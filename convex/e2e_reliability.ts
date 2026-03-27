import { v } from "convex/values";
import { query } from "./_generated/server";
import { isLocalOrTestE2ERuntime, requireE2EIdentity } from "./e2e_shared";

export const getRaceConditionState = query({
  args: {
    orgId: v.string(),
    periodStart: v.string(),
  },
  returns: v.object({
    subscriptionCount: v.number(),
    subscriptionIds: v.array(v.string()),
    usageMeterCount: v.number(),
    usageMeterIds: v.array(v.string()),
    usageToolCallCount: v.number(),
    aiCreditsCount: v.number(),
    aiCreditsIds: v.array(v.string()),
    aiAllowanceUsed: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);

    const subscriptions = await ctx.db
      .query("subscriptions")
      .withIndex("by_org", (q) => q.eq("org_id", args.orgId))
      .collect();

    const usageMeters = await ctx.db
      .query("usage_meters")
      .withIndex("by_org_period", (q) =>
        q.eq("org_id", args.orgId).eq("period_start", args.periodStart),
      )
      .collect();

    const aiCredits = await ctx.db
      .query("ai_credits")
      .withIndex("by_org_period", (q) =>
        q.eq("org_id", args.orgId).eq("period_start", args.periodStart),
      )
      .collect();

    return {
      subscriptionCount: subscriptions.length,
      subscriptionIds: subscriptions.map((row) => row.id),
      usageMeterCount: usageMeters.length,
      usageMeterIds: usageMeters.map((row) => row.id),
      usageToolCallCount: usageMeters.reduce((total, row) => total + row.tool_call_count, 0),
      aiCreditsCount: aiCredits.length,
      aiCreditsIds: aiCredits.map((row) => row.id),
      aiAllowanceUsed: aiCredits.reduce((total, row) => total + row.allowance_used, 0),
    };
  },
});

export const runtimeStatus = query({
  args: {},
  returns: v.object({
    e2eMode: v.boolean(),
    isLocalOrTestRuntime: v.boolean(),
    nodeEnv: v.union(v.string(), v.null()),
    convexDeployment: v.union(v.string(), v.null()),
    convexCloudUrl: v.union(v.string(), v.null()),
    convexSiteUrl: v.union(v.string(), v.null()),
  }),
  handler: async () => {
    if (process.env.KEPPO_E2E_MODE !== "true") {
      throw new Error("E2E_DISABLED: Set KEPPO_E2E_MODE=true to enable e2e helpers.");
    }

    return {
      e2eMode: true,
      isLocalOrTestRuntime: isLocalOrTestE2ERuntime(),
      nodeEnv: process.env.NODE_ENV ?? null,
      convexDeployment: process.env.CONVEX_DEPLOYMENT ?? null,
      convexCloudUrl: process.env.CONVEX_CLOUD_URL ?? null,
      convexSiteUrl: process.env.CONVEX_SITE_URL ?? null,
    };
  },
});
