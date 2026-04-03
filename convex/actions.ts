import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { nowIso, randomIdFor, requireWorkspaceRole } from "./_auth";
import { auditActionIdField, extractAuditActionId } from "./audit_shared";
import { decryptSecretValue, encryptSecretValue } from "./crypto_helpers";
import {
  ACTION_STATUS,
  APPROVAL_DECISION,
  APPROVAL_DECIDER_TYPE,
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  CLIENT_TYPE,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_EVENT_ID,
  RUN_STATUS,
  TOOL_CALL_STATUS,
  USER_ROLE,
  type ActionRiskLevel,
  type ActionStatus,
  type AuditActorType,
  type ApprovalDeciderType,
  type ApprovalDecision,
  type AuditEventType,
  type PolicyDecisionResult,
  type RuleEffect,
} from "./domain_constants";
import { pickFields } from "./field_mapper";
import {
  actionStatusValidator,
  actionRiskValidator,
  approvalDeciderValidator,
  approvalDecisionValidator,
  auditEventTypeValidator,
  jsonRecordValidator,
  policyDecisionValidator as policyDecisionResultValidator,
  ruleEffectValidator,
} from "./validators";

const parseJsonRecord = (encoded: string): Record<string, unknown> | null => {
  try {
    const parsed: unknown = JSON.parse(encoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const decodeNormalizedPayload = async (
  encoded: string,
): Promise<{ raw: string | null; payload: Record<string, unknown> | null }> => {
  try {
    const raw = await decryptSecretValue(encoded, "sensitive_blob");
    return {
      raw,
      payload: parseJsonRecord(raw),
    };
  } catch {
    return {
      raw: null,
      payload: null,
    };
  }
};

const refs = {
  scheduleApprovedAction: makeFunctionReference<"mutation">("mcp_dispatch:scheduleApprovedAction"),
  emitNotificationForOrg: makeFunctionReference<"mutation">("notifications:emitNotificationForOrg"),
};

const APPROVER_ROLES = [USER_ROLE.owner, USER_ROLE.admin, USER_ROLE.approver] as const;
const ACTION_TIMELINE_LIMIT = 50;
const ACTION_TIMELINE_SCAN_LIMIT = 300;
const WORKSPACE_ACTION_LIST_LIMIT = 200;

const dismissApprovalNotifications = async (ctx: MutationCtx, actionId: string) => {
  const events = await ctx.db
    .query("notification_events")
    .withIndex("by_action", (q) => q.eq("action_id", actionId))
    .collect();
  const stamp = nowIso();
  for (const event of events) {
    if (
      event.event_type === NOTIFICATION_EVENT_ID.approvalNeeded &&
      event.channel === NOTIFICATION_CHANNEL.inApp &&
      event.read_at === null
    ) {
      await ctx.db.patch(event._id, { read_at: stamp });
    }
  }
};

const actionValidator = v.object({
  id: v.string(),
  automation_run_id: v.string(),
  automation_name: v.union(v.string(), v.null()),
  automation_run_started_at: v.union(v.string(), v.null()),
  action_type: v.string(),
  risk_level: actionRiskValidator,
  status: actionStatusValidator,
  payload_preview: jsonRecordValidator,
  result_redacted: v.union(jsonRecordValidator, v.null()),
  idempotency_key: v.string(),
  created_at: v.string(),
  resolved_at: v.union(v.string(), v.null()),
});

const approvalValidator = v.object({
  id: v.string(),
  action_id: v.string(),
  decider_type: approvalDeciderValidator,
  decision: approvalDecisionValidator,
  reason: v.string(),
  rule_id: v.union(v.string(), v.null()),
  confidence: v.union(v.number(), v.null()),
  created_at: v.string(),
});

const celRuleMatchValidator = v.object({
  id: v.string(),
  action_id: v.string(),
  cel_rule_id: v.string(),
  effect: ruleEffectValidator,
  expression_snapshot: v.string(),
  context_snapshot: jsonRecordValidator,
  created_at: v.string(),
});

const policyDecisionRowValidator = v.object({
  id: v.string(),
  action_id: v.string(),
  policies_evaluated: v.array(v.string()),
  result: policyDecisionResultValidator,
  explanation: v.string(),
  confidence: v.union(v.number(), v.null()),
  created_at: v.string(),
});

const auditEventValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  actor_type: v.string(),
  actor_id: v.string(),
  event_type: auditEventTypeValidator,
  payload: jsonRecordValidator,
  created_at: v.string(),
});

type ActionView = {
  id: string;
  automation_run_id: string;
  automation_name: string | null;
  automation_run_started_at: string | null;
  action_type: string;
  risk_level: ActionRiskLevel;
  status: ActionStatus;
  payload_preview: Record<string, unknown>;
  result_redacted: Record<string, unknown> | null;
  idempotency_key: string;
  created_at: string;
  resolved_at: string | null;
};

type ApprovalView = {
  id: string;
  action_id: string;
  decider_type: ApprovalDeciderType;
  decision: ApprovalDecision;
  reason: string;
  rule_id: string | null;
  confidence: number | null;
  created_at: string;
};

type CelRuleMatchView = {
  id: string;
  action_id: string;
  cel_rule_id: string;
  effect: RuleEffect;
  expression_snapshot: string;
  context_snapshot: Record<string, unknown>;
  created_at: string;
};

type PolicyDecisionView = {
  id: string;
  action_id: string;
  policies_evaluated: string[];
  result: PolicyDecisionResult;
  explanation: string;
  confidence: number | null;
  created_at: string;
};

type AuditEventView = {
  id: string;
  org_id: string;
  actor_type: AuditActorType;
  actor_id: string;
  event_type: AuditEventType;
  payload: Record<string, unknown>;
  created_at: string;
};

const actionViewFields = [
  "id",
  "automation_run_id",
  "automation_name",
  "automation_run_started_at",
  "action_type",
  "risk_level",
  "status",
  "payload_preview",
  "result_redacted",
  "idempotency_key",
  "created_at",
  "resolved_at",
] as const satisfies readonly (keyof ActionView)[];

const approvalViewFields = [
  "id",
  "action_id",
  "decider_type",
  "decision",
  "reason",
  "rule_id",
  "confidence",
  "created_at",
] as const satisfies readonly (keyof ApprovalView)[];

const celRuleMatchViewFields = [
  "id",
  "action_id",
  "cel_rule_id",
  "effect",
  "expression_snapshot",
  "context_snapshot",
  "created_at",
] as const satisfies readonly (keyof CelRuleMatchView)[];

const policyDecisionViewFields = [
  "id",
  "action_id",
  "policies_evaluated",
  "result",
  "explanation",
  "confidence",
  "created_at",
] as const satisfies readonly (keyof PolicyDecisionView)[];

const auditEventViewFields = [
  "id",
  "org_id",
  "actor_type",
  "actor_id",
  "event_type",
  "payload",
  "created_at",
] as const satisfies readonly (keyof AuditEventView)[];

const toAction = (action: ActionView) => pickFields(action, actionViewFields);

const toApproval = (approval: ApprovalView) => pickFields(approval, approvalViewFields);

const toCelRuleMatch = (match: CelRuleMatchView) => pickFields(match, celRuleMatchViewFields);

const toPolicyDecision = (decision: PolicyDecisionView) =>
  pickFields(decision, policyDecisionViewFields);

const toAuditEvent = (event: AuditEventView) => pickFields(event, auditEventViewFields);

const toActionView = (
  action: {
    id: string;
    automation_run_id: string;
    action_type: string;
    risk_level: ActionRiskLevel;
    status: ActionStatus;
    payload_preview: Record<string, unknown>;
    result_redacted: Record<string, unknown> | null;
    idempotency_key: string;
    created_at: string;
    resolved_at: string | null;
  },
  runContext?: {
    automation_name: string | null;
    automation_run_started_at: string | null;
  },
): ActionView => ({
  id: action.id,
  automation_run_id: action.automation_run_id,
  automation_name: runContext?.automation_name ?? null,
  automation_run_started_at: runContext?.automation_run_started_at ?? null,
  action_type: action.action_type,
  risk_level: action.risk_level,
  status: action.status,
  payload_preview: action.payload_preview,
  result_redacted: action.result_redacted,
  idempotency_key: action.idempotency_key,
  created_at: action.created_at,
  resolved_at: action.resolved_at,
});

const insertAuditEvent = async (
  ctx: MutationCtx,
  orgId: string,
  actorType: AuditActorType,
  actorId: string,
  eventType: AuditEventType,
  payload: Record<string, unknown>,
): Promise<void> => {
  await ctx.db.insert("audit_events", {
    id: randomIdFor("audit"),
    org_id: orgId,
    ...auditActionIdField(payload),
    actor_type: actorType,
    actor_id: actorId,
    event_type: eventType,
    payload,
    created_at: nowIso(),
  });
};

const classifyAction = (toolName: string): { actionType: string; riskLevel: ActionRiskLevel } => {
  if (toolName.includes("refund")) {
    return { actionType: "refund", riskLevel: "high" };
  }
  if (toolName.includes("send") || toolName.includes("post") || toolName.includes("reply")) {
    return { actionType: "send_email", riskLevel: "medium" };
  }
  return { actionType: "write", riskLevel: "low" };
};

const resolveWorkspaceForAction = async (ctx: QueryCtx | MutationCtx, actionId: string) => {
  const action = await ctx.db
    .query("actions")
    .withIndex("by_custom_id", (q) => q.eq("id", actionId))
    .unique();
  if (!action) {
    return null;
  }

  const run = await ctx.db
    .query("automation_runs")
    .withIndex("by_custom_id", (q) => q.eq("id", action.automation_run_id))
    .unique();
  const workspaceId = action.workspace_id ?? run?.workspace_id ?? null;
  if (!workspaceId) {
    return null;
  }

  const workspace = await ctx.db
    .query("workspaces")
    .withIndex("by_custom_id", (q) => q.eq("id", workspaceId))
    .unique();

  if (!workspace) {
    return null;
  }

  return { action, run, workspace };
};

const listActionTimeline = async (
  ctx: QueryCtx,
  orgId: string,
  actionId: string,
): Promise<AuditEventView[]> => {
  const indexedRows = await ctx.db
    .query("audit_events")
    .withIndex("by_org_action_created", (q) => q.eq("org_id", orgId).eq("action_id", actionId))
    .order("desc")
    .take(ACTION_TIMELINE_LIMIT);

  const seen = new Set(indexedRows.map((event) => event.id));
  if (indexedRows.length >= ACTION_TIMELINE_LIMIT) {
    return indexedRows.map((event) => ({
      id: event.id,
      org_id: event.org_id,
      actor_type: event.actor_type as AuditActorType,
      actor_id: event.actor_id,
      event_type: event.event_type as AuditEventType,
      payload: event.payload,
      created_at: event.created_at,
    }));
  }

  const legacyRows = await ctx.db
    .query("audit_events")
    .withIndex("by_org_created", (q) => q.eq("org_id", orgId))
    .order("desc")
    .take(ACTION_TIMELINE_SCAN_LIMIT);

  return [...indexedRows, ...legacyRows.filter((event) => !seen.has(event.id))]
    .filter((event) => extractAuditActionId(event.payload) === actionId)
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, ACTION_TIMELINE_LIMIT)
    .map((event) => ({
      id: event.id,
      org_id: event.org_id,
      actor_type: event.actor_type as AuditActorType,
      actor_id: event.actor_id,
      event_type: event.event_type as AuditEventType,
      payload: event.payload,
      created_at: event.created_at,
    }));
};

const listWorkspaceActions = async (
  ctx: QueryCtx,
  workspaceId: string,
  status?: ActionStatus,
): Promise<
  Array<{
    id: string;
    automation_run_id: string;
    automation_name: string | null;
    automation_run_started_at: string | null;
    action_type: string;
    risk_level: ActionRiskLevel;
    status: ActionStatus;
    payload_preview: Record<string, unknown>;
    result_redacted: Record<string, unknown> | null;
    idempotency_key: string;
    created_at: string;
    resolved_at: string | null;
  }>
> => {
  const rows = status
    ? await ctx.db
        .query("actions")
        .withIndex("by_workspace_status_created", (q) =>
          q.eq("workspace_id", workspaceId).eq("status", status),
        )
        .order("desc")
        .take(WORKSPACE_ACTION_LIST_LIMIT)
    : await ctx.db
        .query("actions")
        .withIndex("by_workspace_created", (q) => q.eq("workspace_id", workspaceId))
        .order("desc")
        .take(WORKSPACE_ACTION_LIST_LIMIT);

  const uniqueRunIds = [...new Set(rows.map((row) => row.automation_run_id))];
  const runs = await Promise.all(
    uniqueRunIds.map(async (runId) => {
      const run = await ctx.db
        .query("automation_runs")
        .withIndex("by_custom_id", (q) => q.eq("id", runId))
        .unique();
      return [runId, run] as const;
    }),
  );
  const uniqueAutomationIds = [
    ...new Set(
      runs
        .map(([, run]) => run?.automation_id)
        .filter((automationId): automationId is string => typeof automationId === "string"),
    ),
  ];
  const automations = await Promise.all(
    uniqueAutomationIds.map(async (automationId) => {
      const automation = await ctx.db
        .query("automations")
        .withIndex("by_custom_id", (q) => q.eq("id", automationId))
        .unique();
      return [automationId, automation] as const;
    }),
  );
  const automationNameById = new Map(
    automations.map(([automationId, automation]) => [
      automationId,
      automation?.name?.trim() ? automation.name.trim() : null,
    ]),
  );
  const runContextByRunId = new Map(
    runs.map(([runId, run]) => [
      runId,
      {
        automation_name:
          run?.automation_id && automationNameById.has(run.automation_id)
            ? (automationNameById.get(run.automation_id) ?? null)
            : null,
        automation_run_started_at: run?.started_at ?? null,
      },
    ]),
  );

  return rows.map((row) =>
    toAction(toActionView(row, runContextByRunId.get(row.automation_run_id))),
  );
};

export const listByWorkspace = query({
  args: {
    workspaceId: v.string(),
    status: v.optional(actionStatusValidator),
  },
  returns: v.array(actionValidator),
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId);
    return await listWorkspaceActions(ctx, args.workspaceId, args.status);
  },
});

export const listPendingByWorkspace = query({
  args: { workspaceId: v.string() },
  returns: v.array(actionValidator),
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId);
    return await listWorkspaceActions(ctx, args.workspaceId, ACTION_STATUS.pending);
  },
});

const PENDING_APPROVAL_BADGE_SCAN_LIMIT = 100;

export const countPendingByWorkspace = query({
  args: { workspaceId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId);
    const rows = await ctx.db
      .query("actions")
      .withIndex("by_workspace_status_created", (q) =>
        q.eq("workspace_id", args.workspaceId).eq("status", ACTION_STATUS.pending),
      )
      .take(PENDING_APPROVAL_BADGE_SCAN_LIMIT);
    return rows.length;
  },
});

export const getActionDetail = query({
  args: { actionId: v.string() },
  returns: v.union(
    v.object({
      action: actionValidator,
      normalized_payload: v.union(jsonRecordValidator, v.null()),
      approvals: v.array(approvalValidator),
      cel_rule_matches: v.array(celRuleMatchValidator),
      policy_decisions: v.array(policyDecisionRowValidator),
      timeline: v.array(auditEventValidator),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const resolved = await resolveWorkspaceForAction(ctx, args.actionId);
    if (!resolved) {
      return null;
    }

    await requireWorkspaceRole(ctx, resolved.workspace.id);

    const decodedPayload = await decodeNormalizedPayload(resolved.action.normalized_payload_enc);
    const normalizedPayload = decodedPayload.payload;
    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_action", (q) => q.eq("action_id", args.actionId))
      .collect();

    const celRuleMatches = await ctx.db
      .query("cel_rule_matches")
      .withIndex("by_action", (q) => q.eq("action_id", args.actionId))
      .collect();

    const policyDecisions = await ctx.db
      .query("policy_decisions")
      .withIndex("by_action", (q) => q.eq("action_id", args.actionId))
      .collect();

    const timeline = await listActionTimeline(ctx, resolved.workspace.org_id, args.actionId);
    const automationId = resolved.run?.automation_id ?? null;
    const automation = automationId
      ? await ctx.db
          .query("automations")
          .withIndex("by_custom_id", (q) => q.eq("id", automationId))
          .unique()
      : null;

    return {
      action: toAction(
        toActionView(resolved.action, {
          automation_name: automation?.name?.trim() ? automation.name.trim() : null,
          automation_run_started_at: resolved.run?.started_at ?? null,
        }),
      ),
      normalized_payload: normalizedPayload,
      approvals: approvals.map(toApproval),
      cel_rule_matches: celRuleMatches.map(toCelRuleMatch),
      policy_decisions: policyDecisions.map(toPolicyDecision),
      timeline: timeline.map(toAuditEvent),
    };
  },
});

export const approveAction = mutation({
  args: {
    actionId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const resolved = await resolveWorkspaceForAction(ctx, args.actionId);
    if (!resolved) {
      throw new Error("Action not found");
    }

    const auth = await requireWorkspaceRole(ctx, resolved.workspace.id, [...APPROVER_ROLES]);

    if (resolved.action.status !== ACTION_STATUS.pending) {
      throw new Error("Action is not pending");
    }

    await ctx.db.patch(resolved.action._id, {
      status: ACTION_STATUS.approved,
      resolved_at: nowIso(),
    });
    await dismissApprovalNotifications(ctx, args.actionId);

    await ctx.db.insert("approvals", {
      id: randomIdFor("appr"),
      action_id: args.actionId,
      decider_type: APPROVAL_DECIDER_TYPE.human,
      decision: APPROVAL_DECISION.approve,
      reason: args.reason ?? "Approved from dashboard",
      rule_id: null,
      confidence: null,
      created_at: nowIso(),
    });

    await insertAuditEvent(
      ctx,
      resolved.workspace.org_id,
      AUDIT_ACTOR_TYPE.user,
      auth.userId,
      AUDIT_EVENT_TYPES.actionApproved,
      {
        action_id: args.actionId,
        reason: args.reason ?? "Approved from dashboard",
      },
    );
    await insertAuditEvent(
      ctx,
      resolved.workspace.org_id,
      AUDIT_ACTOR_TYPE.user,
      "human",
      AUDIT_EVENT_TYPES.approvalRecorded,
      {
        action_id: args.actionId,
        decider_type: APPROVAL_DECIDER_TYPE.human,
        decision: APPROVAL_DECISION.approve,
        reason: args.reason ?? "Approved from dashboard",
        rule_id: null,
        confidence: null,
      },
    );
    await insertAuditEvent(
      ctx,
      resolved.workspace.org_id,
      AUDIT_ACTOR_TYPE.user,
      auth.userId,
      AUDIT_EVENT_TYPES.secretsUnwrapAttempt,
      {
        action_id: args.actionId,
        purpose: "action_payload",
        result: "success",
      },
    );

    try {
      await ctx.scheduler.runAfter(0, refs.scheduleApprovedAction, {
        actionId: args.actionId,
        source: "approval_transition_human",
      });
    } catch (error) {
      await insertAuditEvent(
        ctx,
        resolved.workspace.org_id,
        AUDIT_ACTOR_TYPE.system,
        "queue_dispatch",
        AUDIT_EVENT_TYPES.queueDispatchScheduleFailed,
        {
          action_id: args.actionId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }

    return null;
  },
});

export const rejectAction = mutation({
  args: {
    actionId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const resolved = await resolveWorkspaceForAction(ctx, args.actionId);
    if (!resolved) {
      throw new Error("Action not found");
    }

    const auth = await requireWorkspaceRole(ctx, resolved.workspace.id, [...APPROVER_ROLES]);

    if (resolved.action.status !== ACTION_STATUS.pending) {
      throw new Error("Action is not pending");
    }

    await ctx.db.patch(resolved.action._id, {
      status: ACTION_STATUS.rejected,
      resolved_at: nowIso(),
    });
    await dismissApprovalNotifications(ctx, args.actionId);

    await ctx.db.insert("approvals", {
      id: randomIdFor("appr"),
      action_id: args.actionId,
      decider_type: APPROVAL_DECIDER_TYPE.human,
      decision: APPROVAL_DECISION.reject,
      reason: args.reason ?? "Rejected from dashboard",
      rule_id: null,
      confidence: null,
      created_at: nowIso(),
    });

    await insertAuditEvent(
      ctx,
      resolved.workspace.org_id,
      AUDIT_ACTOR_TYPE.user,
      auth.userId,
      AUDIT_EVENT_TYPES.actionRejected,
      {
        action_id: args.actionId,
        reason: args.reason ?? "Rejected from dashboard",
      },
    );
    await insertAuditEvent(
      ctx,
      resolved.workspace.org_id,
      AUDIT_ACTOR_TYPE.user,
      "human",
      AUDIT_EVENT_TYPES.approvalRecorded,
      {
        action_id: args.actionId,
        decider_type: APPROVAL_DECIDER_TYPE.human,
        decision: APPROVAL_DECISION.reject,
        reason: args.reason ?? "Rejected from dashboard",
        rule_id: null,
        confidence: null,
      },
    );

    return null;
  },
});

export const hasAnyActionForWorkspace = query({
  args: { workspaceId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    await requireWorkspaceRole(ctx, args.workspaceId);
    const indexed = await ctx.db
      .query("actions")
      .withIndex("by_workspace_created", (q) => q.eq("workspace_id", args.workspaceId))
      .first();
    if (indexed) {
      return true;
    }

    const runs = await ctx.db
      .query("automation_runs")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .take(WORKSPACE_ACTION_LIST_LIMIT);
    for (const run of runs) {
      const action = await ctx.db
        .query("actions")
        .withIndex("by_automation_run", (q) => q.eq("automation_run_id", run.id))
        .first();
      if (action) {
        return true;
      }
    }
    return false;
  },
});

export const createTestAction = mutation({
  args: {
    workspaceId: v.string(),
    tool_name: v.string(),
    input: jsonRecordValidator,
  },
  returns: v.object({
    action_id: v.string(),
    status: v.literal(TOOL_CALL_STATUS.approvalRequired),
  }),
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspaceId, [...APPROVER_ROLES]);
    const now = nowIso();
    const runId = randomIdFor("run");
    const toolCallId = randomIdFor("tcall");
    const actionId = randomIdFor("act");

    await ctx.db.insert("automation_runs", {
      id: runId,
      workspace_id: args.workspaceId,
      mcp_session_id: null,
      client_type: CLIENT_TYPE.chatgpt,
      metadata: {
        source: "dashboard_test_action",
        actor_id: auth.userId,
      },
      started_at: now,
      ended_at: null,
      status: RUN_STATUS.active,
    });

    await ctx.db.insert("tool_calls", {
      id: toolCallId,
      automation_run_id: runId,
      tool_name: args.tool_name,
      input_redacted: args.input,
      output_redacted: null,
      status: TOOL_CALL_STATUS.approvalRequired,
      raw_input_blob_id: null,
      raw_output_blob_id: null,
      latency_ms: 0,
      created_at: now,
    });

    const inferred = classifyAction(args.tool_name);
    const normalizedPayloadEnc = await encryptSecretValue(
      JSON.stringify(args.input),
      "sensitive_blob",
    );

    await ctx.db.insert("actions", {
      id: actionId,
      workspace_id: args.workspaceId,
      automation_run_id: runId,
      tool_call_id: toolCallId,
      action_type: inferred.actionType,
      risk_level: inferred.riskLevel,
      normalized_payload_enc: normalizedPayloadEnc,
      payload_preview: args.input,
      payload_purged_at: null,
      status: ACTION_STATUS.pending,
      idempotency_key: randomIdFor("idem"),
      created_at: now,
      resolved_at: null,
      result_redacted: null,
    });

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: auth.orgId,
      action_id: actionId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: auth.userId,
      event_type: AUDIT_EVENT_TYPES.actionCreated,
      payload: {
        action_id: actionId,
        tool_name: args.tool_name,
      },
      created_at: now,
    });

    await ctx.runMutation(refs.emitNotificationForOrg, {
      orgId: auth.orgId,
      eventType: NOTIFICATION_EVENT_ID.approvalNeeded,
      context: {
        workspaceName: auth.workspace.name,
        toolName: args.tool_name,
        riskLevel: inferred.riskLevel,
      },
      metadata: {
        action_id: actionId,
        workspace_id: args.workspaceId,
        tool_name: args.tool_name,
        risk_level: inferred.riskLevel,
      },
      actionId,
    });

    return { action_id: actionId, status: TOOL_CALL_STATUS.approvalRequired };
  },
});
