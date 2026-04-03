// SPDX-License-Identifier: FSL-1.1-Apache-2.0

import { v } from "convex/values";
import { internalMutation, internalQuery } from "../../../convex/_generated/server";
import { nowIso } from "../../../convex/_auth";
import { SUBSCRIPTION_STATUS, SUBSCRIPTION_TIER } from "../../../convex/domain_constants";
import { subscriptionStatusValidator, subscriptionTierValidator } from "../../../convex/validators";
import {
  chooseLatestSubscription,
  resolveCurrentSubscription,
  subscriptionIdForOrg,
  subscriptionValidator,
  toSubscription,
} from "./shared";

export const upsertSubscriptionForOrg = internalMutation({
  args: {
    orgId: v.string(),
    tier: subscriptionTierValidator,
    status: subscriptionStatusValidator,
    stripeCustomerId: v.union(v.string(), v.null()),
    stripeSubscriptionId: v.union(v.string(), v.null()),
    currentPeriodStart: v.string(),
    currentPeriodEnd: v.string(),
  },
  returns: subscriptionValidator,
  handler: async (ctx, args) => {
    const canonicalId = await subscriptionIdForOrg(args.orgId);
    const updatedAt = nowIso();
    const rows = await ctx.db
      .query("subscriptions")
      .withIndex("by_org", (q) => q.eq("org_id", args.orgId))
      .collect();
    const existing = rows.find((row) => row.id === canonicalId) ?? chooseLatestSubscription(rows);

    if (!existing) {
      await ctx.db.insert("subscriptions", {
        id: canonicalId,
        org_id: args.orgId,
        tier: args.tier,
        status: args.status,
        stripe_customer_id: args.stripeCustomerId,
        stripe_subscription_id: args.stripeSubscriptionId,
        workspace_count: 0,
        current_period_start: args.currentPeriodStart,
        current_period_end: args.currentPeriodEnd,
        created_at: updatedAt,
        updated_at: updatedAt,
      });
    } else {
      await ctx.db.patch(existing._id, {
        id: canonicalId,
        tier: args.tier,
        status: args.status,
        stripe_customer_id: args.stripeCustomerId,
        stripe_subscription_id: args.stripeSubscriptionId,
        current_period_start: args.currentPeriodStart,
        current_period_end: args.currentPeriodEnd,
        workspace_count: existing.workspace_count ?? 0,
        updated_at: updatedAt,
      });
    }

    const allRows = await ctx.db
      .query("subscriptions")
      .withIndex("by_org", (q) => q.eq("org_id", args.orgId))
      .collect();
    const canonical =
      allRows.find((row) => row.id === canonicalId) ?? chooseLatestSubscription(allRows);
    if (!canonical) {
      throw new Error("Failed to upsert subscription");
    }
    for (const row of allRows) {
      if (row._id !== canonical._id) {
        await ctx.db.delete(row._id);
      }
    }

    const updated = await ctx.db
      .query("subscriptions")
      .withIndex("by_custom_id", (q) => q.eq("id", canonicalId))
      .first();
    if (!updated) {
      throw new Error("Failed to update subscription");
    }
    return toSubscription(updated);
  },
});

export const downgradeOrgToFree = internalMutation({
  args: {
    orgId: v.string(),
    status: v.optional(subscriptionStatusValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await resolveCurrentSubscription(ctx, args.orgId);
    if (existing) {
      await ctx.db.patch(existing._id, {
        tier: SUBSCRIPTION_TIER.free,
        status: args.status ?? SUBSCRIPTION_STATUS.canceled,
        updated_at: nowIso(),
      });
    }
    return null;
  },
});

export const setSubscriptionStatusByCustomer = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    status: subscriptionStatusValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_customer", (q) => q.eq("stripe_customer_id", args.stripeCustomerId))
      .collect();
    const target = chooseLatestSubscription(rows);
    if (!target) {
      return null;
    }
    await ctx.db.patch(target._id, {
      status: args.status,
      updated_at: nowIso(),
    });
    return null;
  },
});

export const setSubscriptionStatusByStripeSubscription = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
    status: subscriptionStatusValidator,
    tier: v.optional(subscriptionTierValidator),
    currentPeriodStart: v.optional(v.string()),
    currentPeriodEnd: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripe_subscription_id", args.stripeSubscriptionId),
      )
      .collect();
    const target = chooseLatestSubscription(rows);
    if (!target) {
      return null;
    }
    const patch: {
      status: typeof args.status;
      tier?: typeof args.tier;
      current_period_start?: string;
      current_period_end?: string;
      updated_at: string;
    } = {
      status: args.status,
      updated_at: nowIso(),
    };
    if (args.tier) {
      patch.tier = args.tier;
    }
    if (
      Object.prototype.hasOwnProperty.call(args, "currentPeriodStart") &&
      args.currentPeriodStart !== undefined
    ) {
      patch.current_period_start = args.currentPeriodStart;
    }
    if (
      Object.prototype.hasOwnProperty.call(args, "currentPeriodEnd") &&
      args.currentPeriodEnd !== undefined
    ) {
      patch.current_period_end = args.currentPeriodEnd;
    }
    await ctx.db.patch(target._id, {
      ...patch,
    });
    return null;
  },
});

export const getSubscriptionByStripeCustomer = internalQuery({
  args: {
    stripeCustomerId: v.string(),
  },
  returns: v.union(subscriptionValidator, v.null()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_customer", (q) => q.eq("stripe_customer_id", args.stripeCustomerId))
      .collect();
    const target = chooseLatestSubscription(rows);
    return target ? toSubscription(target) : null;
  },
});

export const getSubscriptionByStripeSubscription = internalQuery({
  args: {
    stripeSubscriptionId: v.string(),
  },
  returns: v.union(subscriptionValidator, v.null()),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripe_subscription_id", args.stripeSubscriptionId),
      )
      .collect();
    const target = chooseLatestSubscription(rows);
    return target ? toSubscription(target) : null;
  },
});

export const getSubscriptionForOrg = internalQuery({
  args: {
    orgId: v.string(),
  },
  returns: v.union(subscriptionValidator, v.null()),
  handler: async (ctx, args) => {
    const subscription = await resolveCurrentSubscription(ctx, args.orgId);
    return subscription ? toSubscription(subscription) : null;
  },
});
