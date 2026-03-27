import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { nowIso, requireOrgMember } from "../_auth";
import { NOTIFICATION_CHANNEL } from "../domain_constants";
import {
  type NotificationEventType,
  ensureSameOrgMembership,
  inAppEventViewValidator,
  toInAppEventView,
} from "../notifications_shared";

export const listInAppNotifications = query({
  args: {
    orgId: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(inAppEventViewValidator),
  handler: async (ctx, args) => {
    await ensureSameOrgMembership(ctx, args.orgId);
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 25)));
    const rows = await ctx.db
      .query("notification_events")
      .withIndex("by_org_channel_created", (q) =>
        q.eq("org_id", args.orgId).eq("channel", NOTIFICATION_CHANNEL.inApp),
      )
      .order("desc")
      .take(limit);

    const orderedRows = [...rows].sort((a, b) => {
      if (a.read_at === null && b.read_at !== null) {
        return -1;
      }
      if (a.read_at !== null && b.read_at === null) {
        return 1;
      }
      return b.created_at.localeCompare(a.created_at);
    });

    return orderedRows.map((row) =>
      toInAppEventView({
        id: row.id,
        event_type: row.event_type as NotificationEventType,
        title: row.title,
        body: row.body,
        cta_url: row.cta_url,
        cta_label: row.cta_label,
        ...(row.metadata ? { metadata: row.metadata } : {}),
        read_at: row.read_at,
        created_at: row.created_at,
      }),
    );
  },
});

export const countUnread = query({
  args: {
    orgId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await ensureSameOrgMembership(ctx, args.orgId);
    const unread = await ctx.db
      .query("notification_events")
      .withIndex("by_org_channel_read", (q) =>
        q.eq("org_id", args.orgId).eq("channel", NOTIFICATION_CHANNEL.inApp).eq("read_at", null),
      )
      .collect();
    return unread.length;
  },
});

export const markRead = mutation({
  args: {
    eventId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx);
    const event = await ctx.db
      .query("notification_events")
      .withIndex("by_custom_id", (q) => q.eq("id", args.eventId))
      .unique();
    if (!event) {
      return null;
    }
    if (event.org_id !== auth.orgId || event.channel !== NOTIFICATION_CHANNEL.inApp) {
      throw new Error("Forbidden");
    }
    if (event.read_at === null) {
      await ctx.db.patch(event._id, {
        read_at: nowIso(),
      });
    }
    return null;
  },
});

export const markAllRead = mutation({
  args: {
    orgId: v.string(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    await ensureSameOrgMembership(ctx, args.orgId);
    const events = await ctx.db
      .query("notification_events")
      .withIndex("by_org_channel_read", (q) =>
        q.eq("org_id", args.orgId).eq("channel", NOTIFICATION_CHANNEL.inApp).eq("read_at", null),
      )
      .collect();

    let count = 0;
    const stamp = nowIso();
    for (const event of events) {
      await ctx.db.patch(event._id, {
        read_at: stamp,
      });
      count += 1;
    }
    return count;
  },
});
