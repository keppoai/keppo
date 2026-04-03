import { z } from "zod";
import {
  canonicalProviderIdSchema,
  jsonRecordSchema,
  nonEmptyStringSchema,
  nonNegativeIntegerSchema,
  positiveIntegerSchema,
} from "./common.js";
import {
  PROVIDER_METRIC_EVENT_TYPE,
  PROVIDER_METRIC_NAMES,
  PROVIDER_METRIC_OUTCOMES,
} from "../../domain.js";
import {
  actionRiskLevelSchema,
  actionStatusSchema,
  auditActorTypeSchema,
  auditEventTypeSchema,
  deciderTypeSchema,
  decisionSchema,
  defaultActionBehaviorSchema,
  policyDecisionResultSchema,
  policyModeSchema,
  ruleEffectSchema,
  workspaceStatusSchema,
} from "../../types.js";

export const convexUpsertOAuthProviderPayloadSchema = z.object({
  orgId: nonEmptyStringSchema,
  provider: canonicalProviderIdSchema,
  displayName: nonEmptyStringSchema,
  scopes: z.array(nonEmptyStringSchema),
  externalAccountId: nonEmptyStringSchema,
  accessToken: nonEmptyStringSchema,
  refreshToken: z.union([nonEmptyStringSchema, z.null()]),
  expiresAt: z.union([nonEmptyStringSchema, z.null()]),
  metadata: jsonRecordSchema.optional(),
});

export const convexManagedOAuthConnectStatePayloadSchema = z.object({
  orgId: nonEmptyStringSchema,
  provider: canonicalProviderIdSchema,
  correlationId: nonEmptyStringSchema,
  initiatingUserId: nonEmptyStringSchema,
  createdAt: nonEmptyStringSchema,
  expiresAt: nonEmptyStringSchema,
  pkceCodeVerifier: nonEmptyStringSchema.optional(),
});

export const convexManagedOAuthConnectStateSchema = z.object({
  provider: canonicalProviderIdSchema,
  correlationId: nonEmptyStringSchema,
  initiatingUserId: nonEmptyStringSchema.nullish(),
  createdAt: nonEmptyStringSchema,
  expiresAt: nonEmptyStringSchema,
  pkceCodeVerifier: z.union([nonEmptyStringSchema, z.null()]),
});

export const convexRecordProviderWebhookPayloadSchema = z.object({
  provider: canonicalProviderIdSchema,
  externalAccountId: z.union([nonEmptyStringSchema, z.null()]).optional(),
  eventType: nonEmptyStringSchema,
  payload: jsonRecordSchema,
  receivedAt: nonEmptyStringSchema.optional(),
});

export const convexRecordProviderWebhookResultSchema = z.object({
  matched_orgs: nonNegativeIntegerSchema,
  matched_integrations: nonNegativeIntegerSchema,
  matched_org_ids: z.array(nonEmptyStringSchema),
});

export const convexIngestProviderEventPayloadSchema = z.object({
  orgId: nonEmptyStringSchema,
  provider: canonicalProviderIdSchema,
  triggerKey: nonEmptyStringSchema.optional(),
  providerEventId: nonEmptyStringSchema,
  providerEventType: nonEmptyStringSchema,
  deliveryMode: z.union([z.literal("webhook"), z.literal("polling")]),
  eventPayload: jsonRecordSchema,
  eventPayloadRef: z.union([nonEmptyStringSchema, z.null()]).optional(),
});

export const convexIngestProviderEventResultSchema = z.object({
  queued_count: nonNegativeIntegerSchema,
  skipped_count: nonNegativeIntegerSchema,
});

export const convexApprovedActionDispatchSchema = z.object({
  actionId: nonEmptyStringSchema,
  workspaceId: nonEmptyStringSchema,
  idempotencyKey: nonEmptyStringSchema,
  createdAt: nonEmptyStringSchema,
  e2eNamespace: nonEmptyStringSchema.optional(),
});

export const convexApprovedActionDispatchListSchema = z.array(convexApprovedActionDispatchSchema);

export const convexActionRiskLevelSchema = actionRiskLevelSchema;

export const convexActionStatusSchema = actionStatusSchema;

export const convexExecuteApprovedActionResultSchema = z.object({
  status: convexActionStatusSchema,
  action: jsonRecordSchema,
});

export const convexActionStatusPayloadSchema = z.object({
  id: nonEmptyStringSchema,
  status: convexActionStatusSchema,
  result_redacted: z.union([jsonRecordSchema, z.null()]),
  payload_preview: jsonRecordSchema,
});

export const convexActionSchema = z.object({
  id: nonEmptyStringSchema,
  action_type: nonEmptyStringSchema,
  risk_level: convexActionRiskLevelSchema,
  status: convexActionStatusSchema,
  payload_preview: jsonRecordSchema,
  result_redacted: z.union([jsonRecordSchema, z.null()]),
  idempotency_key: nonEmptyStringSchema,
  created_at: nonEmptyStringSchema,
  resolved_at: z.union([nonEmptyStringSchema, z.null()]),
});

export const convexActionListSchema = z.array(convexActionSchema);

export const convexApprovalSchema = z.object({
  id: nonEmptyStringSchema,
  action_id: nonEmptyStringSchema,
  decider_type: deciderTypeSchema,
  decision: decisionSchema,
  reason: z.string(),
  rule_id: z.union([nonEmptyStringSchema, z.null()]),
  confidence: z.union([z.number(), z.null()]),
  created_at: nonEmptyStringSchema,
});

export const convexCelRuleMatchSchema = z.object({
  id: nonEmptyStringSchema,
  action_id: nonEmptyStringSchema,
  cel_rule_id: nonEmptyStringSchema,
  effect: ruleEffectSchema,
  expression_snapshot: nonEmptyStringSchema,
  context_snapshot: jsonRecordSchema,
  created_at: nonEmptyStringSchema,
});

export const convexPolicyDecisionSchema = z.object({
  id: nonEmptyStringSchema,
  action_id: nonEmptyStringSchema,
  policies_evaluated: z.array(nonEmptyStringSchema),
  result: policyDecisionResultSchema,
  explanation: nonEmptyStringSchema,
  confidence: z.union([z.number(), z.null()]),
  created_at: nonEmptyStringSchema,
});

export const convexAuditEventSchema = z.object({
  id: nonEmptyStringSchema,
  org_id: nonEmptyStringSchema,
  actor_type: auditActorTypeSchema,
  actor_id: nonEmptyStringSchema,
  event_type: auditEventTypeSchema,
  payload: jsonRecordSchema,
  created_at: nonEmptyStringSchema,
});

export const convexActionDetailSchema = z.object({
  action: convexActionSchema,
  normalized_payload: z.union([jsonRecordSchema, z.null()]),
  approvals: z.array(convexApprovalSchema),
  cel_rule_matches: z.array(convexCelRuleMatchSchema),
  policy_decisions: z.array(convexPolicyDecisionSchema),
  timeline: z.array(convexAuditEventSchema).optional(),
});

export const convexNullableActionDetailSchema = z.union([convexActionDetailSchema, z.null()]);

export const convexActionStateSchema = z.object({
  action: convexActionStatusPayloadSchema,
  workspace: z.object({
    id: nonEmptyStringSchema,
  }),
});

export const convexActionExecutionStateSchema = z.object({
  action: convexActionStatusPayloadSchema.extend({
    normalized_payload_enc: nonEmptyStringSchema,
    tool_call_id: nonEmptyStringSchema,
  }),
  run: z.object({
    id: nonEmptyStringSchema,
    metadata: jsonRecordSchema,
  }),
  workspace: z.object({
    id: nonEmptyStringSchema,
    org_id: nonEmptyStringSchema,
  }),
});

export const convexActionCreationResultSchema = z.object({
  action: convexActionStatusPayloadSchema,
  workspace: z.object({
    id: nonEmptyStringSchema,
    org_id: nonEmptyStringSchema,
  }),
  idempotencyReplayed: z.boolean(),
});

export const convexActionDispatchStateSchema = z.object({
  action: z.object({
    status: convexActionStatusSchema,
    idempotency_key: nonEmptyStringSchema,
    created_at: nonEmptyStringSchema,
  }),
  run: z.object({
    metadata: jsonRecordSchema,
  }),
  workspace: z.object({
    id: nonEmptyStringSchema,
  }),
});

export const convexToolCallReferenceSchema = z.object({
  id: nonEmptyStringSchema,
  tool_name: nonEmptyStringSchema,
});

export const convexPollRateLimitSchema = z.object({
  limited: z.boolean(),
  retry_after_ms: nonNegativeIntegerSchema.optional(),
});

export const convexPendingWorkspaceActionSchema = z.object({
  id: nonEmptyStringSchema,
  status: convexActionStatusSchema,
  payload_preview: jsonRecordSchema,
  created_at: nonEmptyStringSchema,
});

export const convexPendingWorkspaceActionListSchema = z.array(convexPendingWorkspaceActionSchema);

export const convexActionIdSchema = z.object({
  id: nonEmptyStringSchema,
});

export const convexActionIdListSchema = z.array(convexActionIdSchema);

export const convexWorkspaceContextSchema = z.object({
  id: nonEmptyStringSchema,
  org_id: nonEmptyStringSchema,
  slug: nonEmptyStringSchema,
  name: nonEmptyStringSchema,
  status: workspaceStatusSchema,
  policy_mode: policyModeSchema,
  default_action_behavior: defaultActionBehaviorSchema,
  code_mode_enabled: z.boolean(),
  created_at: nonEmptyStringSchema,
});

export const convexConnectorContextSchema = z.object({
  workspace: convexWorkspaceContextSchema,
  provider_enabled: z.boolean(),
  integration_id: z.union([nonEmptyStringSchema, z.null()]),
  integration_provider: z.union([canonicalProviderIdSchema, z.null()]),
  scopes: z.array(nonEmptyStringSchema),
  access_token: z.union([nonEmptyStringSchema, z.null()]),
  refresh_token: z.union([nonEmptyStringSchema, z.null()]),
  access_token_expires_at: z.union([nonEmptyStringSchema, z.null()]),
  integration_account_id: z.union([nonEmptyStringSchema, z.null()]),
  external_account_id: z.union([nonEmptyStringSchema, z.null()]),
  metadata: jsonRecordSchema,
});

export const convexGatingDataSchema = z.object({
  workspace: convexWorkspaceContextSchema,
  cel_rules: z.array(
    z.object({
      id: nonEmptyStringSchema,
      workspace_id: nonEmptyStringSchema,
      name: nonEmptyStringSchema,
      description: z.string(),
      expression: nonEmptyStringSchema,
      effect: ruleEffectSchema,
      enabled: z.boolean(),
      created_by: nonEmptyStringSchema,
      created_at: nonEmptyStringSchema,
    }),
  ),
  tool_auto_approvals: z.array(
    z.object({
      id: nonEmptyStringSchema,
      workspace_id: nonEmptyStringSchema,
      tool_name: nonEmptyStringSchema,
      enabled: z.boolean(),
      created_by: nonEmptyStringSchema,
      created_at: nonEmptyStringSchema,
    }),
  ),
  policies: z.array(
    z.object({
      id: nonEmptyStringSchema,
      workspace_id: nonEmptyStringSchema,
      text: nonEmptyStringSchema,
      enabled: z.boolean(),
      created_by: nonEmptyStringSchema,
      created_at: nonEmptyStringSchema,
    }),
  ),
});

export const convexWorkspaceListSchema = z.array(convexWorkspaceContextSchema);

export const convexWorkspaceRuleSchema = z.object({
  id: nonEmptyStringSchema,
  workspace_id: nonEmptyStringSchema,
  name: z.string(),
  description: z.string(),
  expression: z.string(),
  effect: ruleEffectSchema,
  enabled: z.boolean(),
  created_by: z.string(),
  created_at: z.string(),
});

export const convexWorkspacePolicySchema = z.object({
  id: nonEmptyStringSchema,
  workspace_id: nonEmptyStringSchema,
  text: z.string(),
  enabled: z.boolean(),
  created_by: z.string(),
  created_at: z.string(),
});

export const convexWorkspaceAutoApprovalSchema = z.object({
  id: nonEmptyStringSchema,
  workspace_id: nonEmptyStringSchema,
  tool_name: z.string(),
  enabled: z.boolean(),
  created_by: z.string(),
  created_at: z.string(),
});

export const convexWorkspaceRulesResponseSchema = z.object({
  workspace: convexWorkspaceContextSchema,
  rules: z.array(convexWorkspaceRuleSchema),
  policies: z.array(convexWorkspacePolicySchema),
  auto_approvals: z.array(convexWorkspaceAutoApprovalSchema),
  matches: z.array(convexCelRuleMatchSchema),
  decisions: z.array(convexPolicyDecisionSchema),
});

export const convexDispatchResponseSchema = z
  .object({
    message_id: nonEmptyStringSchema.optional(),
  })
  .passthrough();

export { PROVIDER_METRIC_EVENT_TYPE, PROVIDER_METRIC_NAMES, PROVIDER_METRIC_OUTCOMES };

export const providerMetricNameSchema = z.enum(PROVIDER_METRIC_NAMES);

export const providerMetricOutcomeSchema = z.enum(PROVIDER_METRIC_OUTCOMES);

export const convexRecordProviderMetricPayloadSchema = z.object({
  orgId: nonEmptyStringSchema,
  metric: providerMetricNameSchema,
  provider: canonicalProviderIdSchema.optional(),
  providerInput: nonEmptyStringSchema.optional(),
  route: nonEmptyStringSchema.optional(),
  outcome: providerMetricOutcomeSchema.optional(),
  reasonCode: nonEmptyStringSchema.optional(),
  value: positiveIntegerSchema.optional(),
});
