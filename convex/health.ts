import { v } from "convex/values";
import { query } from "./_generated/server";

export const probeConvex = query({
  args: {},
  returns: v.object({
    checkedAt: v.string(),
    featureFlagSampleSize: v.number(),
  }),
  handler: async (ctx) => {
    const sample = await ctx.db.query("feature_flags").take(1);
    return {
      checkedAt: new Date().toISOString(),
      featureFlagSampleSize: sample.length,
    };
  },
});
