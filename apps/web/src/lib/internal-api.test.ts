import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { PushEndpointBlockedError } from "../../app/lib/server/api-runtime/push";
import {
  dispatchStartOwnedInternalApiRequest,
  handleBuildVersionRequest,
  handleInviteAcceptRequest,
  handleInviteCreateRequest,
  handlePushSubscribeRequest,
  handleWorkspaceMcpTestRequest,
} from "../../app/lib/server/internal-api";

const createDeps = () => {
  const convex = {
    acceptInviteInternal: vi.fn().mockResolvedValue({
      orgId: "org_test",
      orgName: "Test Org",
      role: "viewer",
    }),
    createInviteInternal: vi.fn().mockResolvedValue({
      inviteId: "inv_test",
      rawToken: "inv_tok_test",
      orgName: "Test Org",
    }),
    getBillingUsageForOrg: vi.fn().mockResolvedValue({
      org_id: "org_test",
      tier: "pro",
      status: "active",
      billing_source: "stripe",
      invite_promo: null,
      period_start: "2026-03-01T00:00:00.000Z",
      period_end: "2026-04-01T00:00:00.000Z",
      usage: {
        id: "usage_test",
        org_id: "org_test",
        period_start: "2026-03-01T00:00:00.000Z",
        period_end: "2026-04-01T00:00:00.000Z",
        tool_call_count: 12,
        total_tool_call_time_ms: 1_200,
        updated_at: "2026-03-14T08:00:00.000Z",
      },
      limits: {
        price_cents_monthly: 7_500,
        max_workspaces: 10,
        max_members: 25,
        max_tool_calls_per_month: 1_000,
        tool_call_timeout_ms: 30_000,
        max_total_tool_call_time_ms: 3_600_000,
        included_ai_credits: {
          total: 300,
          bundled_runtime_enabled: true,
        },
      },
    }),
    getSubscriptionForOrg: vi.fn().mockResolvedValue({
      org_id: "org_test",
      stripe_customer_id: "cus_test",
    }),
    getWorkspaceById: vi.fn().mockResolvedValue({
      id: "ws_test",
      org_id: "org_test",
      name: "Workspace Test",
    }),
    getWorkspaceCredentialStatus: vi.fn().mockResolvedValue({
      has_active_credential: true,
      last_rotated_at: "2026-03-14T08:00:00.000Z",
    }),
    registerPushEndpointForUser: vi.fn().mockResolvedValue({
      id: "endpoint_test",
    }),
    resolveApiSessionFromToken: vi.fn().mockResolvedValue({
      userId: "user_test",
      orgId: "org_test",
      role: "owner",
    }),
    storeInviteToken: vi.fn().mockResolvedValue(undefined),
  };

  return {
    convex,
    getEnv: vi.fn(
      () =>
        ({
          KEPPO_E2E_MODE: false,
          KEPPO_DASHBOARD_ORIGIN: "http://localhost:3000",
        }) as never,
    ),
    parseJsonPayload: (raw: string) => JSON.parse(raw),
    readBetterAuthSessionToken: (cookieHeader: string | undefined) => {
      if (!cookieHeader) {
        return null;
      }
      const match =
        cookieHeader.match(/better-auth\.session_token=([^;]+)/) ??
        cookieHeader.match(/session_token=([^;]+)/);
      return match?.[1]?.split(".")[0] ?? null;
    },
    sendInviteEmail: vi.fn().mockResolvedValue({ success: true }),
    validatePushSubscriptionEndpoint: vi.fn().mockResolvedValue(undefined),
  };
};

const withJson = (path: string, body: unknown, headers?: HeadersInit): Request =>
  new Request(`http://127.0.0.1${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });

describe("start-owned internal api handlers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires authentication for invite creation", async () => {
    const deps = createDeps();

    const response = await handleInviteCreateRequest(
      withJson("/api/invites/create", {
        email: "teammate@example.com",
        role: "viewer",
      }),
      deps,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(deps.convex.createInviteInternal).not.toHaveBeenCalled();
  });

  it("rejects invalid invite roles before business logic", async () => {
    const deps = createDeps();

    const response = await handleInviteCreateRequest(
      withJson(
        "/api/invites/create",
        {
          email: "teammate@example.com",
          role: "invalid",
        },
        {
          cookie: "better-auth.session_token=session_token_test",
        },
      ),
      deps,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid option: expected one of "owner"|"admin"|"approver"|"viewer"',
    });
    expect(deps.convex.createInviteInternal).not.toHaveBeenCalled();
  });

  it("derives invite acceptance user from the authenticated session", async () => {
    const deps = createDeps();

    const response = await handleInviteAcceptRequest(
      withJson(
        "/api/invites/accept",
        {
          token: "invite_token",
        },
        {
          cookie: "better-auth.session_token=session_token_test",
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.convex.acceptInviteInternal).toHaveBeenCalledWith({
      tokenHash: createHash("sha256").update("invite_token", "utf8").digest("hex"),
      userId: "user_test",
    });
  });

  it("accepts Better-Auth-Cookie for push subscription session resolution", async () => {
    const deps = createDeps();

    const response = await handlePushSubscribeRequest(
      withJson(
        "/api/notifications/push/subscribe",
        {
          subscription: {
            endpoint: "https://push.test/subscriptions/abc",
            keys: {
              p256dh: "key",
              auth: "auth",
            },
          },
        },
        {
          "better-auth-cookie":
            "better-auth.session_token=session_token_test.signed%2Bsegment; better-auth.convex_jwt=fake",
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.convex.registerPushEndpointForUser).toHaveBeenCalledWith({
      orgId: "org_test",
      userId: "user_test",
      destination: "https://push.test/subscriptions/abc",
      pushSubscription: expect.any(String),
    });
    expect(deps.validatePushSubscriptionEndpoint).toHaveBeenCalledWith(
      "https://push.test/subscriptions/abc",
    );
  });

  it("rejects blocked push subscription endpoints before registration", async () => {
    const deps = createDeps();
    deps.validatePushSubscriptionEndpoint.mockRejectedValue(
      new PushEndpointBlockedError("Push subscription endpoint resolves to a blocked address."),
    );

    const response = await handlePushSubscribeRequest(
      withJson(
        "/api/notifications/push/subscribe",
        {
          subscription: {
            endpoint: "https://push.attacker.test/subscriptions/abc",
            keys: {
              p256dh: "key",
              auth: "auth",
            },
          },
        },
        {
          cookie: "better-auth.session_token=session_token_test",
        },
      ),
      deps,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error_code: "notifications.push.registration_failed",
      error: "Push subscription endpoint is not allowed.",
    });
    expect(deps.convex.registerPushEndpointForUser).not.toHaveBeenCalled();
  });

  it("returns workspace credential status from the authenticated workspace context", async () => {
    const deps = createDeps();

    const response = await handleWorkspaceMcpTestRequest(
      new Request("http://127.0.0.1/api/mcp/test?workspaceId=ws_test", {
        headers: {
          cookie: "better-auth.session_token=session_token_test",
        },
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      workspace_id: "ws_test",
      workspace_name: "Workspace Test",
      last_rotated_at: "2026-03-14T08:00:00.000Z",
      message: "Workspace MCP credential is active.",
    });
  });

  it("requires authentication for build-version checks", async () => {
    const deps = createDeps();

    const response = await handleBuildVersionRequest(
      new Request("http://127.0.0.1/api/version"),
      deps,
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error_code: "auth.unauthorized",
      error: "Authentication required.",
      status: 401,
      technical_details: "auth.unauthorized",
      technical_details_safe_for_public: true,
    });
  });

  it("returns the current build id for authenticated sessions", async () => {
    vi.stubEnv("VERCEL_DEPLOYMENT_ID", "dpl_test_current");
    const deps = createDeps();

    const response = await handleBuildVersionRequest(
      new Request("https://app.example.com/api/version", {
        headers: {
          cookie: "better-auth.session_token=session_token_test",
        },
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("strict-transport-security")).toContain("max-age=31536000");
    expect(await response.json()).toEqual({
      ok: true,
      buildId: "dpl_test_current",
    });
  });

  it("dispatches known start-owned internal requests in-process", async () => {
    const deps = createDeps();

    const handled = await dispatchStartOwnedInternalApiRequest(
      withJson(
        "/api/invites/create",
        {
          email: "teammate@example.com",
          role: "viewer",
        },
        {
          cookie: "better-auth.session_token=session_token_test",
        },
      ),
      deps,
    );
    const unhandled = await dispatchStartOwnedInternalApiRequest(
      new Request("http://127.0.0.1/api/oauth/integrations/google/connect", { method: "POST" }),
      deps,
    );
    const buildVersion = await dispatchStartOwnedInternalApiRequest(
      new Request("http://127.0.0.1/api/version", {
        headers: {
          cookie: "better-auth.session_token=session_token_test",
        },
      }),
      deps,
    );

    expect(handled?.status).toBe(200);
    expect(buildVersion?.status).toBe(200);
    expect(unhandled).toBeNull();
  });
});
