import { v } from "convex/values";
import { CANONICAL_PROVIDER_IDS } from "../packages/shared/src/provider-ids.js";
import { NOTIFICATION_EVENTS } from "../packages/shared/src/notifications.js";
import {
  ACTION_RISK_LEVELS,
  ACTION_STATUSES,
  APPROVAL_DECIDER_TYPES,
  CREDENTIAL_TYPES,
  CRON_HEALTH_STATUSES,
  DEAD_LETTER_ERROR_CODES,
  DEAD_LETTER_SOURCES,
  DEAD_LETTER_STATUSES,
  DECISION_OUTCOMES,
  DEFAULT_ACTION_BEHAVIORS,
  INTEGRATION_STATUSES,
  POLICY_DECISION_RESULTS,
  POLICY_MODES,
  PROVIDER_CATALOG_CONFIGURATION_STATUSES,
  RULE_EFFECTS,
  RUN_STATUSES,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_TIERS,
  TOOL_CALL_STATUSES,
  USER_ROLES,
  WORKSPACE_STATUSES,
  CLIENT_TYPES,
  APPROVAL_DECISIONS,
  INVITE_STATUSES,
  INVITE_CODE_REDEMPTION_STATUSES,
  NOTIFICATION_DELIVERY_STATUSES,
  PROVIDER_METRIC_NAMES,
  PROVIDER_METRIC_OUTCOMES,
  AUTOMATION_STATUSES,
  CONFIG_TRIGGER_TYPES,
  RUN_TRIGGER_TYPES,
  RUNNER_TYPES,
  AI_MODEL_PROVIDERS,
  AI_KEY_MODES,
  AUTOMATION_RUN_STATUSES,
  NETWORK_ACCESS_MODES,
  AI_KEY_CREDENTIAL_KINDS,
  CUSTOM_MCP_SERVER_STATUSES,
  API_DEDUPE_SCOPES,
  API_DEDUPE_STATUSES,
  AUTOMATION_RUN_LOG_LEVELS,
  AUTOMATION_RUN_EVENT_TYPES,
  AUTOMATION_TRIGGER_EVENT_STATUSES,
  AUTOMATION_TRIGGER_EVENT_MATCH_STATUSES,
  AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODES,
  AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUSES,
  AUTOMATION_PROVIDER_TRIGGER_MIGRATION_STATUSES,
  AUTOMATION_DISPATCH_ACTION_STATUSES,
  AUTOMATION_TERMINATE_ACTION_STATUSES,
  AI_CREDIT_PURCHASE_STATUSES,
  AUTOMATION_RUN_TOPUP_PURCHASE_STATUSES,
  AUDIT_EVENT_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_ENDPOINT_TYPES,
  AUTOMATION_RUN_ARCHIVED_LOG_ENCODINGS,
  PROVIDER_METRIC_ALERT_SEVERITIES,
  TOOL_CAPABILITIES,
  PROVIDER_DEPRECATION_STATUSES,
  CUSTOM_INTEGRATION_AUTH_METHODS,
  E2E_ACTION_TRIGGER_STATUSES,
  ABUSE_FLAG_SEVERITIES,
  ABUSE_FLAG_STATUSES,
  ABUSE_FLAG_REVIEW_STATUSES,
  INTEGRATION_ERROR_CATEGORIES,
  INTEGRATION_ERROR_CODES,
  AUDIT_ACTOR_TYPES,
} from "./domain_constants";
export {
  dispatchAutomationRunArgsValidator,
  getDispatchAuditContextArgsValidator,
  terminateAutomationRunArgsValidator,
} from "./automation_scheduler_shared";

type LiteralTuple<T extends string> = readonly [T, T, ...T[]];

const requireLiteralTuple = <T extends string>(
  values: readonly T[],
  label: string,
): LiteralTuple<T> => {
  if (values.length < 2) {
    throw new Error(`${label} validator requires at least two values.`);
  }
  return values as LiteralTuple<T>;
};

const createLiteralUnionValidator = <T extends string>(values: readonly T[], label: string) => {
  const tuple = requireLiteralTuple(values, label);
  const literals = tuple.map((value) => v.literal(value));
  return v.union(literals[0]!, literals[1]!, ...literals.slice(2));
};

export const roleValidator = createLiteralUnionValidator(USER_ROLES, "Role");
export const workspaceStatusValidator = createLiteralUnionValidator(
  WORKSPACE_STATUSES,
  "Workspace status",
);
export const policyModeValidator = createLiteralUnionValidator(POLICY_MODES, "Policy mode");
export const defaultActionBehaviorValidator = createLiteralUnionValidator(
  DEFAULT_ACTION_BEHAVIORS,
  "Default action behavior",
);
export const credentialTypeValidator = createLiteralUnionValidator(
  CREDENTIAL_TYPES,
  "Credential type",
);
export const providerValidator = createLiteralUnionValidator(CANONICAL_PROVIDER_IDS, "Provider");
export const integrationStatusValidator = createLiteralUnionValidator(
  INTEGRATION_STATUSES,
  "Integration status",
);
export const integrationErrorCodeValidator = createLiteralUnionValidator(
  INTEGRATION_ERROR_CODES,
  "Integration error code",
);
export const integrationErrorCategoryValidator = createLiteralUnionValidator(
  INTEGRATION_ERROR_CATEGORIES,
  "Integration error category",
);
export const clientTypeValidator = createLiteralUnionValidator(CLIENT_TYPES, "Client type");
export const runStatusValidator = createLiteralUnionValidator(RUN_STATUSES, "Run status");
export const automationStatusValidator = createLiteralUnionValidator(
  AUTOMATION_STATUSES,
  "Automation status",
);
export const configTriggerTypeValidator = createLiteralUnionValidator(
  CONFIG_TRIGGER_TYPES,
  "Config trigger type",
);
export const runTriggerTypeValidator = createLiteralUnionValidator(
  RUN_TRIGGER_TYPES,
  "Run trigger type",
);
export const runnerTypeValidator = createLiteralUnionValidator(RUNNER_TYPES, "Runner type");
export const aiModelProviderValidator = createLiteralUnionValidator(
  AI_MODEL_PROVIDERS,
  "AI model provider",
);
export const aiKeyModeValidator = createLiteralUnionValidator(AI_KEY_MODES, "AI key mode");
export const aiKeyCredentialKindValidator = createLiteralUnionValidator(
  AI_KEY_CREDENTIAL_KINDS,
  "AI key credential kind",
);
export const automationRunStatusValidator = createLiteralUnionValidator(
  AUTOMATION_RUN_STATUSES,
  "Automation run status",
);
export const cronHealthStatusValidator = createLiteralUnionValidator(
  CRON_HEALTH_STATUSES,
  "Cron health status",
);
export const deadLetterErrorCodeValidator = createLiteralUnionValidator(
  DEAD_LETTER_ERROR_CODES,
  "Dead-letter error code",
);
export const networkAccessValidator = createLiteralUnionValidator(
  NETWORK_ACCESS_MODES,
  "Network access mode",
);
export const toolCallStatusValidator = createLiteralUnionValidator(
  TOOL_CALL_STATUSES,
  "Tool call status",
);
export const subscriptionTierValidator = createLiteralUnionValidator(
  SUBSCRIPTION_TIERS,
  "Subscription tier",
);
export const subscriptionStatusValidator = createLiteralUnionValidator(
  SUBSCRIPTION_STATUSES,
  "Subscription status",
);
export const ruleEffectValidator = createLiteralUnionValidator(RULE_EFFECTS, "Rule effect");
export const actionRiskValidator = createLiteralUnionValidator(
  ACTION_RISK_LEVELS,
  "Action risk level",
);
export const toolCapabilityValidator = createLiteralUnionValidator(
  TOOL_CAPABILITIES,
  "Tool capability",
);
export const providerDeprecationStatusValidator = createLiteralUnionValidator(
  PROVIDER_DEPRECATION_STATUSES,
  "Provider deprecation status",
);
export const providerCatalogConfigurationStatusValidator = createLiteralUnionValidator(
  PROVIDER_CATALOG_CONFIGURATION_STATUSES,
  "Provider catalog configuration status",
);
export const customIntegrationAuthMethodValidator = createLiteralUnionValidator(
  CUSTOM_INTEGRATION_AUTH_METHODS,
  "Custom integration auth method",
);
export const e2eActionTriggerStatusValidator = createLiteralUnionValidator(
  E2E_ACTION_TRIGGER_STATUSES,
  "E2E action trigger status",
);
export const actionStatusValidator = createLiteralUnionValidator(ACTION_STATUSES, "Action status");
export const approvalDeciderValidator = createLiteralUnionValidator(
  APPROVAL_DECIDER_TYPES,
  "Approval decider",
);
export const approvalDecisionValidator = createLiteralUnionValidator(
  APPROVAL_DECISIONS,
  "Approval decision",
);
export const decisionOutcomeValidator = createLiteralUnionValidator(
  DECISION_OUTCOMES,
  "Decision outcome",
);
export const policyDecisionValidator = createLiteralUnionValidator(
  POLICY_DECISION_RESULTS,
  "Policy decision result",
);
export const inviteStatusValidator = createLiteralUnionValidator(INVITE_STATUSES, "Invite status");
export const inviteCodeRedemptionStatusValidator = createLiteralUnionValidator(
  INVITE_CODE_REDEMPTION_STATUSES,
  "Invite code redemption status",
);
export const notificationDeliveryStatusValidator = createLiteralUnionValidator(
  NOTIFICATION_DELIVERY_STATUSES,
  "Notification delivery status",
);
export const notificationChannelValidator = createLiteralUnionValidator(
  NOTIFICATION_CHANNELS,
  "Notification channel",
);
export const notificationEndpointTypeValidator = createLiteralUnionValidator(
  NOTIFICATION_ENDPOINT_TYPES,
  "Notification endpoint type",
);
export const notificationEventTypeValidator = createLiteralUnionValidator(
  Object.keys(NOTIFICATION_EVENTS) as Array<keyof typeof NOTIFICATION_EVENTS>,
  "Notification event type",
);
export const customMcpServerStatusValidator = createLiteralUnionValidator(
  CUSTOM_MCP_SERVER_STATUSES,
  "Custom MCP server status",
);
export const apiDedupeScopeValidator = createLiteralUnionValidator(
  API_DEDUPE_SCOPES,
  "API dedupe scope",
);
export const apiDedupeStatusValidator = createLiteralUnionValidator(
  API_DEDUPE_STATUSES,
  "API dedupe status",
);
export const deadLetterStatusValidator = createLiteralUnionValidator(
  DEAD_LETTER_STATUSES,
  "Dead-letter status",
);
export const deadLetterSourceTableValidator = createLiteralUnionValidator(
  DEAD_LETTER_SOURCES,
  "Dead-letter source table",
);
export const automationRunLogLevelValidator = createLiteralUnionValidator(
  AUTOMATION_RUN_LOG_LEVELS,
  "Automation run log level",
);
export const automationTriggerEventStatusValidator = createLiteralUnionValidator(
  AUTOMATION_TRIGGER_EVENT_STATUSES,
  "Automation trigger event status",
);
export const automationTriggerEventMatchStatusValidator = createLiteralUnionValidator(
  AUTOMATION_TRIGGER_EVENT_MATCH_STATUSES,
  "Automation trigger event match status",
);
export const automationDispatchActionStatusValidator = createLiteralUnionValidator(
  AUTOMATION_DISPATCH_ACTION_STATUSES,
  "Automation dispatch action status",
);
export const automationTerminateActionStatusValidator = createLiteralUnionValidator(
  AUTOMATION_TERMINATE_ACTION_STATUSES,
  "Automation terminate action status",
);
export const aiCreditPurchaseStatusValidator = createLiteralUnionValidator(
  AI_CREDIT_PURCHASE_STATUSES,
  "AI credit purchase status",
);
export const automationRunTopupPurchaseStatusValidator = createLiteralUnionValidator(
  AUTOMATION_RUN_TOPUP_PURCHASE_STATUSES,
  "Automation run top-up purchase status",
);
export const providerMetricNameValidator = createLiteralUnionValidator(
  PROVIDER_METRIC_NAMES,
  "Provider metric name",
);
export const providerMetricOutcomeValidator = createLiteralUnionValidator(
  PROVIDER_METRIC_OUTCOMES,
  "Provider metric outcome",
);
export const providerMetricAlertSeverityValidator = createLiteralUnionValidator(
  PROVIDER_METRIC_ALERT_SEVERITIES,
  "Provider metric alert severity",
);
export const abuseFlagSeverityValidator = createLiteralUnionValidator(
  ABUSE_FLAG_SEVERITIES,
  "Abuse flag severity",
);
export const abuseFlagStatusValidator = createLiteralUnionValidator(
  ABUSE_FLAG_STATUSES,
  "Abuse flag status",
);
export const abuseFlagReviewStatusValidator = createLiteralUnionValidator(
  ABUSE_FLAG_REVIEW_STATUSES,
  "Abuse flag review status",
);
export const automationRunArchivedLogEncodingValidator = createLiteralUnionValidator(
  AUTOMATION_RUN_ARCHIVED_LOG_ENCODINGS,
  "Automation run archived log encoding",
);
export const automationRunEventTypeValidator = createLiteralUnionValidator(
  AUTOMATION_RUN_EVENT_TYPES,
  "Automation run event type",
);
export const auditEventTypeValidator = createLiteralUnionValidator(
  Object.values(AUDIT_EVENT_TYPES),
  "Audit event type",
);
export const auditActorTypeValidator = createLiteralUnionValidator(
  AUDIT_ACTOR_TYPES,
  "Audit actor type",
);

export const jsonRecordValidator = v.record(v.string(), v.any());

export const automationProviderTriggerDeliveryModeValidator = createLiteralUnionValidator(
  AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODES,
  "Automation provider trigger delivery mode",
);
export const automationProviderTriggerSubscriptionStatusValidator = createLiteralUnionValidator(
  AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUSES,
  "Automation provider trigger subscription status",
);
export const automationProviderTriggerMigrationStatusValidator = createLiteralUnionValidator(
  AUTOMATION_PROVIDER_TRIGGER_MIGRATION_STATUSES,
  "Automation provider trigger migration status",
);
export const automationProviderTriggerValidator = v.object({
  provider_id: v.string(),
  trigger_key: v.string(),
  schema_version: v.number(),
  filter: jsonRecordValidator,
  delivery: v.object({
    preferred_mode: automationProviderTriggerDeliveryModeValidator,
    supported_modes: v.array(automationProviderTriggerDeliveryModeValidator),
    fallback_mode: v.union(automationProviderTriggerDeliveryModeValidator, v.null()),
  }),
  subscription_state: v.object({
    status: automationProviderTriggerSubscriptionStatusValidator,
    active_mode: v.union(automationProviderTriggerDeliveryModeValidator, v.null()),
    last_error: v.union(v.string(), v.null()),
    updated_at: v.union(v.string(), v.null()),
  }),
});
export const automationProviderTriggerMigrationStateValidator = v.object({
  status: automationProviderTriggerMigrationStatusValidator,
  message: v.string(),
  legacy_event_provider: v.union(v.string(), v.null()),
  legacy_event_type: v.union(v.string(), v.null()),
  legacy_event_predicate: v.union(v.string(), v.null()),
});

const assertSafeIntegerLimit = (value: number, fallback: number): number => {
  const normalized = Number.isFinite(value) ? Math.floor(value) : fallback;
  return normalized >= 0 ? normalized : fallback;
};

type BoundedStringParams = {
  field: string;
  value: string;
  maxLength: number;
  minLength?: number;
  trim?: boolean;
  allowEmpty?: boolean;
};

const coerceBoundedStringParams = (
  valueOrParams: string | BoundedStringParams,
  params?: Omit<BoundedStringParams, "value">,
): BoundedStringParams => {
  if (typeof valueOrParams === "string") {
    if (!params) {
      throw new Error("Missing bounded string params.");
    }
    return {
      ...params,
      value: valueOrParams,
    };
  }
  return valueOrParams;
};

export const requireBoundedString = (
  valueOrParams: string | BoundedStringParams,
  params?: Omit<BoundedStringParams, "value">,
): string => {
  const resolved = coerceBoundedStringParams(valueOrParams, params);
  const trim = resolved.trim ?? true;
  const normalized = trim ? resolved.value.trim() : resolved.value;
  const minLength = assertSafeIntegerLimit(
    resolved.minLength ?? (resolved.allowEmpty ? 0 : 1),
    resolved.allowEmpty ? 0 : 1,
  );
  const maxLength = Math.max(minLength, assertSafeIntegerLimit(resolved.maxLength, 1));

  if (normalized.length < minLength) {
    throw new Error(`${resolved.field} is required.`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${resolved.field} must be ${maxLength} characters or fewer.`);
  }
  return normalized;
};

export const requireOptionalBoundedString = (params: {
  field: string;
  value: string | undefined;
  maxLength: number;
  minLength?: number;
  trim?: boolean;
  allowEmpty?: boolean;
}): string | undefined => {
  if (params.value === undefined) {
    return undefined;
  }
  return requireBoundedString(params.value, {
    field: params.field,
    maxLength: params.maxLength,
    ...(params.minLength !== undefined ? { minLength: params.minLength } : {}),
    ...(params.trim !== undefined ? { trim: params.trim } : {}),
    ...(params.allowEmpty !== undefined ? { allowEmpty: params.allowEmpty } : {}),
  });
};

export const requireBoundedEmail = (
  value: string,
  params?: { field?: string; maxLength?: number },
): string => {
  const normalized = requireBoundedString(value, {
    field: params?.field ?? "email",
    maxLength: params?.maxLength ?? 320,
  }).toLowerCase();
  if (!normalized.includes("@") || normalized.startsWith("@") || normalized.endsWith("@")) {
    throw new Error("Please enter a valid email address.");
  }
  return normalized;
};

const sanitizePolicyContextValue = (
  value: unknown,
  state: {
    nodesRemaining: number;
    maxDepth: number;
    maxObjectEntries: number;
    maxArrayLength: number;
    maxStringLength: number;
  },
  field: string,
  depth: number,
): unknown => {
  if (state.nodesRemaining <= 0) {
    throw new Error(`${field} is too large to evaluate safely.`);
  }
  state.nodesRemaining -= 1;

  if (value === null || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`${field} contains a non-finite number.`);
    }
    return value;
  }
  if (typeof value === "string") {
    if (value.length > state.maxStringLength) {
      throw new Error(`${field} contains a string that exceeds ${state.maxStringLength} chars.`);
    }
    return value;
  }
  if (depth >= state.maxDepth) {
    throw new Error(`${field} exceeds the supported nesting depth.`);
  }
  if (Array.isArray(value)) {
    if (value.length > state.maxArrayLength) {
      throw new Error(`${field} exceeds the supported array length.`);
    }
    return value.map((entry) => sanitizePolicyContextValue(entry, state, field, depth + 1));
  }
  if (!value || typeof value !== "object") {
    throw new Error(`${field} contains an unsupported value.`);
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > state.maxObjectEntries) {
    throw new Error(`${field} exceeds the supported object size.`);
  }

  return Object.fromEntries(
    entries.map(([key, entry]) => {
      const normalizedKey = requireBoundedString({
        field: `${field} key`,
        value: key,
        maxLength: 64,
        minLength: 1,
        trim: false,
      });
      return [normalizedKey, sanitizePolicyContextValue(entry, state, field, depth + 1)];
    }),
  );
};

export const sanitizePolicyContext = (
  value: Record<string, unknown>,
  field = "context",
): Record<string, unknown> => {
  return sanitizePolicyContextValue(
    value,
    {
      nodesRemaining: 200,
      maxDepth: 4,
      maxObjectEntries: 32,
      maxArrayLength: 25,
      maxStringLength: 500,
    },
    field,
    0,
  ) as Record<string, unknown>;
};
