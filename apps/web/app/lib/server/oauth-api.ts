import { randomUUID } from "node:crypto";
import { generateOAuthPkceCodeVerifier } from "@keppo/shared/oauth-pkce";
import {
  PROVIDER_REGISTRY_PATH_FEATURE_FLAG,
  providerRolloutFeatureFlag,
  readFeatureFlagValue,
} from "@keppo/shared/feature-flags";
import { getManagedOAuthProviderFacets } from "@keppo/shared/provider-facet-loader";
import {
  PROVIDER_PARSE_ERROR_CODE,
  type ManagedOAuthProvider,
} from "@keppo/shared/providers/boundaries/common";
import {
  oauthConnectResponseSchema,
  oauthStatePayloadSchema,
} from "@keppo/shared/providers/boundaries/api-schemas";
import {
  buildBoundaryErrorEnvelope,
  isBoundaryParseError,
  parseApiBoundary,
  parseOAuthCallbackRequest,
  parseOAuthConnectRequest,
} from "@keppo/shared/providers/boundaries/error-boundary";
import type {
  OAuthStatePayload,
  ProviderMetricName,
  ProviderMetricOutcome,
} from "@keppo/shared/providers/boundaries/types";
import type { CanonicalProviderId } from "@keppo/shared/provider-ids";
import type { ProviderRuntimeContext } from "@keppo/shared/provider-runtime-context";
import {
  API_DEDUPE_STATUS,
  API_DEDUPE_SCOPE,
  IDEMPOTENCY_RESOLUTION_STATUS,
  OAUTH_METRIC_REASON_CODE,
  OAUTH_STATE_DECODE_REASON,
  PROVIDER_METRIC_NAME,
  PROVIDER_METRIC_OUTCOME,
  assertNever,
  type OAuthStateDecodeReason,
  type UserRole,
} from "@keppo/shared/domain";
import {
  getE2ENamespace,
  getRedirectUri,
  oauthErrorPayload,
  parseJsonPayload,
  readBetterAuthSessionToken,
  safeReturnToPath,
  signOAuthStatePayload,
  toProviderRuntimeContext,
  verifyAndDecodeOAuthStatePayload,
} from "./api-runtime/app-helpers.ts";
import { ConvexInternalClient } from "./api-runtime/convex.ts";
import { withIdempotency } from "./api-runtime/idempotency.ts";
import { logger } from "./api-runtime/logger.ts";
import { captureApiEvent } from "./api-runtime/posthog.ts";

const OAUTH_CONNECT_ROUTE_PATH = "/api/oauth/integrations/:provider/connect";
const OAUTH_CALLBACK_ROUTE_PATH = "/oauth/integrations/:provider/callback";
const OAUTH_STATE_TTL_MS = 15 * 60_000;
const OAUTH_CALLBACK_IDEMPOTENCY_TTL_MS = 10 * 60_000;
const OAUTH_CALLBACK_DEDUPE_WAIT_MS = 2_000;
const OAUTH_CALLBACK_DEDUPE_POLL_INTERVAL_MS = 120;
const SYSTEM_METRICS_ORG_ID = "system";
const ORG_INTEGRATION_MANAGER_ROLES = new Set<UserRole>(["owner", "admin"]);
const SECURITY_HEADER_VALUES = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
} as const;

type ApiSessionIdentity = {
  userId: string;
  orgId: string;
  role: UserRole;
};

type OAuthCallbackReplayPayload = {
  initiatingUserId: string;
};

type StartOwnedOAuthConvex = Pick<
  ConvexInternalClient,
  | "claimApiDedupeKey"
  | "completeApiDedupeKey"
  | "deleteManagedOAuthConnectState"
  | "getApiDedupeKey"
  | "getFeatureFlag"
  | "getManagedOAuthConnectState"
  | "recordProviderMetric"
  | "releaseApiDedupeKey"
  | "resolveApiSessionFromToken"
  | "setApiDedupePayload"
  | "upsertManagedOAuthConnectState"
  | "upsertOAuthProviderForOrg"
>;

type StartOwnedOAuthDeps = {
  convex: StartOwnedOAuthConvex;
  getE2ENamespace: typeof getE2ENamespace;
  getProviderModule: typeof getManagedOAuthProviderFacets;
  getRedirectUri: typeof getRedirectUri;
  logger: Pick<typeof logger, "error" | "info" | "warn">;
  parseJsonPayload: typeof parseJsonPayload;
  readBetterAuthSessionToken: typeof readBetterAuthSessionToken;
  safeReturnToPath: typeof safeReturnToPath;
  signOAuthStatePayload: typeof signOAuthStatePayload;
  toProviderRuntimeContext: (namespace: string | null) => ProviderRuntimeContext;
  verifyAndDecodeOAuthStatePayload: typeof verifyAndDecodeOAuthStatePayload;
  trackAnalyticsEvent: (
    event: string,
    properties: Record<string, unknown>,
    distinctId?: string,
  ) => void;
};

let convexClient: ConvexInternalClient | null = null;

const getDefaultDeps = (): StartOwnedOAuthDeps => ({
  convex: (convexClient ??= new ConvexInternalClient()),
  getE2ENamespace,
  getProviderModule: getManagedOAuthProviderFacets,
  getRedirectUri,
  logger,
  parseJsonPayload,
  readBetterAuthSessionToken,
  safeReturnToPath,
  signOAuthStatePayload,
  toProviderRuntimeContext: (namespace) => toProviderRuntimeContext(namespace, logger),
  verifyAndDecodeOAuthStatePayload,
  trackAnalyticsEvent: (event, properties, distinctId) => {
    captureApiEvent(event, {
      ...(distinctId ? { distinctId } : {}),
      properties: {
        source: "api",
        ...properties,
      },
    });
  },
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

const redirectResponse = (request: Request, location: string, status = 302): Response => {
  return new Response(
    null,
    withSecurityHeaders(request, { status, headers: { Location: location } }),
  );
};

class OAuthCallbackHandledError extends Error {
  readonly response: Response;

  constructor(response: Response) {
    super("oauth_callback_handled");
    this.response = response;
  }
}

const resolveSessionFromRequest = async (
  request: Request,
  deps: StartOwnedOAuthDeps,
): Promise<ApiSessionIdentity | null> => {
  const sessionToken =
    deps.readBetterAuthSessionToken(request.headers.get("cookie") ?? undefined) ??
    deps.readBetterAuthSessionToken(request.headers.get("better-auth-cookie") ?? undefined);
  if (!sessionToken) {
    return null;
  }
  return await deps.convex.resolveApiSessionFromToken(sessionToken);
};

const canManageOrgIntegrations = (identity: ApiSessionIdentity): boolean => {
  return ORG_INTEGRATION_MANAGER_ROLES.has(identity.role);
};

const parseOAuthCallbackReplayPayload = (
  payload: Record<string, unknown> | null,
): OAuthCallbackReplayPayload | null => {
  if (!payload) {
    return null;
  }
  return typeof payload.initiatingUserId === "string"
    ? { initiatingUserId: payload.initiatingUserId }
    : null;
};

const resolveFeatureFlag = async (
  deps: StartOwnedOAuthDeps,
  name: typeof PROVIDER_REGISTRY_PATH_FEATURE_FLAG | ReturnType<typeof providerRolloutFeatureFlag>,
): Promise<boolean> => {
  try {
    return await deps.convex.getFeatureFlag(name);
  } catch {
    return readFeatureFlagValue(name, process.env);
  }
};

const resolveRegistryPathEnabled = async (deps: StartOwnedOAuthDeps): Promise<boolean> => {
  return await resolveFeatureFlag(deps, PROVIDER_REGISTRY_PATH_FEATURE_FLAG);
};

const resolveProviderRolloutFlag = async (
  deps: StartOwnedOAuthDeps,
  provider: CanonicalProviderId,
): Promise<boolean> => {
  return await resolveFeatureFlag(deps, providerRolloutFeatureFlag(provider));
};

const recordProviderMetric = (
  deps: StartOwnedOAuthDeps,
  params: {
    metric: ProviderMetricName;
    orgId?: string;
    provider?: CanonicalProviderId;
    providerInput?: string;
    route?: string;
    outcome?: ProviderMetricOutcome;
    reasonCode?: string;
    value?: number;
  },
): void => {
  const orgId = params.orgId?.trim() ? params.orgId.trim() : SYSTEM_METRICS_ORG_ID;
  void deps.convex
    .recordProviderMetric({
      orgId,
      metric: params.metric,
      ...(params.provider ? { provider: params.provider } : {}),
      ...(params.providerInput ? { providerInput: params.providerInput } : {}),
      ...(params.route ? { route: params.route } : {}),
      ...(params.outcome ? { outcome: params.outcome } : {}),
      ...(params.reasonCode ? { reasonCode: params.reasonCode } : {}),
      ...(params.value !== undefined ? { value: params.value } : {}),
    })
    .catch((error: unknown) => {
      deps.logger.warn("oauth.connect.metric_record_failed", {
        error,
        metric: params.metric,
        route: params.route,
      });
    });
};

const recordProviderResolutionFailure = (
  deps: StartOwnedOAuthDeps,
  params: {
    route: string;
    providerInput: string | undefined;
    error: unknown;
  },
): void => {
  if (!isBoundaryParseError(params.error)) {
    return;
  }
  const providerInput = params.providerInput?.trim().toLowerCase();
  recordProviderMetric(deps, {
    metric: PROVIDER_METRIC_NAME.providerResolutionFailure,
    route: params.route,
    outcome: PROVIDER_METRIC_OUTCOME.failure,
    reasonCode: params.error.code,
    ...(providerInput ? { providerInput } : {}),
  });
  if (params.error.code === PROVIDER_PARSE_ERROR_CODE.unsupportedProvider) {
    recordProviderMetric(deps, {
      metric: PROVIDER_METRIC_NAME.unknownProviderRequest,
      route: params.route,
      outcome: PROVIDER_METRIC_OUTCOME.rejected,
      reasonCode: params.error.code,
      ...(providerInput ? { providerInput } : {}),
    });
  }
  if (params.error.code === PROVIDER_PARSE_ERROR_CODE.nonCanonicalProvider) {
    recordProviderMetric(deps, {
      metric: PROVIDER_METRIC_NAME.nonCanonicalProviderRejection,
      route: params.route,
      outcome: PROVIDER_METRIC_OUTCOME.rejected,
      reasonCode: params.error.code,
      ...(providerInput ? { providerInput } : {}),
    });
  }
};

const oauthBoundaryResponse = (
  request: Request,
  provider: ManagedOAuthProvider | "unknown",
  error: unknown,
): Response => {
  const envelope = buildBoundaryErrorEnvelope(error, {
    defaultCode: "invalid_request",
    defaultMessage: "Invalid request payload",
    source: "api",
    provider,
  });

  return jsonResponse(
    request,
    oauthErrorPayload({
      provider,
      code: envelope.error.code,
      message: envelope.error.message,
      source: envelope.error.source,
      issues: envelope.error.issues,
    }),
    400,
  );
};

const resolveProviderInputFromRequest = (request: Request): string | null => {
  const match = /^\/api\/oauth\/integrations\/([^/]+)\/connect\/?$/u.exec(
    new URL(request.url).pathname,
  );
  if (!match?.[1]) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

const resolveProviderInputFromCallbackRequest = (request: Request): string | null => {
  const match = /^\/oauth\/integrations\/([^/]+)\/callback\/?$/u.exec(
    new URL(request.url).pathname,
  );
  if (!match?.[1]) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

const mapStateDecodeErrorMessage = (reason: OAuthStateDecodeReason): string => {
  switch (reason) {
    case OAUTH_STATE_DECODE_REASON.missingState:
      return "Missing OAuth state";
    case OAUTH_STATE_DECODE_REASON.invalidSignature:
      return "Invalid OAuth state signature";
    case OAUTH_STATE_DECODE_REASON.invalidFormat:
    case OAUTH_STATE_DECODE_REASON.invalidEncoding:
      return "Invalid OAuth state payload";
    default:
      return assertNever(reason, "OAuth state decode error");
  }
};

const buildConnectedRedirect = (
  request: Request,
  deps: Pick<StartOwnedOAuthDeps, "safeReturnToPath">,
  state: OAuthStatePayload,
  provider: ManagedOAuthProvider,
): Response => {
  const returnUrl = new URL(deps.safeReturnToPath(state.return_to), new URL(request.url).origin);
  returnUrl.searchParams.set("integration_connected", provider);
  return redirectResponse(request, returnUrl.toString());
};

const buildCallbackErrorRedirect = (
  request: Request,
  deps: Pick<StartOwnedOAuthDeps, "safeReturnToPath">,
  state: OAuthStatePayload,
  provider: ManagedOAuthProvider,
  code: "forbidden" | "unauthorized",
): Response => {
  const returnUrl = new URL(deps.safeReturnToPath(state.return_to), new URL(request.url).origin);
  returnUrl.searchParams.set("oauth_error", code);
  returnUrl.searchParams.set("oauth_provider", provider);
  return redirectResponse(request, returnUrl.toString());
};

export const handleOAuthProviderConnectRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const providerInput = resolveProviderInputFromRequest(request) ?? "unknown";
  const recordOAuthConnectMetric = (params: {
    provider: CanonicalProviderId;
    outcome: ProviderMetricOutcome;
    orgId?: string;
    reasonCode?: string;
  }) => {
    recordProviderMetric(deps, {
      metric: PROVIDER_METRIC_NAME.oauthConnect,
      provider: params.provider,
      route: OAUTH_CONNECT_ROUTE_PATH,
      outcome: params.outcome,
      ...(params.orgId ? { orgId: params.orgId } : {}),
      ...(params.reasonCode ? { reasonCode: params.reasonCode } : {}),
    });
  };

  if (!(await resolveRegistryPathEnabled(deps))) {
    return jsonResponse(
      request,
      oauthErrorPayload({
        provider: providerInput,
        code: "provider_registry_disabled",
        message: "Provider registry path is disabled by kill switch.",
      }),
      503,
    );
  }

  let provider: ManagedOAuthProvider;
  let body: ReturnType<typeof parseOAuthConnectRequest>["body"];
  try {
    const parsed = parseOAuthConnectRequest(
      {
        provider: providerInput,
      },
      deps.parseJsonPayload(await request.text()),
    );
    provider = parsed.provider;
    body = parsed.body;
  } catch (error) {
    recordProviderResolutionFailure(deps, {
      route: OAUTH_CONNECT_ROUTE_PATH,
      providerInput,
      error,
    });
    return oauthBoundaryResponse(request, "unknown", error);
  }

  recordOAuthConnectMetric({
    provider,
    outcome: PROVIDER_METRIC_OUTCOME.attempt,
  });

  const sessionIdentity = await resolveSessionFromRequest(request, deps);
  if (!sessionIdentity) {
    recordOAuthConnectMetric({
      provider,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode: OAUTH_METRIC_REASON_CODE.unauthorized,
    });
    return jsonResponse(
      request,
      oauthErrorPayload({
        provider,
        code: "unauthorized",
        message: "Authentication required.",
      }),
      401,
    );
  }

  if (!(await resolveProviderRolloutFlag(deps, provider))) {
    recordOAuthConnectMetric({
      provider,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode: OAUTH_METRIC_REASON_CODE.providerDisabled,
    });
    return jsonResponse(
      request,
      oauthErrorPayload({
        provider,
        code: "provider_disabled",
        message: `Provider ${provider} is currently disabled by rollout policy.`,
      }),
      403,
    );
  }

  const namespace = deps.getE2ENamespace(request.headers.get("x-keppo-e2e-namespace") ?? undefined);
  deps.logger.info("oauth.flow", {
    provider,
    step: "connect_requested",
    user_id: sessionIdentity.userId,
    org_id: sessionIdentity.orgId,
  });
  deps.trackAnalyticsEvent(
    "oauth.connect.requested",
    {
      provider,
      org_id: sessionIdentity.orgId,
      request_id: request.headers.get("x-request-id") ?? randomUUID(),
    },
    sessionIdentity.userId,
  );

  const requestedOrgId = typeof body.org_id === "string" ? body.org_id.trim() : "";
  if (requestedOrgId && requestedOrgId !== sessionIdentity.orgId) {
    recordOAuthConnectMetric({
      provider,
      orgId: sessionIdentity.orgId,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode: OAUTH_METRIC_REASON_CODE.crossOrgForbidden,
    });
    return jsonResponse(
      request,
      oauthErrorPayload({
        provider,
        code: "cross_org_forbidden",
        message: "Authenticated session does not match requested org.",
      }),
      403,
    );
  }

  if (!canManageOrgIntegrations(sessionIdentity)) {
    recordOAuthConnectMetric({
      provider,
      orgId: sessionIdentity.orgId,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode: OAUTH_METRIC_REASON_CODE.unauthorized,
    });
    return jsonResponse(
      request,
      oauthErrorPayload({
        provider,
        code: "forbidden",
        message: "Only owners and admins can manage organization integrations.",
      }),
      403,
    );
  }

  const orgId = sessionIdentity.orgId;
  const providerModule = await deps.getProviderModule(provider);
  const defaultScopes = providerModule.metadata.oauth?.defaultScopes ?? [];
  const requiresPkce = providerModule.metadata.oauth?.requiresPkce === true;
  const requestedScopes =
    Array.isArray(body.scopes) && body.scopes.length > 0 ? body.scopes : [...defaultScopes];
  const correlationId = randomUUID();
  const stateCreatedAt = new Date().toISOString();
  const redirectUri = deps.getRedirectUri(request.url, provider);
  const runtimeContext = deps.toProviderRuntimeContext(namespace);
  const pkceCodeVerifier = requiresPkce ? generateOAuthPkceCodeVerifier() : undefined;
  const statePayload = {
    org_id: orgId,
    provider,
    return_to: deps.safeReturnToPath(
      typeof body.return_to === "string" ? body.return_to : "/integrations",
    ),
    scopes: requestedScopes,
    display_name:
      typeof body.display_name === "string" && body.display_name.trim().length > 0
        ? body.display_name.trim()
        : `${provider} integration`,
    correlation_id: correlationId,
    created_at: stateCreatedAt,
    e2e_namespace: namespace,
  };

  await deps.convex.upsertManagedOAuthConnectState({
    orgId,
    provider,
    correlationId,
    initiatingUserId: sessionIdentity.userId,
    createdAt: stateCreatedAt,
    expiresAt: new Date(Date.parse(stateCreatedAt) + OAUTH_STATE_TTL_MS).toISOString(),
    ...(pkceCodeVerifier ? { pkceCodeVerifier } : {}),
  });

  const authRequest = await providerModule.facets.auth.buildAuthRequest(
    {
      redirectUri,
      state: deps.signOAuthStatePayload(JSON.stringify(statePayload)),
      scopes: requestedScopes,
      ...(namespace ? { namespace } : {}),
      ...(pkceCodeVerifier ? { pkceCodeVerifier } : {}),
    },
    runtimeContext,
  );
  const oauthStartUrlValue = authRequest.oauth_start_url;
  if (typeof oauthStartUrlValue !== "string" || oauthStartUrlValue.trim().length === 0) {
    recordOAuthConnectMetric({
      provider,
      orgId: sessionIdentity.orgId,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode: OAUTH_METRIC_REASON_CODE.providerMisconfigured,
    });
    return jsonResponse(
      request,
      oauthErrorPayload({
        provider,
        code: "provider_misconfigured",
        message: "Provider auth module did not return oauth_start_url.",
        correlationId,
      }),
      500,
    );
  }

  recordOAuthConnectMetric({
    provider,
    orgId,
    outcome: PROVIDER_METRIC_OUTCOME.success,
  });
  deps.logger.info("oauth.flow", {
    provider,
    step: "connect_url_generated",
    user_id: sessionIdentity.userId,
    org_id: orgId,
    correlation_id: correlationId,
  });
  deps.trackAnalyticsEvent(
    "oauth.connect.succeeded",
    {
      provider,
      org_id: orgId,
      correlation_id: correlationId,
      request_id: request.headers.get("x-request-id") ?? randomUUID(),
    },
    sessionIdentity.userId,
  );

  return jsonResponse(
    request,
    parseApiBoundary(
      oauthConnectResponseSchema,
      {
        status: "requires_oauth",
        oauth_start_url: oauthStartUrlValue,
        provider,
        correlation_id: correlationId,
      },
      {
        defaultCode: "invalid_oauth_connect_response",
        message: "Invalid OAuth connect response payload.",
      },
    ),
  );
};

export const handleOAuthProviderCallbackRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const providerInput = resolveProviderInputFromCallbackRequest(request) ?? "unknown";
  const recordOAuthCallbackMetric = (params: {
    provider: CanonicalProviderId;
    outcome: ProviderMetricOutcome;
    orgId?: string;
    reasonCode?: string;
  }) => {
    recordProviderMetric(deps, {
      metric: PROVIDER_METRIC_NAME.oauthCallback,
      provider: params.provider,
      route: OAUTH_CALLBACK_ROUTE_PATH,
      outcome: params.outcome,
      ...(params.orgId ? { orgId: params.orgId } : {}),
      ...(params.reasonCode ? { reasonCode: params.reasonCode } : {}),
    });
  };

  if (!(await resolveRegistryPathEnabled(deps))) {
    return jsonResponse(
      request,
      oauthErrorPayload({
        provider: providerInput,
        code: "provider_registry_disabled",
        message: "Provider registry path is disabled by kill switch.",
      }),
      503,
    );
  }

  let provider: ManagedOAuthProvider;
  let parsedQuery: ReturnType<typeof parseOAuthCallbackRequest>["query"];
  try {
    const url = new URL(request.url);
    const parsed = parseOAuthCallbackRequest(
      {
        provider: providerInput,
      },
      {
        code: url.searchParams.get("code") ?? undefined,
        state: url.searchParams.get("state") ?? undefined,
        namespace: url.searchParams.get("namespace") ?? undefined,
      },
    );
    provider = parsed.provider;
    parsedQuery = parsed.query;
  } catch (error) {
    recordProviderResolutionFailure(deps, {
      route: OAUTH_CALLBACK_ROUTE_PATH,
      providerInput,
      error,
    });
    return oauthBoundaryResponse(request, "unknown", error);
  }

  recordOAuthCallbackMetric({
    provider,
    outcome: PROVIDER_METRIC_OUTCOME.attempt,
  });

  if (!(await resolveProviderRolloutFlag(deps, provider))) {
    recordOAuthCallbackMetric({
      provider,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode: OAUTH_METRIC_REASON_CODE.providerDisabled,
    });
    return jsonResponse(
      request,
      oauthErrorPayload({
        provider,
        code: "provider_disabled",
        message: `Provider ${provider} is currently disabled by rollout policy.`,
      }),
      403,
    );
  }

  const code = parsedQuery.code?.trim();
  if (!code) {
    recordOAuthCallbackMetric({
      provider,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode: OAUTH_METRIC_REASON_CODE.missingCode,
    });
    return jsonResponse(
      request,
      oauthErrorPayload({
        provider,
        code: "missing_code",
        message: "Missing OAuth code",
      }),
      400,
    );
  }

  const stateDecode = deps.verifyAndDecodeOAuthStatePayload(parsedQuery.state);
  if ("reason" in stateDecode) {
    const reasonCode =
      stateDecode.reason === OAUTH_STATE_DECODE_REASON.missingState
        ? OAUTH_METRIC_REASON_CODE.missingState
        : OAUTH_METRIC_REASON_CODE.invalidState;
    recordOAuthCallbackMetric({
      provider,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode,
    });
    return jsonResponse(
      request,
      oauthErrorPayload({
        provider,
        code: reasonCode,
        message: mapStateDecodeErrorMessage(stateDecode.reason),
      }),
      400,
    );
  }

  let state: OAuthStatePayload;
  try {
    state = parseApiBoundary(
      oauthStatePayloadSchema,
      deps.parseJsonPayload(stateDecode.payloadRaw),
      {
        defaultCode: "invalid_state",
        message: "Invalid OAuth state payload",
      },
    );
  } catch (error) {
    recordOAuthCallbackMetric({
      provider,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode: OAUTH_METRIC_REASON_CODE.invalidState,
    });
    return jsonResponse(
      request,
      oauthErrorPayload({
        provider,
        code: "invalid_state",
        message:
          isBoundaryParseError(error) && error.message
            ? error.message
            : "Invalid OAuth state payload",
      }),
      400,
    );
  }

  const correlationId = typeof state.correlation_id === "string" ? state.correlation_id : undefined;

  if (state.provider !== provider) {
    recordOAuthCallbackMetric({
      provider,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode: OAUTH_METRIC_REASON_CODE.providerMismatch,
    });
    return jsonResponse(
      request,
      oauthErrorPayload({
        provider,
        code: "provider_mismatch",
        message: "OAuth state provider mismatch",
        correlationId,
      }),
      400,
    );
  }

  const createdAt = Date.parse(state.created_at);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > OAUTH_STATE_TTL_MS) {
    recordOAuthCallbackMetric({
      provider,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode: OAUTH_METRIC_REASON_CODE.stateExpired,
    });
    return jsonResponse(
      request,
      oauthErrorPayload({
        provider,
        code: "state_expired",
        message: "OAuth state has expired; restart the connection flow.",
        correlationId,
      }),
      400,
    );
  }

  const orgId = state.org_id;
  const sessionIdentity = await resolveSessionFromRequest(request, deps);
  if (!sessionIdentity) {
    recordOAuthCallbackMetric({
      provider,
      orgId,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode: OAUTH_METRIC_REASON_CODE.unauthorized,
    });
    return buildCallbackErrorRedirect(request, deps, state, provider, "unauthorized");
  }
  deps.logger.info("oauth.flow", {
    provider,
    step: "callback_received",
    org_id: orgId,
    correlation_id: correlationId,
  });
  deps.trackAnalyticsEvent("oauth.callback.received", {
    provider,
    org_id: orgId,
    correlation_id: correlationId,
    request_id: request.headers.get("x-request-id") ?? randomUUID(),
  });

  const providerModule = await deps.getProviderModule(provider);
  const requiresPkce = providerModule.metadata.oauth?.requiresPkce === true;
  const redirectUri = deps.getRedirectUri(request.url, provider);
  const namespace = state.e2e_namespace ?? deps.getE2ENamespace(parsedQuery.namespace);
  const exchangeKey = `${provider}:${orgId}:${code}`;
  const managedOAuthConnectState = await deps.convex.getManagedOAuthConnectState({
    orgId,
    provider,
    correlationId: state.correlation_id,
  });

  if (!managedOAuthConnectState?.initiatingUserId) {
    const replayedCallback = await deps.convex.getApiDedupeKey({
      scope: API_DEDUPE_SCOPE.oauthCallback,
      dedupeKey: exchangeKey,
    });
    const replayPayload = parseOAuthCallbackReplayPayload(replayedCallback?.payload ?? null);

    if (
      replayPayload?.initiatingUserId === sessionIdentity.userId &&
      sessionIdentity.orgId === orgId &&
      canManageOrgIntegrations(sessionIdentity)
    ) {
      recordOAuthCallbackMetric({
        provider,
        orgId,
        outcome: PROVIDER_METRIC_OUTCOME.success,
      });
      return buildConnectedRedirect(request, deps, state, provider);
    }

    recordOAuthCallbackMetric({
      provider,
      orgId,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode: OAUTH_METRIC_REASON_CODE.invalidState,
    });
    return jsonResponse(
      request,
      oauthErrorPayload({
        provider,
        code: "invalid_state",
        message: "Missing OAuth connect state; restart the connection flow.",
        correlationId,
      }),
      400,
    );
  }

  if (requiresPkce && !managedOAuthConnectState.pkceCodeVerifier) {
    recordOAuthCallbackMetric({
      provider,
      orgId,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode: OAUTH_METRIC_REASON_CODE.invalidState,
    });
    return jsonResponse(
      request,
      oauthErrorPayload({
        provider,
        code: "invalid_state",
        message: "Missing OAuth PKCE verifier; restart the connection flow.",
        correlationId,
      }),
      400,
    );
  }

  if (
    managedOAuthConnectState.initiatingUserId !== sessionIdentity.userId ||
    sessionIdentity.orgId !== orgId ||
    !canManageOrgIntegrations(sessionIdentity)
  ) {
    recordOAuthCallbackMetric({
      provider,
      orgId,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode: OAUTH_METRIC_REASON_CODE.unauthorized,
    });
    return buildCallbackErrorRedirect(request, deps, state, provider, "forbidden");
  }

  try {
    return await withIdempotency({
      client: deps.convex,
      scope: API_DEDUPE_SCOPE.oauthCallback,
      dedupeKey: exchangeKey,
      ttlMs: OAUTH_CALLBACK_IDEMPOTENCY_TTL_MS,
      waitMs: OAUTH_CALLBACK_DEDUPE_WAIT_MS,
      pollIntervalMs: OAUTH_CALLBACK_DEDUPE_POLL_INTERVAL_MS,
      onReplay: (resolution) => {
        switch (resolution.status) {
          case IDEMPOTENCY_RESOLUTION_STATUS.completed:
            recordOAuthCallbackMetric({
              provider,
              orgId,
              outcome: PROVIDER_METRIC_OUTCOME.success,
            });
            return buildConnectedRedirect(request, deps, state, provider);
          case IDEMPOTENCY_RESOLUTION_STATUS.unresolved:
            deps.logger.warn("oauth.flow", {
              provider,
              step: "callback_in_progress",
              org_id: orgId,
              correlation_id: correlationId,
            });
            deps.trackAnalyticsEvent("oauth.callback.in_progress", {
              provider,
              org_id: orgId,
              correlation_id: correlationId,
              request_id: request.headers.get("x-request-id") ?? randomUUID(),
            });
            recordOAuthCallbackMetric({
              provider,
              orgId,
              outcome: PROVIDER_METRIC_OUTCOME.failure,
              reasonCode: OAUTH_METRIC_REASON_CODE.callbackInProgress,
            });
            return jsonResponse(
              request,
              oauthErrorPayload({
                provider,
                code: "callback_in_progress",
                message: "OAuth callback is already being processed. Retry in a moment.",
                correlationId,
              }),
              409,
            );
          case IDEMPOTENCY_RESOLUTION_STATUS.payloadReady:
            return jsonResponse(
              request,
              oauthErrorPayload({
                provider,
                code: "callback_in_progress",
                message: "OAuth callback is already being processed. Retry in a moment.",
                correlationId,
              }),
              409,
            );
          default:
            return assertNever(resolution, "OAuth idempotency replay resolution");
        }
      },
      execute: async ({ setPayload }) => {
        const runtimeContext = deps.toProviderRuntimeContext(namespace);

        try {
          const credentials = await providerModule.facets.auth.exchangeCredentials(
            {
              code,
              redirectUri,
              scopes: state.scopes,
              externalAccountFallback: orgId,
              ...(managedOAuthConnectState?.pkceCodeVerifier
                ? { pkceCodeVerifier: managedOAuthConnectState.pkceCodeVerifier }
                : {}),
              ...(namespace ? { namespace } : {}),
            },
            runtimeContext,
          );

          await deps.convex.upsertOAuthProviderForOrg({
            orgId,
            provider,
            displayName: state.display_name,
            scopes: credentials.scopes,
            externalAccountId: credentials.externalAccountId ?? orgId,
            accessToken: credentials.accessToken,
            refreshToken: credentials.refreshToken,
            expiresAt: credentials.expiresAt,
            metadata: {
              oauth_provider: provider,
              oauth_correlation_id: state.correlation_id,
              ...(state.e2e_namespace ? { e2e_namespace: state.e2e_namespace } : {}),
            },
          });
          await setPayload({
            initiatingUserId: managedOAuthConnectState.initiatingUserId,
          });
          await deps.convex.deleteManagedOAuthConnectState({
            orgId,
            provider,
            correlationId: state.correlation_id,
          });
        } catch (error) {
          recordOAuthCallbackMetric({
            provider,
            orgId,
            outcome: PROVIDER_METRIC_OUTCOME.failure,
            reasonCode: OAUTH_METRIC_REASON_CODE.tokenExchangeFailed,
          });
          const message = error instanceof Error ? error.message : "OAuth token exchange failed.";
          deps.logger.error("oauth.flow", {
            provider,
            step: "token_exchange_failed",
            org_id: orgId,
            correlation_id: correlationId,
            error: message,
          });
          deps.trackAnalyticsEvent("oauth.callback.token_exchange_failed", {
            provider,
            org_id: orgId,
            correlation_id: correlationId,
            request_id: request.headers.get("x-request-id") ?? randomUUID(),
            error: message,
          });
          throw new OAuthCallbackHandledError(
            jsonResponse(
              request,
              oauthErrorPayload({
                provider,
                code: "token_exchange_failed",
                message,
                correlationId,
              }),
              400,
            ),
          );
        }

        recordOAuthCallbackMetric({
          provider,
          orgId,
          outcome: PROVIDER_METRIC_OUTCOME.success,
        });
        deps.logger.info("oauth.flow", {
          provider,
          step: "callback_completed",
          org_id: orgId,
          correlation_id: correlationId,
        });
        deps.trackAnalyticsEvent("oauth.callback.completed", {
          provider,
          org_id: orgId,
          correlation_id: correlationId,
          request_id: request.headers.get("x-request-id") ?? randomUUID(),
        });
        return buildConnectedRedirect(request, deps, state, provider);
      },
    });
  } catch (error) {
    if (error instanceof OAuthCallbackHandledError) {
      return error.response;
    }
    throw error;
  }
};

export const dispatchStartOwnedOAuthApiRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response | null> => {
  if (request.method !== "POST") {
    return null;
  }

  if (resolveProviderInputFromRequest(request) === null) {
    return null;
  }

  return await handleOAuthProviderConnectRequest(request, deps);
};
