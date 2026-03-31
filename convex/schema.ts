import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  actionRiskValidator,
  actionStatusValidator,
  abuseFlagSeverityValidator,
  abuseFlagStatusValidator,
  automationRunStatusValidator,
  automationStatusValidator,
  aiKeyCredentialKindValidator,
  aiKeyModeValidator,
  aiModelProviderValidator,
  approvalDeciderValidator,
  approvalDecisionValidator,
  clientTypeValidator,
  configTriggerTypeValidator,
  credentialTypeValidator,
  defaultActionBehaviorValidator,
  integrationStatusValidator,
  integrationErrorCategoryValidator,
  integrationErrorCodeValidator,
  inviteCodeRedemptionStatusValidator,
  inviteStatusValidator,
  networkAccessValidator,
  notificationDeliveryStatusValidator,
  notificationEndpointTypeValidator,
  notificationChannelValidator,
  notificationEventTypeValidator,
  policyDecisionValidator,
  policyModeValidator,
  providerMetricNameValidator,
  providerMetricOutcomeValidator,
  providerValidator,
  runTriggerTypeValidator,
  runnerTypeValidator,
  ruleEffectValidator,
  roleValidator,
  runStatusValidator,
  automationRunLogLevelValidator,
  automationRunEventTypeValidator,
  automationTriggerEventStatusValidator,
  automationTriggerEventMatchStatusValidator,
  automationProviderTriggerDeliveryModeValidator,
  automationProviderTriggerMigrationStateValidator,
  automationProviderTriggerValidator,
  aiCreditPurchaseStatusValidator,
  automationRunTopupPurchaseStatusValidator,
  apiDedupeScopeValidator,
  apiDedupeStatusValidator,
  auditActorTypeValidator,
  auditEventTypeValidator,
  customMcpServerStatusValidator,
  deadLetterErrorCodeValidator,
  deadLetterSourceTableValidator,
  deadLetterStatusValidator,
  subscriptionStatusValidator,
  subscriptionTierValidator,
  toolCapabilityValidator,
  toolCallStatusValidator,
  workspaceStatusValidator,
  jsonRecordValidator,
} from "./validators";

export default defineSchema({
  subscriptions: defineTable({
    id: v.string(),
    org_id: v.string(),
    tier: subscriptionTierValidator,
    status: subscriptionStatusValidator,
    stripe_customer_id: v.union(v.string(), v.null()),
    stripe_subscription_id: v.union(v.string(), v.null()),
    invite_code_id: v.optional(v.union(v.string(), v.null())),
    workspace_count: v.optional(v.number()),
    current_period_start: v.string(),
    current_period_end: v.string(),
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_org", ["org_id"])
    .index("by_tier", ["tier"])
    .index("by_stripe_customer", ["stripe_customer_id"])
    .index("by_stripe_subscription", ["stripe_subscription_id"]),

  invites: defineTable({
    id: v.string(),
    org_id: v.string(),
    email: v.string(),
    role: roleValidator,
    token_hash: v.string(),
    invited_by: v.string(),
    status: inviteStatusValidator,
    created_at: v.string(),
    expires_at: v.string(),
    accepted_at: v.union(v.string(), v.null()),
  })
    .index("by_custom_id", ["id"])
    .index("by_org", ["org_id"])
    .index("by_org_email", ["org_id", "email"])
    .index("by_token_hash", ["token_hash"])
    .index("by_expires_at", ["expires_at"]),

  invite_codes: defineTable({
    id: v.string(),
    code: v.string(),
    label: v.string(),
    grant_tier: v.optional(subscriptionTierValidator),
    active: v.boolean(),
    use_count: v.number(),
    created_by: v.string(),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_code", ["code"]),

  invite_code_redemptions: defineTable({
    id: v.string(),
    org_id: v.string(),
    invite_code_id: v.string(),
    grant_tier: subscriptionTierValidator,
    status: inviteCodeRedemptionStatusValidator,
    redeemed_by: v.string(),
    redeemed_at: v.string(),
    expires_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_org", ["org_id"])
    .index("by_org_status", ["org_id", "status"])
    .index("by_invite_code", ["invite_code_id"])
    .index("by_expires_at", ["expires_at"])
    .index("by_status_and_expires_at", ["status", "expires_at"]),

  e2e_invite_tokens: defineTable({
    invite_id: v.string(),
    org_id: v.string(),
    email: v.string(),
    raw_token: v.string(),
    created_at: v.string(),
  })
    .index("by_invite_id", ["invite_id"])
    .index("by_org_email", ["org_id", "email"])
    .index("by_org_email_created_at", ["org_id", "email", "created_at"]),

  usage_meters: defineTable({
    id: v.string(),
    org_id: v.string(),
    period_start: v.string(),
    period_end: v.string(),
    tool_call_count: v.number(),
    total_tool_call_time_ms: v.number(),
    notifications_fired: v.optional(v.string()),
    updated_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_org_period", ["org_id", "period_start"]),

  workspaces: defineTable({
    id: v.string(),
    org_id: v.string(),
    slug: v.string(),
    name: v.string(),
    status: workspaceStatusValidator,
    policy_mode: policyModeValidator,
    default_action_behavior: defaultActionBehaviorValidator,
    code_mode_enabled: v.optional(v.boolean()),
    automation_count: v.optional(v.number()),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_org", ["org_id"])
    .index("by_org_status", ["org_id", "status"])
    .index("by_org_slug", ["org_id", "slug"])
    .index("by_created_at", ["created_at"]),

  workspace_integrations: defineTable({
    id: v.string(),
    workspace_id: v.string(),
    provider: providerValidator,
    enabled: v.boolean(),
    created_by: v.string(),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_workspace", ["workspace_id"])
    .index("by_workspace_provider", ["workspace_id", "provider"]),

  custom_mcp_servers: defineTable({
    id: v.string(),
    org_id: v.string(),
    slug: v.string(),
    display_name: v.string(),
    url: v.string(),
    bearer_token_enc: v.union(v.string(), v.null()),
    key_version: v.string(),
    status: customMcpServerStatusValidator,
    last_discovery_at: v.union(v.string(), v.null()),
    last_discovery_error: v.union(v.string(), v.null()),
    tool_count: v.number(),
    created_by: v.string(),
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_org", ["org_id"])
    .index("by_org_slug", ["org_id", "slug"]),

  custom_mcp_tools: defineTable({
    id: v.string(),
    server_id: v.string(),
    org_id: v.string(),
    tool_name: v.string(),
    remote_tool_name: v.string(),
    description: v.string(),
    input_schema_json: v.string(),
    risk_level: actionRiskValidator,
    requires_approval: v.boolean(),
    enabled: v.boolean(),
    discovered_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_server", ["server_id"])
    .index("by_org", ["org_id"])
    .index("by_tool_name", ["org_id", "tool_name"]),

  workspace_custom_servers: defineTable({
    id: v.string(),
    workspace_id: v.string(),
    server_id: v.string(),
    enabled: v.boolean(),
    created_by: v.string(),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_workspace", ["workspace_id"])
    .index("by_server", ["server_id"])
    .index("by_workspace_server", ["workspace_id", "server_id"]),

  code_mode_tool_index: defineTable({
    tool_name: v.string(),
    provider: providerValidator,
    capability: toolCapabilityValidator,
    risk_level: actionRiskValidator,
    requires_approval: v.boolean(),
    description: v.string(),
    action_type: v.string(),
    input_schema_json: v.string(),
    embedding: v.array(v.float64()),
  })
    .index("by_tool_name", ["tool_name"])
    .index("by_provider", ["provider"])
    .searchIndex("search_description", {
      searchField: "description",
      filterFields: ["provider", "capability"],
    })
    .vectorIndex("vector_description", {
      vectorField: "embedding",
      dimensions: 64,
      filterFields: ["provider", "capability"],
    }),

  workspace_credentials: defineTable({
    id: v.string(),
    workspace_id: v.string(),
    type: credentialTypeValidator,
    hashed_secret: v.string(),
    last_used_at: v.union(v.string(), v.null()),
    revoked_at: v.union(v.string(), v.null()),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_workspace", ["workspace_id"])
    .index("by_hashed_secret", ["hashed_secret"])
    .index("by_revoked_created", ["revoked_at", "created_at"])
    .index("by_revoked_created_id", ["revoked_at", "created_at", "id"]),

  org_suspensions: defineTable({
    id: v.string(),
    org_id: v.string(),
    reason: v.string(),
    suspended_by: v.string(),
    suspended_at: v.string(),
    lifted_at: v.union(v.string(), v.null()),
    lifted_by: v.union(v.string(), v.null()),
  })
    .index("by_custom_id", ["id"])
    .index("by_org", ["org_id"])
    .index("by_org_lifted", ["org_id", "lifted_at"])
    .index("by_org_suspended", ["org_id", "suspended_at"]),

  credential_auth_failures: defineTable({
    id: v.string(),
    workspace_id: v.string(),
    ip_hash: v.string(),
    attempt_count: v.number(),
    first_attempt_at: v.string(),
    last_attempt_at: v.string(),
    locked_at: v.union(v.string(), v.null()),
  })
    .index("by_custom_id", ["id"])
    .index("by_workspace_ip", ["workspace_id", "ip_hash"])
    .index("by_workspace_locked", ["workspace_id", "locked_at"])
    .index("by_last_attempt", ["last_attempt_at"]),

  credential_usage_observations: defineTable({
    id: v.string(),
    credential_id: v.string(),
    workspace_id: v.string(),
    ip_hash: v.string(),
    first_seen_at: v.string(),
    last_seen_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_credential", ["credential_id"])
    .index("by_credential_ip", ["credential_id", "ip_hash"])
    .index("by_last_seen", ["last_seen_at"]),

  abuse_flags: defineTable({
    id: v.string(),
    org_id: v.string(),
    flag_type: v.string(),
    severity: abuseFlagSeverityValidator,
    details: v.string(),
    status: abuseFlagStatusValidator,
    reviewed_by: v.union(v.string(), v.null()),
    reviewed_at: v.union(v.string(), v.null()),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_org", ["org_id"])
    .index("by_status", ["status"])
    .index("by_org_status", ["org_id", "status"])
    .index("by_org_status_flag_details", ["org_id", "status", "flag_type", "details"]),

  integrations: defineTable({
    id: v.string(),
    org_id: v.string(),
    provider: providerValidator,
    provider_module_version: v.optional(v.number()),
    display_name: v.string(),
    status: integrationStatusValidator,
    created_at: v.string(),
    last_health_check_at: v.optional(v.union(v.string(), v.null())),
    last_successful_health_check_at: v.optional(v.union(v.string(), v.null())),
    last_error_code: v.optional(v.union(integrationErrorCodeValidator, v.null())),
    last_error_category: v.optional(v.union(integrationErrorCategoryValidator, v.null())),
    last_webhook_at: v.optional(v.union(v.string(), v.null())),
    degraded_reason: v.optional(v.union(v.string(), v.null())),
  })
    .index("by_custom_id", ["id"])
    .index("by_org", ["org_id"])
    .index("by_provider", ["provider"])
    .index("by_org_provider", ["org_id", "provider"]),

  integration_accounts: defineTable({
    id: v.string(),
    integration_id: v.string(),
    external_account_id: v.string(),
    scopes: v.array(v.string()),
    metadata: jsonRecordValidator,
  })
    .index("by_custom_id", ["id"])
    .index("by_integration", ["integration_id"])
    .index("by_integration_external_account", ["integration_id", "external_account_id"]),

  integration_credentials: defineTable({
    id: v.string(),
    integration_account_id: v.string(),
    access_token_enc: v.string(),
    refresh_token_enc: v.union(v.string(), v.null()),
    expires_at: v.union(v.string(), v.null()),
    key_version: v.string(),
    last_refreshed_at: v.optional(v.union(v.string(), v.null())),
    last_refresh_error_at: v.optional(v.union(v.string(), v.null())),
    last_refresh_error_code: v.optional(v.union(v.string(), v.null())),
  })
    .index("by_custom_id", ["id"])
    .index("by_integration_account", ["integration_account_id"]),

  oauth_connect_states: defineTable({
    id: v.string(),
    org_id: v.string(),
    provider: providerValidator,
    correlation_id: v.string(),
    pkce_code_verifier_enc: v.union(v.string(), v.null()),
    key_version: v.string(),
    created_at: v.string(),
    expires_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_org_provider_correlation", ["org_id", "provider", "correlation_id"])
    .index("by_expires_at", ["expires_at"]),

  api_dedupe_keys: defineTable({
    id: v.string(),
    scope: apiDedupeScopeValidator,
    dedupe_key: v.string(),
    status: apiDedupeStatusValidator,
    payload: v.union(jsonRecordValidator, v.null()),
    created_at: v.string(),
    completed_at: v.union(v.string(), v.null()),
    expires_at: v.number(),
  })
    .index("by_custom_id", ["id"])
    .index("by_scope_key", ["scope", "dedupe_key"])
    .index("by_expires", ["expires_at"]),

  rate_limits: defineTable({
    id: v.string(),
    key: v.string(),
    timestamps: v.array(v.number()),
    window_ms: v.number(),
    updated_at: v.number(),
  })
    .index("by_custom_id", ["id"])
    .index("by_key", ["key"])
    .index("by_updated_at", ["updated_at"]),

  automations: defineTable({
    id: v.string(),
    org_id: v.string(),
    workspace_id: v.string(),
    slug: v.string(),
    name: v.string(),
    description: v.string(),
    mermaid_content: v.optional(v.union(v.string(), v.null())),
    mermaid_prompt_hash: v.optional(v.union(v.string(), v.null())),
    status: automationStatusValidator,
    current_config_version_id: v.string(),
    next_config_version_number: v.optional(v.number()),
    created_by: v.string(),
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_workspace", ["workspace_id"])
    .index("by_workspace_slug", ["workspace_id", "slug"])
    .index("by_status", ["status"])
    .index("by_org", ["org_id"]),

  automation_config_versions: defineTable({
    id: v.string(),
    automation_id: v.string(),
    version_number: v.number(),
    trigger_type: configTriggerTypeValidator,
    schedule_cron: v.union(v.string(), v.null()),
    provider_trigger: v.union(automationProviderTriggerValidator, v.null()),
    provider_trigger_migration_state: v.union(
      automationProviderTriggerMigrationStateValidator,
      v.null(),
    ),
    event_provider: v.union(v.string(), v.null()),
    event_type: v.union(v.string(), v.null()),
    event_predicate: v.union(v.string(), v.null()),
    runner_type: runnerTypeValidator,
    ai_model_provider: aiModelProviderValidator,
    ai_model_name: v.string(),
    prompt: v.string(),
    network_access: networkAccessValidator,
    created_by: v.string(),
    created_at: v.string(),
    change_summary: v.union(v.string(), v.null()),
  })
    .index("by_custom_id", ["id"])
    .index("by_automation", ["automation_id"])
    .index("by_automation_version", ["automation_id", "version_number"])
    .index("by_trigger_provider_type", ["trigger_type", "event_provider", "event_type"]),

  automation_runs: defineTable({
    id: v.string(),
    automation_id: v.optional(v.string()),
    org_id: v.optional(v.string()),
    config_version_id: v.optional(v.string()),
    trigger_type: v.optional(runTriggerTypeValidator),
    error_message: v.optional(v.union(v.string(), v.null())),
    sandbox_id: v.optional(v.union(v.string(), v.null())),
    log_storage_id: v.optional(v.union(v.id("_storage"), v.null())),
    created_at: v.optional(v.string()),
    // Legacy imported runs may omit workspace_id; new writes should always include it.
    workspace_id: v.optional(v.string()),
    // Legacy Harbor-sourced runs may carry this identifier.
    harbor_id: v.optional(v.string()),
    mcp_session_id: v.union(v.string(), v.null()),
    client_type: clientTypeValidator,
    metadata: jsonRecordValidator,
    started_at: v.string(),
    ended_at: v.union(v.string(), v.null()),
    status: runStatusValidator,
  })
    .index("by_custom_id", ["id"])
    .index("by_automation", ["automation_id"])
    .index("by_automation_status", ["automation_id", "status"])
    .index("by_automation_trigger_started", ["automation_id", "trigger_type", "started_at"])
    .index("by_workspace", ["workspace_id"])
    .index("by_org_status", ["org_id", "status"])
    .index("by_org_status_created", ["org_id", "status", "created_at"])
    .index("by_workspace_status", ["workspace_id", "status"])
    .index("by_status", ["status"])
    .index("by_status_started", ["status", "started_at"])
    .index("by_status_ended", ["status", "ended_at"])
    .index("by_workspace_session_status", ["workspace_id", "mcp_session_id", "status"]),

  automation_run_logs: defineTable({
    automation_run_id: v.string(),
    seq: v.number(),
    level: automationRunLogLevelValidator,
    content: v.string(),
    timestamp: v.string(),
    event_type: v.optional(automationRunEventTypeValidator),
    event_data: v.optional(jsonRecordValidator),
  }).index("by_run_seq", ["automation_run_id", "seq"]),

  ai_credits: defineTable({
    id: v.string(),
    org_id: v.string(),
    period_start: v.string(),
    period_end: v.string(),
    allowance_total: v.number(),
    allowance_used: v.number(),
    purchased_balance: v.number(),
    updated_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_org_period", ["org_id", "period_start"]),

  ai_credit_purchases: defineTable({
    id: v.string(),
    org_id: v.string(),
    credits: v.number(),
    price_cents: v.number(),
    stripe_payment_intent_id: v.union(v.string(), v.null()),
    purchased_at: v.string(),
    expires_at: v.string(),
    credits_remaining: v.number(),
    status: aiCreditPurchaseStatusValidator,
  })
    .index("by_custom_id", ["id"])
    .index("by_org", ["org_id"])
    .index("by_org_active", ["org_id", "status"])
    .index("by_expires_at", ["expires_at"]),

  automation_run_topups: defineTable({
    id: v.string(),
    org_id: v.string(),
    period_start: v.string(),
    period_end: v.string(),
    purchased_runs_balance: v.number(),
    purchased_tool_calls_balance: v.number(),
    purchased_tool_call_time_ms_balance: v.number(),
    updated_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_org_period", ["org_id", "period_start"]),

  automation_run_topup_purchases: defineTable({
    id: v.string(),
    org_id: v.string(),
    tier_at_purchase: v.string(),
    multiplier: v.string(),
    runs_total: v.number(),
    runs_remaining: v.number(),
    tool_calls_total: v.number(),
    tool_calls_remaining: v.number(),
    tool_call_time_ms: v.number(),
    price_cents: v.number(),
    stripe_payment_intent_id: v.union(v.string(), v.null()),
    purchased_at: v.string(),
    expires_at: v.string(),
    status: automationRunTopupPurchaseStatusValidator,
  })
    .index("by_custom_id", ["id"])
    .index("by_org", ["org_id"])
    .index("by_org_active", ["org_id", "status"])
    .index("by_expires_at", ["expires_at"]),

  org_ai_keys: defineTable({
    id: v.string(),
    org_id: v.string(),
    provider: aiModelProviderValidator,
    key_mode: aiKeyModeValidator,
    encrypted_key: v.string(),
    credential_kind: v.optional(aiKeyCredentialKindValidator),
    key_hint: v.string(),
    key_version: v.number(),
    is_active: v.boolean(),
    subject_email: v.optional(v.union(v.string(), v.null())),
    account_id: v.optional(v.union(v.string(), v.null())),
    token_expires_at: v.optional(v.union(v.string(), v.null())),
    last_refreshed_at: v.optional(v.union(v.string(), v.null())),
    last_validated_at: v.optional(v.union(v.string(), v.null())),
    created_by: v.string(),
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_org", ["org_id"])
    .index("by_org_mode", ["org_id", "key_mode"])
    .index("by_org_provider_mode", ["org_id", "provider", "key_mode"]),

  automation_trigger_events: defineTable({
    id: v.string(),
    automation_id: v.string(),
    org_id: v.optional(v.string()),
    config_version_id: v.optional(v.string()),
    trigger_id: v.optional(v.string()),
    trigger_key: v.optional(v.string()),
    delivery_mode: v.optional(automationProviderTriggerDeliveryModeValidator),
    match_status: v.optional(automationTriggerEventMatchStatusValidator),
    failure_reason: v.optional(v.union(v.string(), v.null())),
    event_provider: v.string(),
    event_type: v.string(),
    event_id: v.string(),
    event_payload_ref: v.union(v.string(), v.null()),
    status: automationTriggerEventStatusValidator,
    automation_run_id: v.union(v.string(), v.null()),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_automation", ["automation_id"])
    .index("by_automation_status", ["automation_id", "status"])
    .index("by_status_created", ["status", "created_at"])
    .index("by_event_id", ["event_id"]),

  tool_calls: defineTable({
    id: v.string(),
    automation_run_id: v.string(),
    tool_name: v.string(),
    input_redacted: jsonRecordValidator,
    output_redacted: v.union(jsonRecordValidator, v.null()),
    status: toolCallStatusValidator,
    raw_input_blob_id: v.union(v.string(), v.null()),
    raw_output_blob_id: v.union(v.string(), v.null()),
    latency_ms: v.number(),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_automation_run", ["automation_run_id"]),

  actions: defineTable({
    id: v.string(),
    workspace_id: v.optional(v.string()),
    automation_run_id: v.string(),
    tool_call_id: v.string(),
    action_type: v.string(),
    risk_level: actionRiskValidator,
    normalized_payload_enc: v.string(),
    payload_preview: jsonRecordValidator,
    payload_purged_at: v.union(v.string(), v.null()),
    status: actionStatusValidator,
    idempotency_key: v.string(),
    created_at: v.string(),
    resolved_at: v.union(v.string(), v.null()),
    result_redacted: v.union(jsonRecordValidator, v.null()),
  })
    .index("by_custom_id", ["id"])
    .index("by_workspace_created", ["workspace_id", "created_at"])
    .index("by_workspace_status_created", ["workspace_id", "status", "created_at"])
    .index("by_automation_run", ["automation_run_id"])
    .index("by_automation_run_status", ["automation_run_id", "status"])
    .index("by_tool_call", ["tool_call_id"])
    .index("by_idempotency_key", ["idempotency_key"])
    .index("by_status", ["status"])
    .index("by_status_created", ["status", "created_at"]),

  approvals: defineTable({
    id: v.string(),
    action_id: v.string(),
    decider_type: approvalDeciderValidator,
    decision: approvalDecisionValidator,
    reason: v.string(),
    rule_id: v.union(v.string(), v.null()),
    confidence: v.union(v.number(), v.null()),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_action", ["action_id"]),

  cel_rules: defineTable({
    id: v.string(),
    workspace_id: v.string(),
    name: v.string(),
    description: v.string(),
    expression: v.string(),
    effect: ruleEffectValidator,
    enabled: v.boolean(),
    created_by: v.string(),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_workspace", ["workspace_id"]),

  cel_rule_matches: defineTable({
    id: v.string(),
    action_id: v.string(),
    cel_rule_id: v.string(),
    effect: ruleEffectValidator,
    expression_snapshot: v.string(),
    context_snapshot: jsonRecordValidator,
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_cel_rule", ["cel_rule_id"])
    .index("by_action", ["action_id"]),

  tool_auto_approvals: defineTable({
    id: v.string(),
    workspace_id: v.string(),
    tool_name: v.string(),
    enabled: v.boolean(),
    created_by: v.string(),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_workspace", ["workspace_id"])
    .index("by_workspace_tool", ["workspace_id", "tool_name"]),

  policies: defineTable({
    id: v.string(),
    workspace_id: v.string(),
    text: v.string(),
    enabled: v.boolean(),
    created_by: v.string(),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_workspace", ["workspace_id"]),

  policy_decisions: defineTable({
    id: v.string(),
    action_id: v.string(),
    policies_evaluated: v.array(v.string()),
    result: policyDecisionValidator,
    explanation: v.string(),
    confidence: v.union(v.number(), v.null()),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_action", ["action_id"]),

  feature_flags: defineTable({
    id: v.string(),
    key: v.string(),
    label: v.string(),
    description: v.string(),
    enabled: v.boolean(),
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_key", ["key"]),

  cron_heartbeats: defineTable({
    id: v.string(),
    job_name: v.string(),
    last_success_at: v.union(v.string(), v.null()),
    last_failure_at: v.union(v.string(), v.null()),
    last_error: v.union(v.string(), v.null()),
    consecutive_failures: v.number(),
    lock_owner: v.optional(v.union(v.string(), v.null())),
    lock_expires_at: v.optional(v.union(v.string(), v.null())),
    updated_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_job", ["job_name"]),

  dead_letter_queue: defineTable({
    id: v.string(),
    source_table: deadLetterSourceTableValidator,
    source_id: v.string(),
    failure_reason: v.string(),
    error_code: v.optional(v.union(deadLetterErrorCodeValidator, v.null())),
    payload: jsonRecordValidator,
    retry_count: v.number(),
    max_retries: v.number(),
    last_attempt_at: v.string(),
    status: deadLetterStatusValidator,
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_status", ["status"])
    .index("by_status_created", ["status", "created_at"])
    .index("by_source", ["source_table", "source_id"]),

  dogfood_orgs: defineTable({
    id: v.string(),
    org_id: v.string(),
    added_by: v.string(),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_org", ["org_id"]),

  provider_metrics: defineTable({
    id: v.string(),
    org_id: v.string(),
    metric: providerMetricNameValidator,
    provider: v.union(providerValidator, v.null()),
    provider_input: v.union(v.string(), v.null()),
    route: v.union(v.string(), v.null()),
    outcome: v.union(providerMetricOutcomeValidator, v.null()),
    reason_code: v.union(v.string(), v.null()),
    value: v.number(),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_created", ["created_at"])
    .index("by_metric_created", ["metric", "created_at"])
    .index("by_metric_provider_created", ["metric", "provider", "created_at"])
    .index("by_org_created", ["org_id", "created_at"]),

  audit_events: defineTable({
    id: v.string(),
    org_id: v.string(),
    action_id: v.optional(v.string()),
    actor_type: auditActorTypeValidator,
    actor_id: v.string(),
    event_type: auditEventTypeValidator,
    payload: jsonRecordValidator,
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_org", ["org_id"])
    .index("by_org_created", ["org_id", "created_at"])
    .index("by_org_action_created", ["org_id", "action_id", "created_at"])
    .index("by_event_type_created", ["event_type", "created_at"])
    .index("by_org_event_type_created", ["org_id", "event_type", "created_at"]),

  notification_endpoints: defineTable({
    id: v.string(),
    org_id: v.string(),
    user_id: v.string(),
    type: notificationEndpointTypeValidator,
    destination: v.string(),
    push_subscription: v.union(v.string(), v.null()),
    notification_preferences: v.optional(v.string()),
    enabled: v.boolean(),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_user", ["user_id"])
    .index("by_org", ["org_id"])
    .index("by_org_type", ["org_id", "type"])
    .index("by_org_type_destination", ["org_id", "type", "destination"])
    .index("by_org_user_created", ["org_id", "user_id", "created_at"])
    .index("by_org_user_type", ["org_id", "user_id", "type"]),

  notification_events: defineTable({
    id: v.string(),
    org_id: v.string(),
    event_type: notificationEventTypeValidator,
    channel: notificationChannelValidator,
    title: v.string(),
    body: v.string(),
    cta_url: v.string(),
    cta_label: v.string(),
    metadata: v.optional(v.string()),
    action_id: v.union(v.string(), v.null()),
    endpoint_id: v.union(v.string(), v.null()),
    read_at: v.union(v.string(), v.null()),
    status: notificationDeliveryStatusValidator,
    attempts: v.number(),
    last_error: v.union(v.string(), v.null()),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_action", ["action_id"])
    .index("by_endpoint", ["endpoint_id"])
    .index("by_endpoint_created", ["endpoint_id", "created_at"])
    .index("by_org_unread", ["org_id", "read_at"])
    .index("by_org_created", ["org_id", "created_at"])
    .index("by_org_channel_created", ["org_id", "channel", "created_at"])
    .index("by_org_channel_read", ["org_id", "channel", "read_at"])
    .index("by_status_created", ["status", "created_at"]),

  sensitive_blobs: defineTable({
    id: v.string(),
    org_id: v.string(),
    ref_table: v.string(),
    ref_id: v.string(),
    ref_field: v.string(),
    blob_enc: v.string(),
    key_version: v.string(),
    expires_at: v.union(v.string(), v.null()),
    purged_at: v.union(v.string(), v.null()),
    created_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_org", ["org_id"])
    .index("by_ref_table_ref_id", ["ref_table", "ref_id"])
    .index("by_expires", ["expires_at"]),

  retention_policies: defineTable({
    id: v.string(),
    org_id: v.string(),
    raw_tool_io_retention_days: v.union(v.number(), v.null()),
    action_payload_retention_days: v.number(),
    audit_retention_days: v.union(v.number(), v.null()),
    updated_by: v.string(),
    updated_at: v.string(),
  })
    .index("by_custom_id", ["id"])
    .index("by_org", ["org_id"]),

  poll_trackers: defineTable({
    action_id: v.string(),
    credential_id: v.string(),
    consecutive_pending_count: v.number(),
    last_polled_at: v.string(),
  }).index("by_action_credential", ["action_id", "credential_id"]),
});
