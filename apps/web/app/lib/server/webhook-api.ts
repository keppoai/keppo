import {
  PROVIDER_REGISTRY_PATH_FEATURE_FLAG,
  providerRolloutFeatureFlag,
  readFeatureFlagValue,
} from "@keppo/shared/feature-flags";
import {
  getWebhookProviderFacets,
  isWebhookProviderId,
  type WebhookProvider,
} from "@keppo/shared/provider-facet-loader";
import {
  buildBoundaryErrorEnvelope,
  parseWebhookEnvelope,
  parseWebhookResponse,
} from "@keppo/shared/providers/boundaries/error-boundary";
import type {
  ProviderMetricName,
  ProviderMetricOutcome,
} from "@keppo/shared/providers/boundaries/types";
import type { CanonicalProviderId } from "@keppo/shared/provider-ids";
import type { ProviderRuntimeContext } from "@keppo/shared/provider-runtime-context";
import {
  API_DEDUPE_SCOPE,
  PROVIDER_METRIC_NAME,
  PROVIDER_METRIC_OUTCOME,
  WEBHOOK_VERIFICATION_REASON,
  assertNever,
  type WebhookVerificationReason,
} from "@keppo/shared/domain";
import {
  getE2ENamespace,
  parseJsonPayload,
  toLowercaseHeaders,
  toProviderRuntimeContext,
} from "./api-runtime/app-helpers.ts";
import { ConvexInternalClient } from "./api-runtime/convex.ts";
import { IDEMPOTENCY_RESOLUTION_STATUS, withIdempotency } from "./api-runtime/idempotency.ts";
import { logger } from "./api-runtime/logger.ts";
import { captureApiEvent } from "./api-runtime/posthog.ts";

const SECURITY_HEADER_VALUES = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
} as const;

const WEBHOOK_ROUTE_PATH = "/webhooks/:provider";
const WEBHOOK_DEDUP_TTL_MS = 10 * 60_000;
type StartOwnedWebhookConvex = Pick<
  ConvexInternalClient,
  | "claimApiDedupeKey"
  | "completeApiDedupeKey"
  | "getApiDedupeKey"
  | "getFeatureFlag"
  | "ingestProviderEvent"
  | "recordProviderMetric"
  | "recordProviderWebhook"
  | "releaseApiDedupeKey"
  | "setApiDedupePayload"
>;

type StartOwnedWebhookDeps = {
  convex: StartOwnedWebhookConvex;
  getE2ENamespace: typeof getE2ENamespace;
  getProviderModule: typeof getWebhookProviderFacets;
  isWebhookProvider: (provider: string) => provider is WebhookProvider;
  logger: Pick<typeof logger, "error" | "info">;
  parseJsonPayload: typeof parseJsonPayload;
  toLowercaseHeaders: typeof toLowercaseHeaders;
  toProviderRuntimeContext: (namespace: string | null) => ProviderRuntimeContext;
  trackAnalyticsEvent: (
    event: string,
    properties: Record<string, unknown>,
    distinctId?: string,
  ) => void;
  webhookBoundaryResponse: (
    request: Request,
    provider: string,
    defaultCode: string,
    defaultMessage: string,
    error: unknown,
  ) => Response;
};

let convexClient: ConvexInternalClient | null = null;

const getDefaultDeps = (): StartOwnedWebhookDeps => ({
  convex: (convexClient ??= new ConvexInternalClient()),
  getE2ENamespace,
  getProviderModule: getWebhookProviderFacets,
  isWebhookProvider: isWebhookProviderId,
  logger,
  parseJsonPayload,
  toLowercaseHeaders,
  toProviderRuntimeContext: (namespace) => toProviderRuntimeContext(namespace, logger),
  trackAnalyticsEvent: (event, properties, distinctId) => {
    captureApiEvent(event, {
      ...(distinctId ? { distinctId } : {}),
      properties: {
        source: "api",
        ...properties,
      },
    });
  },
  webhookBoundaryResponse: (request, provider, defaultCode, defaultMessage, error) => {
    const envelope = buildBoundaryErrorEnvelope(error, {
      defaultCode,
      defaultMessage,
      source: "api",
      provider,
    });
    return jsonResponse(
      request,
      parseWebhookResponse({
        error: {
          ...envelope.error,
        },
      }),
      400,
    );
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

const applySecurityHeaders = (request: Request, response: Response): Response => {
  const headers = withSecurityHeaders(request, response).headers ?? response.headers;
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

const jsonResponse = (request: Request, payload: unknown, status = 200): Response => {
  return Response.json(payload, withSecurityHeaders(request, { status }));
};

const textResponse = (request: Request, body: string, status: number): Response => {
  return new Response(body, withSecurityHeaders(request, { status }));
};

const toWebhookVerifyErrorCode = (
  reason: WebhookVerificationReason,
): "invalid_signature_payload" | "invalid_signature" => {
  switch (reason) {
    case WEBHOOK_VERIFICATION_REASON.missingOrMalformedSignature:
      return "invalid_signature_payload";
    case WEBHOOK_VERIFICATION_REASON.invalidSignatureTimestamp:
    case WEBHOOK_VERIFICATION_REASON.signatureTimestampOutOfTolerance:
    case WEBHOOK_VERIFICATION_REASON.missingWebhookSecret:
    case WEBHOOK_VERIFICATION_REASON.invalidSignature:
      return "invalid_signature";
    default:
      return assertNever(reason, "webhook verification failure reason");
  }
};

const resolveProviderInputFromRequest = (request: Request): string | null => {
  const match = /^\/webhooks\/([^/]+)\/?$/u.exec(new URL(request.url).pathname);
  return match?.[1] ?? null;
};

const resolveFeatureFlag = async (
  deps: StartOwnedWebhookDeps,
  name: typeof PROVIDER_REGISTRY_PATH_FEATURE_FLAG | ReturnType<typeof providerRolloutFeatureFlag>,
): Promise<boolean> => {
  try {
    return await deps.convex.getFeatureFlag(name);
  } catch {
    return readFeatureFlagValue(name, process.env);
  }
};

const resolveRegistryPathEnabled = async (deps: StartOwnedWebhookDeps): Promise<boolean> => {
  return await resolveFeatureFlag(deps, PROVIDER_REGISTRY_PATH_FEATURE_FLAG);
};

const resolveProviderRolloutFlag = async (
  deps: StartOwnedWebhookDeps,
  provider: CanonicalProviderId,
): Promise<boolean> => {
  return await resolveFeatureFlag(deps, providerRolloutFeatureFlag(provider));
};

const recordProviderMetric = (
  deps: StartOwnedWebhookDeps,
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
  void deps.convex
    .recordProviderMetric({
      orgId: params.orgId?.trim() ? params.orgId.trim() : "system",
      metric: params.metric,
      ...(params.provider ? { provider: params.provider } : {}),
      ...(params.providerInput ? { providerInput: params.providerInput } : {}),
      ...(params.route ? { route: params.route } : {}),
      ...(params.outcome ? { outcome: params.outcome } : {}),
      ...(params.reasonCode ? { reasonCode: params.reasonCode } : {}),
      ...(params.value !== undefined ? { value: params.value } : {}),
    })
    .catch((error: unknown) => {
      deps.logger.error("webhook.metric_record_failed", {
        error: error instanceof Error ? error.message : String(error),
        ...params,
      });
    });
};

export const handleProviderWebhookRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response> => {
  const providerInput = resolveProviderInputFromRequest(request);
  if (!providerInput || !deps.isWebhookProvider(providerInput)) {
    return textResponse(request, "Not Found", 404);
  }

  const provider = providerInput;
  if (!(await resolveRegistryPathEnabled(deps))) {
    return jsonResponse(
      request,
      parseWebhookResponse({
        error: {
          code: "provider_registry_disabled",
          message: "Provider registry path is disabled by kill switch.",
          provider,
        },
      }),
      503,
    );
  }

  if (!(await resolveProviderRolloutFlag(deps, provider))) {
    return jsonResponse(
      request,
      parseWebhookResponse({
        error: {
          code: "provider_disabled",
          message: `${provider} integration is currently disabled by rollout policy`,
          provider,
        },
      }),
      403,
    );
  }

  const providerModule = await deps.getProviderModule(provider);
  const webhookFacet = providerModule.facets.webhooks;
  if (!webhookFacet?.verifyWebhook) {
    deps.logger.error(`Provider ${provider} is webhook-capable but has no verifyWebhook hook.`);
    return jsonResponse(
      request,
      parseWebhookResponse({
        error: {
          code: "provider_misconfigured",
          message: `${provider} webhook verification is not configured`,
          provider,
        },
      }),
      500,
    );
  }
  if (!webhookFacet.extractWebhookEvent) {
    deps.logger.error(
      `Provider ${provider} is webhook-capable but has no extractWebhookEvent hook.`,
    );
    return jsonResponse(
      request,
      parseWebhookResponse({
        error: {
          code: "provider_misconfigured",
          message: `${provider} webhook event extraction is not configured`,
          provider,
        },
      }),
      500,
    );
  }

  const rawBody = await request.text();
  let payload: Record<string, unknown>;
  try {
    payload = parseWebhookEnvelope(deps.parseJsonPayload(rawBody));
  } catch (error) {
    return deps.webhookBoundaryResponse(
      request,
      provider,
      "invalid_payload",
      `${provider} webhook body must be a JSON object`,
      error,
    );
  }

  const normalizedHeaders = deps.toLowercaseHeaders(request.headers);
  const namespace = deps.getE2ENamespace(request.headers.get("x-keppo-e2e-namespace") ?? undefined);
  const providerRuntimeContext = deps.toProviderRuntimeContext(namespace);

  const verification = await webhookFacet.verifyWebhook(
    {
      rawBody,
      headers: normalizedHeaders,
    },
    providerRuntimeContext,
  );
  recordProviderMetric(deps, {
    metric: PROVIDER_METRIC_NAME.webhookVerify,
    provider,
    route: WEBHOOK_ROUTE_PATH,
    outcome: PROVIDER_METRIC_OUTCOME.attempt,
  });
  if (!verification.verified) {
    const errorCode = toWebhookVerifyErrorCode(verification.reason);
    recordProviderMetric(deps, {
      metric: PROVIDER_METRIC_NAME.webhookVerify,
      provider,
      route: WEBHOOK_ROUTE_PATH,
      outcome: PROVIDER_METRIC_OUTCOME.failure,
      reasonCode: verification.reason,
    });
    return jsonResponse(
      request,
      parseWebhookResponse({
        error: {
          code: errorCode,
          message: `Invalid ${provider} webhook signature`,
          provider,
          reason: verification.reason,
        },
      }),
      400,
    );
  }
  recordProviderMetric(deps, {
    metric: PROVIDER_METRIC_NAME.webhookVerify,
    provider,
    route: WEBHOOK_ROUTE_PATH,
    outcome: PROVIDER_METRIC_OUTCOME.success,
  });

  const requestId = request.headers.get("x-request-id");
  let event;
  try {
    event = webhookFacet.extractWebhookEvent(
      payload,
      {
        rawBody,
        headers: normalizedHeaders,
      },
      providerRuntimeContext,
    );
  } catch (error) {
    return deps.webhookBoundaryResponse(
      request,
      provider,
      "invalid_payload",
      `${provider} webhook event payload is invalid`,
      error,
    );
  }

  const dedupeKey = `${provider}:${event.deliveryId}`;
  const now = Date.now();

  deps.logger.info("webhook.received", {
    provider,
    event_type: event.eventType,
    dedupe_key: dedupeKey,
  });
  deps.trackAnalyticsEvent("webhook.received", {
    provider,
    event_type: event.eventType,
    dedupe_key: dedupeKey,
    ...(requestId ? { request_id: requestId } : {}),
  });

  try {
    return await withIdempotency({
      client: deps.convex,
      scope: API_DEDUPE_SCOPE.webhookDelivery,
      dedupeKey,
      ttlMs: WEBHOOK_DEDUP_TTL_MS,
      onReplay: (resolution) => {
        switch (resolution.status) {
          case IDEMPOTENCY_RESOLUTION_STATUS.completed:
          case IDEMPOTENCY_RESOLUTION_STATUS.payloadReady:
          case IDEMPOTENCY_RESOLUTION_STATUS.unresolved:
            deps.logger.info("webhook.duplicate", {
              provider,
              event_type: event.eventType,
              dedupe_key: dedupeKey,
            });
            deps.trackAnalyticsEvent("webhook.duplicate", {
              provider,
              event_type: event.eventType,
              dedupe_key: dedupeKey,
              ...(requestId ? { request_id: requestId } : {}),
            });
            return jsonResponse(
              request,
              parseWebhookResponse({ received: true, provider, duplicate: true }),
            );
          default:
            return assertNever(resolution, "webhook idempotency replay resolution");
        }
      },
      execute: async () => {
        const result = await deps.convex.recordProviderWebhook({
          provider,
          externalAccountId: event.externalAccountId,
          eventType: event.eventType,
          payload,
          receivedAt: new Date(now).toISOString(),
        });
        const matchedOrgIds = result.matched_org_ids ?? [];
        if (matchedOrgIds.length > 0) {
          await Promise.all(
            matchedOrgIds.map(async (orgId) =>
              deps.convex.ingestProviderEvent({
                orgId,
                provider,
                providerEventType: event.eventType,
                providerEventId: event.deliveryId,
                deliveryMode: "webhook",
                eventPayload: payload,
                eventPayloadRef: event.deliveryId,
              }),
            ),
          ).catch((error: unknown) => {
            deps.logger.error("webhook.trigger_queue.failed", {
              provider,
              event_id: event.deliveryId,
              error: error instanceof Error ? error.message : String(error),
            });
            throw error;
          });
        }
        deps.logger.info("webhook.process.succeeded", {
          provider,
          event_type: event.eventType,
          dedupe_key: dedupeKey,
          matched_integrations: result.matched_integrations,
          matched_orgs: result.matched_orgs,
        });
        deps.trackAnalyticsEvent("webhook.process.completed", {
          provider,
          event_type: event.eventType,
          dedupe_key: dedupeKey,
          ...(requestId ? { request_id: requestId } : {}),
          matched_integrations: result.matched_integrations,
          matched_orgs: result.matched_orgs,
        });
        return jsonResponse(
          request,
          parseWebhookResponse({
            received: true,
            provider,
            duplicate: false,
            matched_integrations: result.matched_integrations,
            matched_orgs: result.matched_orgs,
          }),
        );
      },
    });
  } catch (error) {
    deps.logger.error("webhook.process.failed", {
      provider,
      dedupe_key: dedupeKey,
      error: error instanceof Error ? error.message : String(error),
    });
    deps.trackAnalyticsEvent("webhook.process.failed", {
      provider,
      event_type: event.eventType,
      dedupe_key: dedupeKey,
      ...(requestId ? { request_id: requestId } : {}),
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      request,
      parseWebhookResponse({
        error: {
          code: "webhook_processing_failed",
          message: `Failed to process ${provider} webhook`,
          provider,
        },
      }),
      500,
    );
  }
};

export const dispatchStartOwnedWebhookRequest = async (
  request: Request,
  deps = getDefaultDeps(),
): Promise<Response | null> => {
  if (request.method !== "POST") {
    return null;
  }

  if (resolveProviderInputFromRequest(request) === null) {
    return null;
  }

  return await handleProviderWebhookRequest(request, deps);
};
