import { createHash } from "node:crypto";
import {
  PROVIDER_REGISTRY_PATH_FEATURE_FLAG,
  readFeatureFlagValue,
  type KnownFeatureFlag,
} from "@keppo/shared/feature-flags";
import type {
  ProviderMetricName,
  ProviderMetricOutcome,
} from "@keppo/shared/providers/boundaries/types";
import type { CanonicalProviderId } from "@keppo/shared/provider-ids";
import { AUDIT_ACTOR_TYPE, AUDIT_EVENT_TYPES } from "@keppo/shared/domain";
import {
  getE2ENamespace,
  parseContentLengthBytes,
  resolveClientIp,
  resolveOrigins,
} from "./api-runtime/app-helpers.ts";
import { fireAndForgetWithDlq } from "./api-runtime/convex.ts";
import { ConvexInternalClient } from "./api-runtime/convex.ts";
import { getEnv } from "./api-runtime/env.ts";
import { logger, resolveRequestId, withRequestLoggerContext } from "./api-runtime/logger.ts";
import { createDurableRateLimiter } from "./api-runtime/rate-limit.ts";
import { createMcpRouteDispatcher } from "./api-runtime/routes/mcp.ts";

const MCP_PATH_PATTERN = /^\/mcp\/([^/]+)\/?$/u;
const SYSTEM_METRICS_ORG_ID = "system";
const CORS_ALLOW_HEADERS = [
  "Authorization",
  "Better-Auth-Cookie",
  "Content-Type",
  "Mcp-Session-Id",
  "x-keppo-e2e-namespace",
  "x-e2e-test-id",
  "x-e2e-scenario-id",
] as const;
const CORS_ALLOW_METHODS = ["GET", "POST", "DELETE", "OPTIONS"] as const;
const SECURITY_HEADER_VALUES = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
} as const;

type StartOwnedMcpApp = {
  fetch: (request: Request) => Promise<Response> | Response;
};

let cachedApp: StartOwnedMcpApp | null = null;
let convexClient: ConvexInternalClient | null = null;

const isWriteMethod = (method: string): boolean => {
  return method === "POST" || method === "PUT" || method === "PATCH";
};

const appendVaryHeader = (headers: Headers, value: string): void => {
  const existing = headers.get("Vary");
  if (!existing) {
    headers.set("Vary", value);
    return;
  }
  const normalized = existing.split(",").map((entry) => entry.trim().toLowerCase());
  if (!normalized.includes(value.toLowerCase())) {
    headers.set("Vary", `${existing}, ${value}`);
  }
};

const applyResponseHeaders = (
  request: Request,
  response: Response,
  allowedOrigins: string[],
  requestId: string,
): Response => {
  const headers = new Headers(response.headers);
  for (const [header, value] of Object.entries(SECURITY_HEADER_VALUES)) {
    headers.set(header, value);
  }
  if (new URL(request.url).protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  headers.set("X-Request-Id", requestId);

  const requestOrigin = request.headers.get("origin");
  if (requestOrigin) {
    appendVaryHeader(headers, "Origin");
    if (allowedOrigins.includes(requestOrigin)) {
      headers.set("Access-Control-Allow-Origin", requestOrigin);
      headers.set("Access-Control-Allow-Credentials", "true");
      headers.set("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS.join(", "));
      headers.set("Access-Control-Allow-Methods", CORS_ALLOW_METHODS.join(", "));
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const createOptionsResponse = (
  request: Request,
  allowedOrigins: string[],
  requestId: string,
): Response => {
  return applyResponseHeaders(
    request,
    new Response(null, { status: 204 }),
    allowedOrigins,
    requestId,
  );
};

const payloadTooLargeResponse = (
  request: Request,
  requestLogger: typeof logger,
  limitBytes: number,
  actualBytes?: number,
): Response => {
  requestLogger.warn("security.request_body_too_large", {
    route: "/mcp/*",
    method: request.method.toUpperCase(),
    limitBytes,
    ...(actualBytes !== undefined ? { actualBytes } : {}),
    ...(parseContentLengthBytes(request.headers.get("content-length") ?? undefined) !== null
      ? {
          contentLength: parseContentLengthBytes(
            request.headers.get("content-length") ?? undefined,
          ),
        }
      : {}),
  });
  return Response.json(
    {
      error: {
        code: "payload_too_large",
        message: "Request body exceeds allowed size.",
        max_bytes: limitBytes,
      },
    },
    { status: 413 },
  );
};

const enforceRequestBodyLimit = async (
  request: Request,
  requestLogger: typeof logger,
  limitBytes: number,
): Promise<Response | null> => {
  if (!isWriteMethod(request.method.toUpperCase())) {
    return null;
  }

  const contentLength = parseContentLengthBytes(request.headers.get("content-length") ?? undefined);
  if (contentLength !== null && contentLength > limitBytes) {
    return payloadTooLargeResponse(request, requestLogger, limitBytes, contentLength);
  }
  // When Content-Length is present and within the limit, skip streaming the body here.
  // Reading a cloned body can interfere with the original body's stream in some Fetch
  // implementations, breaking a later `request.json()` in the MCP dispatcher.
  if (contentLength !== null && contentLength <= limitBytes) {
    return null;
  }

  const clone = request.clone();
  if (!clone.body) {
    return null;
  }

  const reader = clone.body.getReader();
  let actualBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      actualBytes += value.byteLength;
      if (actualBytes > limitBytes) {
        await reader.cancel();
        return payloadTooLargeResponse(request, requestLogger, limitBytes, actualBytes);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return null;
};

const getStartOwnedMcpApp = (): StartOwnedMcpApp => {
  if (cachedApp) {
    return cachedApp;
  }

  const env = getEnv();
  const convex = (convexClient ??= new ConvexInternalClient());
  const dashboardOrigin = env.KEPPO_DASHBOARD_ORIGIN ?? "http://localhost:3000";
  const corsOrigins = resolveOrigins(dashboardOrigin);
  const mcpAuthFailureLimiter = createDurableRateLimiter(convex, "mcp_auth_failure_ip");
  const mcpCredentialLimiter = createDurableRateLimiter(convex, "mcp_credential_requests");
  const mcpAuthFailuresPerMinute = env.KEPPO_RATE_LIMIT_MCP_AUTH_FAILURES_PER_MINUTE;
  const mcpRequestsPerCredentialPerMinute =
    env.KEPPO_RATE_LIMIT_MCP_REQUESTS_PER_CREDENTIAL_PER_MINUTE;
  const mcpBodyLimitBytes = env.KEPPO_MAX_BODY_BYTES_MCP;

  const resolveFeatureFlag = async (name: KnownFeatureFlag): Promise<boolean> => {
    try {
      return await convex.getFeatureFlag(name);
    } catch {
      return readFeatureFlagValue(name, process.env);
    }
  };

  const runFireAndForget = async (
    label: string,
    fn: () => Promise<void>,
    payload?: Record<string, unknown>,
  ): Promise<void> => {
    await fireAndForgetWithDlq(label, fn, convex, {
      logger,
      ...(payload ? { payload } : {}),
    });
  };

  const dispatch = createMcpRouteDispatcher({
    convex,
    getE2ENamespace,
    hashIpAddress: (value) => createHash("sha256").update(value, "utf8").digest("hex"),
    resolveClientIp,
    resolveRegistryPathEnabled: async () =>
      await resolveFeatureFlag(PROVIDER_REGISTRY_PATH_FEATURE_FLAG),
    recordRateLimitedEvent: (params) => {
      void runFireAndForget(
        "audit.security_rate_limited",
        async () =>
          await convex.createAuditEvent({
            orgId: params.orgId ?? SYSTEM_METRICS_ORG_ID,
            actorType: AUDIT_ACTOR_TYPE.system,
            actorId: "api",
            eventType: AUDIT_EVENT_TYPES.securityRateLimited,
            payload: {
              route: params.route,
              key: params.key,
              ip_hash: params.ipHash,
              retry_after_ms: params.retryAfterMs,
            },
          }),
        {
          orgId: params.orgId ?? SYSTEM_METRICS_ORG_ID,
          route: params.route,
          key: params.key,
          ipHash: params.ipHash,
          retryAfterMs: params.retryAfterMs,
        },
      );
    },
    recordProviderMetric: (params: {
      metric: ProviderMetricName;
      orgId?: string;
      provider?: CanonicalProviderId;
      providerInput?: string;
      route?: string;
      outcome?: ProviderMetricOutcome;
      reasonCode?: string;
      value?: number;
    }) => {
      const orgId = params.orgId?.trim() ? params.orgId.trim() : SYSTEM_METRICS_ORG_ID;
      void runFireAndForget(
        "provider.metric.record",
        async () =>
          await convex.recordProviderMetric({
            orgId,
            metric: params.metric,
            ...(params.provider ? { provider: params.provider } : {}),
            ...(params.providerInput ? { providerInput: params.providerInput } : {}),
            ...(params.route ? { route: params.route } : {}),
            ...(params.outcome ? { outcome: params.outcome } : {}),
            ...(params.reasonCode ? { reasonCode: params.reasonCode } : {}),
            ...(params.value !== undefined ? { value: params.value } : {}),
          }),
        {
          orgId,
          metric: params.metric,
          ...(params.provider ? { provider: params.provider } : {}),
          ...(params.providerInput ? { providerInput: params.providerInput } : {}),
          ...(params.route ? { route: params.route } : {}),
          ...(params.outcome ? { outcome: params.outcome } : {}),
          ...(params.reasonCode ? { reasonCode: params.reasonCode } : {}),
          ...(params.value !== undefined ? { value: params.value } : {}),
        },
      );
    },
    mcpAuthFailureLimiter,
    mcpCredentialLimiter,
    mcpAuthFailuresPerMinute,
    mcpRequestsPerCredentialPerMinute,
    systemMetricsOrgId: SYSTEM_METRICS_ORG_ID,
    logger,
  });

  cachedApp = {
    fetch: async (request: Request): Promise<Response> => {
      const match = MCP_PATH_PATTERN.exec(new URL(request.url).pathname);
      if (!match) {
        return new Response("Not Found", { status: 404 });
      }

      const requestId = resolveRequestId(request);
      if (request.method === "OPTIONS") {
        return createOptionsResponse(request, corsOrigins, requestId);
      }

      const startedAt = Date.now();
      const requestUrl = new URL(request.url);
      const response = await withRequestLoggerContext(
        {
          request_id: requestId,
          method: request.method,
          path: requestUrl.pathname,
        },
        async (requestLogger) => {
          requestLogger.info("http.request.started");
          let response: Response | null = null;
          try {
            const limitResponse = await enforceRequestBodyLimit(
              request,
              requestLogger,
              mcpBodyLimitBytes,
            );
            if (limitResponse) {
              response = limitResponse;
              return response;
            }
            response = await dispatch({
              request,
              workspaceIdParam: match[1] ?? "",
            });
            return response;
          } finally {
            requestLogger.info("http.request.completed", {
              status: response?.status ?? 500,
              duration_ms: Date.now() - startedAt,
            });
          }
        },
      );

      return applyResponseHeaders(request, response, corsOrigins, requestId);
    },
  };
  return cachedApp;
};

export const isStartOwnedMcpPath = (pathname: string): boolean => {
  return MCP_PATH_PATTERN.test(pathname);
};

export const dispatchStartOwnedMcpRequest = async (
  request: Request,
  app: StartOwnedMcpApp = getStartOwnedMcpApp(),
): Promise<Response | null> => {
  if (!isStartOwnedMcpPath(new URL(request.url).pathname)) {
    return null;
  }
  return await app.fetch(request);
};

export const handleStartOwnedMcpRequest = async (
  request: Request,
  app?: StartOwnedMcpApp,
): Promise<Response> => {
  const response = await dispatchStartOwnedMcpRequest(request, app);
  return response ?? new Response("Not Found", { status: 404 });
};
