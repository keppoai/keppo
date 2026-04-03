import { createHash } from "node:crypto";
import { type UserRole } from "@keppo/shared/domain";
import {
  parseInternalInviteAcceptRequest,
  parseInternalInviteCreateRequest,
  parseInternalPushSubscribeRequest,
} from "@keppo/shared/providers/boundaries/error-boundary";
import { readBetterAuthSessionToken, parseJsonPayload } from "./api-runtime/app-helpers.ts";
import { ConvexInternalClient } from "./api-runtime/convex.ts";
import { sendInviteEmail } from "./api-runtime/email.ts";
import { getEnv } from "./api-runtime/env.ts";
import { validatePushSubscriptionEndpoint } from "./api-runtime/push.ts";
import {
  handleBillingCheckoutRequest,
  handleBillingCreditsCheckoutRequest,
  handleBillingExtraUsageRequest,
  handleBillingPortalRequest,
  handleBillingUsageRequest,
} from "./billing-api";

export {
  handleBillingCheckoutRequest,
  handleBillingCreditsCheckoutRequest,
  handleBillingExtraUsageRequest,
  handleBillingPortalRequest,
  handleBillingUsageRequest,
} from "./billing-api";

type ApiSessionIdentity = {
  userId: string;
  orgId: string;
  role: UserRole;
};

type StartOwnedInternalApiConvex = Pick<
  ConvexInternalClient,
  | "acceptInviteInternal"
  | "createInviteInternal"
  | "getWorkspaceById"
  | "getWorkspaceCredentialStatus"
  | "registerPushEndpointForUser"
  | "resolveApiSessionFromToken"
  | "storeInviteToken"
>;

type StartOwnedInternalApiDeps = {
  convex: StartOwnedInternalApiConvex;
  getEnv: typeof getEnv;
  parseJsonPayload: typeof parseJsonPayload;
  readBetterAuthSessionToken: typeof readBetterAuthSessionToken;
  sendInviteEmail: typeof sendInviteEmail;
  validatePushSubscriptionEndpoint: typeof validatePushSubscriptionEndpoint;
};

const SECURITY_HEADER_VALUES = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
} as const;

let convexClient: ConvexInternalClient | null = null;

const getDefaultDeps = (): StartOwnedInternalApiDeps => ({
  convex: (convexClient ??= new ConvexInternalClient()),
  getEnv,
  parseJsonPayload,
  readBetterAuthSessionToken,
  sendInviteEmail,
  validatePushSubscriptionEndpoint,
});

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

const jsonNoStoreResponse = (request: Request, payload: unknown, status = 200): Response => {
  return Response.json(
    payload,
    withSecurityHeaders(request, {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    }),
  );
};

const dashboardErrorBody = (
  code: string,
  message: string,
  options?: {
    status?: number;
    metadata?: Record<string, string | number | boolean | null>;
    technicalDetails?: string;
    publicSafe?: boolean;
  },
) => {
  return {
    error_code: code,
    error: message,
    ...(typeof options?.status === "number" ? { status: options.status } : {}),
    ...(options?.metadata ? { metadata: options.metadata } : {}),
    ...(options?.technicalDetails ? { technical_details: options.technicalDetails } : {}),
    ...(typeof options?.publicSafe === "boolean"
      ? { technical_details_safe_for_public: options.publicSafe }
      : {}),
  };
};

const resolveSessionFromRequest = async (
  request: Request,
  deps: StartOwnedInternalApiDeps,
): Promise<ApiSessionIdentity | null> => {
  const sessionToken =
    deps.readBetterAuthSessionToken(request.headers.get("cookie") ?? undefined) ??
    deps.readBetterAuthSessionToken(request.headers.get("better-auth-cookie") ?? undefined);
  if (!sessionToken) {
    return null;
  }
  return await deps.convex.resolveApiSessionFromToken(sessionToken);
};

const parseRequestBody = async <T>(
  request: Request,
  deps: StartOwnedInternalApiDeps,
  parser: (payload: unknown) => T,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> => {
  try {
    const body = parser(deps.parseJsonPayload(await request.text()));
    return {
      ok: true,
      data: body,
    };
  } catch (error) {
    return {
      ok: false,
      response: jsonResponse(
        request,
        {
          error: error instanceof Error ? error.message : "Request body must be valid JSON.",
        },
        400,
      ),
    };
  }
};

const hashToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

const resolveCurrentBuildId = (): string | null => {
  const buildId =
    process.env["VERCEL_DEPLOYMENT_ID"] ??
    process.env["KEPPO_RELEASE_VERSION"] ??
    process.env["VERCEL_GIT_COMMIT_SHA"] ??
    "";
  const trimmed = buildId.trim().slice(0, 256);
  return trimmed.length > 0 ? trimmed : null;
};

export const handleInviteCreateRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const parsedBody = await parseRequestBody(request, deps, parseInternalInviteCreateRequest);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const sessionIdentity = await resolveSessionFromRequest(request, deps);
  if (!sessionIdentity) {
    return jsonResponse(request, { error: "Authentication required." }, 401);
  }

  const requestedOrgId = parsedBody.data.orgId?.trim() ?? "";
  const requestedInviterUserId = parsedBody.data.inviterUserId?.trim() ?? "";
  const inviterName =
    typeof parsedBody.data.inviterName === "string" && parsedBody.data.inviterName.trim().length > 0
      ? parsedBody.data.inviterName.trim()
      : "A teammate";
  const email = typeof parsedBody.data.email === "string" ? parsedBody.data.email.trim() : "";
  const role = parsedBody.data.role;

  if (!email) {
    return jsonResponse(
      request,
      dashboardErrorBody("invite.email_required", "Email is required.", {
        status: 400,
        technicalDetails: "invite.email_required",
        publicSafe: true,
      }),
      400,
    );
  }

  if (requestedOrgId && requestedOrgId !== sessionIdentity.orgId) {
    return jsonResponse(
      request,
      dashboardErrorBody(
        "invite.cross_org_forbidden",
        "Authenticated session does not match requested organization.",
        {
          status: 403,
          technicalDetails: "invite.cross_org_forbidden",
          publicSafe: true,
        },
      ),
      403,
    );
  }

  if (requestedInviterUserId && requestedInviterUserId !== sessionIdentity.userId) {
    return jsonResponse(
      request,
      dashboardErrorBody(
        "invite.cross_user_forbidden",
        "Authenticated session does not match the requested inviter.",
        {
          status: 403,
          technicalDetails: "invite.cross_user_forbidden",
          publicSafe: true,
        },
      ),
      403,
    );
  }

  try {
    const created = await deps.convex.createInviteInternal({
      orgId: sessionIdentity.orgId,
      inviterUserId: sessionIdentity.userId,
      email,
      role,
    });
    const env = deps.getEnv();
    const e2eNamespace = request.headers.get("x-keppo-e2e-namespace")?.trim();
    if (env.KEPPO_E2E_MODE && e2eNamespace) {
      await deps.convex.storeInviteToken({
        inviteId: created.inviteId,
        orgId: sessionIdentity.orgId,
        email,
        rawToken: created.rawToken,
        createdAt: new Date().toISOString(),
      });
    }
    const acceptUrl = `${env.KEPPO_DASHBOARD_ORIGIN ?? "http://localhost:3000"}/invites/accept?token=${encodeURIComponent(created.rawToken)}`;
    const emailResult = await deps.sendInviteEmail({
      to: email,
      inviterName,
      orgName: created.orgName,
      acceptUrl,
    });
    if (!emailResult.success) {
      return jsonResponse(
        request,
        dashboardErrorBody(
          "invite.email_delivery_failed",
          emailResult.error ?? "Failed to send invite email.",
          {
            status: 502,
            technicalDetails: "invite.email_delivery_failed",
          },
        ),
        502,
      );
    }
    return jsonResponse(request, { inviteId: created.inviteId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create invite.";
    return jsonResponse(
      request,
      dashboardErrorBody("invite.create_failed", message, {
        status: 400,
        technicalDetails: "invite.create_failed",
      }),
      400,
    );
  }
};

export const handleInviteAcceptRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const parsedBody = await parseRequestBody(request, deps, parseInternalInviteAcceptRequest);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const sessionIdentity = await resolveSessionFromRequest(request, deps);
  if (!sessionIdentity) {
    return jsonResponse(request, { error: "Authentication required." }, 401);
  }

  const token = typeof parsedBody.data.token === "string" ? parsedBody.data.token.trim() : "";
  const requestedUserId = parsedBody.data.userId?.trim() ?? "";
  if (!token) {
    return jsonResponse(
      request,
      dashboardErrorBody("invite.token_required", "Invitation token is required.", {
        status: 400,
        technicalDetails: "invite.token_required",
        publicSafe: true,
      }),
      400,
    );
  }
  if (requestedUserId && requestedUserId !== sessionIdentity.userId) {
    return jsonResponse(
      request,
      dashboardErrorBody(
        "invite.cross_user_forbidden",
        "Authenticated session does not match the requested user.",
        {
          status: 403,
          technicalDetails: "invite.cross_user_forbidden",
          publicSafe: true,
        },
      ),
      403,
    );
  }

  try {
    const accepted = await deps.convex.acceptInviteInternal({
      tokenHash: hashToken(token),
      userId: sessionIdentity.userId,
    });
    return jsonResponse(request, {
      ok: true,
      orgId: accepted.orgId,
      orgName: accepted.orgName,
      role: accepted.role,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to accept invitation.";
    return jsonResponse(
      request,
      {
        ok: false,
        ...dashboardErrorBody("invite.accept_failed", message, {
          status: 400,
          technicalDetails: "invite.accept_failed",
        }),
      },
      400,
    );
  }
};

export const handlePushSubscribeRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const parsedBody = await parseRequestBody(request, deps, parseInternalPushSubscribeRequest);
  if (!parsedBody.ok) {
    return parsedBody.response;
  }

  const sessionIdentity = await resolveSessionFromRequest(request, deps);
  if (!sessionIdentity) {
    return jsonResponse(
      request,
      {
        ok: false,
        ...dashboardErrorBody("auth.unauthorized", "Authentication required.", {
          status: 401,
          technicalDetails: "auth.unauthorized",
          publicSafe: true,
        }),
      },
      401,
    );
  }

  try {
    await deps.validatePushSubscriptionEndpoint(parsedBody.data.subscription.endpoint);
    const endpoint = await deps.convex.registerPushEndpointForUser({
      orgId: sessionIdentity.orgId,
      userId: sessionIdentity.userId,
      destination: parsedBody.data.subscription.endpoint,
      pushSubscription: JSON.stringify(parsedBody.data.subscription),
    });
    return jsonResponse(request, {
      ok: true,
      endpointId: endpoint.id,
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message.startsWith("Push subscription endpoint")
        ? "Push subscription endpoint is not allowed."
        : "Push subscription registration failed.";
    return jsonResponse(
      request,
      {
        ok: false,
        ...dashboardErrorBody("notifications.push.registration_failed", message, {
          status: 400,
          technicalDetails: "notifications.push.registration_failed",
        }),
      },
      400,
    );
  }
};

export const handleWorkspaceMcpTestRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const sessionIdentity = await resolveSessionFromRequest(request, deps);
  if (!sessionIdentity) {
    return jsonResponse(request, { error: "Authentication required." }, 401);
  }

  const workspaceId = new URL(request.url).searchParams.get("workspaceId")?.trim() ?? "";
  if (!workspaceId) {
    return jsonResponse(request, { error: "workspaceId is required." }, 400);
  }

  const workspace = await deps.convex.getWorkspaceById(workspaceId);
  if (!workspace || workspace.org_id !== sessionIdentity.orgId) {
    return jsonResponse(request, { error: "Workspace not found." }, 404);
  }

  const credentialStatus = await deps.convex.getWorkspaceCredentialStatus(workspaceId);
  return jsonResponse(request, {
    ok: credentialStatus.has_active_credential,
    workspace_id: workspaceId,
    workspace_name: workspace.name,
    last_rotated_at: credentialStatus.last_rotated_at,
    message: credentialStatus.has_active_credential
      ? "Workspace MCP credential is active."
      : "No active workspace credential is available. Rotate the credential to issue a fresh token.",
  });
};

export const handleBuildVersionRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  if (!(await resolveSessionFromRequest(request, deps))) {
    return jsonResponse(
      request,
      {
        ok: false,
        ...dashboardErrorBody("auth.unauthorized", "Authentication required.", {
          status: 401,
          technicalDetails: "auth.unauthorized",
          publicSafe: true,
        }),
      },
      401,
    );
  }

  return jsonNoStoreResponse(request, {
    ok: true,
    buildId: resolveCurrentBuildId(),
  });
};

export const dispatchStartOwnedInternalApiRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response | null> => {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/api/invites/create") {
    return await handleInviteCreateRequest(request, deps);
  }
  if (request.method === "POST" && url.pathname === "/api/invites/accept") {
    return await handleInviteAcceptRequest(request, deps);
  }
  if (request.method === "POST" && url.pathname === "/api/notifications/push/subscribe") {
    return await handlePushSubscribeRequest(request, deps);
  }
  if (request.method === "GET" && url.pathname === "/api/mcp/test") {
    return await handleWorkspaceMcpTestRequest(request, deps);
  }
  if (request.method === "GET" && url.pathname === "/api/version") {
    return await handleBuildVersionRequest(request, deps);
  }

  return null;
};
