import { z } from "zod";
import { nowIso as sharedNowIso } from "./runtime.js";
import type { CanonicalProviderId } from "./provider-ids.js";
import { CANONICAL_PROVIDER_IDS } from "./provider-ids.js";
import type { NotificationEventId } from "./notifications.js";
import type { SubscriptionTierId, SubscriptionStatus } from "./subscriptions.js";
import { subscriptionStatusSchema, subscriptionTierIdSchema } from "./subscriptions.js";
import type {
  ActionStatus as DomainActionStatus,
  AuditActorType as DomainAuditActorType,
  AuditEventType as DomainAuditEventType,
  CredentialType as DomainCredentialType,
  ApprovalDeciderType as DomainApprovalDeciderType,
  ClientType as DomainClientType,
  DefaultActionBehavior as DomainDefaultActionBehavior,
  IntegrationStatus as DomainIntegrationStatus,
  InviteStatus as DomainInviteStatus,
  InviteCodeRedemptionStatus as DomainInviteCodeRedemptionStatus,
  AbuseFlagSeverity as DomainAbuseFlagSeverity,
  AbuseFlagStatus as DomainAbuseFlagStatus,
  NotificationChannelValue as DomainNotificationChannelValue,
  NotificationEndpointTypeValue as DomainNotificationEndpointTypeValue,
  OutputSensitivity as DomainOutputSensitivity,
  NotificationDeliveryStatus as DomainNotificationDeliveryStatus,
  PolicyDecisionResult as DomainPolicyDecisionResult,
  PolicyMode as DomainPolicyMode,
  ProviderCatalogConfigurationStatus as DomainProviderCatalogConfigurationStatus,
  ProviderDeprecationStatus as DomainProviderDeprecationStatus,
  RuleEffect as DomainRuleEffect,
  RunStatus as DomainRunStatus,
  ToolCapability as DomainToolCapability,
  ToolCallStatus as DomainToolCallStatus,
  UserRole as DomainUserRole,
  WorkspaceStatus as DomainWorkspaceStatus,
} from "./domain.js";
import {
  ACTION_RISK_LEVELS,
  ACTION_STATUSES,
  AUDIT_ACTOR_TYPES,
  AUDIT_EVENT_TYPES,
  CREDENTIAL_TYPES,
  APPROVAL_DECISIONS,
  APPROVAL_DECIDER_TYPES,
  CLIENT_TYPES,
  DEFAULT_ACTION_BEHAVIORS,
  INTEGRATION_STATUSES,
  OUTPUT_SENSITIVITIES,
  POLICY_DECISION_RESULTS,
  POLICY_MODES,
  PROVIDER_CATALOG_CONFIGURATION_STATUSES,
  PROVIDER_DEPRECATION_STATUSES,
  RULE_EFFECTS,
  RUN_STATUSES,
  TOOL_CAPABILITIES,
  TOOL_CALL_STATUSES,
  USER_ROLES,
  WORKSPACE_STATUSES,
} from "./domain.js";

export const roleSchema = z.enum(USER_ROLES);
export type Role = DomainUserRole;

export const workspaceStatusSchema = z.enum(WORKSPACE_STATUSES);
export type WorkspaceStatus = DomainWorkspaceStatus;

export const policyModeSchema = z.enum(POLICY_MODES);
export type PolicyMode = DomainPolicyMode;

export const defaultActionBehaviorSchema = z.enum(DEFAULT_ACTION_BEHAVIORS);
export type DefaultActionBehavior = DomainDefaultActionBehavior;

export const credentialTypeSchema = z.enum(CREDENTIAL_TYPES);
export type CredentialType = DomainCredentialType;

export const providerSchema = z.enum(CANONICAL_PROVIDER_IDS);
export type Provider = CanonicalProviderId;

export { subscriptionTierIdSchema, subscriptionStatusSchema };

export const integrationStatusSchema = z.enum(INTEGRATION_STATUSES);
export type IntegrationStatus = DomainIntegrationStatus;

export const clientTypeSchema = z.enum(CLIENT_TYPES);
export type ClientType = DomainClientType;

export const runStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = DomainRunStatus;

export const toolCallStatusSchema = z.enum(TOOL_CALL_STATUSES);
export type ToolCallStatus = DomainToolCallStatus;

export const actionRiskLevelSchema = z.enum(ACTION_RISK_LEVELS);
export type ActionRiskLevel = z.infer<typeof actionRiskLevelSchema>;

export const actionStatusSchema = z.enum(ACTION_STATUSES);
export type ActionStatus = DomainActionStatus;

export const deciderTypeSchema = z.enum(APPROVAL_DECIDER_TYPES);
export type DeciderType = DomainApprovalDeciderType;

export const decisionSchema = z.enum(APPROVAL_DECISIONS);
export type Decision = z.infer<typeof decisionSchema>;

export const ruleEffectSchema = z.enum(RULE_EFFECTS);
export type RuleEffect = DomainRuleEffect;

export const policyDecisionResultSchema = z.enum(POLICY_DECISION_RESULTS);
export type PolicyDecisionResult = DomainPolicyDecisionResult;

export const outputSensitivitySchema = z.enum(OUTPUT_SENSITIVITIES);
export type OutputSensitivity = DomainOutputSensitivity;

export const capabilitySchema = z.enum(TOOL_CAPABILITIES);
export type Capability = DomainToolCapability;

export const providerDeprecationStatusSchema = z.enum(PROVIDER_DEPRECATION_STATUSES);
export type ProviderDeprecationStatus = DomainProviderDeprecationStatus;

export const providerCatalogConfigurationStatusSchema = z.enum(
  PROVIDER_CATALOG_CONFIGURATION_STATUSES,
);
export type ProviderCatalogConfigurationStatus = DomainProviderCatalogConfigurationStatus;

export const auditActorTypeSchema = z.enum(AUDIT_ACTOR_TYPES);
export type AuditActorType = DomainAuditActorType;

const auditEventTypeValues = Object.values(AUDIT_EVENT_TYPES) as [
  DomainAuditEventType,
  ...DomainAuditEventType[],
];
export const auditEventTypeSchema = z.enum(auditEventTypeValues);
export type AuditEventType = DomainAuditEventType;

export interface Workspace {
  id: string;
  org_id: string;
  name: string;
  status: WorkspaceStatus;
  policy_mode: PolicyMode;
  default_action_behavior: DefaultActionBehavior;
  code_mode_enabled: boolean;
  created_at: string;
}

export interface WorkspaceIntegration {
  id: string;
  workspace_id: string;
  provider: Provider;
  enabled: boolean;
  created_by: string;
  created_at: string;
}

export interface WorkspaceCredential {
  id: string;
  workspace_id: string;
  type: CredentialType;
  hashed_secret: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface OrgSuspension {
  id: string;
  org_id: string;
  reason: string;
  suspended_by: string;
  suspended_at: string;
  lifted_at: string | null;
  lifted_by: string | null;
}

export interface CredentialAuthFailure {
  id: string;
  workspace_id: string;
  ip_hash: string;
  attempt_count: number;
  first_attempt_at: string;
  last_attempt_at: string;
  locked_at: string | null;
}

export interface CredentialUsageObservation {
  id: string;
  credential_id: string;
  workspace_id: string;
  ip_hash: string;
  first_seen_at: string;
  last_seen_at: string;
}

export interface AbuseFlag {
  id: string;
  org_id: string;
  flag_type: string;
  severity: DomainAbuseFlagSeverity;
  details: string;
  status: DomainAbuseFlagStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export interface Integration {
  id: string;
  org_id: string;
  provider: Provider;
  display_name: string;
  status: IntegrationStatus;
  created_at: string;
  last_health_check_at?: string | null;
  last_successful_health_check_at?: string | null;
  last_error_code?: string | null;
  last_error_category?: string | null;
  last_webhook_at?: string | null;
  degraded_reason?: string | null;
}

export interface IntegrationAccount {
  id: string;
  integration_id: string;
  external_account_id: string;
  scopes: string[];
  metadata: Record<string, unknown>;
}

export interface IntegrationCredential {
  id: string;
  integration_account_id: string;
  access_token_enc: string;
  refresh_token_enc: string | null;
  expires_at: string | null;
  key_version: string;
  last_refreshed_at?: string | null;
  last_refresh_error_at?: string | null;
  last_refresh_error_code?: string | null;
}

export interface AutomationRun {
  id: string;
  workspace_id: string;
  mcp_session_id: string | null;
  client_type: ClientType;
  metadata: Record<string, unknown>;
  started_at: string;
  ended_at: string | null;
  status: RunStatus;
}

export interface ToolCall {
  id: string;
  automation_run_id: string;
  tool_name: string;
  input_redacted: Record<string, unknown>;
  output_redacted: Record<string, unknown> | null;
  status: ToolCallStatus;
  raw_input_blob_id: string | null;
  raw_output_blob_id: string | null;
  latency_ms: number;
  created_at: string;
}

export interface Action {
  id: string;
  automation_run_id: string;
  tool_call_id: string;
  action_type: string;
  risk_level: ActionRiskLevel;
  normalized_payload_enc: string;
  payload_preview: Record<string, unknown>;
  payload_purged_at: string | null;
  status: ActionStatus;
  idempotency_key: string;
  created_at: string;
  resolved_at: string | null;
  result_redacted: Record<string, unknown> | null;
}

export interface Approval {
  id: string;
  action_id: string;
  decider_type: DeciderType;
  decision: Decision;
  reason: string;
  rule_id: string | null;
  confidence: number | null;
  created_at: string;
}

export interface CelRule {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  expression: string;
  effect: RuleEffect;
  enabled: boolean;
  created_by: string;
  created_at: string;
}

export interface CelRuleMatch {
  id: string;
  action_id: string;
  cel_rule_id: string;
  effect: RuleEffect;
  expression_snapshot: string;
  context_snapshot: Record<string, unknown>;
  created_at: string;
}

export interface ToolAutoApproval {
  id: string;
  workspace_id: string;
  tool_name: string;
  enabled: boolean;
  created_by: string;
  created_at: string;
}

export interface Policy {
  id: string;
  workspace_id: string;
  text: string;
  enabled: boolean;
  created_by: string;
  created_at: string;
}

export interface PolicyDecision {
  id: string;
  action_id: string;
  policies_evaluated: string[];
  result: PolicyDecisionResult;
  explanation: string;
  confidence: number | null;
  created_at: string;
}

export interface Invite {
  id: string;
  org_id: string;
  email: string;
  role: Role;
  token_hash: string;
  invited_by: string;
  status: DomainInviteStatus;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

export interface CodeModeToolIndexEntry {
  tool_name: string;
  provider: string;
  capability: string;
  risk_level: string;
  requires_approval: boolean;
  description: string;
  action_type: string;
  input_schema_json: string;
  embedding: number[];
}

export interface FeatureFlag {
  id: string;
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface DogfoodOrg {
  id: string;
  org_id: string;
  added_by: string;
  created_at: string;
}

export interface AuditEvent {
  id: string;
  org_id: string;
  actor_type: DomainAuditActorType;
  actor_id: string;
  event_type: DomainAuditEventType;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface NotificationEndpoint {
  id: string;
  org_id: string;
  user_id: string;
  type: DomainNotificationEndpointTypeValue;
  destination: string;
  push_subscription: string | null;
  notification_preferences?: string;
  enabled: boolean;
  created_at: string;
}

export interface NotificationEvent {
  id: string;
  org_id: string;
  event_type: NotificationEventId;
  channel: DomainNotificationChannelValue;
  title: string;
  body: string;
  cta_url: string;
  cta_label: string;
  metadata?: string;
  action_id: string | null;
  endpoint_id: string | null;
  read_at: string | null;
  status: DomainNotificationDeliveryStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
}

export interface SensitiveBlob {
  id: string;
  org_id: string;
  ref_table: string;
  ref_id: string;
  ref_field: string;
  blob_enc: string;
  key_version: string;
  expires_at: string | null;
  purged_at: string | null;
  created_at: string;
}

export interface RetentionPolicy {
  id: string;
  org_id: string;
  raw_tool_io_retention_days: number | null;
  action_payload_retention_days: number;
  audit_retention_days: number | null;
  updated_by: string;
  updated_at: string;
}

export interface PollingTracker {
  action_id: string;
  credential_id: string;
  consecutive_pending_count: number;
  last_polled_at: string;
}

export interface Subscription {
  id: string;
  org_id: string;
  tier: SubscriptionTierId;
  status: SubscriptionStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  invite_code_id?: string | null;
  current_period_start: string;
  current_period_end: string;
  created_at: string;
  updated_at: string;
}

export interface InviteCode {
  id: string;
  code: string;
  label: string;
  grant_tier?: SubscriptionTierId;
  active: boolean;
  use_count: number;
  created_by: string;
  created_at: string;
}

export interface InviteCodeRedemption {
  id: string;
  org_id: string;
  invite_code_id: string;
  grant_tier: SubscriptionTierId;
  status: DomainInviteCodeRedemptionStatus;
  redeemed_by: string;
  redeemed_at: string;
  expires_at: string;
  updated_at: string;
}

export interface UsageMeter {
  id: string;
  org_id: string;
  period_start: string;
  period_end: string;
  tool_call_count: number;
  total_tool_call_time_ms: number;
  notifications_fired?: string;
  updated_at: string;
}

export interface DbSchema {
  invite_codes: InviteCode[];
  invite_code_redemptions: InviteCodeRedemption[];
  invites: Invite[];
  workspaces: Workspace[];
  workspace_integrations: WorkspaceIntegration[];
  code_mode_tool_index: CodeModeToolIndexEntry[];
  workspace_credentials: WorkspaceCredential[];
  org_suspensions: OrgSuspension[];
  credential_auth_failures: CredentialAuthFailure[];
  credential_usage_observations: CredentialUsageObservation[];
  abuse_flags: AbuseFlag[];
  integrations: Integration[];
  integration_accounts: IntegrationAccount[];
  integration_credentials: IntegrationCredential[];
  automation_runs: AutomationRun[];
  tool_calls: ToolCall[];
  actions: Action[];
  approvals: Approval[];
  cel_rules: CelRule[];
  cel_rule_matches: CelRuleMatch[];
  tool_auto_approvals: ToolAutoApproval[];
  policies: Policy[];
  policy_decisions: PolicyDecision[];
  feature_flags: FeatureFlag[];
  dogfood_orgs: DogfoodOrg[];
  audit_events: AuditEvent[];
  notification_endpoints: NotificationEndpoint[];
  notification_events: NotificationEvent[];
  sensitive_blobs: SensitiveBlob[];
  retention_policies: RetentionPolicy[];
  poll_trackers: PollingTracker[];
  subscriptions: Subscription[];
  usage_meters: UsageMeter[];
}

export const nowIso = sharedNowIso;

export const emptyDb = (): DbSchema => ({
  invite_codes: [],
  invite_code_redemptions: [],
  invites: [],
  workspaces: [],
  workspace_integrations: [],
  code_mode_tool_index: [],
  workspace_credentials: [],
  org_suspensions: [],
  credential_auth_failures: [],
  credential_usage_observations: [],
  abuse_flags: [],
  integrations: [],
  integration_accounts: [],
  integration_credentials: [],
  automation_runs: [],
  tool_calls: [],
  actions: [],
  approvals: [],
  cel_rules: [],
  cel_rule_matches: [],
  tool_auto_approvals: [],
  policies: [],
  policy_decisions: [],
  feature_flags: [],
  dogfood_orgs: [],
  audit_events: [],
  notification_endpoints: [],
  notification_events: [],
  sensitive_blobs: [],
  retention_policies: [],
  poll_trackers: [],
  subscriptions: [],
  usage_meters: [],
});

export const toolInputEnvelopeSchema = z.object({
  idempotency_key: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type ToolInputEnvelope = z.infer<typeof toolInputEnvelopeSchema>;

export const credentialsContextSchema = z.object({
  integration_id: z.string(),
  scopes: z.array(z.string()),
});

export type CredentialsContext = z.infer<typeof credentialsContextSchema>;

export interface DecisionTrace {
  matched_cel_rules: Array<{ id: string; name: string; effect: RuleEffect; expression: string }>;
  tool_auto_approve: boolean;
  policy_result: PolicyDecisionResult | null;
}

export interface ActionContext {
  tool: {
    name: string;
    capability: Capability;
    risk_level: ActionRiskLevel;
  };
  action: {
    type: string;
    preview: Record<string, unknown>;
  };
  workspace: {
    id: string;
    name: string;
    policy_mode: PolicyMode;
    default_action_behavior: DefaultActionBehavior;
  };
  now: string;
}
