import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "../_generated/server";
import { requireOrgMember } from "../_auth";
import { NOTIFICATION_DELIVERY_STATUS } from "../domain_constants";
import {
  NOTIFICATION_EVENTS,
  type NotificationEventType,
  endpointValidator,
  ensureSameOrgMembership,
  eventDefinitionValidator,
  notificationEndpointTypeValidator,
  toEndpointView,
  upsertEndpoint,
} from "../notifications_shared";
import { cascadeDeleteNotificationEndpointDescendants } from "../cascade";

const ENDPOINT_WARNING_SAMPLE_SIZE = 6;
const ENDPOINT_WARNING_FAILURE_THRESHOLD = 2;

const summarizeEndpointDeliveryWarning = (
  deliveries: Array<{
    status: string;
    last_error: string | null;
    created_at: string;
  }>,
) => {
  const failedDeliveries = deliveries.filter(
    (delivery) => delivery.status === NOTIFICATION_DELIVERY_STATUS.failed,
  );
  if (failedDeliveries.length === 0) {
    return null;
  }

  let consecutiveFailureCount = 0;
  for (const delivery of deliveries) {
    if (delivery.status !== NOTIFICATION_DELIVERY_STATUS.failed) {
      break;
    }
    consecutiveFailureCount += 1;
  }

  if (
    consecutiveFailureCount < ENDPOINT_WARNING_FAILURE_THRESHOLD &&
    failedDeliveries.length < ENDPOINT_WARNING_FAILURE_THRESHOLD
  ) {
    return null;
  }

  const latestFailure = failedDeliveries[0];
  if (!latestFailure) {
    return null;
  }

  return {
    recent_failure_count: failedDeliveries.length,
    consecutive_failure_count: consecutiveFailureCount,
    last_error: latestFailure.last_error ?? "Recent deliveries to this endpoint failed.",
    last_attempt_at: latestFailure.created_at,
  };
};

export const listEventDefinitions = query({
  args: {},
  returns: v.array(eventDefinitionValidator),
  handler: async () => {
    return (
      Object.entries(NOTIFICATION_EVENTS) as Array<
        [NotificationEventType, (typeof NOTIFICATION_EVENTS)[NotificationEventType]]
      >
    ).map(([id, config]) => ({
      id,
      title: config.title,
      channels: [...config.channels],
    }));
  },
});

export const listEndpoints = query({
  args: {
    orgId: v.string(),
  },
  returns: v.array(endpointValidator),
  handler: async (ctx, args) => {
    const auth = await ensureSameOrgMembership(ctx, args.orgId);
    const endpoints = await ctx.db
      .query("notification_endpoints")
      .withIndex("by_org_user_created", (q) =>
        q.eq("org_id", args.orgId).eq("user_id", auth.userId),
      )
      .collect();
    const sortedEndpoints = endpoints.sort((a, b) => b.created_at.localeCompare(a.created_at));

    return await Promise.all(
      sortedEndpoints.map(async (endpoint) => {
        const recentDeliveries = await ctx.db
          .query("notification_events")
          .withIndex("by_endpoint_created", (q) => q.eq("endpoint_id", endpoint.id))
          .order("desc")
          .take(ENDPOINT_WARNING_SAMPLE_SIZE);
        return toEndpointView(endpoint, summarizeEndpointDeliveryWarning(recentDeliveries));
      }),
    );
  },
});

export const registerEndpoint = mutation({
  args: {
    orgId: v.string(),
    type: notificationEndpointTypeValidator,
    destination: v.string(),
    pushSubscription: v.optional(v.string()),
    preferences: v.optional(v.record(v.string(), v.boolean())),
  },
  returns: endpointValidator,
  handler: async (ctx, args) => {
    const auth = await ensureSameOrgMembership(ctx, args.orgId);
    const endpoint = await upsertEndpoint(ctx, {
      orgId: args.orgId,
      userId: auth.userId,
      type: args.type,
      destination: args.destination,
      ...(args.pushSubscription ? { pushSubscription: args.pushSubscription } : {}),
      ...(args.preferences ? { preferences: args.preferences } : {}),
      enabled: true,
    });

    return toEndpointView(endpoint);
  },
});

export const registerEndpointForOrgMember = internalMutation({
  args: {
    orgId: v.string(),
    userId: v.string(),
    type: notificationEndpointTypeValidator,
    destination: v.string(),
    pushSubscription: v.optional(v.string()),
    preferences: v.optional(v.record(v.string(), v.boolean())),
  },
  returns: endpointValidator,
  handler: async (ctx, args) => {
    const member = await ctx.runQuery(components.betterAuth.queries.getMemberByOrgAndUser, {
      orgId: args.orgId,
      userId: args.userId,
    });
    if (!member) {
      throw new Error("Forbidden");
    }

    const endpoint = await upsertEndpoint(ctx, {
      orgId: args.orgId,
      userId: args.userId,
      type: args.type,
      destination: args.destination,
      ...(args.pushSubscription ? { pushSubscription: args.pushSubscription } : {}),
      ...(args.preferences ? { preferences: args.preferences } : {}),
      enabled: true,
    });

    return toEndpointView(endpoint);
  },
});

export const ensureDefaultEmailEndpoint = mutation({
  args: {
    orgId: v.string(),
    email: v.optional(v.string()),
  },
  returns: endpointValidator,
  handler: async (ctx, args) => {
    const auth = await ensureSameOrgMembership(ctx, args.orgId);
    const email = (args.email ?? "").trim();
    if (!email) {
      throw new Error("Email required");
    }

    const endpoint = await upsertEndpoint(ctx, {
      orgId: args.orgId,
      userId: auth.userId,
      type: "email",
      destination: email,
      enabled: true,
    });

    return toEndpointView(endpoint);
  },
});

export const removeEndpoint = mutation({
  args: {
    endpointId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx);
    const endpoint = await ctx.db
      .query("notification_endpoints")
      .withIndex("by_custom_id", (q) => q.eq("id", args.endpointId))
      .unique();
    if (!endpoint) {
      return null;
    }
    if (endpoint.user_id !== auth.userId || endpoint.org_id !== auth.orgId) {
      throw new Error("Forbidden");
    }
    await cascadeDeleteNotificationEndpointDescendants(ctx, endpoint.id);
    await ctx.db.delete(endpoint._id);
    return null;
  },
});

export const toggleEndpoint = mutation({
  args: {
    endpointId: v.string(),
    enabled: v.boolean(),
  },
  returns: endpointValidator,
  handler: async (ctx, args) => {
    const endpoint = await getOwnedEndpoint(ctx, args.endpointId);

    await ctx.db.patch(endpoint._id, {
      enabled: args.enabled,
    });

    const updated = await ctx.db
      .query("notification_endpoints")
      .withIndex("by_custom_id", (q) => q.eq("id", endpoint.id))
      .unique();
    if (!updated) {
      throw new Error("Failed to update endpoint");
    }

    return toEndpointView(updated);
  },
});

export const setEndpointPreferences = mutation({
  args: {
    endpointId: v.string(),
    preferences: v.record(v.string(), v.boolean()),
  },
  returns: endpointValidator,
  handler: async (ctx, args) => {
    const endpoint = await getOwnedEndpoint(ctx, args.endpointId);

    await ctx.db.patch(endpoint._id, {
      notification_preferences: JSON.stringify(args.preferences),
    });

    const updated = await ctx.db
      .query("notification_endpoints")
      .withIndex("by_custom_id", (q) => q.eq("id", endpoint.id))
      .unique();
    if (!updated) {
      throw new Error("Failed to update endpoint preferences");
    }

    return toEndpointView(updated);
  },
});

const getOwnedEndpoint = async (ctx: MutationCtx, endpointId: string) => {
  const auth = await requireOrgMember(ctx);
  const endpoint = await ctx.db
    .query("notification_endpoints")
    .withIndex("by_custom_id", (q) => q.eq("id", endpointId))
    .unique();
  if (!endpoint) {
    throw new Error("Endpoint not found");
  }
  if (endpoint.user_id !== auth.userId || endpoint.org_id !== auth.orgId) {
    throw new Error("Forbidden");
  }
  return endpoint;
};
