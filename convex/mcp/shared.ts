import { v } from "convex/values";
import { type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { INTEGRATION_STATUS } from "../domain_constants";
import { createWorkerExecutionError } from "../mcp_runtime_shared";
import { type ProviderId } from "../provider_ids";
import {
  actionRiskValidator,
  actionStatusValidator,
  approvalDeciderValidator,
  clientTypeValidator,
  decisionOutcomeValidator,
  defaultActionBehaviorValidator,
  jsonRecordValidator,
  policyDecisionValidator,
  policyModeValidator,
  providerValidator,
  runStatusValidator,
  toolCallStatusValidator,
  workspaceStatusValidator,
} from "../validators";

export type DbContext = QueryCtx | MutationCtx;

export const createMcpExecutionFailedError = (message: string): Error => {
  return createWorkerExecutionError("execution_failed", message);
};

export const workspaceValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  slug: v.string(),
  name: v.string(),
  status: workspaceStatusValidator,
  policy_mode: policyModeValidator,
  default_action_behavior: defaultActionBehaviorValidator,
  code_mode_enabled: v.boolean(),
  created_at: v.string(),
});

export const runValidator = v.object({
  id: v.string(),
  workspace_id: v.string(),
  mcp_session_id: v.union(v.string(), v.null()),
  client_type: clientTypeValidator,
  metadata: jsonRecordValidator,
  started_at: v.string(),
  ended_at: v.union(v.string(), v.null()),
  status: runStatusValidator,
});

export const actionValidator = v.object({
  id: v.string(),
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
});

export const toolCallValidator = v.object({
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
});

export const decisionInputValidator = v.object({
  outcome: decisionOutcomeValidator,
  decider_type: v.optional(approvalDeciderValidator),
  decision_reason: v.string(),
  matched_rule_id: v.optional(v.string()),
  expression_snapshot: v.optional(v.string()),
  context_snapshot: jsonRecordValidator,
  policy_decision: v.optional(
    v.object({
      result: policyDecisionValidator,
      explanation: v.string(),
      confidence: v.number(),
      policies: v.array(v.string()),
    }),
  ),
});

export const integrationContextValidator = v.object({
  workspace: workspaceValidator,
  provider_enabled: v.boolean(),
  integration_id: v.union(v.string(), v.null()),
  integration_provider: v.union(providerValidator, v.null()),
  scopes: v.array(v.string()),
  access_token: v.union(v.string(), v.null()),
  refresh_token: v.union(v.string(), v.null()),
  access_token_expires_at: v.union(v.string(), v.null()),
  integration_account_id: v.union(v.string(), v.null()),
  external_account_id: v.union(v.string(), v.null()),
  metadata: jsonRecordValidator,
});

export const findOrgIntegrationByProvider = async (
  ctx: DbContext,
  orgId: string,
  provider: ProviderId,
): Promise<Doc<"integrations"> | null> => {
  const integrations = await ctx.db
    .query("integrations")
    .withIndex("by_org_provider", (q) => q.eq("org_id", orgId).eq("provider", provider))
    .collect();
  if (integrations.length === 0) {
    return null;
  }
  const sorted = [...integrations].sort((left, right) =>
    right.created_at.localeCompare(left.created_at),
  );
  const connected = sorted.find(
    (integration) => integration.status === INTEGRATION_STATUS.connected,
  );
  return connected ?? sorted[0] ?? null;
};
