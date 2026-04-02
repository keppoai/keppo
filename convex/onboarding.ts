import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireWorkspaceRole } from "./_auth";
import { getAiCreditBalanceForOrg } from "./ai_credits";
import { listConnectedProviderIdsForOrg } from "./integrations/read_model";

const refs = {
  getSubscriptionForOrg: makeFunctionReference<"query">("billing:getSubscriptionForOrg"),
};

const onboardingReadinessValidator = v.object({
  has_connected_integration: v.boolean(),
  has_enabled_workspace_integration: v.boolean(),
  has_ai_key: v.boolean(),
  ai_access_mode: v.union(v.literal("bundled"), v.literal("self_managed")),
  has_automation: v.boolean(),
  has_first_action: v.boolean(),
});

export const getReadiness = query({
  args: {
    workspaceId: v.string(),
  },
  returns: onboardingReadinessValidator,
  handler: async (ctx, args) => {
    const auth = await requireWorkspaceRole(ctx, args.workspaceId);
    const subscription = await ctx.runQuery(refs.getSubscriptionForOrg, {
      orgId: auth.orgId,
    });

    const workspaceIntegrations = await ctx.db
      .query("workspace_integrations")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .take(50);
    const aiKeys = await ctx.db
      .query("org_ai_keys")
      .withIndex("by_org", (q) => q.eq("org_id", auth.orgId))
      .take(50);
    const aiCreditBalance = await getAiCreditBalanceForOrg(ctx, auth.orgId, subscription);
    const automations = await ctx.db
      .query("automations")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
      .take(50);

    let hasFirstAction = false;
    if (automations.length > 0) {
      const runs = await ctx.db
        .query("automation_runs")
        .withIndex("by_workspace", (q) => q.eq("workspace_id", args.workspaceId))
        .take(50);
      for (const run of runs) {
        const firstAction = await ctx.db
          .query("actions")
          .withIndex("by_automation_run", (q) => q.eq("automation_run_id", run.id))
          .first();
        if (firstAction) {
          hasFirstAction = true;
          break;
        }
      }
    }
    const connectedProviderIds = await listConnectedProviderIdsForOrg(ctx, auth.orgId);

    return {
      has_connected_integration: connectedProviderIds.length > 0,
      has_enabled_workspace_integration: workspaceIntegrations.some(
        (integration) => integration.enabled,
      ),
      has_ai_key: aiCreditBalance.bundled_runtime_enabled
        ? aiCreditBalance.total_available > 0
        : aiKeys.some((key) => key.is_active),
      ai_access_mode: aiCreditBalance.bundled_runtime_enabled
        ? ("bundled" as const)
        : ("self_managed" as const),
      has_automation: automations.length > 0,
      has_first_action: hasFirstAction,
    };
  },
});
