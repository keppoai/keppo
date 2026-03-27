import { v } from "convex/values";
import { randomIdFor } from "./_auth";
import { internalMutation, query } from "./_generated/server";

export const checkRateLimit = internalMutation({
  args: {
    key: v.string(),
    limit: v.number(),
    windowMs: v.number(),
  },
  returns: v.object({
    allowed: v.boolean(),
    remaining: v.number(),
    retryAfterMs: v.number(),
  }),
  handler: async (ctx, args) => {
    const nowMs = Date.now();
    const limit = Math.max(1, Math.floor(args.limit));
    const windowMs = Math.max(1000, Math.floor(args.windowMs));
    const windowStart = nowMs - windowMs;

    const existing = await ctx.db
      .query("rate_limits")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();

    const timestamps = (existing?.timestamps ?? []).filter((timestamp) => timestamp > windowStart);
    const basePatch = {
      key: args.key,
      timestamps,
      window_ms: windowMs,
      updated_at: nowMs,
    };

    if (timestamps.length >= limit) {
      const oldest = timestamps[0] ?? nowMs;
      const retryAfterMs = Math.max(1000, windowMs - (nowMs - oldest));
      if (existing) {
        await ctx.db.patch(existing._id, basePatch);
      }
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs,
      };
    }

    const nextTimestamps = [...timestamps, nowMs];
    if (existing) {
      await ctx.db.patch(existing._id, {
        ...basePatch,
        timestamps: nextTimestamps,
      });
    } else {
      await ctx.db.insert("rate_limits", {
        id: randomIdFor("rate_limit"),
        ...basePatch,
        timestamps: nextTimestamps,
      });
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - nextTimestamps.length),
      retryAfterMs: 0,
    };
  },
});

const resolveRateLimitBucket = (key: string): string => {
  if (key.startsWith("mcp-auth-failure:")) {
    return "mcp_auth_failure_ip";
  }
  if (key.startsWith("mcp-credential:")) {
    return "mcp_credential_requests";
  }
  if (key.startsWith("oauth-connect:")) {
    return "oauth_connect_ip";
  }
  if (key.startsWith("webhook:")) {
    return "webhook_ip";
  }
  return "other";
};

export const summarizeForHealth = query({
  args: {
    sampleLimit: v.optional(v.number()),
    activeWithinMs: v.optional(v.number()),
  },
  returns: v.object({
    sampledAtMs: v.number(),
    sampleLimit: v.number(),
    sampledRows: v.number(),
    activeWithinMs: v.number(),
    activeKeysLowerBound: v.number(),
    buckets: v.array(
      v.object({
        bucket: v.string(),
        activeKeys: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const sampleLimit = Math.max(1, Math.min(500, Math.floor(args.sampleLimit ?? 200)));
    const activeWithinMs = Math.max(1_000, Math.floor(args.activeWithinMs ?? 5 * 60_000));
    const sampledAtMs = Date.now();
    const lowerBoundUpdatedAt = sampledAtMs - activeWithinMs;

    const rows = await ctx.db
      .query("rate_limits")
      .withIndex("by_updated_at")
      .order("desc")
      .take(sampleLimit);

    const activeRows = rows.filter((row) => row.updated_at >= lowerBoundUpdatedAt);
    const bucketCounts = new Map<string, number>();
    for (const row of activeRows) {
      const bucket = resolveRateLimitBucket(row.key);
      bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
    }

    const buckets = Array.from(bucketCounts.entries())
      .map(([bucket, activeKeys]) => ({
        bucket,
        activeKeys,
      }))
      .sort((a, b) => b.activeKeys - a.activeKeys || a.bucket.localeCompare(b.bucket));

    return {
      sampledAtMs,
      sampleLimit,
      sampledRows: rows.length,
      activeWithinMs,
      activeKeysLowerBound: activeRows.length,
      buckets,
    };
  },
});
