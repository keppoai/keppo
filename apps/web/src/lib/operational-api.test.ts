import { describe, expect, it, vi } from "vitest";
import {
  dispatchStartOwnedOperationalRequest,
  handleInternalCronMaintenanceRequest,
  handleInternalDeepHealthRequest,
  handleInternalDlqListRequest,
  handleInternalNotificationsDeliverRequest,
  handleInternalQueueDispatchRequest,
} from "../../app/lib/server/operational-api";

const createDeps = () => {
  const convex = {
    abandonDeadLetter: vi.fn().mockResolvedValue({
      abandoned: true,
      status: "abandoned",
    }),
    checkCronHealth: vi.fn().mockResolvedValue([]),
    cleanupExpiredInvites: vi.fn().mockResolvedValue({ expired: 2 }),
    disableNotificationEndpoint: vi.fn().mockResolvedValue(undefined),
    enqueueDeadLetter: vi.fn().mockResolvedValue(undefined),
    getNotificationDeliveryEvent: vi.fn(),
    listApprovedActionDispatches: vi.fn().mockResolvedValue([
      {
        actionId: "act_pending_1",
        workspaceId: "ws_pending_1",
        idempotencyKey: "idem_pending_1",
        createdAt: "2026-03-14T20:00:00.000Z",
        e2eNamespace: "ns_test",
      },
    ]),
    listPendingDeadLetters: vi.fn().mockResolvedValue([{ id: "dlq_123" }]),
    markNotificationEventFailed: vi.fn().mockResolvedValue({
      attempts: 1,
      shouldRetry: false,
      status: "failed",
      retryAfterMs: null,
      maxRetries: 5,
    }),
    markNotificationEventSent: vi.fn().mockResolvedValue(undefined),
    probeConvexHealth: vi.fn().mockResolvedValue({
      checkedAt: "2026-03-14T20:10:00.000Z",
      featureFlagSampleSize: 0,
    }),
    replayDeadLetter: vi.fn().mockResolvedValue({
      replayed: true,
      status: "replayed",
    }),
    runMaintenanceTick: vi.fn().mockResolvedValue({
      processed: 4,
      expired: 1,
      timedOutRuns: 1,
      securityFlagsCreated: 0,
      credentialLockoutRowsPurged: 0,
      credentialRotationRecommendations: 0,
      notificationsSent: 0,
      notificationsFailed: 0,
      purgedActions: 0,
      purgedBlobs: 0,
      purgedAudits: 0,
    }),
    scheduleApprovedAction: vi.fn(),
    summarizeRateLimitHealth: vi.fn().mockResolvedValue({
      activeKeysLowerBound: 0,
      sampledRows: 0,
      sampleLimit: 200,
      activeWithinMs: 300000,
      buckets: [],
    }),
  };
  const deepHealthReport = {
    ok: true,
    status: "ok" as const,
    checkedAt: "2026-03-14T20:10:00.000Z",
    responseTimeMs: 9,
    subsystems: [{ name: "convex", status: "up", critical: true, responseTimeMs: 2 }],
  };

  return {
    authorizeInternalRequest: vi.fn((authorizationHeader: string | undefined) => ({
      ok: authorizationHeader === "Bearer secret_token",
      ...(authorizationHeader === "Bearer secret_token"
        ? {}
        : { reason: authorizationHeader ? "invalid_secret" : "missing_secret" }),
    })),
    buildDeepHealthReport: vi.fn().mockResolvedValue(deepHealthReport),
    convex,
    emitDeepHealthAlerts: vi.fn(),
    getEnv: vi.fn(
      () =>
        ({
          KEPPO_ACTION_TTL_MINUTES: 60,
          KEPPO_QUEUE_APPROVED_FALLBACK_LIMIT: 5,
          KEPPO_QUEUE_ENQUEUE_SWEEP_LIMIT: 10,
          KEPPO_RUN_INACTIVITY_MINUTES: 30,
        }) as never,
    ),
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
    parsePushSubscription: vi.fn().mockReturnValue({
      endpoint: "https://push.example.test/subscription",
      keys: {
        auth: "auth",
        p256dh: "p256dh",
      },
    }),
    parseJsonPayload: (raw: string) => JSON.parse(raw),
    queueClient: {
      checkHealth: vi.fn().mockResolvedValue({
        ok: true,
        mode: "local",
        detail: "healthy",
      }),
      enqueueApprovedAction: vi.fn().mockResolvedValue({
        messageId: "msg_enqueued_1",
      }),
    },
    sendNotificationEmail: vi.fn().mockResolvedValue({ success: true }),
    sendPushNotification: vi.fn().mockResolvedValue({ success: true }),
    trackAnalyticsEvent: vi.fn(),
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

describe("start-owned operational route handlers", () => {
  it("fails closed for internal queue dispatch when the bearer secret is missing", async () => {
    const deps = createDeps();

    const response = await handleInternalQueueDispatchRequest(
      withJson("/internal/queue/dispatch-approved-action", {
        actionId: "act_1",
        workspaceId: "ws_1",
        idempotencyKey: "idem_1",
        requestedAt: "2026-03-14T20:00:00.000Z",
      }),
      deps,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      reason: "missing_secret",
    });
    expect(deps.queueClient.enqueueApprovedAction).not.toHaveBeenCalled();
  });

  it("enqueues approved-action dispatch payloads from the Start-owned internal route", async () => {
    const deps = createDeps();

    const response = await handleInternalQueueDispatchRequest(
      withJson(
        "/internal/queue/dispatch-approved-action",
        {
          actionId: "act_1",
          workspaceId: "ws_1",
          idempotencyKey: "idem_1",
          requestedAt: "2026-03-14T20:00:00.000Z",
        },
        {
          authorization: "Bearer secret_token",
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.queueClient.enqueueApprovedAction).toHaveBeenCalledWith({
      actionId: "act_1",
      workspaceId: "ws_1",
      idempotencyKey: "idem_1",
      requestedAt: "2026-03-14T20:00:00.000Z",
    });
  });

  it("runs maintenance sweeps from the Start-owned internal cron route", async () => {
    const deps = createDeps();

    const response = await handleInternalCronMaintenanceRequest(
      new Request("http://127.0.0.1/internal/cron/maintenance", {
        method: "POST",
        headers: {
          authorization: "Bearer secret_token",
        },
      }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.queueClient.enqueueApprovedAction).toHaveBeenCalledWith({
      actionId: "act_pending_1",
      workspaceId: "ws_pending_1",
      idempotencyKey: "idem_pending_1",
      requestedAt: "2026-03-14T20:00:00.000Z",
      metadata: {
        source: "cron_sweep",
        e2e_namespace: "ns_test",
      },
    });
    expect(deps.convex.runMaintenanceTick).toHaveBeenCalledWith({
      approvedLimit: 5,
      ttlMinutes: 60,
      inactivityMinutes: 30,
    });
    expect(deps.trackAnalyticsEvent).toHaveBeenCalledWith(
      "cron.maintenance.completed",
      expect.objectContaining({
        path_source: "cron",
        queue_enqueued: 1,
      }),
    );
  });

  it("returns deep health and emits alerts from the Start-owned internal route", async () => {
    const deps = createDeps();

    const response = await handleInternalDeepHealthRequest(
      new Request("http://127.0.0.1/internal/health/deep", {
        headers: {
          authorization: "Bearer secret_token",
        },
      }),
      deps,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: "ok",
    });
    expect(deps.buildDeepHealthReport).toHaveBeenCalledTimes(1);
    expect(deps.emitDeepHealthAlerts).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "ok",
      }),
    );
  });

  it("lists pending DLQ items from the Start-owned internal route", async () => {
    const deps = createDeps();

    const response = await handleInternalDlqListRequest(
      new Request("http://127.0.0.1/internal/dlq?limit=20", {
        headers: {
          authorization: "Bearer secret_token",
        },
      }),
      deps,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      pending: [{ id: "dlq_123" }],
    });
    expect(deps.convex.listPendingDeadLetters).toHaveBeenCalledWith({ limit: 20 });
  });

  it("delivers pending notification events from the Start-owned internal route", async () => {
    const deps = createDeps();
    deps.convex.getNotificationDeliveryEvent.mockResolvedValue({
      event: {
        id: "evt_123",
        org_id: "org_123",
        channel: "email",
        title: "Approval required",
        body: "A queued action needs review.",
        cta_url: "/approvals",
        cta_label: "Review approvals",
        metadata: JSON.stringify({ orgName: "Keppo Ops" }),
        status: "pending",
        endpoint_id: "endpoint_123",
        event_type: "approval_needed",
      },
      endpoint: {
        id: "endpoint_123",
        type: "email",
        destination: "ops@example.com",
        push_subscription: null,
        enabled: true,
      },
    });

    const response = await handleInternalNotificationsDeliverRequest(
      withJson(
        "/internal/notifications/deliver",
        {
          eventIds: ["evt_123"],
        },
        {
          authorization: "Bearer secret_token",
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processed: 1,
      sent: 1,
      failed: 0,
      skipped: 0,
      retryEventIds: [],
      retryJobs: [],
    });
    expect(deps.sendNotificationEmail).toHaveBeenCalledWith(
      "ops@example.com",
      expect.objectContaining({
        eventId: "approval_needed",
        orgName: "Keppo Ops",
      }),
    );
    expect(deps.convex.markNotificationEventSent).toHaveBeenCalledWith("evt_123");
  });

  it("disables push endpoints that fail outbound network policy revalidation", async () => {
    const deps = createDeps();
    deps.convex.getNotificationDeliveryEvent.mockResolvedValue({
      event: {
        id: "evt_push_123",
        org_id: "org_123",
        channel: "push",
        title: "Approval required",
        body: "A queued action needs review.",
        cta_url: "/approvals",
        cta_label: "Review approvals",
        metadata: null,
        status: "pending",
        endpoint_id: "endpoint_123",
        event_type: "approval_needed",
      },
      endpoint: {
        id: "endpoint_123",
        type: "push",
        destination: "https://push.attacker.test/subscription",
        push_subscription: JSON.stringify({
          endpoint: "https://push.attacker.test/subscription",
          keys: {
            auth: "auth",
            p256dh: "p256dh",
          },
        }),
        enabled: true,
      },
    });
    deps.sendPushNotification.mockResolvedValue({
      success: false,
      error: "Push subscription endpoint is not allowed.",
      retryable: false,
      subscriptionInvalid: true,
    });

    const response = await handleInternalNotificationsDeliverRequest(
      withJson(
        "/internal/notifications/deliver",
        {
          eventIds: ["evt_push_123"],
        },
        {
          authorization: "Bearer secret_token",
        },
      ),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.convex.disableNotificationEndpoint).toHaveBeenCalledWith("endpoint_123");
    expect(deps.convex.markNotificationEventFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_push_123",
        error: "Push subscription endpoint is not allowed.",
        retryable: false,
      }),
    );
  });

  it("dispatches only the migrated Start-owned operational paths", async () => {
    const deps = createDeps();

    const cronResponse = await dispatchStartOwnedOperationalRequest(
      new Request("http://127.0.0.1/internal/cron/maintenance", {
        method: "GET",
        headers: {
          authorization: "Bearer secret_token",
        },
      }),
      deps,
    );
    const unhandledResponse = await dispatchStartOwnedOperationalRequest(
      new Request("http://127.0.0.1/internal/health/deep", {
        method: "GET",
        headers: {
          authorization: "Bearer secret_token",
        },
      }),
      deps,
    );
    const dlqResponse = await dispatchStartOwnedOperationalRequest(
      new Request("http://127.0.0.1/internal/dlq"),
      deps,
    );
    const notificationsResponse = await dispatchStartOwnedOperationalRequest(
      new Request("http://127.0.0.1/internal/notifications/deliver", {
        method: "POST",
        headers: {
          authorization: "Bearer secret_token",
        },
        body: JSON.stringify({ eventIds: [] }),
      }),
      deps,
    );
    const forwardedResponse = await dispatchStartOwnedOperationalRequest(
      new Request("http://127.0.0.1/mcp/ws_test", {
        method: "POST",
      }),
      deps,
    );

    expect(cronResponse?.status).toBe(200);
    expect(unhandledResponse?.status).toBe(200);
    expect(dlqResponse?.status).toBe(503);
    expect(notificationsResponse?.status).toBe(200);
    expect(forwardedResponse).toBeNull();
  });
});
