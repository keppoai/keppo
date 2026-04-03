import { z } from "zod";
import {
  canonicalProviderIdSchema,
  jsonRecordSchema,
  managedOAuthProviderIdSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  nullableNonEmptyStringSchema,
  positiveIntegerSchema,
} from "./common.js";
import {
  actionRiskLevelSchema,
  capabilitySchema,
  integrationStatusSchema,
  providerCatalogConfigurationStatusSchema,
  providerDeprecationStatusSchema,
  roleSchema,
} from "../../types.js";
import { AI_KEY_MODES, AI_MODEL_PROVIDERS } from "../../automations.js";

export const oauthConnectParamsSchema = z.object({
  provider: managedOAuthProviderIdSchema,
});

export const oauthConnectBodySchema = z
  .object({
    org_id: z.string().trim().optional(),
    return_to: z.string().optional(),
    scopes: z.array(z.string().trim().min(1)).optional(),
    display_name: z.string().optional(),
  })
  .passthrough();

export const oauthCallbackParamsSchema = z.object({
  provider: managedOAuthProviderIdSchema,
});

export const oauthCallbackQuerySchema = z
  .object({
    code: z.string().optional(),
    state: z.string().optional(),
    namespace: z.string().optional(),
  })
  .passthrough();

export const oauthStatePayloadSchema = z.object({
  org_id: z.string().trim().min(1),
  provider: managedOAuthProviderIdSchema,
  return_to: z.string().min(1),
  scopes: z.array(z.string().trim().min(1)),
  display_name: z.string().min(1),
  correlation_id: z.string().min(1),
  created_at: z.string().min(1),
  e2e_namespace: z.union([z.string().trim().min(1), z.null()]),
});

export const oauthTokenResponseSchema = z
  .object({
    access_token: z.string().optional(),
    refresh_token: z.string().optional(),
    expires_in: z.number().int().positive().optional(),
    scope: z.string().optional(),
  })
  .passthrough();

const oauthConnectSuccessResponseSchema = z
  .object({
    status: z.literal("requires_oauth"),
    oauth_start_url: z.string().trim().min(1),
    provider: managedOAuthProviderIdSchema,
    correlation_id: z.string().trim().min(1),
  })
  .passthrough();

const oauthConnectErrorDetailsSchema = z
  .object({
    code: z.string().trim().min(1),
    message: z.string().trim().min(1),
    provider: z.string().trim().min(1),
    correlation_id: z.string().trim().min(1).optional(),
  })
  .passthrough();

const oauthConnectErrorResponseSchema = z
  .object({
    error: oauthConnectErrorDetailsSchema,
  })
  .passthrough();

export const oauthConnectResponseSchema = z.union([
  oauthConnectSuccessResponseSchema,
  oauthConnectErrorResponseSchema,
]);

export const webhookPayloadSchema = jsonRecordSchema;

const webhookHeadersSchema = z.record(z.string(), z.string().optional());

export const stripeWebhookHeadersSchema = webhookHeadersSchema.and(
  z.object({
    "stripe-signature": z.string().trim().min(1),
  }),
);

export const githubWebhookHeadersSchema = webhookHeadersSchema.and(
  z.object({
    "x-hub-signature-256": z.string().trim().min(1),
    "x-github-delivery": z.string().trim().min(1).optional(),
    "x-github-event": z.string().trim().min(1).optional(),
  }),
);

export const providerCatalogToolSchema = z.object({
  name: nonEmptyStringSchema,
  capability: capabilitySchema,
  risk_level: actionRiskLevelSchema,
  requires_approval: z.boolean(),
});

export const providerCatalogDeprecationSchema = z.object({
  status: providerDeprecationStatusSchema,
  message: nonEmptyStringSchema,
  sunset_at: nonEmptyStringSchema.optional(),
  replacement_provider: canonicalProviderIdSchema.optional(),
});

export const providerCatalogConfigurationSchema = z.object({
  status: providerCatalogConfigurationStatusSchema,
  message: nonEmptyStringSchema,
});

export const providerCatalogEntrySchema = z.object({
  provider: canonicalProviderIdSchema,
  supported_tools: z.array(providerCatalogToolSchema),
  configuration: providerCatalogConfigurationSchema.optional(),
  deprecation: providerCatalogDeprecationSchema.optional(),
});

export const providerCatalogResponseSchema = z.array(providerCatalogEntrySchema);

export const integrationDetailSchema = z
  .object({
    id: nonEmptyStringSchema,
    org_id: nonEmptyStringSchema,
    provider: canonicalProviderIdSchema,
    display_name: nonEmptyStringSchema,
    status: integrationStatusSchema,
    created_at: nonEmptyStringSchema,
    connected: z.boolean(),
    scopes: z.array(nonEmptyStringSchema),
    external_account_id: nullableNonEmptyStringSchema,
    credential_expires_at: nullableNonEmptyStringSchema,
    has_refresh_token: z.boolean().optional(),
    last_health_check_at: nullableNonEmptyStringSchema.optional(),
    last_successful_health_check_at: nullableNonEmptyStringSchema.optional(),
    last_error_code: nullableNonEmptyStringSchema.optional(),
    last_error_category: nullableNonEmptyStringSchema.optional(),
    last_webhook_at: nullableNonEmptyStringSchema.optional(),
    degraded_reason: nullableNonEmptyStringSchema.optional(),
    provider_module_version: z.union([nonNegativeIntegerSchema, z.null()]).optional(),
    metadata: jsonRecordSchema.optional(),
  })
  .passthrough();

export const integrationDetailsResponseSchema = z.array(integrationDetailSchema);

export const workspaceIntegrationSchema = z.object({
  id: nonEmptyStringSchema,
  workspace_id: nonEmptyStringSchema,
  provider: canonicalProviderIdSchema,
  enabled: z.boolean(),
  created_by: nonEmptyStringSchema,
  created_at: nonEmptyStringSchema,
});

export const workspaceIntegrationsResponseSchema = z.array(workspaceIntegrationSchema);

export const mcpWorkspaceParamsSchema = z.object({
  workspaceId: nonEmptyStringSchema,
});

export const mcpRequestEnvelopeSchema = z
  .object({
    jsonrpc: z.literal("2.0").optional(),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    method: nonEmptyStringSchema,
    params: jsonRecordSchema.optional(),
  })
  .passthrough();

export const mcpToolCallParamsSchema = z
  .object({
    name: nonEmptyStringSchema,
    arguments: jsonRecordSchema.optional(),
  })
  .passthrough();

export const providerUiPayloadSchema = z.object({
  provider: canonicalProviderIdSchema,
  values: jsonRecordSchema,
});

export const convexExecuteToolCallPayloadSchema = z.object({
  workspaceId: nonEmptyStringSchema,
  runId: nonEmptyStringSchema,
  automationRunId: nonEmptyStringSchema.optional(),
  toolName: nonEmptyStringSchema,
  input: jsonRecordSchema,
  credentialId: nonEmptyStringSchema,
});

export const convexRunMaintenanceTickPayloadSchema = z.object({
  approvedLimit: nonNegativeIntegerSchema,
  ttlMinutes: positiveIntegerSchema,
  inactivityMinutes: positiveIntegerSchema,
});

export const approvedActionQueuePayloadSchema = z.object({
  actionId: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  idempotencyKey: nonEmptyStringSchema,
  requestedAt: nonEmptyStringSchema,
  metadata: jsonRecordSchema.optional(),
});

export const approvedActionDispatchRequestSchema = approvedActionQueuePayloadSchema;

export const approvedActionQueueEnvelopeSchema = z.object({
  messageId: nonEmptyStringSchema,
  topic: z.literal("approved-action"),
  attempt: nonNegativeIntegerSchema,
  maxAttempts: positiveIntegerSchema,
  enqueuedAt: nonEmptyStringSchema,
  payload: approvedActionQueuePayloadSchema,
});

export const localQueueEnqueueResponseSchema = z.object({
  messageId: nonEmptyStringSchema,
});

export const workerMaintenanceTickResultSchema = z.object({
  processed: nonNegativeIntegerSchema,
  expired: nonNegativeIntegerSchema,
  timedOutRuns: nonNegativeIntegerSchema,
  securityFlagsCreated: nonNegativeIntegerSchema,
  credentialLockoutRowsPurged: nonNegativeIntegerSchema,
  credentialRotationRecommendations: nonNegativeIntegerSchema,
  notificationsSent: nonNegativeIntegerSchema,
  notificationsFailed: nonNegativeIntegerSchema,
  purgedActions: nonNegativeIntegerSchema,
  purgedBlobs: nonNegativeIntegerSchema,
  purgedAudits: nonNegativeIntegerSchema,
});

export const internalInviteCreateRequestSchema = z
  .object({
    orgId: z.string().trim().optional(),
    inviterUserId: z.string().trim().optional(),
    inviterName: z.string().optional(),
    email: z.string().optional(),
    role: roleSchema,
  })
  .passthrough();

export const internalInviteAcceptRequestSchema = z
  .object({
    token: z.string().optional(),
    userId: z.string().trim().optional(),
  })
  .passthrough();

export const internalNotificationsDeliverRequestSchema = z
  .object({
    eventIds: z.array(z.string().trim().min(1)),
  })
  .passthrough();

export const pushSubscriptionSchema = z
  .object({
    endpoint: z.url().refine((value) => {
      try {
        return new URL(value).protocol === "https:";
      } catch {
        return false;
      }
    }, "Push subscription endpoint must use https."),
    keys: z
      .object({
        p256dh: z.string().trim().min(1),
        auth: z.string().trim().min(1),
      })
      .passthrough(),
  })
  .passthrough();

export const internalPushSubscribeRequestSchema = z
  .object({
    subscription: pushSubscriptionSchema,
  })
  .passthrough();

export const automationDispatchMissingAiKeyResponseSchema = z
  .object({
    ok: z.boolean().optional(),
    status: z.literal("missing_ai_key"),
    provider: z.enum(AI_MODEL_PROVIDERS),
    key_mode: z.enum(AI_KEY_MODES),
  })
  .passthrough();
