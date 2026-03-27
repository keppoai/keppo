import { ConvexError, v } from "convex/values";
import { nowIso } from "./_auth";
import { mutation } from "./_generated/server";
import {
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  DEFAULT_ACTION_BEHAVIOR,
  POLICY_MODE,
  SUBSCRIPTION_TIER,
  WORKSPACE_STATUS,
  type DefaultActionBehavior,
} from "./domain_constants";
import { requireE2EIdentity } from "./e2e_shared";
import { defaultActionBehaviorValidator, policyModeValidator } from "./validators";
import { getTierConfig } from "../packages/shared/src/subscriptions.js";
import { slugifyWorkspaceName } from "./workspaces_shared";

export const createWorkspace = mutation({
  args: {
    name: v.string(),
    policyMode: v.optional(policyModeValidator),
    defaultActionBehavior: v.optional(defaultActionBehaviorValidator),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const orgId = "org_e2e";
    const workspaceId = `workspace_${Math.random().toString(16).slice(2, 12)}`;

    const retention = await ctx.db
      .query("retention_policies")
      .withIndex("by_org", (q) => q.eq("org_id", orgId))
      .first();
    if (!retention) {
      await ctx.db.insert("retention_policies", {
        id: "ret_e2e",
        org_id: orgId,
        raw_tool_io_retention_days: null,
        action_payload_retention_days: 30,
        audit_retention_days: null,
        updated_by: "system",
        updated_at: nowIso(),
      });
    }

    await ctx.db.insert("workspaces", {
      id: workspaceId,
      org_id: orgId,
      slug: slugifyWorkspaceName(args.name),
      name: args.name,
      status: WORKSPACE_STATUS.active,
      policy_mode: args.policyMode ?? POLICY_MODE.manualOnly,
      default_action_behavior: (args.defaultActionBehavior ??
        DEFAULT_ACTION_BEHAVIOR.requireApproval) as DefaultActionBehavior,
      code_mode_enabled: true,
      created_at: nowIso(),
    });

    return workspaceId;
  },
});

export const createWorkspaceForOrgWithLimitCheck = mutation({
  args: {
    orgId: v.string(),
    name: v.string(),
    policyMode: v.optional(policyModeValidator),
    defaultActionBehavior: v.optional(defaultActionBehaviorValidator),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);

    const workspaceCount = (
      await ctx.db
        .query("workspaces")
        .withIndex("by_org", (q) => q.eq("org_id", args.orgId))
        .collect()
    ).length;
    const latestSubscription = (
      await ctx.db
        .query("subscriptions")
        .withIndex("by_org", (q) => q.eq("org_id", args.orgId))
        .collect()
    ).sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
    const tier = latestSubscription?.tier ?? SUBSCRIPTION_TIER.free;
    const maxWorkspaces = getTierConfig(tier).max_workspaces;

    if (workspaceCount >= maxWorkspaces) {
      throw new ConvexError({
        code: "WORKSPACE_LIMIT_REACHED",
        current_count: workspaceCount,
        max_count: maxWorkspaces,
        tier,
      });
    }

    const workspaceId = `workspace_${Math.random().toString(16).slice(2, 12)}`;
    const createdAt = nowIso();
    await ctx.db.insert("workspaces", {
      id: workspaceId,
      org_id: args.orgId,
      slug: slugifyWorkspaceName(args.name),
      name: args.name,
      status: WORKSPACE_STATUS.active,
      policy_mode: args.policyMode ?? POLICY_MODE.manualOnly,
      default_action_behavior: (args.defaultActionBehavior ??
        DEFAULT_ACTION_BEHAVIOR.requireApproval) as DefaultActionBehavior,
      code_mode_enabled: true,
      created_at: createdAt,
    });
    await ctx.db.insert("audit_events", {
      id: `audit_${Math.random().toString(16).slice(2, 12)}`,
      org_id: args.orgId,
      actor_type: AUDIT_ACTOR_TYPE.user,
      actor_id: "api",
      event_type: AUDIT_EVENT_TYPES.workspaceCreated,
      payload: {
        workspace_id: workspaceId,
        name: args.name,
        source: "e2e_limit_check",
      },
      created_at: createdAt,
    });
    return workspaceId;
  },
});

export const setToolAutoApproval = mutation({
  args: {
    workspaceId: v.string(),
    toolName: v.string(),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const row = await ctx.db
      .query("tool_auto_approvals")
      .withIndex("by_workspace_tool", (q) =>
        q.eq("workspace_id", args.workspaceId).eq("tool_name", args.toolName),
      )
      .first();

    if (!row) {
      await ctx.db.insert("tool_auto_approvals", {
        id: `taa_${Math.random().toString(16).slice(2, 12)}`,
        workspace_id: args.workspaceId,
        tool_name: args.toolName,
        enabled: args.enabled,
        created_by: "usr_e2e",
        created_at: nowIso(),
      });
    } else {
      await ctx.db.patch(row._id, { enabled: args.enabled });
    }

    return null;
  },
});

export const setOrgFeatureAccess = mutation({
  args: {
    orgId: v.string(),
    featureKey: v.string(),
    enabled: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const existingFlag = await ctx.db
      .query("feature_flags")
      .withIndex("by_key", (q) => q.eq("key", args.featureKey))
      .unique();
    const timestamp = nowIso();

    if (existingFlag) {
      await ctx.db.patch(existingFlag._id, {
        enabled: args.enabled,
        updated_at: timestamp,
      });
    } else {
      await ctx.db.insert("feature_flags", {
        id: `flag_${Math.random().toString(16).slice(2, 12)}`,
        key: args.featureKey,
        label: args.featureKey,
        description: `E2E seeded feature flag for ${args.featureKey}`,
        enabled: args.enabled,
        created_at: timestamp,
        updated_at: timestamp,
      });
    }

    const existingDogfoodOrg = await ctx.db
      .query("dogfood_orgs")
      .withIndex("by_org", (q) => q.eq("org_id", args.orgId))
      .unique();

    if (args.enabled) {
      if (!existingDogfoodOrg) {
        await ctx.db.insert("dogfood_orgs", {
          id: `dog_${Math.random().toString(16).slice(2, 12)}`,
          org_id: args.orgId,
          added_by: "usr_e2e",
          created_at: timestamp,
        });
      }
      return null;
    }

    if (existingDogfoodOrg) {
      await ctx.db.delete(existingDogfoodOrg._id);
    }

    return null;
  },
});

export const setUsageMeterForOrg = mutation({
  args: {
    orgId: v.string(),
    periodStart: v.string(),
    periodEnd: v.string(),
    toolCallCount: v.number(),
    totalToolCallTimeMs: v.number(),
  },
  returns: v.object({
    id: v.string(),
    org_id: v.string(),
    period_start: v.string(),
    period_end: v.string(),
    tool_call_count: v.number(),
    total_tool_call_time_ms: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const toolCallCount = Math.max(0, Math.floor(args.toolCallCount));
    const totalToolCallTimeMs = Math.max(0, Math.floor(args.totalToolCallTimeMs));

    const existing = await ctx.db
      .query("usage_meters")
      .withIndex("by_org_period", (q) =>
        q.eq("org_id", args.orgId).eq("period_start", args.periodStart),
      )
      .first();

    if (!existing) {
      const id = `meter_${Math.random().toString(16).slice(2, 12)}`;
      await ctx.db.insert("usage_meters", {
        id,
        org_id: args.orgId,
        period_start: args.periodStart,
        period_end: args.periodEnd,
        tool_call_count: toolCallCount,
        total_tool_call_time_ms: totalToolCallTimeMs,
        updated_at: nowIso(),
      });
      return {
        id,
        org_id: args.orgId,
        period_start: args.periodStart,
        period_end: args.periodEnd,
        tool_call_count: toolCallCount,
        total_tool_call_time_ms: totalToolCallTimeMs,
      };
    }

    await ctx.db.patch(existing._id, {
      period_end: args.periodEnd,
      tool_call_count: toolCallCount,
      total_tool_call_time_ms: totalToolCallTimeMs,
      updated_at: nowIso(),
    });

    return {
      id: existing.id,
      org_id: existing.org_id,
      period_start: existing.period_start,
      period_end: args.periodEnd,
      tool_call_count: toolCallCount,
      total_tool_call_time_ms: totalToolCallTimeMs,
    };
  },
});

export const setOrgSuspended = mutation({
  args: {
    orgId: v.string(),
    suspended: v.boolean(),
    reason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const rows = await ctx.db
      .query("org_suspensions")
      .withIndex("by_org", (q) => q.eq("org_id", args.orgId))
      .collect();
    const active = rows.find((row) => row.lifted_at === null);

    if (args.suspended) {
      if (!active) {
        await ctx.db.insert("org_suspensions", {
          id: `susp_${Math.random().toString(16).slice(2, 12)}`,
          org_id: args.orgId,
          reason: args.reason ?? "e2e_suspension",
          suspended_by: "e2e",
          suspended_at: nowIso(),
          lifted_at: null,
          lifted_by: null,
        });
      }
      return null;
    }

    if (active) {
      await ctx.db.patch(active._id, {
        lifted_at: nowIso(),
        lifted_by: "e2e",
      });
    }
    return null;
  },
});
