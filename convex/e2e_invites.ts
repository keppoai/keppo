import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { nowIso, randomIdFor } from "./_auth";
import { chooseLatestSubscription, subscriptionIdForOrg } from "./billing/shared";
import {
  INVITE_CODE_REDEMPTION_STATUS,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TIER,
} from "./domain_constants";
import { requireE2EIdentity } from "./e2e_shared";
import { inviteCodeRedemptionStatusValidator, subscriptionTierValidator } from "./validators";
import { getDefaultBillingPeriod } from "../packages/shared/src/subscriptions.js";

const inviteTokenViewValidator = v.object({
  inviteId: v.string(),
  orgId: v.string(),
  email: v.string(),
  rawToken: v.string(),
});

export const storeInviteToken = mutation({
  args: {
    inviteId: v.string(),
    orgId: v.string(),
    email: v.string(),
    rawToken: v.string(),
    createdAt: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const existing = await ctx.db
      .query("e2e_invite_tokens")
      .withIndex("by_invite_id", (q) => q.eq("invite_id", args.inviteId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        org_id: args.orgId,
        email: args.email,
        raw_token: args.rawToken,
        created_at: args.createdAt,
      });
      return null;
    }

    await ctx.db.insert("e2e_invite_tokens", {
      invite_id: args.inviteId,
      org_id: args.orgId,
      email: args.email,
      raw_token: args.rawToken,
      created_at: args.createdAt,
    });
    return null;
  },
});

export const createInviteCodeForTesting = mutation({
  args: {
    code: v.string(),
    label: v.string(),
    grantTier: subscriptionTierValidator,
    active: v.optional(v.boolean()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const existing = await ctx.db
      .query("invite_codes")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        label: args.label,
        grant_tier: args.grantTier,
        active: args.active ?? true,
      });
      return existing.id;
    }

    const id = randomIdFor("icode");
    await ctx.db.insert("invite_codes", {
      id,
      code: args.code,
      label: args.label,
      grant_tier: args.grantTier,
      active: args.active ?? true,
      use_count: 0,
      created_by: "e2e",
      created_at: nowIso(),
    });
    return id;
  },
});

export const seedInvitePromoForOrg = mutation({
  args: {
    orgId: v.string(),
    inviteCodeId: v.string(),
    grantTier: subscriptionTierValidator,
    status: v.optional(inviteCodeRedemptionStatusValidator),
    redeemedAt: v.string(),
    expiresAt: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);

    const subscription =
      chooseLatestSubscription(
        await ctx.db
          .query("subscriptions")
          .withIndex("by_org", (q) => q.eq("org_id", args.orgId))
          .take(8),
      ) ?? null;
    const nextNow = nowIso();
    if (!subscription) {
      const subscriptionId = await subscriptionIdForOrg(args.orgId);
      const period = getDefaultBillingPeriod(new Date());
      await ctx.db.insert("subscriptions", {
        id: subscriptionId,
        org_id: args.orgId,
        tier: SUBSCRIPTION_TIER.free,
        status: SUBSCRIPTION_STATUS.active,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        invite_code_id: args.inviteCodeId,
        workspace_count: 1,
        current_period_start: period.periodStart,
        current_period_end: period.periodEnd,
        created_at: nextNow,
        updated_at: nextNow,
      });
    }

    const currentSubscription = chooseLatestSubscription(
      await ctx.db
        .query("subscriptions")
        .withIndex("by_org", (q) => q.eq("org_id", args.orgId))
        .take(8),
    );
    if (currentSubscription) {
      await ctx.db.patch(currentSubscription._id, {
        tier: args.grantTier,
        status:
          args.status === INVITE_CODE_REDEMPTION_STATUS.active
            ? SUBSCRIPTION_STATUS.trialing
            : SUBSCRIPTION_STATUS.active,
        stripe_subscription_id: null,
        current_period_start: args.redeemedAt,
        current_period_end: args.expiresAt,
        invite_code_id:
          typeof currentSubscription.invite_code_id === "string"
            ? currentSubscription.invite_code_id
            : args.inviteCodeId,
        updated_at: nextNow,
      });
    }

    await ctx.db.insert("invite_code_redemptions", {
      id: randomIdFor("ired"),
      org_id: args.orgId,
      invite_code_id: args.inviteCodeId,
      grant_tier: args.grantTier,
      status: args.status ?? INVITE_CODE_REDEMPTION_STATUS.active,
      redeemed_by: "e2e",
      redeemed_at: args.redeemedAt,
      expires_at: args.expiresAt,
      updated_at: nextNow,
    });
    return null;
  },
});

export const getInviteToken = query({
  args: {
    inviteId: v.string(),
  },
  returns: v.union(inviteTokenViewValidator, v.null()),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const row = await ctx.db
      .query("e2e_invite_tokens")
      .withIndex("by_invite_id", (q) => q.eq("invite_id", args.inviteId))
      .unique();
    if (!row) {
      return null;
    }
    return {
      inviteId: row.invite_id,
      orgId: row.org_id,
      email: row.email,
      rawToken: row.raw_token,
    };
  },
});

export const getLatestInviteTokenForEmail = query({
  args: {
    orgId: v.string(),
    email: v.string(),
  },
  returns: v.union(inviteTokenViewValidator, v.null()),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const row =
      (
        await ctx.db
          .query("e2e_invite_tokens")
          .withIndex("by_org_email_created_at", (q) =>
            q.eq("org_id", args.orgId).eq("email", args.email),
          )
          .order("desc")
          .take(1)
      )[0] ?? null;
    if (!row) {
      return null;
    }
    return {
      inviteId: row.invite_id,
      orgId: row.org_id,
      email: row.email,
      rawToken: row.raw_token,
    };
  },
});
