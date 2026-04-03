import { parse } from "cel-js";
import { v } from "convex/values";
import { nowIso } from "./_auth";
import { mutation, query } from "./_generated/server";
import { encryptSecretValue } from "./crypto_helpers";
import {
  ACTION_STATUS,
  APPROVAL_DECISION,
  AUDIT_EVENT_TYPES,
  APPROVAL_DECIDER_TYPE,
  DEFAULT_ACTION_BEHAVIOR,
  E2E_ACTION_TRIGGER_STATUS,
  RULE_EFFECT,
  TOOL_CALL_STATUS,
} from "./domain_constants";
import {
  classifyAction,
  evaluateCel,
  insertAudit,
  type RiskLevel,
  requireE2EIdentity,
} from "./e2e_shared";
import {
  actionRiskValidator,
  actionStatusValidator,
  e2eActionTriggerStatusValidator,
  jsonRecordValidator,
  ruleEffectValidator,
} from "./validators";

const E2E_ORG_ID = "org_e2e";

export const createCelRule = mutation({
  args: {
    workspaceId: v.string(),
    name: v.string(),
    expression: v.string(),
    effect: ruleEffectValidator,
    enabled: v.boolean(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const parsed = parse(args.expression);
    if (!parsed.isSuccess) {
      throw new Error(parsed.errors?.[0] ?? "Invalid CEL expression");
    }

    const id = `cel_${Math.random().toString(16).slice(2, 12)}`;
    await ctx.db.insert("cel_rules", {
      id,
      workspace_id: args.workspaceId,
      name: args.name,
      description: "",
      expression: args.expression,
      effect: args.effect,
      enabled: args.enabled,
      created_by: "usr_e2e",
      created_at: nowIso(),
    });

    return id;
  },
});

export const triggerWriteAction = mutation({
  args: {
    workspaceId: v.string(),
    toolName: v.string(),
    payloadPreview: jsonRecordValidator,
    actionType: v.optional(v.string()),
    riskLevel: v.optional(actionRiskValidator),
  },
  returns: v.object({
    actionId: v.string(),
    status: e2eActionTriggerStatusValidator,
  }),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", args.workspaceId))
      .first();
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    const inferred = classifyAction(args.toolName);
    const actionId = `act_${Math.random().toString(16).slice(2, 12)}`;
    const runId = `run_${Math.random().toString(16).slice(2, 12)}`;
    const createdAt = nowIso();
    const normalizedPayloadEnc = await encryptSecretValue(
      JSON.stringify({
        input: args.payloadPreview,
        remote_tool_name: args.toolName,
      }),
      "sensitive_blob",
    );

    await ctx.db.insert("automation_runs", {
      id: runId,
      workspace_id: args.workspaceId,
      mcp_session_id: null,
      client_type: "chatgpt",
      metadata: {
        source: "e2e_actions",
        action_id: actionId,
        last_activity_at: createdAt,
      },
      started_at: createdAt,
      ended_at: null,
      status: "active",
    });

    await ctx.db.insert("actions", {
      id: actionId,
      workspace_id: args.workspaceId,
      automation_run_id: runId,
      tool_call_id: "tcall_e2e",
      action_type: args.actionType ?? inferred.actionType,
      risk_level: (args.riskLevel ?? inferred.riskLevel) as RiskLevel,
      normalized_payload_enc: normalizedPayloadEnc,
      payload_preview: args.payloadPreview,
      payload_purged_at: null,
      status: ACTION_STATUS.pending,
      idempotency_key: `idem_${actionId}`,
      created_at: createdAt,
      resolved_at: null,
      result_redacted: null,
    });

    await insertAudit(
      ctx,
      workspace.org_id,
      "automation",
      "run_e2e",
      AUDIT_EVENT_TYPES.actionCreated,
      {
        action_id: actionId,
        tool_name: args.toolName,
      },
    );

    const context = {
      tool: { name: args.toolName },
      action: { preview: args.payloadPreview },
      workspace: { name: workspace.name, policy_mode: workspace.policy_mode },
      now: nowIso(),
    };

    const rules = await ctx.db
      .query("cel_rules")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .collect();

    const enabledRules = rules.filter((rule) => rule.enabled);

    const denyMatch = enabledRules.find(
      (rule) => rule.effect === RULE_EFFECT.deny && evaluateCel(rule.expression, context),
    );
    if (denyMatch) {
      await ctx.db
        .query("actions")
        .withIndex("by_custom_id", (q) => q.eq("id", actionId))
        .first()
        .then(async (row) => {
          if (row) {
            await ctx.db.patch(row._id, {
              status: ACTION_STATUS.rejected,
              resolved_at: nowIso(),
            });
          }
        });

      await ctx.db.insert("cel_rule_matches", {
        id: `celm_${Math.random().toString(16).slice(2, 12)}`,
        action_id: actionId,
        cel_rule_id: denyMatch.id,
        effect: RULE_EFFECT.deny,
        expression_snapshot: denyMatch.expression,
        context_snapshot: context,
        created_at: nowIso(),
      });

      await ctx.db.insert("approvals", {
        id: `appr_${Math.random().toString(16).slice(2, 12)}`,
        action_id: actionId,
        decider_type: APPROVAL_DECIDER_TYPE.celRule,
        decision: APPROVAL_DECISION.reject,
        reason: `Matched CEL deny rule: ${denyMatch.name}`,
        rule_id: denyMatch.id,
        confidence: null,
        created_at: nowIso(),
      });

      await insertAudit(
        ctx,
        workspace.org_id,
        "system",
        "gating",
        AUDIT_EVENT_TYPES.actionRejected,
        {
          action_id: actionId,
          reason: "cel_rule_deny",
        },
      );

      return { actionId, status: E2E_ACTION_TRIGGER_STATUS.rejected };
    }

    const autoApproval = await ctx.db
      .query("tool_auto_approvals")
      .withIndex("by_workspace_tool", (q) =>
        q.eq("workspace_id", args.workspaceId).eq("tool_name", args.toolName),
      )
      .first();

    const shouldAutoApprove =
      workspace.default_action_behavior === DEFAULT_ACTION_BEHAVIOR.autoApproveAll ||
      (autoApproval?.enabled ?? false);

    if (shouldAutoApprove) {
      await ctx.db
        .query("actions")
        .withIndex("by_custom_id", (q) => q.eq("id", actionId))
        .first()
        .then(async (row) => {
          if (row) {
            await ctx.db.patch(row._id, {
              status: ACTION_STATUS.succeeded,
              resolved_at: nowIso(),
              result_redacted: { status: "ok" },
            });
          }
        });

      await ctx.db.insert("approvals", {
        id: `appr_${Math.random().toString(16).slice(2, 12)}`,
        action_id: actionId,
        decider_type: APPROVAL_DECIDER_TYPE.toolAutoApprove,
        decision: APPROVAL_DECISION.approve,
        reason: "Auto-approved by workspace configuration",
        rule_id: null,
        confidence: null,
        created_at: nowIso(),
      });

      await insertAudit(
        ctx,
        workspace.org_id,
        "system",
        "gating",
        AUDIT_EVENT_TYPES.actionExecuted,
        {
          action_id: actionId,
          decider_type: APPROVAL_DECIDER_TYPE.toolAutoApprove,
        },
      );

      return { actionId, status: E2E_ACTION_TRIGGER_STATUS.succeeded };
    }

    return { actionId, status: E2E_ACTION_TRIGGER_STATUS.approvalRequired };
  },
});

export const createGroupedPendingActions = mutation({
  args: {
    workspaceId: v.string(),
    toolName: v.string(),
    payloadPreviews: v.array(jsonRecordValidator),
    actionType: v.optional(v.string()),
    riskLevel: v.optional(actionRiskValidator),
  },
  returns: v.object({
    runId: v.string(),
    actionIds: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", args.workspaceId))
      .first();
    if (!workspace) {
      throw new Error("Workspace not found");
    }

    if (args.payloadPreviews.length === 0) {
      throw new Error("At least one payload preview is required");
    }

    const inferred = classifyAction(args.toolName);
    const runId = `run_${Math.random().toString(16).slice(2, 12)}`;
    const createdAt = nowIso();
    const actionIds: string[] = [];

    await ctx.db.insert("automation_runs", {
      id: runId,
      workspace_id: args.workspaceId,
      mcp_session_id: null,
      client_type: "chatgpt",
      metadata: {
        source: "e2e_grouped_actions",
        action_count: args.payloadPreviews.length,
        last_activity_at: createdAt,
      },
      started_at: createdAt,
      ended_at: null,
      status: "active",
    });

    for (const [index, payloadPreview] of args.payloadPreviews.entries()) {
      const actionId = `act_${Math.random().toString(16).slice(2, 12)}`;
      const toolCallId = `tcall_${Math.random().toString(16).slice(2, 12)}`;
      const normalizedPayloadEnc = await encryptSecretValue(
        JSON.stringify(payloadPreview),
        "sensitive_blob",
      );
      actionIds.push(actionId);

      await ctx.db.insert("tool_calls", {
        id: toolCallId,
        automation_run_id: runId,
        tool_name: args.toolName,
        input_redacted: payloadPreview,
        output_redacted: null,
        status: TOOL_CALL_STATUS.approvalRequired,
        raw_input_blob_id: null,
        raw_output_blob_id: null,
        latency_ms: 0,
        created_at: createdAt,
      });

      await ctx.db.insert("actions", {
        id: actionId,
        workspace_id: args.workspaceId,
        automation_run_id: runId,
        tool_call_id: toolCallId,
        action_type: args.actionType ?? inferred.actionType,
        risk_level: (args.riskLevel ?? inferred.riskLevel) as RiskLevel,
        normalized_payload_enc: normalizedPayloadEnc,
        payload_preview: payloadPreview,
        payload_purged_at: null,
        status: ACTION_STATUS.pending,
        idempotency_key: `idem_${actionId}`,
        created_at: createdAt,
        resolved_at: null,
        result_redacted: null,
      });

      await insertAudit(
        ctx,
        workspace.org_id,
        "automation",
        "run_e2e_grouped",
        AUDIT_EVENT_TYPES.actionCreated,
        {
          action_id: actionId,
          automation_run_id: runId,
          tool_name: args.toolName,
          sequence: index,
        },
      );
    }

    return {
      runId,
      actionIds,
    };
  },
});

export const approveAction = mutation({
  args: {
    actionId: v.string(),
    actorId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    status: actionStatusValidator,
    executionCount: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const action = await ctx.db
      .query("actions")
      .withIndex("by_custom_id", (q) => q.eq("id", args.actionId))
      .first();
    if (!action) {
      throw new Error("Action not found");
    }

    if (action.status !== ACTION_STATUS.pending) {
      return {
        status: action.status,
        executionCount: action.status === ACTION_STATUS.succeeded ? 1 : 0,
      };
    }

    await ctx.db.insert("approvals", {
      id: `appr_${Math.random().toString(16).slice(2, 12)}`,
      action_id: args.actionId,
      decider_type: APPROVAL_DECIDER_TYPE.human,
      decision: APPROVAL_DECISION.approve,
      reason: args.reason ?? "",
      rule_id: null,
      confidence: null,
      created_at: nowIso(),
    });

    await ctx.db.patch(action._id, {
      status: ACTION_STATUS.succeeded,
      resolved_at: nowIso(),
      result_redacted: { status: "ok" },
    });

    await insertAudit(ctx, E2E_ORG_ID, "user", args.actorId, AUDIT_EVENT_TYPES.actionExecuted, {
      action_id: args.actionId,
      decider_type: APPROVAL_DECIDER_TYPE.human,
    });

    return { status: ACTION_STATUS.succeeded, executionCount: 1 };
  },
});

export const rejectAction = mutation({
  args: {
    actionId: v.string(),
    actorId: v.string(),
    reason: v.string(),
  },
  returns: v.object({ status: actionStatusValidator }),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const action = await ctx.db
      .query("actions")
      .withIndex("by_custom_id", (q) => q.eq("id", args.actionId))
      .first();
    if (!action) {
      throw new Error("Action not found");
    }

    if (action.status !== ACTION_STATUS.pending) {
      return { status: action.status };
    }

    await ctx.db.insert("approvals", {
      id: `appr_${Math.random().toString(16).slice(2, 12)}`,
      action_id: args.actionId,
      decider_type: APPROVAL_DECIDER_TYPE.human,
      decision: APPROVAL_DECISION.reject,
      reason: args.reason,
      rule_id: null,
      confidence: null,
      created_at: nowIso(),
    });

    await ctx.db.patch(action._id, {
      status: ACTION_STATUS.rejected,
      resolved_at: nowIso(),
      result_redacted: { reason: args.reason },
    });

    await insertAudit(ctx, E2E_ORG_ID, "user", args.actorId, AUDIT_EVENT_TYPES.actionRejected, {
      action_id: args.actionId,
      reason: args.reason,
      decider_type: APPROVAL_DECIDER_TYPE.human,
    });

    return { status: ACTION_STATUS.rejected };
  },
});

export const backdateActionForMaintenance = mutation({
  args: {
    actionId: v.string(),
    minutesAgo: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const action = await ctx.db
      .query("actions")
      .withIndex("by_custom_id", (q) => q.eq("id", args.actionId))
      .first();
    if (!action) {
      throw new Error("Action not found");
    }
    const minutesAgo = Math.max(1, Math.floor(args.minutesAgo));
    await ctx.db.patch(action._id, {
      created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    });
    return null;
  },
});

export const backdateRunActivityForAction = mutation({
  args: {
    actionId: v.string(),
    minutesAgo: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const action = await ctx.db
      .query("actions")
      .withIndex("by_custom_id", (q) => q.eq("id", args.actionId))
      .first();
    if (!action) {
      throw new Error("Action not found");
    }
    const run = await ctx.db
      .query("automation_runs")
      .withIndex("by_custom_id", (q) => q.eq("id", action.automation_run_id))
      .first();
    if (!run) {
      throw new Error("Run not found");
    }
    const minutesAgo = Math.max(1, Math.floor(args.minutesAgo));
    const staleAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    const metadata =
      run.metadata && typeof run.metadata === "object" && !Array.isArray(run.metadata)
        ? ({ ...run.metadata } as Record<string, unknown>)
        : {};
    metadata.last_activity_at = staleAt;
    await ctx.db.patch(run._id, {
      metadata,
      started_at: staleAt,
    });
    return null;
  },
});

export const listPendingActions = query({
  args: { workspaceId: v.string() },
  returns: v.array(
    v.object({
      id: v.string(),
      status: actionStatusValidator,
      payload_preview: jsonRecordValidator,
      created_at: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const runs = await ctx.db
      .query("automation_runs")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .collect();
    const runIds = new Set(runs.map((run) => run.id));
    const rows = await ctx.db
      .query("actions")
      .withIndex("by_status", (q) => q.eq("status", ACTION_STATUS.pending))
      .collect();
    return rows
      .filter((row) => row.id.startsWith("act_") && runIds.has(row.automation_run_id))
      .map((row) => ({
        id: row.id,
        status: row.status,
        payload_preview:
          row.payload_preview &&
          typeof row.payload_preview === "object" &&
          !Array.isArray(row.payload_preview)
            ? (row.payload_preview as Record<string, unknown>)
            : {},
        created_at: row.created_at,
      }));
  },
});

export const getAction = query({
  args: { actionId: v.string() },
  returns: v.object({
    action: v.object({
      id: v.string(),
      status: actionStatusValidator,
      executionCount: v.number(),
      reason: v.optional(v.string()),
    }),
    approvals: v.array(
      v.object({
        deciderType: v.string(),
        decision: v.string(),
        reason: v.string(),
      }),
    ),
    celRuleMatches: v.array(
      v.object({
        effect: ruleEffectValidator,
        expressionSnapshot: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const action = await ctx.db
      .query("actions")
      .withIndex("by_custom_id", (q) => q.eq("id", args.actionId))
      .first();
    if (!action) {
      throw new Error("Action not found");
    }

    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_action", (q) => q.eq("action_id", args.actionId))
      .collect();
    const celRuleMatches = await ctx.db
      .query("cel_rule_matches")
      .withIndex("by_action", (q) => q.eq("action_id", args.actionId))
      .collect();

    return {
      action: {
        id: action.id,
        status: action.status,
        executionCount: action.status === ACTION_STATUS.succeeded ? 1 : 0,
        reason: action.result_redacted?.reason,
      },
      approvals: approvals.map((approval) => ({
        deciderType: approval.decider_type,
        decision: approval.decision,
        reason: approval.reason,
      })),
      celRuleMatches: celRuleMatches.map((match) => ({
        effect: match.effect,
        expressionSnapshot: match.expression_snapshot,
      })),
    };
  },
});

export const listAuditEvents = query({
  args: { workspaceId: v.string() },
  returns: v.array(
    v.object({
      eventType: v.string(),
      payload: jsonRecordValidator,
      createdAt: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", args.workspaceId))
      .first();
    if (!workspace) {
      return [];
    }
    const rows = await ctx.db
      .query("audit_events")
      .withIndex("by_org", (q) => q.eq("org_id", workspace.org_id))
      .collect();

    const events = rows.map((row) => ({
      eventType: row.event_type,
      payload: row.payload,
      createdAt: row.created_at,
    }));

    const runs = await ctx.db
      .query("automation_runs")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .collect();
    const runIds = new Set(runs.map((run) => run.id));
    const actions = await ctx.db.query("actions").collect();

    for (const action of actions) {
      if (!runIds.has(action.automation_run_id)) {
        continue;
      }
      if (action.status === ACTION_STATUS.succeeded) {
        const alreadyPresent = events.some(
          (event) =>
            event.eventType === AUDIT_EVENT_TYPES.actionExecuted &&
            typeof event.payload === "object" &&
            event.payload !== null &&
            !Array.isArray(event.payload) &&
            event.payload.action_id === action.id,
        );
        if (!alreadyPresent) {
          events.push({
            eventType: AUDIT_EVENT_TYPES.actionExecuted,
            payload: { action_id: action.id, source: "e2e_synthesized" },
            createdAt: action.resolved_at ?? action.created_at,
          });
        }
      }
      if (action.status === ACTION_STATUS.rejected) {
        const alreadyPresent = events.some(
          (event) =>
            event.eventType === AUDIT_EVENT_TYPES.actionRejected &&
            typeof event.payload === "object" &&
            event.payload !== null &&
            !Array.isArray(event.payload) &&
            event.payload.action_id === action.id,
        );
        if (!alreadyPresent) {
          events.push({
            eventType: AUDIT_EVENT_TYPES.actionRejected,
            payload: {
              action_id: action.id,
              reason:
                action.result_redacted &&
                typeof action.result_redacted === "object" &&
                !Array.isArray(action.result_redacted)
                  ? (action.result_redacted.reason ?? "rejected")
                  : "rejected",
              source: "e2e_synthesized",
            },
            createdAt: action.resolved_at ?? action.created_at,
          });
        }
      }
    }

    return events;
  },
});
