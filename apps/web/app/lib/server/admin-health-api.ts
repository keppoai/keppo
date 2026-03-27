import { type UserRole } from "@keppo/shared/domain";
import { readBetterAuthSessionToken } from "./api-runtime/app-helpers.ts";
import { ConvexInternalClient } from "./api-runtime/convex.ts";
import { getEnv } from "./api-runtime/env.ts";
import { createQueueClient, type QueueClient } from "./api-runtime/queue.ts";
import { buildDeepHealthReport, canAccessAdminHealthRoutes } from "./health-runtime";

type ApiSessionIdentity = {
  userId: string;
  orgId: string;
  role: UserRole;
};

type StartOwnedAdminHealthConvex = Pick<
  ConvexInternalClient,
  | "abandonDeadLetter"
  | "checkCronHealth"
  | "listAllFeatureFlags"
  | "listPendingDeadLetters"
  | "listRecentAuditErrors"
  | "probeConvexHealth"
  | "replayDeadLetter"
  | "resolveApiSessionFromToken"
  | "summarizeRateLimitHealth"
>;

type StartOwnedAdminHealthDeps = {
  convex: StartOwnedAdminHealthConvex;
  getEnv: typeof getEnv;
  queueClient: QueueClient;
  readBetterAuthSessionToken: typeof readBetterAuthSessionToken;
};

const SECURITY_HEADER_VALUES = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
} as const;

let convexClient: ConvexInternalClient | null = null;
let queueClient: QueueClient | null = null;

const getDefaultDeps = (): StartOwnedAdminHealthDeps => {
  const convex = (convexClient ??= new ConvexInternalClient());
  return {
    convex,
    getEnv,
    queueClient: (queueClient ??= createQueueClient(convex)),
    readBetterAuthSessionToken,
  };
};

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

const resolveSessionFromRequest = async (
  request: Request,
  deps: StartOwnedAdminHealthDeps,
): Promise<ApiSessionIdentity | null> => {
  const sessionToken =
    deps.readBetterAuthSessionToken(request.headers.get("cookie") ?? undefined) ??
    deps.readBetterAuthSessionToken(request.headers.get("better-auth-cookie") ?? undefined);
  if (!sessionToken) {
    return null;
  }
  return await deps.convex.resolveApiSessionFromToken(sessionToken);
};

const parseLimit = (request: Request, fallback: number): number => {
  const limitRaw = new URL(request.url).searchParams.get("limit");
  if (!limitRaw) {
    return fallback;
  }
  const parsedLimit = Number.parseInt(limitRaw, 10);
  return Number.isFinite(parsedLimit) ? parsedLimit : fallback;
};

const resolveDlqActionPath = (
  pathname: string,
): { action: "replay" | "abandon"; id: string } | null => {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length !== 5 || segments[0] !== "api" || segments[1] !== "health") {
    return null;
  }
  if (segments[2] !== "dlq") {
    return null;
  }
  const action = segments[4];
  if (action !== "replay" && action !== "abandon") {
    return null;
  }
  return {
    action,
    id: decodeURIComponent(segments[3] ?? ""),
  };
};

const requireAdminSession = async (
  request: Request,
  deps: StartOwnedAdminHealthDeps,
): Promise<{ ok: true; session: ApiSessionIdentity } | { ok: false; response: Response }> => {
  const session = await resolveSessionFromRequest(request, deps);
  if (!session) {
    return {
      ok: false,
      response: jsonResponse(request, { error: "Authentication required." }, 401),
    };
  }
  if (!canAccessAdminHealthRoutes(session.userId, deps)) {
    return {
      ok: false,
      response: jsonResponse(request, { ok: false, status: "forbidden" }, 403),
    };
  }
  return {
    ok: true,
    session,
  };
};

const handleDlqActionRequest = async (
  request: Request,
  action: "replay" | "abandon",
  dlqId: string,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const auth = await requireAdminSession(request, deps);
  if (!auth.ok) {
    return auth.response;
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

export const handleDeepHealthRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const auth = await requireAdminSession(request, deps);
  if (!auth.ok) {
    return auth.response;
  }

  const report = await buildDeepHealthReport(deps);
  return jsonResponse(request, report, report.ok ? 200 : 503);
};

export const handleFeatureFlagsRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const auth = await requireAdminSession(request, deps);
  if (!auth.ok) {
    return auth.response;
  }

  const flags = await deps.convex.listAllFeatureFlags();
  return jsonResponse(request, { ok: true, flags });
};

export const handleAuditErrorsRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const auth = await requireAdminSession(request, deps);
  if (!auth.ok) {
    return auth.response;
  }

  const errors = await deps.convex.listRecentAuditErrors({ limit: parseLimit(request, 50) });
  return jsonResponse(request, { ok: true, errors });
};

export const handleDlqListRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const auth = await requireAdminSession(request, deps);
  if (!auth.ok) {
    return auth.response;
  }

  const pending = await deps.convex.listPendingDeadLetters({ limit: parseLimit(request, 100) });
  return jsonResponse(request, { ok: true, pending });
};

export const handleDlqReplayRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const parsed = resolveDlqActionPath(new URL(request.url).pathname);
  return await handleDlqActionRequest(request, "replay", parsed?.id ?? "", deps);
};

export const handleDlqAbandonRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const parsed = resolveDlqActionPath(new URL(request.url).pathname);
  return await handleDlqActionRequest(request, "abandon", parsed?.id ?? "", deps);
};

export const dispatchStartOwnedAdminHealthRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response | null> => {
  const { pathname } = new URL(request.url);

  if (request.method === "GET" && pathname === "/api/health/deep") {
    return await handleDeepHealthRequest(request, deps);
  }
  if (request.method === "GET" && pathname === "/api/health/flags") {
    return await handleFeatureFlagsRequest(request, deps);
  }
  if (request.method === "GET" && pathname === "/api/health/audit-errors") {
    return await handleAuditErrorsRequest(request, deps);
  }
  if (request.method === "GET" && pathname === "/api/health/dlq") {
    return await handleDlqListRequest(request, deps);
  }

  const dlqAction = resolveDlqActionPath(pathname);
  if (request.method === "POST" && dlqAction?.action === "replay") {
    return await handleDlqActionRequest(request, "replay", dlqAction.id, deps);
  }
  if (request.method === "POST" && dlqAction?.action === "abandon") {
    return await handleDlqActionRequest(request, "abandon", dlqAction.id, deps);
  }

  return null;
};
