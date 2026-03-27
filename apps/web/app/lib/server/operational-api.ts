import {
  buildBoundaryErrorEnvelope,
  parseInternalNotificationsDeliverRequest,
  parseApprovedActionDispatchRequest,
} from "@keppo/shared/providers/boundaries/error-boundary";
import { isJsonRecord, parseJsonValue } from "@keppo/shared/providers/boundaries/json";
import {
  NOTIFICATION_DELIVERY_STATUS,
  QUEUE_ROUTE_PATH_SOURCE,
  QUEUE_ROUTE_STATUS,
} from "@keppo/shared/domain";
import { parseJsonPayload } from "./api-runtime/app-helpers.ts";
import { captureApiEvent } from "./api-runtime/posthog.ts";
import { ConvexInternalClient } from "./api-runtime/convex.ts";
import { sendNotificationEmail } from "./api-runtime/email.ts";
import { getEnv } from "./api-runtime/env.ts";
import { isInternalBearerAuthorized } from "./api-runtime/internal-auth.ts";
import { logger } from "./api-runtime/logger.ts";
import { parsePushSubscription, sendPushNotification } from "./api-runtime/push.ts";
import { createQueueClient, type QueueClient } from "./api-runtime/queue.ts";
import {
  buildDeepHealthReport,
  emitDeepHealthAlerts,
  getDefaultStartOwnedHealthRuntimeDeps,
  type DeepHealthReport,
} from "./health-runtime";
import { dispatchStartOwnedAutomationRuntimeRequest } from "./automation-runtime";

const SECURITY_HEADER_VALUES = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
} as const;

type StartOwnedOperationalConvex = Pick<
  ConvexInternalClient,
  | "abandonDeadLetter"
  | "checkCronHealth"
  | "cleanupExpiredInvites"
  | "disableNotificationEndpoint"
  | "enqueueDeadLetter"
  | "getNotificationDeliveryEvent"
  | "listApprovedActionDispatches"
  | "listPendingDeadLetters"
  | "markNotificationEventFailed"
  | "markNotificationEventSent"
  | "probeConvexHealth"
  | "replayDeadLetter"
  | "runMaintenanceTick"
  | "scheduleApprovedAction"
  | "summarizeRateLimitHealth"
>;

type RouteLogger = Pick<typeof logger, "error" | "info" | "warn">;

type StartOwnedOperationalDeps = {
  authorizeInternalRequest: (authorizationHeader: string | undefined) => {
    ok: boolean;
    reason?: string;
  };
  convex: StartOwnedOperationalConvex;
  getEnv: typeof getEnv;
  logger: RouteLogger;
  parseJsonPayload: typeof parseJsonPayload;
  queueClient: Pick<QueueClient, "checkHealth" | "enqueueApprovedAction">;
  sendNotificationEmail: typeof sendNotificationEmail;
  parsePushSubscription: typeof parsePushSubscription;
  sendPushNotification: typeof sendPushNotification;
  trackAnalyticsEvent: (
    event: string,
    properties: Record<string, unknown>,
    distinctId?: string,
  ) => void;
  buildDeepHealthReport: () => Promise<DeepHealthReport>;
  emitDeepHealthAlerts: (report: DeepHealthReport) => void;
};

let convexClient: ConvexInternalClient | null = null;
let queueClient: QueueClient | null = null;

const withSecurityHeaders = (request: Request, init?: ResponseInit): ResponseInit => {
  const headers = new Headers(init?.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADER_VALUES)) {
    headers.set(key, value);
  }
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return {
    ...init,
    headers,
  };
};

const jsonResponse = (request: Request, payload: unknown, status = 200): Response => {
  return Response.json(payload, withSecurityHeaders(request, { status }));
};

const redirectResponse = (request: Request, location: string, status = 302): Response => {
  return new Response(
    null,
    withSecurityHeaders(request, { status, headers: { Location: location } }),
  );
};

const getDefaultDeps = (): StartOwnedOperationalDeps => {
  const healthRuntimeDeps = getDefaultStartOwnedHealthRuntimeDeps();
  const convex = (convexClient ??= new ConvexInternalClient());
  queueClient ??= createQueueClient(convex);

  return {
    authorizeInternalRequest: (authorizationHeader) =>
      isInternalBearerAuthorized({
        authorizationHeader,
        allowWhenSecretMissing: false,
      }),
    convex,
    getEnv,
    logger,
    parseJsonPayload,
    sendNotificationEmail,
    parsePushSubscription,
    sendPushNotification,
    queueClient,
    trackAnalyticsEvent: (event, properties, distinctId) => {
      captureApiEvent(event, {
        ...(distinctId ? { distinctId } : {}),
        properties: {
          source: "api",
          ...properties,
        },
      });
    },
    buildDeepHealthReport: async () => await buildDeepHealthReport(healthRuntimeDeps),
    emitDeepHealthAlerts: (report) => {
      emitDeepHealthAlerts(report, healthRuntimeDeps);
    },
  };
};

const resolveOAuthHelperPlatform = (request: Request): "macos" | "windows" | null => {
  const match = /^\/downloads\/oauth-helper\/([^/]+)\/latest\/?$/u.exec(
    new URL(request.url).pathname,
  );
  if (!match?.[1]) {
    return null;
  }
  if (match[1] === "macos" || match[1] === "windows") {
    return match[1];
  }
  return null;
};

const isOAuthHelperDownloadPath = (pathname: string): boolean => {
  return /^\/downloads\/oauth-helper\/[^/]+\/latest\/?$/u.test(pathname);
};

const isInternalCronPath = (pathname: string): boolean => {
  return pathname === "/internal/cron/maintenance";
};

const isInternalQueueDispatchPath = (pathname: string): boolean => {
  return pathname === "/internal/queue/dispatch-approved-action";
};

const isInternalDeepHealthPath = (pathname: string): boolean => {
  return pathname === "/internal/health/deep";
};

const isInternalDlqListPath = (pathname: string): boolean => {
  return pathname === "/internal/dlq";
};

const isInternalNotificationsDeliverPath = (pathname: string): boolean => {
  return pathname === "/internal/notifications/deliver";
};

const resolveInternalDlqAction = (
  pathname: string,
): { action: "replay" | "abandon"; id: string } | null => {
  const match = /^\/internal\/dlq\/([^/]+)\/(replay|abandon)\/?$/u.exec(pathname);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    action: match[2] === "replay" ? "replay" : "abandon",
    id: decodeURIComponent(match[1]),
  };
};

const parseLimit = (request: Request, fallback: number): number => {
  const limitRaw = new URL(request.url).searchParams.get("limit");
  if (!limitRaw) {
    return fallback;
  }
  const parsed = Number.parseInt(limitRaw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseNotificationMetadata = (encoded: string | undefined | null): Record<string, string> => {
  if (!encoded) {
    return {};
  }

  try {
    const parsed = parseJsonValue(encoded);
    if (!isJsonRecord(parsed)) {
      return {};
    }

    const output: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        output[key] = value;
      } else if (typeof value === "number" || typeof value === "boolean") {
        output[key] = String(value);
      }
    }
    return output;
  } catch {
    return {};
  }
};

const DEFAULT_NOTIFICATION_RETRY_AFTER_MS = 10_000;
const MIN_NOTIFICATION_RETRY_AFTER_MS = 1_000;
const MAX_NOTIFICATION_RETRY_AFTER_MS = 15 * 60_000;

const clampNotificationRetryAfterMs = (retryAfterMs: number | null | undefined): number => {
  if (typeof retryAfterMs !== "number" || !Number.isFinite(retryAfterMs)) {
    return DEFAULT_NOTIFICATION_RETRY_AFTER_MS;
  }
  return Math.max(
    MIN_NOTIFICATION_RETRY_AFTER_MS,
    Math.min(MAX_NOTIFICATION_RETRY_AFTER_MS, Math.floor(retryAfterMs)),
  );
};

const enqueueApprovedActions = async (deps: StartOwnedOperationalDeps) => {
  const env = deps.getEnv();
  const approved = await deps.convex.listApprovedActionDispatches({
    limit: env.KEPPO_QUEUE_ENQUEUE_SWEEP_LIMIT,
  });

  let enqueued = 0;
  let failed = 0;
  for (const item of approved) {
    try {
      await deps.queueClient.enqueueApprovedAction({
        actionId: item.actionId,
        workspaceId: item.workspaceId,
        idempotencyKey: item.idempotencyKey,
        requestedAt: item.createdAt,
        metadata: {
          source: "cron_sweep",
          ...(item.e2eNamespace ? { e2e_namespace: item.e2eNamespace } : {}),
        },
      });
      enqueued += 1;
    } catch (error) {
      failed += 1;
      deps.logger.error("queue.dispatch.failed", {
        path_source: "cron",
        action_id: item.actionId,
        workspace_id: item.workspaceId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    attempted: approved.length,
    enqueued,
    failed,
  };
};

const internalUnauthorizedResponse = (request: Request, reason: string | undefined): Response => {
  const statusCode = reason === "missing_secret" ? 503 : 401;
  return jsonResponse(
    request,
    {
      ok: false,
      status: QUEUE_ROUTE_STATUS.unauthorized,
      reason: reason ?? QUEUE_ROUTE_STATUS.unauthorized,
    },
    statusCode,
  );
};

export const handleOAuthHelperLatestDownloadRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const platform = resolveOAuthHelperPlatform(request);
  const env = deps.getEnv();
  const targetUrl =
    platform === "macos"
      ? env.KEPPO_OAUTH_HELPER_MACOS_URL
      : platform === "windows"
        ? env.KEPPO_OAUTH_HELPER_WINDOWS_URL
        : null;

  if (!targetUrl) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: "artifact_unavailable",
        error:
          platform === "macos" || platform === "windows"
            ? `No ${platform} OAuth helper artifact has been configured.`
            : "Unknown helper artifact platform.",
      },
      platform === "macos" || platform === "windows" ? 404 : 400,
    );
  }

  return redirectResponse(request, targetUrl);
};

export const handleInternalQueueDispatchRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const auth = deps.authorizeInternalRequest(request.headers.get("authorization") ?? undefined);
  if (!auth.ok) {
    return internalUnauthorizedResponse(request, auth.reason);
  }

  let payload: ReturnType<typeof parseApprovedActionDispatchRequest>;
  try {
    payload = parseApprovedActionDispatchRequest(deps.parseJsonPayload(await request.text()));
  } catch (error) {
    const boundaryEnvelope = buildBoundaryErrorEnvelope(error, {
      defaultCode: "invalid_queue_dispatch_payload",
      defaultMessage: "Dispatch payload must be valid JSON.",
      source: "api",
    });

    return jsonResponse(
      request,
      {
        ok: false,
        status: QUEUE_ROUTE_STATUS.invalidQueueDispatchPayload,
        code: boundaryEnvelope.error.code,
        message: boundaryEnvelope.error.message,
        error: boundaryEnvelope.error,
      },
      400,
    );
  }

  try {
    const enqueued = await deps.queueClient.enqueueApprovedAction({
      actionId: payload.actionId,
      workspaceId: payload.workspaceId,
      idempotencyKey: payload.idempotencyKey,
      requestedAt: payload.requestedAt,
      ...(payload.metadata ? { metadata: payload.metadata } : {}),
    });

    deps.logger.info("queue.dispatch.enqueued", {
      path_source: QUEUE_ROUTE_PATH_SOURCE.approvalTransition,
      action_id: payload.actionId,
      workspace_id: payload.workspaceId,
      message_id: enqueued.messageId,
    });

    return jsonResponse(request, {
      ok: true,
      status: QUEUE_ROUTE_STATUS.enqueued,
      path_source: QUEUE_ROUTE_PATH_SOURCE.approvalTransition,
      message_id: enqueued.messageId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.logger.error("queue.dispatch.failed", {
      path_source: QUEUE_ROUTE_PATH_SOURCE.approvalTransition,
      action_id: payload.actionId,
      workspace_id: payload.workspaceId,
      error: errorMessage,
    });

    return jsonResponse(
      request,
      {
        ok: false,
        status: QUEUE_ROUTE_STATUS.enqueueFailed,
        path_source: QUEUE_ROUTE_PATH_SOURCE.approvalTransition,
        error: errorMessage,
      },
      500,
    );
  }
};

export const handleInternalCronMaintenanceRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const auth = deps.authorizeInternalRequest(request.headers.get("authorization") ?? undefined);
  if (!auth.ok) {
    return internalUnauthorizedResponse(request, auth.reason);
  }

  const env = deps.getEnv();
  try {
    const queueStats = await enqueueApprovedActions(deps);
    const maintenanceResult = await deps.convex.runMaintenanceTick({
      approvedLimit: env.KEPPO_QUEUE_APPROVED_FALLBACK_LIMIT,
      ttlMinutes: env.KEPPO_ACTION_TTL_MINUTES,
      inactivityMinutes: env.KEPPO_RUN_INACTIVITY_MINUTES,
    });
    const inviteMaintenanceResult = await deps.convex.cleanupExpiredInvites();

    deps.logger.info("maintenance.cron.tick", {
      path_source: "cron",
      result: "success",
      queue_attempted: queueStats.attempted,
      queue_enqueued: queueStats.enqueued,
      queue_failed: queueStats.failed,
      processed: maintenanceResult.processed,
      expired: maintenanceResult.expired,
      timed_out_runs: maintenanceResult.timedOutRuns,
    });
    deps.trackAnalyticsEvent("cron.maintenance.completed", {
      path_source: "cron",
      queue_attempted: queueStats.attempted,
      queue_enqueued: queueStats.enqueued,
      queue_failed: queueStats.failed,
      processed: maintenanceResult.processed,
      expired: maintenanceResult.expired,
      timed_out_runs: maintenanceResult.timedOutRuns,
    });

    return jsonResponse(request, {
      ok: true,
      status: "ok",
      path_source: "cron",
      queue: queueStats,
      maintenance: maintenanceResult,
      invites: inviteMaintenanceResult,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.logger.error("maintenance.cron.tick", {
      path_source: "cron",
      result: "failed",
      error: errorMessage,
    });
    deps.trackAnalyticsEvent("cron.maintenance.failed", {
      path_source: "cron",
      error: errorMessage,
    });
    return jsonResponse(
      request,
      {
        ok: false,
        status: "failed",
        path_source: "cron",
        error: errorMessage,
      },
      500,
    );
  }
};

export const handleInternalDeepHealthRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const auth = deps.authorizeInternalRequest(request.headers.get("authorization") ?? undefined);
  if (!auth.ok) {
    return internalUnauthorizedResponse(request, auth.reason);
  }

  const report = await deps.buildDeepHealthReport();
  deps.emitDeepHealthAlerts(report);
  return jsonResponse(request, report, report.ok ? 200 : 503);
};

export const handleInternalNotificationsDeliverRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const auth = deps.authorizeInternalRequest(request.headers.get("authorization") ?? undefined);
  if (!auth.ok) {
    return internalUnauthorizedResponse(request, auth.reason);
  }

  let payload: ReturnType<typeof parseInternalNotificationsDeliverRequest>;
  try {
    payload = parseInternalNotificationsDeliverRequest(deps.parseJsonPayload(await request.text()));
  } catch {
    return jsonResponse(
      request,
      {
        ok: false,
        status: "invalid_notifications_deliver_payload",
        error: "Notification delivery payload must be valid JSON.",
      },
      400,
    );
  }

  const eventIds = payload.eventIds;
  const deliveryNamespace = request.headers.get("x-keppo-e2e-namespace")?.trim();

  if (eventIds.length === 0) {
    return jsonResponse(request, {
      ok: true,
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      retryEventIds: [],
      retryJobs: [],
    });
  }

  const retryEventIds: string[] = [];
  const retryJobs: Array<{ eventId: string; retryAfterMs: number }> = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let processed = 0;

  const queueRetryJob = (eventId: string, retryAfterMs: number | null | undefined) => {
    retryEventIds.push(eventId);
    retryJobs.push({
      eventId,
      retryAfterMs: clampNotificationRetryAfterMs(retryAfterMs),
    });
  };

  for (const eventId of eventIds) {
    const delivery = await deps.convex.getNotificationDeliveryEvent(eventId);
    if (!delivery || delivery.event.status !== NOTIFICATION_DELIVERY_STATUS.pending) {
      skipped += 1;
      continue;
    }
    processed += 1;

    const endpoint = delivery.endpoint;
    const deadLetterPayload = deliveryNamespace
      ? { deadLetterPayload: { e2eNamespace: deliveryNamespace } }
      : {};
    if (!endpoint || !endpoint.enabled) {
      const failedResult = await deps.convex.markNotificationEventFailed({
        eventId,
        error: "Notification endpoint is unavailable",
        retryable: false,
        ...deadLetterPayload,
      });
      if (failedResult.shouldRetry) {
        queueRetryJob(eventId, failedResult.retryAfterMs);
      }
      failed += 1;
      continue;
    }

    const notificationPayload = {
      eventId: delivery.event.event_type,
      orgId: delivery.event.org_id,
      orgName: parseNotificationMetadata(delivery.event.metadata).orgName ?? delivery.event.org_id,
      title: delivery.event.title,
      body: delivery.event.body,
      ctaUrl: delivery.event.cta_url,
      ctaLabel: delivery.event.cta_label,
      metadata: parseNotificationMetadata(delivery.event.metadata),
    };

    if (delivery.event.channel === "email") {
      if (endpoint.type !== "email") {
        const failedResult = await deps.convex.markNotificationEventFailed({
          eventId,
          error: "Email notification endpoint type mismatch",
          retryable: false,
          ...deadLetterPayload,
        });
        if (failedResult.shouldRetry) {
          queueRetryJob(eventId, failedResult.retryAfterMs);
        }
        failed += 1;
        continue;
      }

      const result = await deps.sendNotificationEmail(endpoint.destination, notificationPayload);
      if (result.success) {
        await deps.convex.markNotificationEventSent(eventId);
        sent += 1;
        continue;
      }

      const failedResult = await deps.convex.markNotificationEventFailed({
        eventId,
        error: result.error ?? "Email delivery failed",
        retryable: result.retryable ?? true,
        ...deadLetterPayload,
      });
      if (failedResult.shouldRetry) {
        queueRetryJob(eventId, failedResult.retryAfterMs);
      }
      failed += 1;
      continue;
    }

    if (delivery.event.channel === "push") {
      if (endpoint.type !== "push") {
        const failedResult = await deps.convex.markNotificationEventFailed({
          eventId,
          error: "Push notification endpoint type mismatch",
          retryable: false,
          ...deadLetterPayload,
        });
        if (failedResult.shouldRetry) {
          queueRetryJob(eventId, failedResult.retryAfterMs);
        }
        failed += 1;
        continue;
      }

      const subscription = endpoint.push_subscription
        ? deps.parsePushSubscription(endpoint.push_subscription)
        : null;
      if (!subscription) {
        const failedResult = await deps.convex.markNotificationEventFailed({
          eventId,
          error: "Push subscription payload is missing or invalid",
          retryable: false,
          ...deadLetterPayload,
        });
        if (failedResult.shouldRetry) {
          queueRetryJob(eventId, failedResult.retryAfterMs);
        }
        failed += 1;
        continue;
      }

      const result = await deps.sendPushNotification(subscription, notificationPayload);
      if (result.success) {
        await deps.convex.markNotificationEventSent(eventId);
        sent += 1;
        continue;
      }

      if (result.subscriptionExpired) {
        await deps.convex.disableNotificationEndpoint(endpoint.id);
      }

      const failedResult = await deps.convex.markNotificationEventFailed({
        eventId,
        error: result.error ?? "Push delivery failed",
        retryable: result.retryable ?? true,
        ...deadLetterPayload,
      });
      if (failedResult.shouldRetry) {
        queueRetryJob(eventId, failedResult.retryAfterMs);
      }
      failed += 1;
      continue;
    }

    skipped += 1;
  }

  return jsonResponse(request, {
    ok: true,
    processed,
    sent,
    failed,
    skipped,
    retryEventIds,
    retryJobs,
  });
};

export const handleInternalDlqListRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const auth = deps.authorizeInternalRequest(request.headers.get("authorization") ?? undefined);
  if (!auth.ok) {
    return internalUnauthorizedResponse(request, auth.reason);
  }

  const pending = await deps.convex.listPendingDeadLetters({ limit: parseLimit(request, 50) });
  return jsonResponse(request, {
    ok: true,
    pending,
  });
};

const handleInternalDlqActionRequest = async (
  request: Request,
  action: "replay" | "abandon",
  dlqId: string,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const auth = deps.authorizeInternalRequest(request.headers.get("authorization") ?? undefined);
  if (!auth.ok) {
    return internalUnauthorizedResponse(request, auth.reason);
  }

  const trimmedId = dlqId.trim();
  if (!trimmedId) {
    return jsonResponse(request, { ok: false, status: "invalid_dlq_id" }, 400);
  }

  try {
    if (action === "replay") {
      const result = await deps.convex.replayDeadLetter({ dlqId: trimmedId });
      return jsonResponse(request, {
        ok: true,
        dlqId: trimmedId,
        replayed: result.replayed,
        status: result.status,
      });
    }

    const result = await deps.convex.abandonDeadLetter({ dlqId: trimmedId });
    return jsonResponse(request, {
      ok: true,
      dlqId: trimmedId,
      abandoned: result.abandoned,
      status: result.status,
    });
  } catch (error) {
    return jsonResponse(
      request,
      {
        ok: false,
        status: action === "replay" ? "replay_failed" : "abandon_failed",
        error:
          error instanceof Error
            ? error.message
            : action === "replay"
              ? "Failed to replay dead-letter item."
              : "Failed to abandon dead-letter item.",
      },
      400,
    );
  }
};

export const dispatchStartOwnedOperationalRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response | null> => {
  const pathname = new URL(request.url).pathname;

  if (request.method === "GET" && isOAuthHelperDownloadPath(pathname)) {
    return await handleOAuthHelperLatestDownloadRequest(request, deps);
  }
  if ((request.method === "GET" || request.method === "POST") && isInternalCronPath(pathname)) {
    return await handleInternalCronMaintenanceRequest(request, deps);
  }
  if (request.method === "POST" && isInternalQueueDispatchPath(pathname)) {
    return await handleInternalQueueDispatchRequest(request, deps);
  }
  if (request.method === "GET" && isInternalDeepHealthPath(pathname)) {
    return await handleInternalDeepHealthRequest(request, deps);
  }
  if (request.method === "POST" && isInternalNotificationsDeliverPath(pathname)) {
    return await handleInternalNotificationsDeliverRequest(request, deps);
  }
  if (request.method === "GET" && isInternalDlqListPath(pathname)) {
    return await handleInternalDlqListRequest(request, deps);
  }

  const internalDlqAction = resolveInternalDlqAction(pathname);
  if (request.method === "POST" && internalDlqAction?.action === "replay") {
    return await handleInternalDlqActionRequest(request, "replay", internalDlqAction.id, deps);
  }
  if (request.method === "POST" && internalDlqAction?.action === "abandon") {
    return await handleInternalDlqActionRequest(request, "abandon", internalDlqAction.id, deps);
  }

  const automationRuntimeResponse = await dispatchStartOwnedAutomationRuntimeRequest(request);
  if (automationRuntimeResponse) {
    return automationRuntimeResponse;
  }

  return null;
};
