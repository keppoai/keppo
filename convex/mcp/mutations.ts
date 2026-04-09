import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { normalizeJsonRecord } from "../mcp_runtime_shared";
import { nowIso, randomIdFor } from "../_auth";
import { encryptSecretValue } from "../crypto_helpers";
import {
  actionRiskValidator,
  actionStatusValidator,
  clientTypeValidator,
  jsonRecordValidator,
  toolCallStatusValidator,
} from "../validators";
import {
  ACTION_STATUS,
  APPROVAL_DECISION,
  APPROVAL_DECIDER_TYPE,
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  DECISION_OUTCOME,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_EVENT_ID,
  RUN_STATUS,
  TOOL_CALL_STATUS,
  assertNever,
  type DecisionOutcome,
} from "../domain_constants";
import { safeRunMutation } from "../safe_convex";
import { toWorkspaceBoundary } from "../workspaces_shared";
import {
  actionValidator,
  createMcpExecutionFailedError,
  decisionInputValidator,
  runValidator,
  toolCallValidator,
  workspaceValidator,
} from "./shared";

const refs = {
  emitNotificationForOrg: makeFunctionReference<"mutation">("notifications:emitNotificationForOrg"),
};

const actionStatusFromOutcome = (outcome: DecisionOutcome) => {
  switch (outcome) {
    case DECISION_OUTCOME.approve:
      return ACTION_STATUS.approved;
    case DECISION_OUTCOME.deny:
      return ACTION_STATUS.rejected;
    case DECISION_OUTCOME.pending:
      return ACTION_STATUS.pending;
    default:
      return assertNever(outcome, "decision outcome");
  }
};

const resolveWorkspaceByRunId = async (
  ctx: MutationCtx,
  runId: string,
): Promise<{
  run: Doc<"automation_runs">;
  workspace: Doc<"workspaces">;
  automationName: string | null;
} | null> => {
  const run = await ctx.db
    .query("automation_runs")
    .withIndex("by_custom_id", (q) => q.eq("id", runId))
    .unique();
  if (!run?.workspace_id) {
    return null;
  }
  const workspaceId = run.workspace_id;
  const workspace = await ctx.db
    .query("workspaces")
    .withIndex("by_custom_id", (q) => q.eq("id", workspaceId))
    .unique();
  if (!workspace) {
    return null;
  }

  const runMetadata = normalizeJsonRecord(run.metadata);
  const metadataAutomationName =
    typeof runMetadata.automation_name === "string" && runMetadata.automation_name.trim()
      ? runMetadata.automation_name.trim()
      : null;

  return {
    run,
    workspace,
    automationName: metadataAutomationName,
  };
};

const toActionBoundary = (action: Doc<"actions">) => {
  return {
    id: action.id,
    automation_run_id: action.automation_run_id,
    tool_call_id: action.tool_call_id,
    action_type: action.action_type,
    risk_level: action.risk_level,
    normalized_payload_enc: action.normalized_payload_enc,
    payload_preview: normalizeJsonRecord(action.payload_preview),
    payload_purged_at: action.payload_purged_at,
    status: action.status,
    idempotency_key: action.idempotency_key,
    created_at: action.created_at,
    resolved_at: action.resolved_at,
    result_redacted: action.result_redacted ? normalizeJsonRecord(action.result_redacted) : null,
  };
};

const findExistingActionByWorkspaceAndIdempotency = async (
  ctx: MutationCtx,
  workspaceId: string,
  idempotencyKey: string,
): Promise<Doc<"actions"> | null> => {
  const candidates = await ctx.db
    .query("actions")
    .withIndex("by_idempotency_key", (q) => q.eq("idempotency_key", idempotencyKey))
    .collect();

  const sortedCandidates = [...candidates].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return sortedCandidates.find((action) => action.workspace_id === workspaceId) ?? null;
};

export const createRun = internalMutation({
  args: {
    workspaceId: v.string(),
    sessionId: v.union(v.string(), v.null()),
    clientType: clientTypeValidator,
    metadata: v.optional(jsonRecordValidator),
  },
  returns: runValidator,
  handler: async (ctx, args) => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", args.workspaceId))
      .unique();
    if (!workspace) {
      throw new Error("WorkspaceNotFound");
    }

    const id = randomIdFor("run");
    const createdAt = nowIso();
    const metadata = {
      ...args.metadata,
      last_activity_at: createdAt,
    };

    await ctx.db.insert("automation_runs", {
      id,
      org_id: workspace.org_id,
      workspace_id: args.workspaceId,
      mcp_session_id: args.sessionId,
      client_type: args.clientType,
      metadata,
      started_at: createdAt,
      ended_at: null,
      status: RUN_STATUS.active,
    });

    return {
      id,
      workspace_id: args.workspaceId,
      mcp_session_id: args.sessionId,
      client_type: args.clientType,
      metadata,
      started_at: createdAt,
      ended_at: null,
      status: RUN_STATUS.active,
    };
  },
});

export const touchRun = internalMutation({
  args: {
    runId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("automation_runs")
      .withIndex("by_custom_id", (q) => q.eq("id", args.runId))
      .unique();
    if (!run || run.status !== RUN_STATUS.active) {
      return false;
    }
    const metadata = {
      ...normalizeJsonRecord(run.metadata),
      last_activity_at: nowIso(),
    };
    await ctx.db.patch(run._id, { metadata });
    return true;
  },
});

export const closeRunBySession = internalMutation({
  args: {
    workspaceId: v.string(),
    sessionId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("automation_runs")
      .withIndex("by_workspace_session_status", (q) =>
        q
          .eq("workspace_id", args.workspaceId)
          .eq("mcp_session_id", args.sessionId)
          .eq("status", RUN_STATUS.active),
      )
      .first();
    if (!run) {
      return false;
    }
    await ctx.db.patch(run._id, {
      status: RUN_STATUS.ended,
      ended_at: nowIso(),
    });
    return true;
  },
});

export const createToolCall = internalMutation({
  args: {
    runId: v.string(),
    toolName: v.string(),
    inputRedacted: jsonRecordValidator,
  },
  returns: toolCallValidator,
  handler: async (ctx, args) => {
    const id = randomIdFor("tcall");
    const createdAt = nowIso();
    await ctx.db.insert("tool_calls", {
      id,
      automation_run_id: args.runId,
      tool_name: args.toolName,
      input_redacted: args.inputRedacted,
      output_redacted: null,
      status: TOOL_CALL_STATUS.received,
      raw_input_blob_id: null,
      raw_output_blob_id: null,
      latency_ms: 0,
      created_at: createdAt,
    });
    return {
      id,
      automation_run_id: args.runId,
      tool_name: args.toolName,
      input_redacted: args.inputRedacted,
      output_redacted: null,
      status: TOOL_CALL_STATUS.received,
      raw_input_blob_id: null,
      raw_output_blob_id: null,
      latency_ms: 0,
      created_at: createdAt,
    };
  },
});

export const updateToolCall = internalMutation({
  args: {
    toolCallId: v.string(),
    status: v.optional(toolCallStatusValidator),
    outputRedacted: v.optional(v.union(jsonRecordValidator, v.null())),
    latencyMs: v.optional(v.number()),
    rawInputBlobId: v.optional(v.union(v.string(), v.null())),
    rawOutputBlobId: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const toolCall = await ctx.db
      .query("tool_calls")
      .withIndex("by_custom_id", (q) => q.eq("id", args.toolCallId))
      .unique();
    if (!toolCall) {
      return null;
    }
    await ctx.db.patch(toolCall._id, {
      ...(args.status !== undefined ? { status: args.status } : {}),
      ...(args.outputRedacted !== undefined ? { output_redacted: args.outputRedacted } : {}),
      ...(args.latencyMs !== undefined ? { latency_ms: args.latencyMs } : {}),
      ...(args.rawInputBlobId !== undefined ? { raw_input_blob_id: args.rawInputBlobId } : {}),
      ...(args.rawOutputBlobId !== undefined ? { raw_output_blob_id: args.rawOutputBlobId } : {}),
    });
    return null;
  },
});

export const createActionFromDecision = internalMutation({
  args: {
    runId: v.string(),
    toolCallId: v.string(),
    toolName: v.string(),
    actionType: v.string(),
    riskLevel: actionRiskValidator,
    normalizedPayload: jsonRecordValidator,
    payloadPreview: jsonRecordValidator,
    idempotencyKey: v.string(),
    decision: decisionInputValidator,
  },
  returns: v.object({
    action: actionValidator,
    workspace: workspaceValidator,
    idempotencyReplayed: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const resolved = await resolveWorkspaceByRunId(ctx, args.runId);
    if (!resolved) {
      throw createMcpExecutionFailedError("Run workspace not found");
    }

    const existing = await findExistingActionByWorkspaceAndIdempotency(
      ctx,
      resolved.workspace.id,
      args.idempotencyKey,
    );
    if (existing) {
      return {
        action: toActionBoundary(existing),
        workspace: toWorkspaceBoundary(resolved.workspace),
        idempotencyReplayed: true,
      };
    }

    const status = actionStatusFromOutcome(args.decision.outcome);
    const normalizedPayloadEnc = await encryptSecretValue(
      JSON.stringify(args.normalizedPayload),
      "sensitive_blob",
    );

    const actionId = randomIdFor("act");
    const createdAt = nowIso();
    await ctx.db.insert("actions", {
      id: actionId,
      workspace_id: resolved.workspace.id,
      automation_run_id: args.runId,
      automation_name: resolved.automationName,
      automation_run_started_at: resolved.run.started_at,
      tool_call_id: args.toolCallId,
      action_type: args.actionType,
      risk_level: args.riskLevel,
      normalized_payload_enc: normalizedPayloadEnc,
      payload_preview: args.payloadPreview,
      payload_purged_at: null,
      status,
      idempotency_key: args.idempotencyKey,
      created_at: createdAt,
      resolved_at: status === ACTION_STATUS.rejected ? createdAt : null,
      result_redacted: null,
    });

    if (args.decision.matched_rule_id) {
      await ctx.db.insert("cel_rule_matches", {
        id: randomIdFor("celm"),
        action_id: actionId,
        cel_rule_id: args.decision.matched_rule_id,
        effect:
          args.decision.outcome === DECISION_OUTCOME.deny
            ? DECISION_OUTCOME.deny
            : DECISION_OUTCOME.approve,
        expression_snapshot: args.decision.expression_snapshot ?? "",
        context_snapshot: args.decision.context_snapshot,
        created_at: createdAt,
      });
    }

    if (args.decision.decider_type && args.decision.decider_type !== APPROVAL_DECIDER_TYPE.human) {
      await ctx.db.insert("approvals", {
        id: randomIdFor("appr"),
        action_id: actionId,
        decider_type: args.decision.decider_type,
        decision:
          args.decision.outcome === DECISION_OUTCOME.deny
            ? APPROVAL_DECISION.reject
            : APPROVAL_DECISION.approve,
        reason: args.decision.decision_reason,
        rule_id: args.decision.matched_rule_id ?? null,
        confidence: args.decision.policy_decision?.confidence ?? null,
        created_at: createdAt,
      });
    }

    if (args.decision.policy_decision) {
      await ctx.db.insert("policy_decisions", {
        id: randomIdFor("pdec"),
        action_id: actionId,
        policies_evaluated: args.decision.policy_decision.policies,
        result: args.decision.policy_decision.result,
        explanation: args.decision.policy_decision.explanation,
        confidence: args.decision.policy_decision.confidence,
        created_at: createdAt,
      });
    }

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: resolved.workspace.org_id,
      action_id: actionId,
      actor_type: AUDIT_ACTOR_TYPE.automation,
      actor_id: args.runId,
      event_type: AUDIT_EVENT_TYPES.actionCreated,
      payload: {
        action_id: actionId,
        tool_name: args.toolName,
        status,
        payload_preview: args.payloadPreview,
      },
      created_at: createdAt,
    });

    if (status === ACTION_STATUS.rejected) {
      await ctx.db.insert("audit_events", {
        id: randomIdFor("audit"),
        org_id: resolved.workspace.org_id,
        action_id: actionId,
        actor_type: AUDIT_ACTOR_TYPE.system,
        actor_id: "gating",
        event_type: AUDIT_EVENT_TYPES.actionRejected,
        payload: {
          action_id: actionId,
          decider_type: args.decision.decider_type ?? APPROVAL_DECIDER_TYPE.human,
          reason: args.decision.decision_reason,
        },
        created_at: createdAt,
      });
    }

    if (status === ACTION_STATUS.pending) {
      await safeRunMutation("mcp.emitNotificationForOrg", () =>
        ctx.runMutation(refs.emitNotificationForOrg, {
          orgId: resolved.workspace.org_id,
          eventType: NOTIFICATION_EVENT_ID.approvalNeeded,
          context: {
            workspaceName: resolved.workspace.name,
            toolName: args.toolName,
            riskLevel: args.riskLevel,
          },
          metadata: {
            action_id: actionId,
            workspace_id: resolved.workspace.id,
            tool_name: args.toolName,
            risk_level: args.riskLevel,
            ...(typeof resolved.run.metadata?.e2e_namespace === "string"
              ? { e2e_namespace: resolved.run.metadata.e2e_namespace }
              : {}),
          },
          actionId,
        }),
      );
    }

    const action = await ctx.db
      .query("actions")
      .withIndex("by_custom_id", (q) => q.eq("id", actionId))
      .unique();
    if (!action) {
      throw createMcpExecutionFailedError("Action not found after insert");
    }

    return {
      action: toActionBoundary(action),
      workspace: toWorkspaceBoundary(resolved.workspace),
      idempotencyReplayed: false,
    };
  },
});

export const setActionStatus = internalMutation({
  args: {
    actionId: v.string(),
    status: actionStatusValidator,
    resultRedacted: v.optional(v.union(jsonRecordValidator, v.null())),
    allowedCurrentStatuses: v.optional(v.array(actionStatusValidator)),
  },
  returns: v.union(actionValidator, v.null()),
  handler: async (ctx, args) => {
    const action = await ctx.db
      .query("actions")
      .withIndex("by_custom_id", (q) => q.eq("id", args.actionId))
      .unique();
    if (!action) {
      return null;
    }

    if (args.allowedCurrentStatuses && !args.allowedCurrentStatuses.includes(action.status)) {
      throw new Error(
        `action_status_transition_conflict: ${action.id} is ${action.status}, not one of ${args.allowedCurrentStatuses.join(",")}`,
      );
    }

    const resolvedAt =
      args.status === ACTION_STATUS.succeeded ||
      args.status === ACTION_STATUS.failed ||
      args.status === ACTION_STATUS.rejected ||
      args.status === ACTION_STATUS.expired
        ? nowIso()
        : action.resolved_at;

    await ctx.db.patch(action._id, {
      status: args.status,
      resolved_at: resolvedAt,
      ...(args.resultRedacted !== undefined ? { result_redacted: args.resultRedacted } : {}),
    });

    if (action.status === ACTION_STATUS.pending && args.status !== ACTION_STATUS.pending) {
      const events = await ctx.db
        .query("notification_events")
        .withIndex("by_action", (q) => q.eq("action_id", args.actionId))
        .collect();
      const stamp = nowIso();
      for (const ev of events) {
        if (
          ev.event_type === NOTIFICATION_EVENT_ID.approvalNeeded &&
          ev.channel === NOTIFICATION_CHANNEL.inApp &&
          ev.read_at === null
        ) {
          await ctx.db.patch(ev._id, { read_at: stamp });
        }
      }
    }

    const updated = await ctx.db
      .query("actions")
      .withIndex("by_custom_id", (q) => q.eq("id", args.actionId))
      .unique();
    if (!updated) {
      return null;
    }

    return {
      id: updated.id,
      automation_run_id: updated.automation_run_id,
      tool_call_id: updated.tool_call_id,
      action_type: updated.action_type,
      risk_level: updated.risk_level,
      normalized_payload_enc: updated.normalized_payload_enc,
      payload_preview: normalizeJsonRecord(updated.payload_preview),
      payload_purged_at: updated.payload_purged_at,
      status: updated.status,
      idempotency_key: updated.idempotency_key,
      created_at: updated.created_at,
      resolved_at: updated.resolved_at,
      result_redacted: updated.result_redacted
        ? normalizeJsonRecord(updated.result_redacted)
        : null,
    };
  },
});

export * from "./mutations_auth";
export * from "./mutations_maintenance";
export * from "./mutations_audit";
export * from "./mutations_integrations";
