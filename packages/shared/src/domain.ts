export const USER_ROLES = ["owner", "admin", "approver", "viewer"] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const USER_ROLE = {
  owner: "owner",
  admin: "admin",
  approver: "approver",
  viewer: "viewer",
} as const satisfies Record<string, UserRole>;

export const WORKSPACE_STATUSES = ["active", "disabled"] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];
export const WORKSPACE_STATUS = {
  active: "active",
  disabled: "disabled",
} as const satisfies Record<string, WorkspaceStatus>;

export const INTEGRATION_STATUSES = ["connected", "degraded", "disconnected"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];
export const INTEGRATION_STATUS = {
  connected: "connected",
  degraded: "degraded",
  disconnected: "disconnected",
} as const satisfies Record<string, IntegrationStatus>;

export const CUSTOM_MCP_SERVER_STATUSES = ["connected", "disconnected", "error"] as const;
export type CustomMcpServerStatus = (typeof CUSTOM_MCP_SERVER_STATUSES)[number];
export const CUSTOM_MCP_SERVER_STATUS = {
  connected: "connected",
  disconnected: "disconnected",
  error: "error",
} as const satisfies Record<string, CustomMcpServerStatus>;

export const CREDENTIAL_TYPES = ["bearer_token", "oauth_client", "mtls"] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];
export const CREDENTIAL_TYPE = {
  bearerToken: "bearer_token",
  oauthClient: "oauth_client",
  mtls: "mtls",
} as const satisfies Record<string, CredentialType>;

export const POLICY_MODES = ["manual_only", "rules_first", "rules_plus_agent"] as const;
export type PolicyMode = (typeof POLICY_MODES)[number];
export const POLICY_MODE = {
  manualOnly: "manual_only",
  rulesFirst: "rules_first",
  rulesPlusAgent: "rules_plus_agent",
} as const satisfies Record<string, PolicyMode>;

export const DEFAULT_ACTION_BEHAVIORS = [
  "require_approval",
  "allow_if_rule_matches",
  "auto_approve_all",
] as const;
export type DefaultActionBehavior = (typeof DEFAULT_ACTION_BEHAVIORS)[number];
export const DEFAULT_ACTION_BEHAVIOR = {
  requireApproval: "require_approval",
  allowIfRuleMatches: "allow_if_rule_matches",
  autoApproveAll: "auto_approve_all",
} as const satisfies Record<string, DefaultActionBehavior>;

export const CLIENT_TYPES = [
  "claude_desktop",
  "claude_code",
  "cursor",
  "chatgpt",
  "other",
] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];
export const CLIENT_TYPE = {
  claudeDesktop: "claude_desktop",
  claudeCode: "claude_code",
  cursor: "cursor",
  chatgpt: "chatgpt",
  other: "other",
} as const satisfies Record<string, ClientType>;

export const RUN_STATUSES = ["active", "ended", "timed_out"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
export const RUN_STATUS = {
  active: "active",
  ended: "ended",
  timedOut: "timed_out",
} as const satisfies Record<string, RunStatus>;

export const TOOL_CALL_STATUSES = ["received", "completed", "failed", "approval_required"] as const;
export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];
export const TOOL_CALL_STATUS = {
  received: "received",
  completed: "completed",
  failed: "failed",
  approvalRequired: "approval_required",
} as const satisfies Record<string, ToolCallStatus>;

export const TOOL_CALL_RESULT_STATUSES = ["idempotent_replay"] as const;
export type ToolCallResultStatus = (typeof TOOL_CALL_RESULT_STATUSES)[number];
export const TOOL_CALL_RESULT_STATUS = {
  idempotentReplay: "idempotent_replay",
} as const satisfies Record<string, ToolCallResultStatus>;

export const ACTION_POLL_STATUSES = ["still_pending", "rate_limited"] as const;
export type ActionPollStatus = (typeof ACTION_POLL_STATUSES)[number];
export const ACTION_POLL_STATUS = {
  stillPending: "still_pending",
  rateLimited: "rate_limited",
} as const satisfies Record<string, ActionPollStatus>;

export const CRON_HEALTH_STATUSES = ["HEALTHY", "STALE", "FAILING"] as const;
export type CronHealthStatus = (typeof CRON_HEALTH_STATUSES)[number];
export const CRON_HEALTH_STATUS = {
  healthy: "HEALTHY",
  stale: "STALE",
  failing: "FAILING",
} as const satisfies Record<string, CronHealthStatus>;

export const ACTION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "executing",
  "succeeded",
  "failed",
  "expired",
] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export const ACTION_STATUS = {
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
  executing: "executing",
  succeeded: "succeeded",
  failed: "failed",
  expired: "expired",
} as const satisfies Record<string, ActionStatus>;

export const ACTION_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
export type ActionRiskLevel = (typeof ACTION_RISK_LEVELS)[number];
export const ACTION_RISK_LEVEL = {
  low: "low",
  medium: "medium",
  high: "high",
  critical: "critical",
} as const satisfies Record<string, ActionRiskLevel>;

export const OUTPUT_SENSITIVITIES = ["low", "high"] as const;
export type OutputSensitivity = (typeof OUTPUT_SENSITIVITIES)[number];
export const OUTPUT_SENSITIVITY = {
  low: "low",
  high: "high",
} as const satisfies Record<string, OutputSensitivity>;

export const TOOL_CAPABILITIES = ["read", "write"] as const;
export type ToolCapability = (typeof TOOL_CAPABILITIES)[number];
export const TOOL_CAPABILITY = {
  read: "read",
  write: "write",
} as const satisfies Record<string, ToolCapability>;

export const APPROVAL_DECIDER_TYPES = [
  "human",
  "tool_auto_approve",
  "cel_rule",
  "policy_agent",
  "default_auto_approve",
] as const;
export type ApprovalDeciderType = (typeof APPROVAL_DECIDER_TYPES)[number];
export const APPROVAL_DECIDER_TYPE = {
  human: "human",
  toolAutoApprove: "tool_auto_approve",
  celRule: "cel_rule",
  policyAgent: "policy_agent",
  defaultAutoApprove: "default_auto_approve",
} as const satisfies Record<string, ApprovalDeciderType>;

export const APPROVAL_DECISIONS = ["approve", "reject", "abstain"] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];
export const APPROVAL_DECISION = {
  approve: "approve",
  reject: "reject",
  abstain: "abstain",
} as const satisfies Record<string, ApprovalDecision>;

export const DECISION_OUTCOMES = ["approve", "deny", "pending"] as const;
export type DecisionOutcome = (typeof DECISION_OUTCOMES)[number];
export const DECISION_OUTCOME = {
  approve: "approve",
  deny: "deny",
  pending: "pending",
} as const satisfies Record<string, DecisionOutcome>;

export const RULE_EFFECTS = ["approve", "deny"] as const;
export type RuleEffect = (typeof RULE_EFFECTS)[number];
export const RULE_EFFECT = {
  approve: "approve",
  deny: "deny",
} as const satisfies Record<string, RuleEffect>;

export const POLICY_DECISION_RESULTS = ["approve", "deny", "escalate"] as const;
export type PolicyDecisionResult = (typeof POLICY_DECISION_RESULTS)[number];
export const POLICY_DECISION_RESULT = {
  approve: "approve",
  deny: "deny",
  escalate: "escalate",
} as const satisfies Record<string, PolicyDecisionResult>;

export const PROVIDER_METRIC_EVENT_TYPE = "provider.metric";
export const PROVIDER_METRIC_NAMES = [
  "provider_resolution_failure",
  "unknown_provider_request",
  "non_canonical_provider_rejection",
  "capability_mismatch_block",
  "tool_call_failure",
  "oauth_connect",
  "oauth_callback",
  "webhook_verify",
] as const;
type ProviderMetricName = (typeof PROVIDER_METRIC_NAMES)[number];
export const PROVIDER_METRIC_NAME = {
  providerResolutionFailure: "provider_resolution_failure",
  unknownProviderRequest: "unknown_provider_request",
  nonCanonicalProviderRejection: "non_canonical_provider_rejection",
  capabilityMismatchBlock: "capability_mismatch_block",
  toolCallFailure: "tool_call_failure",
  oauthConnect: "oauth_connect",
  oauthCallback: "oauth_callback",
  webhookVerify: "webhook_verify",
} as const satisfies Record<string, ProviderMetricName>;

export const PROVIDER_METRIC_OUTCOMES = [
  "attempt",
  "success",
  "failure",
  "rejected",
  "blocked",
] as const;
type ProviderMetricOutcome = (typeof PROVIDER_METRIC_OUTCOMES)[number];
export const PROVIDER_METRIC_OUTCOME = {
  attempt: "attempt",
  success: "success",
  failure: "failure",
  rejected: "rejected",
  blocked: "blocked",
} as const satisfies Record<string, ProviderMetricOutcome>;

export const PROVIDER_DEPRECATION_STATUSES = ["deprecated", "sunset"] as const;
export type ProviderDeprecationStatus = (typeof PROVIDER_DEPRECATION_STATUSES)[number];
export const PROVIDER_DEPRECATION_STATUS = {
  deprecated: "deprecated",
  sunset: "sunset",
} as const satisfies Record<string, ProviderDeprecationStatus>;

export const PROVIDER_CATALOG_CONFIGURATION_STATUSES = ["configured", "misconfigured"] as const;
export type ProviderCatalogConfigurationStatus =
  (typeof PROVIDER_CATALOG_CONFIGURATION_STATUSES)[number];
export const PROVIDER_CATALOG_CONFIGURATION_STATUS = {
  configured: "configured",
  misconfigured: "misconfigured",
} as const satisfies Record<string, ProviderCatalogConfigurationStatus>;

export const E2E_ACTION_TRIGGER_STATUSES = ["approval_required", "succeeded", "rejected"] as const;
export type E2eActionTriggerStatus = (typeof E2E_ACTION_TRIGGER_STATUSES)[number];
export const E2E_ACTION_TRIGGER_STATUS = {
  approvalRequired: "approval_required",
  succeeded: "succeeded",
  rejected: "rejected",
} as const satisfies Record<string, E2eActionTriggerStatus>;

export const CUSTOM_INTEGRATION_AUTH_METHODS = ["bearer_token", "oauth", "mtls"] as const;
export type CustomIntegrationAuthMethod = (typeof CUSTOM_INTEGRATION_AUTH_METHODS)[number];
export const CUSTOM_INTEGRATION_AUTH_METHOD = {
  bearerToken: "bearer_token",
  oauth: "oauth",
  mtls: "mtls",
} as const satisfies Record<string, CustomIntegrationAuthMethod>;

export const NOTIFICATION_CHANNELS = ["email", "push", "in_app"] as const;
export type NotificationChannelValue = (typeof NOTIFICATION_CHANNELS)[number];
export const NOTIFICATION_CHANNEL = {
  email: "email",
  push: "push",
  inApp: "in_app",
} as const satisfies Record<string, NotificationChannelValue>;

export const NOTIFICATION_ENDPOINT_TYPES = ["email", "push", "webhook"] as const;
export type NotificationEndpointTypeValue = (typeof NOTIFICATION_ENDPOINT_TYPES)[number];
export const NOTIFICATION_ENDPOINT_TYPE = {
  email: "email",
  push: "push",
  webhook: "webhook",
} as const satisfies Record<string, NotificationEndpointTypeValue>;

export const AUTOMATION_RUN_ARCHIVED_LOG_ENCODINGS = ["gzip", "identity"] as const;
export type AutomationRunArchivedLogEncoding =
  (typeof AUTOMATION_RUN_ARCHIVED_LOG_ENCODINGS)[number];
export const AUTOMATION_RUN_ARCHIVED_LOG_ENCODING = {
  gzip: "gzip",
  identity: "identity",
} as const satisfies Record<string, AutomationRunArchivedLogEncoding>;

export const PROVIDER_METRIC_ALERT_SEVERITIES = ["warning", "critical"] as const;
export type ProviderMetricAlertSeverity = (typeof PROVIDER_METRIC_ALERT_SEVERITIES)[number];
export const PROVIDER_METRIC_ALERT_SEVERITY = {
  warning: "warning",
  critical: "critical",
} as const satisfies Record<string, ProviderMetricAlertSeverity>;

export const ABUSE_FLAG_STATUSES = ["open", "reviewed", "dismissed", "confirmed"] as const;
export type AbuseFlagStatus = (typeof ABUSE_FLAG_STATUSES)[number];
export const ABUSE_FLAG_STATUS = {
  open: "open",
  reviewed: "reviewed",
  dismissed: "dismissed",
  confirmed: "confirmed",
} as const satisfies Record<string, AbuseFlagStatus>;

export const ABUSE_FLAG_SEVERITIES = ["low", "medium", "high"] as const;
export type AbuseFlagSeverity = (typeof ABUSE_FLAG_SEVERITIES)[number];
export const ABUSE_FLAG_SEVERITY = {
  low: "low",
  medium: "medium",
  high: "high",
} as const satisfies Record<string, AbuseFlagSeverity>;

export const ABUSE_FLAG_REVIEW_STATUSES = ["reviewed", "dismissed", "confirmed"] as const;
export type AbuseFlagReviewStatus = (typeof ABUSE_FLAG_REVIEW_STATUSES)[number];
export const ABUSE_FLAG_REVIEW_STATUS = {
  reviewed: "reviewed",
  dismissed: "dismissed",
  confirmed: "confirmed",
} as const satisfies Record<string, AbuseFlagReviewStatus>;

export const AUDIT_ACTOR_TYPES = ["user", "system", "automation", "worker"] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];
export const AUDIT_ACTOR_TYPE = {
  user: "user",
  system: "system",
  automation: "automation",
  worker: "worker",
} as const satisfies Record<string, AuditActorType>;

export const AUDIT_EVENT_TYPES = {
  actionApproved: "action.approved",
  actionCreated: "action.created",
  actionExecuted: "action.executed",
  actionExecutionCompleted: "action.execution_completed",
  actionExecutionFailed: "action.execution_failed",
  actionExecutionStarted: "action.execution_started",
  actionExpired: "action.expired",
  actionRejected: "action.rejected",
  automationConfigRolledBack: "automation.config_rolled_back",
  automationConfigUpdated: "automation.config_updated",
  automationCreated: "automation.created",
  automationDeleted: "automation.deleted",
  automationMetaUpdated: "automation.meta_updated",
  automationStatusUpdated: "automation.status_updated",
  adminDogfoodOrgRemoved: "admin.dogfood_org_removed",
  adminDogfoodOrgUpserted: "admin.dogfood_org_upserted",
  adminFeatureFlagsSeeded: "admin.feature_flags_seeded",
  adminFeatureFlagUpdated: "admin.feature_flag_updated",
  adminOrgHardDeleted: "admin.org_hard_deleted",
  adminUserHardDeleted: "admin.user_hard_deleted",
  aiCreditAllowanceReset: "ai_credit.allowance_reset",
  aiCreditDeducted: "ai_credit.deducted",
  aiCreditExpired: "ai_credit.expired",
  aiCreditPurchased: "ai_credit.purchased",
  automationRunTopupDeducted: "automation_run_topup.deducted",
  automationRunTopupExpired: "automation_run_topup.expired",
  automationRunTopupPurchased: "automation_run_topup.purchased",
  approvalRecorded: "approval.recorded",
  authSignupBlocked: "auth.signup_blocked",
  billingAutomationRunTopupCheckoutCompleted: "billing.automation_run_topup_checkout_completed",
  billingCheckoutCompleted: "billing.checkout_completed",
  billingCreditCheckoutCompleted: "billing.credit_checkout_completed",
  billingInvoicePaid: "billing.invoice_paid",
  billingInvoicePaymentFailed: "billing.invoice_payment_failed",
  billingInvitePromoConverted: "billing.invite_promo_converted",
  billingInvitePromoExpired: "billing.invite_promo_expired",
  billingInvitePromoRedeemed: "billing.invite_promo_redeemed",
  inviteCodeRedeemed: "invite_code.redeemed",
  billingSubscriptionDeleted: "billing.subscription_deleted",
  billingSubscriptionUpdated: "billing.subscription_updated",
  billingSubscriptionScheduleUpdated: "billing.subscription_schedule_updated",
  canaryFailed: "canary.failed",
  customMcpBulkToolConfigured: "custom_mcp.bulk_tool_configured",
  customMcpDiscoveryFailed: "custom_mcp.discovery_failed",
  customMcpDiscoverySucceeded: "custom_mcp.discovery_succeeded",
  customMcpServerDeleted: "custom_mcp.server_deleted",
  customMcpServerRegistered: "custom_mcp.server_registered",
  customMcpServerUpdated: "custom_mcp.server_updated",
  customMcpToolConfigured: "custom_mcp.tool_configured",
  customMcpWorkspaceServerToggled: "custom_mcp.workspace_server_toggled",
  integrationConnected: "integration.connected",
  integrationCredentialRefreshFailed: "integration.credential_refresh_failed",
  integrationCredentialRefreshSucceeded: "integration.credential_refresh_succeeded",
  integrationCustomRegistered: "integration.custom_registered",
  integrationDisconnected: "integration.disconnected",
  integrationHealthUpdated: "integration.health_updated",
  integrationMetadataUpdated: "integration.metadata_updated",
  integrationWebhookReceived: "integration.webhook_received",
  orgInviteAccepted: "org.invite_accepted",
  orgInviteCreated: "org.invite_created",
  orgInviteRevoked: "org.invite_revoked",
  orgAiKeyCreated: "org_ai_key.created",
  orgAiKeyDeleted: "org_ai_key.deleted",
  orgAiKeyUpdated: "org_ai_key.updated",
  orgMemberLeft: "org.member_left",
  orgMemberRemoved: "org.member_removed",
  orgMemberRoleUpdated: "org.member_role_updated",
  orgSuspended: "org.suspended",
  orgUnsuspended: "org.unsuspended",
  policyCreated: "policy.created",
  policyUpdated: "policy.updated",
  providerMetric: "provider.metric",
  queueDispatchScheduleFailed: "queue.dispatch.schedule_failed",
  ruleCreated: "rule.created",
  ruleDeleted: "rule.deleted",
  ruleUpdated: "rule.updated",
  secretsUnwrapAttempt: "secrets.unwrap_attempt",
  securityAbuseFlagged: "security.abuse_flagged",
  securityAbuseFlagReviewed: "security.abuse_flag_reviewed",
  securityCredentialAuthFailed: "security.credential_auth_failed",
  securityCredentialLocked: "security.credential_locked",
  securityCredentialLockoutCleared: "security.credential_lockout_cleared",
  securityCredentialRotationRecommended: "security.credential_rotation_recommended",
  securityCredentialSharingSuspect: "security.credential_sharing_suspect",
  securityRateLimited: "security.rate_limited",
  securitySignupVelocityWarning: "security.signup_velocity_warning",
  toolCallCompleted: "tool_call.completed",
  toolCallReceived: "tool_call.received",
  workspaceCodeModeUpdated: "workspace.code_mode_updated",
  workspaceCredentialRotated: "workspace.credential_rotated",
  workspaceCreated: "workspace.created",
  workspaceDeleted: "workspace.deleted",
  workspaceIntegrationsUpdated: "workspace.integrations_updated",
  workspacePolicyModeUpdated: "workspace.policy_mode_updated",
} as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES];

export const AUDIT_ERROR_EVENT_TYPES = Object.values(AUDIT_EVENT_TYPES).filter(
  (eventType): eventType is AuditEventType =>
    eventType.endsWith("_failed") || eventType.endsWith(".failed"),
);
export const AUDIT_ERROR_EVENT_TYPE_SET = new Set<AuditEventType>(AUDIT_ERROR_EVENT_TYPES);

export const SECURITY_AUDIT_EVENT_TYPES = new Set<AuditEventType>([
  AUDIT_EVENT_TYPES.authSignupBlocked,
  AUDIT_EVENT_TYPES.orgSuspended,
  AUDIT_EVENT_TYPES.orgUnsuspended,
  AUDIT_EVENT_TYPES.securityAbuseFlagged,
  AUDIT_EVENT_TYPES.securityAbuseFlagReviewed,
  AUDIT_EVENT_TYPES.securityCredentialAuthFailed,
  AUDIT_EVENT_TYPES.securityCredentialLocked,
  AUDIT_EVENT_TYPES.securityCredentialLockoutCleared,
  AUDIT_EVENT_TYPES.securityCredentialRotationRecommended,
  AUDIT_EVENT_TYPES.securityCredentialSharingSuspect,
  AUDIT_EVENT_TYPES.securityRateLimited,
  AUDIT_EVENT_TYPES.securitySignupVelocityWarning,
]);

export const QUEUE_ROUTE_STATUSES = [
  "unauthorized",
  "invalid_queue_payload",
  "duplicate",
  "execution_error",
  "invalid_queue_dispatch_payload",
  "enqueued",
  "enqueue_failed",
] as const;
export type QueueRouteStatus = (typeof QUEUE_ROUTE_STATUSES)[number];
export const QUEUE_ROUTE_STATUS = {
  unauthorized: "unauthorized",
  invalidQueuePayload: "invalid_queue_payload",
  duplicate: "duplicate",
  executionError: "execution_error",
  invalidQueueDispatchPayload: "invalid_queue_dispatch_payload",
  enqueued: "enqueued",
  enqueueFailed: "enqueue_failed",
} as const satisfies Record<string, QueueRouteStatus>;

export const QUEUE_ROUTE_PATH_SOURCES = ["queue", "approval_transition"] as const;
export type QueueRoutePathSource = (typeof QUEUE_ROUTE_PATH_SOURCES)[number];
export const QUEUE_ROUTE_PATH_SOURCE = {
  queue: "queue",
  approvalTransition: "approval_transition",
} as const satisfies Record<string, QueueRoutePathSource>;

export const QUEUE_ENQUEUE_ERROR_CODES = [
  "local_queue_enqueue_failed",
  "direct_queue_enqueue_failed",
  "vercel_queue_send_unavailable",
] as const;
export type QueueEnqueueErrorCode = (typeof QUEUE_ENQUEUE_ERROR_CODES)[number];
export const QUEUE_ENQUEUE_ERROR_CODE = {
  localQueueEnqueueFailed: "local_queue_enqueue_failed",
  directQueueEnqueueFailed: "direct_queue_enqueue_failed",
  vercelQueueSendUnavailable: "vercel_queue_send_unavailable",
} as const satisfies Record<string, QueueEnqueueErrorCode>;

const QUEUE_ENQUEUE_ERROR_CODE_SET = new Set<string>(QUEUE_ENQUEUE_ERROR_CODES);

export const isQueueEnqueueErrorCode = (value: unknown): value is QueueEnqueueErrorCode => {
  return typeof value === "string" && QUEUE_ENQUEUE_ERROR_CODE_SET.has(value);
};

export const formatQueueEnqueueErrorMessage = (
  code: QueueEnqueueErrorCode,
  message: string,
): string => {
  return `${code}: ${message}`;
};

export const parseQueueEnqueueErrorCode = (
  errorMessage: string | undefined,
): QueueEnqueueErrorCode | null => {
  if (!errorMessage) {
    return null;
  }
  const trimmed = errorMessage.trim();
  if (!trimmed) {
    return null;
  }
  if (isQueueEnqueueErrorCode(trimmed)) {
    return trimmed;
  }
  const match = /^([a-z0-9_]+):\s/u.exec(trimmed);
  if (!match) {
    return null;
  }
  const parsed = match[1]?.trim();
  if (!parsed) {
    return null;
  }
  return isQueueEnqueueErrorCode(parsed) ? parsed : null;
};

export const DEAD_LETTER_STATUSES = ["pending", "retrying", "replayed", "abandoned"] as const;
export type DeadLetterStatus = (typeof DEAD_LETTER_STATUSES)[number];
export const DEAD_LETTER_STATUS = {
  pending: "pending",
  retrying: "retrying",
  replayed: "replayed",
  abandoned: "abandoned",
} as const satisfies Record<string, DeadLetterStatus>;

export const DEAD_LETTER_SOURCES = [
  "notification_events",
  "maintenance_task",
  "fire_and_forget",
] as const;
export type DeadLetterSource = (typeof DEAD_LETTER_SOURCES)[number];
export const DEAD_LETTER_SOURCE = {
  notificationEvents: "notification_events",
  maintenanceTask: "maintenance_task",
  fireAndForget: "fire_and_forget",
} as const satisfies Record<string, DeadLetterSource>;

export const API_DEDUPE_SCOPES = ["oauth_callback", "webhook_delivery", "queue_message"] as const;
export type ApiDedupeScope = (typeof API_DEDUPE_SCOPES)[number];
export const API_DEDUPE_SCOPE = {
  oauthCallback: "oauth_callback",
  webhookDelivery: "webhook_delivery",
  queueMessage: "queue_message",
} as const satisfies Record<string, ApiDedupeScope>;

export const API_DEDUPE_STATUSES = ["pending", "completed"] as const;
export type ApiDedupeStatus = (typeof API_DEDUPE_STATUSES)[number];
export const API_DEDUPE_STATUS = {
  pending: "pending",
  completed: "completed",
} as const satisfies Record<string, ApiDedupeStatus>;

export const IDEMPOTENCY_RESOLUTION_STATUSES = [
  "completed",
  "payload_ready",
  "unresolved",
] as const;
export type IdempotencyResolutionStatus = (typeof IDEMPOTENCY_RESOLUTION_STATUSES)[number];
export const IDEMPOTENCY_RESOLUTION_STATUS = {
  completed: "completed",
  payloadReady: "payload_ready",
  unresolved: "unresolved",
} as const satisfies Record<string, IdempotencyResolutionStatus>;

// Backward-compatible OAuth alias for existing route/client contracts.
export const OAUTH_DEDUPE_RESOLUTION_STATUSES = IDEMPOTENCY_RESOLUTION_STATUSES;
export type OAuthDedupeResolutionStatus = IdempotencyResolutionStatus;
export const OAUTH_DEDUPE_RESOLUTION_STATUS = IDEMPOTENCY_RESOLUTION_STATUS;

export const OAUTH_STATE_DECODE_REASONS = [
  "missing_state",
  "invalid_format",
  "invalid_signature",
  "invalid_encoding",
] as const;
export type OAuthStateDecodeReason = (typeof OAUTH_STATE_DECODE_REASONS)[number];
export const OAUTH_STATE_DECODE_REASON = {
  missingState: "missing_state",
  invalidFormat: "invalid_format",
  invalidSignature: "invalid_signature",
  invalidEncoding: "invalid_encoding",
} as const satisfies Record<string, OAuthStateDecodeReason>;

export const OAUTH_METRIC_REASON_CODES = [
  "unauthorized",
  "forbidden",
  "provider_disabled",
  "cross_org_forbidden",
  "provider_misconfigured",
  "missing_code",
  "missing_state",
  "invalid_state",
  "provider_mismatch",
  "state_expired",
  "callback_in_progress",
  "token_exchange_failed",
] as const;
export type OAuthMetricReasonCode = (typeof OAUTH_METRIC_REASON_CODES)[number];
export const OAUTH_METRIC_REASON_CODE = {
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  providerDisabled: "provider_disabled",
  crossOrgForbidden: "cross_org_forbidden",
  providerMisconfigured: "provider_misconfigured",
  missingCode: "missing_code",
  missingState: "missing_state",
  invalidState: "invalid_state",
  providerMismatch: "provider_mismatch",
  stateExpired: "state_expired",
  callbackInProgress: "callback_in_progress",
  tokenExchangeFailed: "token_exchange_failed",
} as const satisfies Record<string, OAuthMetricReasonCode>;

export const WEBHOOK_VERIFICATION_REASONS = [
  "missing_or_malformed_signature",
  "invalid_signature_timestamp",
  "signature_timestamp_out_of_tolerance",
  "missing_webhook_secret",
  "invalid_signature",
] as const;
export type WebhookVerificationReason = (typeof WEBHOOK_VERIFICATION_REASONS)[number];
export const WEBHOOK_VERIFICATION_REASON = {
  missingOrMalformedSignature: "missing_or_malformed_signature",
  invalidSignatureTimestamp: "invalid_signature_timestamp",
  signatureTimestampOutOfTolerance: "signature_timestamp_out_of_tolerance",
  missingWebhookSecret: "missing_webhook_secret",
  invalidSignature: "invalid_signature",
} as const satisfies Record<string, WebhookVerificationReason>;

export const INVITE_STATUSES = ["pending", "accepted", "expired", "revoked"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];
export const INVITE_STATUS = {
  pending: "pending",
  accepted: "accepted",
  expired: "expired",
  revoked: "revoked",
} as const satisfies Record<string, InviteStatus>;

export const INVITE_CODE_REDEMPTION_STATUSES = ["active", "expired", "converted"] as const;
export type InviteCodeRedemptionStatus = (typeof INVITE_CODE_REDEMPTION_STATUSES)[number];
export const INVITE_CODE_REDEMPTION_STATUS = {
  active: "active",
  expired: "expired",
  converted: "converted",
} as const satisfies Record<string, InviteCodeRedemptionStatus>;

export const NOTIFICATION_DELIVERY_STATUSES = ["pending", "sent", "failed"] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];
export const NOTIFICATION_DELIVERY_STATUS = {
  pending: "pending",
  sent: "sent",
  failed: "failed",
} as const satisfies Record<string, NotificationDeliveryStatus>;

export const AI_CREDIT_PURCHASE_STATUSES = ["active", "expired", "depleted"] as const;
export type AiCreditPurchaseStatus = (typeof AI_CREDIT_PURCHASE_STATUSES)[number];
export const AI_CREDIT_PURCHASE_STATUS = {
  active: "active",
  expired: "expired",
  depleted: "depleted",
} as const satisfies Record<string, AiCreditPurchaseStatus>;

export const AUTOMATION_RUN_TOPUP_PURCHASE_STATUSES = ["active", "depleted", "expired"] as const;
export type AutomationRunTopupPurchaseStatus =
  (typeof AUTOMATION_RUN_TOPUP_PURCHASE_STATUSES)[number];
export const AUTOMATION_RUN_TOPUP_PURCHASE_STATUS = {
  active: "active",
  depleted: "depleted",
  expired: "expired",
} as const satisfies Record<string, AutomationRunTopupPurchaseStatus>;

export const SUBSCRIPTION_TIERS = ["free", "starter", "pro"] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];
export const SUBSCRIPTION_TIER = {
  free: "free",
  starter: "starter",
  pro: "pro",
} as const satisfies Record<string, SubscriptionTier>;

export const SUBSCRIPTION_STATUSES = ["active", "past_due", "canceled", "trialing"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const SUBSCRIPTION_STATUS = {
  active: "active",
  pastDue: "past_due",
  canceled: "canceled",
  trialing: "trialing",
} as const satisfies Record<string, SubscriptionStatus>;

export const assertNever = (value: never, context: string): never => {
  throw new Error(`Unexpected ${context}: ${String(value)}`);
};
