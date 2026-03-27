import { evaluate, parse } from "cel-js";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { hasFeatureAccess, nowIso, randomIdFor, requireWorkspaceRole } from "./_auth";
import {
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  USER_ROLE,
  type DefaultActionBehavior,
  type PolicyDecisionResult,
  type PolicyMode,
  type RuleEffect,
  type WorkspaceStatus,
} from "./domain_constants";
import { pickFields } from "./field_mapper";
import {
  defaultActionBehaviorValidator,
  jsonRecordValidator,
  policyDecisionValidator as policyDecisionResultValidator,
  policyModeValidator,
  requireBoundedString,
  requireOptionalBoundedString,
  ruleEffectValidator,
  sanitizePolicyContext,
  workspaceStatusValidator,
} from "./validators";
import { cascadeDeleteCelRuleDescendants } from "./cascade";
import { toWorkspaceBoundary } from "./workspaces_shared";
import { enforceRateLimit } from "./rate_limit_helpers";

const CEL_RULES_DISABLED_ERROR = "CEL rules are not enabled for this organization";
const RULE_MANAGER_ROLES = [USER_ROLE.owner, USER_ROLE.admin] as const;
const RULES_QUERY_SCAN_BUDGET = 100;
const ACTION_SCAN_BUDGET = 100;
const POLICY_DECISION_SCAN_BUDGET = 100;
const RULE_NAME_MAX_LENGTH = 80;
const RULE_DESCRIPTION_MAX_LENGTH = 280;
const POLICY_TEXT_MAX_LENGTH = 8_000;
const TOOL_NAME_MAX_LENGTH = 120;
const CEL_EXPRESSION_MAX_LENGTH = 2_000;
const CEL_COMPLEXITY_BUDGET = 3_000;
const RULE_MUTATION_RATE_LIMIT = {
  limit: 30,
  windowMs: 15 * 60_000,
} as const;
const RULE_TEST_RATE_LIMIT = {
  limit: 60,
  windowMs: 15 * 60_000,
} as const;

const workspaceValidator = v.object({
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

const celRuleValidator = v.object({
  id: v.string(),
  workspace_id: v.string(),
  name: v.string(),
  description: v.string(),
  expression: v.string(),
  effect: ruleEffectValidator,
  enabled: v.boolean(),
  created_by: v.string(),
  created_at: v.string(),
});

const policyValidator = v.object({
  id: v.string(),
  workspace_id: v.string(),
  text: v.string(),
  enabled: v.boolean(),
  created_by: v.string(),
  created_at: v.string(),
});

const autoApprovalValidator = v.object({
  id: v.string(),
  workspace_id: v.string(),
  tool_name: v.string(),
  enabled: v.boolean(),
  created_by: v.string(),
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

type WorkspaceView = {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  status: WorkspaceStatus;
  policy_mode: PolicyMode;
  default_action_behavior: DefaultActionBehavior;
  code_mode_enabled?: boolean;
  created_at: string;
};

type CelRuleView = {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  expression: string;
  effect: RuleEffect;
  enabled: boolean;
  created_by: string;
  created_at: string;
};

type PolicyView = {
  id: string;
  workspace_id: string;
  text: string;
  enabled: boolean;
  created_by: string;
  created_at: string;
};

type AutoApprovalView = {
  id: string;
  workspace_id: string;
  tool_name: string;
  enabled: boolean;
  created_by: string;
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

const workspaceViewFields = [
  "id",
  "org_id",
  "slug",
  "name",
  "status",
  "policy_mode",
  "default_action_behavior",
  "created_at",
] as const satisfies readonly (keyof WorkspaceView)[];

const celRuleViewFields = [
  "id",
  "workspace_id",
  "name",
  "description",
  "expression",
  "effect",
  "enabled",
  "created_by",
  "created_at",
] as const satisfies readonly (keyof CelRuleView)[];

const policyViewFields = [
  "id",
  "workspace_id",
  "text",
  "enabled",
  "created_by",
  "created_at",
] as const satisfies readonly (keyof PolicyView)[];

const autoApprovalViewFields = [
  "id",
  "workspace_id",
  "tool_name",
  "enabled",
  "created_by",
  "created_at",
] as const satisfies readonly (keyof AutoApprovalView)[];

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

const toWorkspace = (workspace: WorkspaceView) => toWorkspaceBoundary(workspace);

const toCelRule = (rule: CelRuleView) => pickFields(rule, celRuleViewFields);

const toPolicy = (policy: PolicyView) => pickFields(policy, policyViewFields);

const toAutoApproval = (row: AutoApprovalView) => pickFields(row, autoApprovalViewFields);

const toMatch = (row: CelRuleMatchView) => pickFields(row, celRuleMatchViewFields);

const toDecision = (row: PolicyDecisionView) => pickFields(row, policyDecisionViewFields);

const normalizeRuleName = (value: string): string =>
  requireBoundedString(value, {
    field: "Rule name",
    maxLength: RULE_NAME_MAX_LENGTH,
  });

const normalizeRuleDescription = (value: string): string =>
  requireBoundedString(value, {
    field: "Rule description",
    maxLength: RULE_DESCRIPTION_MAX_LENGTH,
    minLength: 0,
  });

const normalizeCelExpression = (value: string): string => {
  const normalized = requireBoundedString(value, {
    field: "Rule expression",
    maxLength: CEL_EXPRESSION_MAX_LENGTH,
  });
  const complexity =
    normalized.length +
    (normalized.match(/\b(and|or|in|exists|all|filter|map)\b/giu)?.length ?? 0) * 8 +
    (normalized.match(/[()[\]{}]/g)?.length ?? 0) * 4 +
    (normalized.match(/[<>=!&|+\-*/%]/g)?.length ?? 0);
  if (complexity > CEL_COMPLEXITY_BUDGET) {
    throw new Error("Rule expression is too complex to evaluate safely.");
  }
  return normalized;
};

const normalizePolicyText = (value: string): string =>
  requireBoundedString(value, {
    field: "Policy text",
    maxLength: POLICY_TEXT_MAX_LENGTH,
  });

const normalizeToolName = (value: string): string =>
  requireBoundedString(value, {
    field: "Tool name",
    maxLength: TOOL_NAME_MAX_LENGTH,
  });

const evaluateCel = (expression: string, context: Record<string, unknown>): boolean => {
  const parsed = parse(expression);
  if (!parsed.isSuccess) {
    throw new Error(parsed.errors?.[0] ?? "Invalid CEL expression");
  }
  return Boolean(evaluate(parsed.cst, context));
};

export const getWorkspaceRules = query({
  args: { workspaceId: v.string() },
  returns: v.object({
    workspace: workspaceValidator,
    rules: v.array(celRuleValidator),
    policies: v.array(policyValidator),
    auto_approvals: v.array(autoApprovalValidator),
    matches: v.array(celRuleMatchValidator),
    decisions: v.array(policyDecisionRowValidator),
  }),
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspaceId);
    const celRulesEnabled = await hasFeatureAccess(ctx, auth.orgId, "cel_rules");

    const rules = celRulesEnabled
      ? await ctx.db
          .query("cel_rules")
          .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
          .take(RULES_QUERY_SCAN_BUDGET)
      : [];

    const policies = await ctx.db
      .query("policies")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .take(RULES_QUERY_SCAN_BUDGET);

    const autoApprovals = await ctx.db
      .query("tool_auto_approvals")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .take(RULES_QUERY_SCAN_BUDGET);

    const runs = await ctx.db
      .query("automation_runs")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .take(ACTION_SCAN_BUDGET);

    const runIds = new Set(runs.map((run) => run.id));
    const actions = (
      await Promise.all(
        [...runIds].map((runId) =>
          ctx.db
            .query("actions")
            .withIndex("by_automation_run", (q) => q.eq("automation_run_id", runId))
            .take(ACTION_SCAN_BUDGET),
        ),
      )
    ).flat();
    const actionIds = new Set(actions.map((action) => action.id));

    const matches = celRulesEnabled
      ? (
          await Promise.all(
            [...actionIds].map((actionId) =>
              ctx.db
                .query("cel_rule_matches")
                .withIndex("by_action", (q) => q.eq("action_id", actionId))
                .take(POLICY_DECISION_SCAN_BUDGET),
            ),
          )
        )
          .flat()
          .sort((left, right) => right.created_at.localeCompare(left.created_at))
          .slice(0, 100)
      : [];

    const decisions = (
      await Promise.all(
        [...actionIds].map((actionId) =>
          ctx.db
            .query("policy_decisions")
            .withIndex("by_action", (q) => q.eq("action_id", actionId))
            .take(POLICY_DECISION_SCAN_BUDGET),
        ),
      )
    )
      .flat()
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, 100);

    return {
      workspace: toWorkspace(auth.workspace),
      rules: rules.map(toCelRule),
      policies: policies.map(toPolicy),
      auto_approvals: autoApprovals.map(toAutoApproval),
      matches: matches.map(toMatch),
      decisions: decisions.map(toDecision),
    };
  },
});

export const createCelRule = mutation({
  args: {
    workspaceId: v.string(),
    name: v.string(),
    description: v.string(),
    expression: v.string(),
    effect: ruleEffectValidator,
    enabled: v.boolean(),
  },
  returns: celRuleValidator,
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspaceId, [...RULE_MANAGER_ROLES]);
    if (!(await hasFeatureAccess(ctx, auth.orgId, "cel_rules"))) {
      throw new Error(CEL_RULES_DISABLED_ERROR);
    }
    await enforceRateLimit(ctx, {
      key: `rules:create:${args.workspaceId}`,
      limit: RULE_MUTATION_RATE_LIMIT.limit,
      windowMs: RULE_MUTATION_RATE_LIMIT.windowMs,
      message: "Too many rule changes.",
    });
    const name = normalizeRuleName(args.name);
    const description = normalizeRuleDescription(args.description);
    const expression = normalizeCelExpression(args.expression);

    const parsed = parse(expression);
    if (!parsed.isSuccess) {
      throw new Error(parsed.errors?.[0] ?? "Invalid CEL expression");
    }

    const id = randomIdFor("cel");
    const created = {
      id,
      workspace_id: args.workspaceId,
      name,
      description,
      expression,
      effect: args.effect,
      enabled: args.enabled,
      created_by: auth.userId,
      created_at: nowIso(),
    } as const;

    await ctx.db.insert("cel_rules", created);

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: auth.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: auth.userId,
      event_type: AUDIT_EVENT_TYPES.ruleCreated,
      payload: {
        workspace_id: args.workspaceId,
        rule_id: id,
      },
      created_at: nowIso(),
    });

    return created;
  },
});

export const updateCelRule = mutation({
  args: {
    ruleId: v.string(),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    expression: v.optional(v.string()),
    effect: v.optional(ruleEffectValidator),
    enabled: v.optional(v.boolean()),
  },
  returns: celRuleValidator,
  handler: async (ctx, args) => {
    const rule = await ctx.db
      .query("cel_rules")
      .withIndex("by_custom_id", (q) => q.eq("id", args.ruleId))
      .unique();

    if (!rule) {
      throw new Error("Rule not found");
    }

    const auth = await requireWorkspaceRole(ctx, rule.workspace_id, [...RULE_MANAGER_ROLES]);
    if (!(await hasFeatureAccess(ctx, auth.orgId, "cel_rules"))) {
      throw new Error(CEL_RULES_DISABLED_ERROR);
    }
    await enforceRateLimit(ctx, {
      key: `rules:update:${rule.workspace_id}`,
      limit: RULE_MUTATION_RATE_LIMIT.limit,
      windowMs: RULE_MUTATION_RATE_LIMIT.windowMs,
      message: "Too many rule changes.",
    });

    const name = requireOptionalBoundedString({
      field: "Rule name",
      value: args.name,
      maxLength: RULE_NAME_MAX_LENGTH,
    });
    const description =
      args.description === undefined ? undefined : normalizeRuleDescription(args.description);
    const expression =
      args.expression === undefined ? undefined : normalizeCelExpression(args.expression);

    if (expression) {
      const parsed = parse(expression);
      if (!parsed.isSuccess) {
        throw new Error(parsed.errors?.[0] ?? "Invalid CEL expression");
      }
    }

    await ctx.db.patch(rule._id, {
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(expression !== undefined ? { expression } : {}),
      ...(args.effect !== undefined ? { effect: args.effect } : {}),
      ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
    });

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: auth.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: auth.userId,
      event_type: AUDIT_EVENT_TYPES.ruleUpdated,
      payload: {
        workspace_id: rule.workspace_id,
        rule_id: args.ruleId,
      },
      created_at: nowIso(),
    });

    const updated = await ctx.db
      .query("cel_rules")
      .withIndex("by_custom_id", (q) => q.eq("id", args.ruleId))
      .unique();

    if (!updated) {
      throw new Error("Rule not found");
    }

    return toCelRule(updated);
  },
});

export const deleteCelRule = mutation({
  args: { ruleId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rule = await ctx.db
      .query("cel_rules")
      .withIndex("by_custom_id", (q) => q.eq("id", args.ruleId))
      .unique();

    if (!rule) {
      throw new Error("Rule not found");
    }

    const auth = await requireWorkspaceRole(ctx, rule.workspace_id, [...RULE_MANAGER_ROLES]);
    if (!(await hasFeatureAccess(ctx, auth.orgId, "cel_rules"))) {
      throw new Error(CEL_RULES_DISABLED_ERROR);
    }
    await enforceRateLimit(ctx, {
      key: `rules:delete:${rule.workspace_id}`,
      limit: RULE_MUTATION_RATE_LIMIT.limit,
      windowMs: RULE_MUTATION_RATE_LIMIT.windowMs,
      message: "Too many rule changes.",
    });
    await cascadeDeleteCelRuleDescendants(ctx, args.ruleId);
    await ctx.db.delete(rule._id);

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: auth.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: auth.userId,
      event_type: AUDIT_EVENT_TYPES.ruleDeleted,
      payload: {
        workspace_id: rule.workspace_id,
        rule_id: args.ruleId,
      },
      created_at: nowIso(),
    });

    return null;
  },
});

export const testCelRule = mutation({
  args: {
    workspaceId: v.string(),
    expression: v.string(),
    context: jsonRecordValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspaceId, [...RULE_MANAGER_ROLES]);
    if (!(await hasFeatureAccess(ctx, auth.orgId, "cel_rules"))) {
      throw new Error(CEL_RULES_DISABLED_ERROR);
    }
    await enforceRateLimit(ctx, {
      key: `rules:test:${args.workspaceId}`,
      limit: RULE_TEST_RATE_LIMIT.limit,
      windowMs: RULE_TEST_RATE_LIMIT.windowMs,
      message: "Too many rule test requests.",
    });
    return evaluateCel(
      normalizeCelExpression(args.expression),
      sanitizePolicyContext(args.context),
    );
  },
});

export const createPolicy = mutation({
  args: {
    workspaceId: v.string(),
    text: v.string(),
  },
  returns: policyValidator,
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspaceId, [...RULE_MANAGER_ROLES]);
    await enforceRateLimit(ctx, {
      key: `policy:create:${args.workspaceId}`,
      limit: RULE_MUTATION_RATE_LIMIT.limit,
      windowMs: RULE_MUTATION_RATE_LIMIT.windowMs,
      message: "Too many policy changes.",
    });
    const id = randomIdFor("pol");
    const text = normalizePolicyText(args.text);

    const created = {
      id,
      workspace_id: args.workspaceId,
      text,
      enabled: true,
      created_by: auth.userId,
      created_at: nowIso(),
    } as const;

    await ctx.db.insert("policies", created);

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: auth.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: auth.userId,
      event_type: AUDIT_EVENT_TYPES.policyCreated,
      payload: {
        workspace_id: args.workspaceId,
        policy_id: id,
      },
      created_at: nowIso(),
    });

    return created;
  },
});

export const updatePolicy = mutation({
  args: {
    policyId: v.string(),
    text: v.optional(v.string()),
    enabled: v.optional(v.boolean()),
  },
  returns: policyValidator,
  handler: async (ctx, args) => {
    const policy = await ctx.db
      .query("policies")
      .withIndex("by_custom_id", (q) => q.eq("id", args.policyId))
      .unique();

    if (!policy) {
      throw new Error("Policy not found");
    }

    const auth = await requireWorkspaceRole(ctx, policy.workspace_id, [...RULE_MANAGER_ROLES]);
    await enforceRateLimit(ctx, {
      key: `policy:update:${policy.workspace_id}`,
      limit: RULE_MUTATION_RATE_LIMIT.limit,
      windowMs: RULE_MUTATION_RATE_LIMIT.windowMs,
      message: "Too many policy changes.",
    });
    const text = requireOptionalBoundedString({
      field: "Policy text",
      value: args.text,
      maxLength: POLICY_TEXT_MAX_LENGTH,
    });

    await ctx.db.patch(policy._id, {
      ...(text !== undefined ? { text } : {}),
      ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
    });

    await ctx.db.insert("audit_events", {
      id: randomIdFor("audit"),
      org_id: auth.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: auth.userId,
      event_type: AUDIT_EVENT_TYPES.policyUpdated,
      payload: {
        workspace_id: policy.workspace_id,
        policy_id: args.policyId,
      },
      created_at: nowIso(),
    });

    const updated = await ctx.db
      .query("policies")
      .withIndex("by_custom_id", (q) => q.eq("id", args.policyId))
      .unique();

    if (!updated) {
      throw new Error("Policy not found");
    }

    return toPolicy(updated);
  },
});

export const setAutoApproval = mutation({
  args: {
    workspaceId: v.string(),
    tool_name: v.string(),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspaceId, [...RULE_MANAGER_ROLES]);
    await enforceRateLimit(ctx, {
      key: `auto-approval:${args.workspaceId}`,
      limit: RULE_MUTATION_RATE_LIMIT.limit,
      windowMs: RULE_MUTATION_RATE_LIMIT.windowMs,
      message: "Too many auto-approval changes.",
    });
    const toolName = normalizeToolName(args.tool_name);

    const existing = await ctx.db
      .query("tool_auto_approvals")
      .withIndex("by_workspace_tool", (q) =>
        q.eq("workspace_id", args.workspaceId).eq("tool_name", toolName),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { enabled: args.enabled });
    } else {
      await ctx.db.insert("tool_auto_approvals", {
        id: randomIdFor("taa"),
        workspace_id: args.workspaceId,
        tool_name: toolName,
        enabled: args.enabled,
        created_by: auth.userId,
        created_at: nowIso(),
      });
    }

    return null;
  },
});
