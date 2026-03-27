import { afterEach, describe, expect, it, vi } from "vitest";
import {
  dispatchStartOwnedAdminHealthRequest,
  handleAuditErrorsRequest,
  handleDeepHealthRequest,
  handleFeatureFlagsRequest,
} from "../../app/lib/server/admin-health-api";

const createDeps = () => {
  const baseEnv = {
    KEPPO_ADMIN_USER_IDS: undefined,
    KEPPO_URL: "http://localhost:3000",
    KEPPO_DLQ_ALERT_THRESHOLD: 10,
    KEPPO_LOCAL_ADMIN_BYPASS: false,
    KEPPO_MASTER_KEY: "master_key_test",
    CONVEX_URL: "http://localhost:3210",
    NODE_ENV: "test",
  };
  const convex = {
    abandonDeadLetter: vi.fn().mockResolvedValue({
      abandoned: true,
      status: "abandoned",
    }),
    checkCronHealth: vi.fn().mockResolvedValue([]),
    listAllFeatureFlags: vi.fn().mockResolvedValue([
      {
        id: "flag_registry",
        key: "KEPPO_FEATURE_PROVIDER_REGISTRY_PATH",
        label: "Provider Registry Path",
        description: "Global registry toggle",
        enabled: true,
        created_at: "2026-03-14T08:00:00.000Z",
        updated_at: "2026-03-14T08:00:00.000Z",
      },
    ]),
    listPendingDeadLetters: vi.fn().mockResolvedValue([]),
    listRecentAuditErrors: vi.fn().mockResolvedValue([
      {
        id: "audit_err_1",
        actor_type: "system",
        actor_id: "api",
        event_type: "action_execution_failed",
        payload: { provider: "google" },
        created_at: "2026-03-14T08:00:00.000Z",
      },
    ]),
    probeConvexHealth: vi.fn().mockResolvedValue({
      checkedAt: "2026-03-14T08:00:00.000Z",
      featureFlagSampleSize: 1,
    }),
    replayDeadLetter: vi.fn().mockResolvedValue({
      replayed: true,
      status: "replayed",
    }),
    resolveApiSessionFromToken: vi.fn().mockResolvedValue({
      userId: "user_test",
      orgId: "org_test",
      role: "owner",
    }),
    summarizeRateLimitHealth: vi.fn().mockResolvedValue({
      activeKeysLowerBound: 0,
      sampledRows: 0,
      sampleLimit: 200,
      activeWithinMs: 300000,
      buckets: [],
    }),
  };

  return {
    baseEnv,
    convex,
    getEnv: vi.fn(() => baseEnv as never),
    queueClient: {
      checkHealth: vi.fn().mockResolvedValue({
        ok: true,
        mode: "convex",
        detail: {
          checkedAt: "2026-03-14T08:00:00.000Z",
        },
      }),
      enqueueApprovedAction: vi.fn(),
    },
    readBetterAuthSessionToken: (cookieHeader: string | undefined) => {
      if (!cookieHeader) {
        return null;
      }
      const match =
        cookieHeader.match(/better-auth\.session_token=([^;]+)/) ??
        cookieHeader.match(/session_token=([^;]+)/);
      return match?.[1]?.split(".")[0] ?? null;
    },
  };
};

const withCookie = (path: string, init?: RequestInit): Request =>
  new Request(`http://127.0.0.1${path}`, {
    ...init,
    headers: {
      cookie: "better-auth.session_token=session_token_test",
      ...init?.headers,
    },
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("start-owned admin health api handlers", () => {
  it("requires authentication for deep health", async () => {
    const deps = createDeps();

    const response = await handleDeepHealthRequest(
      new Request("http://127.0.0.1/api/health/deep"),
      deps,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(deps.convex.probeConvexHealth).not.toHaveBeenCalled();
  });

  it("requires authentication for feature flags before reading Convex state", async () => {
    const deps = createDeps();

    const response = await handleFeatureFlagsRequest(
      new Request("http://127.0.0.1/api/health/flags"),
      deps,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(deps.convex.listAllFeatureFlags).not.toHaveBeenCalled();
  });

  it("requires authentication for audit errors before reading Convex state", async () => {
    const deps = createDeps();

    const response = await handleAuditErrorsRequest(
      new Request("http://127.0.0.1/api/health/audit-errors?limit=20"),
      deps,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(deps.convex.listRecentAuditErrors).not.toHaveBeenCalled();
  });

  it("rejects authenticated non-admin users before reading feature flags", async () => {
    const deps = createDeps();

    const response = await handleFeatureFlagsRequest(withCookie("/api/health/flags"), deps);

    expect(response.status).toBe(403);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "forbidden",
    });
    expect(deps.convex.listAllFeatureFlags).not.toHaveBeenCalled();
  });

  it("rejects authenticated non-admin users before reading audit errors", async () => {
    const deps = createDeps();

    const response = await handleAuditErrorsRequest(
      withCookie("/api/health/audit-errors?limit=20"),
      deps,
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "forbidden",
    });
    expect(deps.convex.listRecentAuditErrors).not.toHaveBeenCalled();
  });

  it("fails closed when local admin bypass is enabled outside a local runtime", async () => {
    const deps = createDeps();
    deps.getEnv.mockReturnValue({
      ...deps.baseEnv,
      KEPPO_URL: "https://app.keppo.test",
      KEPPO_LOCAL_ADMIN_BYPASS: true,
      CONVEX_URL: "https://example.convex.cloud",
      NODE_ENV: "production",
    } as never);

    const response = await handleDeepHealthRequest(withCookie("/api/health/deep"), deps);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: "forbidden",
    });
  });

  it("returns degraded deep health for platform admins when a critical subsystem is down", async () => {
    const deps = createDeps();
    deps.getEnv.mockReturnValue({
      ...deps.baseEnv,
      KEPPO_ADMIN_USER_IDS: "user_test",
      KEPPO_DLQ_ALERT_THRESHOLD: 2,
    } as never);
    deps.convex.listPendingDeadLetters.mockResolvedValue([
      {
        id: "dlq_1",
        sourceTable: "notification_events",
        sourceId: "nev_1",
        failureReason: "failed",
        retryCount: 3,
        maxRetries: 3,
        lastAttemptAt: "2026-03-14T08:00:00.000Z",
        createdAt: "2026-03-14T07:59:00.000Z",
      },
      {
        id: "dlq_2",
        sourceTable: "notification_events",
        sourceId: "nev_2",
        failureReason: "failed",
        retryCount: 3,
        maxRetries: 3,
        lastAttemptAt: "2026-03-14T08:00:01.000Z",
        createdAt: "2026-03-14T07:59:01.000Z",
      },
      {
        id: "dlq_3",
        sourceTable: "notification_events",
        sourceId: "nev_3",
        failureReason: "failed",
        retryCount: 3,
        maxRetries: 3,
        lastAttemptAt: "2026-03-14T08:00:02.000Z",
        createdAt: "2026-03-14T07:59:02.000Z",
      },
    ]);

    const response = await handleDeepHealthRequest(withCookie("/api/health/deep"), deps);

    expect(response.status).toBe(503);
    const payload = (await response.json()) as {
      ok?: boolean;
      status?: string;
      subsystems?: Array<{ name?: string; status?: string; overThreshold?: boolean }>;
    };
    expect(payload).toMatchObject({
      ok: false,
      status: "degraded",
    });
    expect(payload.subsystems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "convex",
          status: "up",
        }),
        expect.objectContaining({
          name: "queue",
          status: "up",
        }),
        expect.objectContaining({
          name: "master_key",
          status: "up",
        }),
        expect.objectContaining({
          name: "cron",
          status: "up",
        }),
        expect.objectContaining({
          name: "dlq",
          status: "down",
          overThreshold: true,
        }),
      ]),
    );
  });

  it("returns feature flags for platform admins", async () => {
    const deps = createDeps();
    deps.getEnv.mockReturnValue({
      ...deps.baseEnv,
      KEPPO_ADMIN_USER_IDS: "user_test",
    } as never);

    const response = await handleFeatureFlagsRequest(withCookie("/api/health/flags"), deps);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      flags: [expect.objectContaining({ key: "KEPPO_FEATURE_PROVIDER_REGISTRY_PATH" })],
    });
  });

  it("passes the requested limit through to audit errors", async () => {
    const deps = createDeps();
    deps.getEnv.mockReturnValue({
      ...deps.baseEnv,
      KEPPO_ADMIN_USER_IDS: "user_test",
    } as never);

    const response = await handleAuditErrorsRequest(
      withCookie("/api/health/audit-errors?limit=20"),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.convex.listRecentAuditErrors).toHaveBeenCalledWith({ limit: 20 });
  });

  it("dispatches DLQ replay requests in-process", async () => {
    const deps = createDeps();
    deps.getEnv.mockReturnValue({
      ...deps.baseEnv,
      KEPPO_ADMIN_USER_IDS: "user_test",
    } as never);

    const handled = await dispatchStartOwnedAdminHealthRequest(
      withCookie("/api/health/dlq/dlq_123/replay", { method: "POST" }),
      deps,
    );
    const unhandled = await dispatchStartOwnedAdminHealthRequest(
      withCookie("/api/health/unknown"),
      deps,
    );

    expect(handled?.status).toBe(200);
    await expect(handled?.json()).resolves.toMatchObject({
      ok: true,
      dlqId: "dlq_123",
      replayed: true,
      status: "replayed",
    });
    expect(deps.convex.replayDeadLetter).toHaveBeenCalledWith({ dlqId: "dlq_123" });
    expect(unhandled).toBeNull();
  });
});
