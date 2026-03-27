import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import { nowIso } from "../_auth";

export const recordPollAttempt = internalMutation({
  args: {
    credentialId: v.string(),
  },
  returns: v.object({
    limited: v.boolean(),
    retry_after_ms: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const actionId = "__poll_rate_limit__";
    const now = Date.now();
    const windowMs = 60_000;
    const row = await ctx.db
      .query("poll_trackers")
      .withIndex("by_action_credential", (q) =>
        q.eq("action_id", actionId).eq("credential_id", args.credentialId),
      )
      .unique();

    if (!row) {
      await ctx.db.insert("poll_trackers", {
        action_id: actionId,
        credential_id: args.credentialId,
        consecutive_pending_count: 1,
        last_polled_at: nowIso(),
      });
      return { limited: false };
    }

    const last = Date.parse(row.last_polled_at);
    const inWindow = Number.isFinite(last) && now - last <= windowMs;
    const nextCount = inWindow ? row.consecutive_pending_count + 1 : 1;

    await ctx.db.patch(row._id, {
      consecutive_pending_count: nextCount,
      last_polled_at: nowIso(),
    });

    if (nextCount > 60) {
      const retry = inWindow ? Math.max(1000, windowMs - (now - last)) : 1000;
      return {
        limited: true,
        retry_after_ms: retry,
      };
    }

    return { limited: false };
  },
});

export const updatePendingPollTracker = internalMutation({
  args: {
    actionId: v.string(),
    credentialId: v.string(),
    pending: v.boolean(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("poll_trackers")
      .withIndex("by_action_credential", (q) =>
        q.eq("action_id", args.actionId).eq("credential_id", args.credentialId),
      )
      .unique();

    const next = args.pending ? (row?.consecutive_pending_count ?? 0) + 1 : 0;

    if (!row) {
      await ctx.db.insert("poll_trackers", {
        action_id: args.actionId,
        credential_id: args.credentialId,
        consecutive_pending_count: next,
        last_polled_at: nowIso(),
      });
      return next;
    }

    await ctx.db.patch(row._id, {
      consecutive_pending_count: next,
      last_polled_at: nowIso(),
    });

    return next;
  },
});
