import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import {
  calculatePromoExpiry,
  chooseLatestRedemption,
  isActiveStripeSubscriptionStatus,
  isPaidInviteGrantTier,
  resolveInviteGrantTier,
} from "@keppo/shared/billing-contracts";
import { nowIso, randomIdFor, requireOrgMember, type BaseCtx } from "./_auth";
import {
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  INVITE_CODE_REDEMPTION_STATUS,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TIER,
  USER_ROLE,
  type SubscriptionTier,
} from "./domain_constants";
import { chooseLatestSubscription, subscriptionIdForOrg } from "./billing/shared";
import { subscriptionTierValidator } from "./validators";
import { getDefaultBillingPeriod } from "../packages/shared/src/subscriptions.js";

const PROMO_SCAN_LIMIT_DEFAULT = 20;

const redeemInviteCodeResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    inviteCodeId: v.string(),
    code: v.string(),
    grantTier: subscriptionTierValidator,
    expiresAt: v.union(v.string(), v.null()),
  }),
  v.object({
    ok: v.literal(false),
    errorCode: v.string(),
    message: v.string(),
  }),
);

const invitePromoSweepResultValidator = v.object({
  processed: v.number(),
  expired: v.number(),
  continued: v.boolean(),
});

const invitePromoConversionResultValidator = v.object({
  converted: v.number(),
});

const normalizeInviteCode = (value: string): string => {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);
};

export const resolveInviteCodeGrantTier = (
  inviteCode: Pick<Doc<"invite_codes">, "grant_tier">,
): SubscriptionTier => {
  return resolveInviteGrantTier(inviteCode.grant_tier);
};

const getCurrentSubscriptionRow = async (ctx: BaseCtx, orgId: string) => {
  const rows = await ctx.db
    .query("subscriptions")
    .withIndex("by_org", (q) => q.eq("org_id", orgId))
    .take(8);
  return chooseLatestSubscription(rows);
};

const ensureSubscriptionRow = async (ctx: MutationCtx, orgId: string) => {
  let subscription = await getCurrentSubscriptionRow(ctx, orgId);
  if (subscription) {
    return subscription;
  }

  const now = nowIso();
  const period = getDefaultBillingPeriod(new Date());
  const subscriptionId = await subscriptionIdForOrg(orgId);
  await ctx.db.insert("subscriptions", {
    id: subscriptionId,
    org_id: orgId,
    tier: SUBSCRIPTION_TIER.free,
    status: SUBSCRIPTION_STATUS.active,
    stripe_customer_id: null,
    stripe_subscription_id: null,
    invite_code_id: null,
    workspace_count: 1,
    current_period_start: period.periodStart,
    current_period_end: period.periodEnd,
    created_at: now,
    updated_at: now,
  });

  subscription = await getCurrentSubscriptionRow(ctx, orgId);
  if (!subscription) {
    throw new ConvexError({
      code: "INVITE_CODE_SUBSCRIPTION_MISSING",
    });
  }
  return subscription;
};

const shouldWriteInviteMarker = (subscription: Doc<"subscriptions"> | null): boolean => {
  return typeof subscription?.invite_code_id !== "string";
};

const isStripePaidSubscription = (subscription: Doc<"subscriptions"> | null): boolean => {
  if (!subscription) {
    return false;
  }
  return (
    subscription.tier !== SUBSCRIPTION_TIER.free &&
    typeof subscription.stripe_subscription_id === "string" &&
    isActiveStripeSubscriptionStatus(subscription.status)
  );
};

export const getActivePaidInvitePromoForOrg = async (
  ctx: BaseCtx,
  orgId: string,
  now = nowIso(),
) => {
  const rows = await ctx.db
    .query("invite_code_redemptions")
    .withIndex("by_org_status", (q) =>
      q.eq("org_id", orgId).eq("status", INVITE_CODE_REDEMPTION_STATUS.active),
    )
    .take(16);
  return (
    chooseLatestRedemption(
      rows.filter(
        (row) => isPaidInviteGrantTier(row.grant_tier) && row.expires_at.localeCompare(now) > 0,
      ),
    ) ?? null
  );
};

const insertAuditEvent = async (
  ctx: MutationCtx,
  params: {
    orgId: string;
    actorType: Doc<"audit_events">["actor_type"];
    actorId: string;
    eventType: Doc<"audit_events">["event_type"];
    payload: Record<string, string | boolean | string[] | null>;
  },
): Promise<void> => {
  await ctx.db.insert("audit_events", {
    id: randomIdFor("audit"),
    org_id: params.orgId,
    actor_type: params.actorType,
    actor_id: params.actorId,
    event_type: params.eventType,
    payload: params.payload,
    created_at: nowIso(),
  });
};

export const redeemInviteCode = mutation({
  args: {
    code: v.string(),
  },
  returns: redeemInviteCodeResultValidator,
  handler: async (ctx, args) => {
    const auth = await requireOrgMember(ctx);
    const normalizedCode = normalizeInviteCode(args.code);
    if (!/^[A-Z0-9]{6}$/.test(normalizedCode)) {
      return {
        ok: false as const,
        errorCode: "INVALID_INVITE_CODE",
        message: "Enter a valid 6-character invite code.",
      };
    }

    const inviteCode = await ctx.db
      .query("invite_codes")
      .withIndex("by_code", (q) => q.eq("code", normalizedCode))
      .unique();
    if (!inviteCode || !inviteCode.active) {
      return {
        ok: false as const,
        errorCode: "INVALID_INVITE_CODE",
        message: "That invite code is invalid or inactive.",
      };
    }

    const grantTier = resolveInviteCodeGrantTier(inviteCode);
    const subscription = await ensureSubscriptionRow(ctx, auth.orgId);
    const redeemedAt = nowIso();

    if (grantTier === SUBSCRIPTION_TIER.free) {
      return {
        ok: false as const,
        errorCode: "INVITE_CODE_NOT_REQUIRED",
        message: "Free invite codes are no longer required.",
      };
    }

    if (auth.role !== USER_ROLE.owner && auth.role !== USER_ROLE.admin) {
      return {
        ok: false as const,
        errorCode: "INVITE_CODE_PROMO_REQUIRES_BILLING_ADMIN",
        message: "Only org owners and admins can redeem paid invite codes.",
      };
    }

    const activePromo = await getActivePaidInvitePromoForOrg(ctx, auth.orgId, redeemedAt);
    if (activePromo) {
      return {
        ok: false as const,
        errorCode: "INVITE_CODE_PROMO_ALREADY_ACTIVE",
        message: "This organization already has an active paid invite promo.",
      };
    }
    if (isStripePaidSubscription(subscription)) {
      return {
        ok: false as const,
        errorCode: "INVITE_CODE_PROMO_STRIPE_ACTIVE",
        message: "This organization already has an active Stripe subscription.",
      };
    }
    if (subscription.tier !== SUBSCRIPTION_TIER.free) {
      return {
        ok: false as const,
        errorCode: "INVITE_CODE_PROMO_REQUIRES_FREE_BILLING",
        message:
          "Paid invite codes can only be redeemed while the organization is on the Free plan.",
      };
    }

    const expiresAt = calculatePromoExpiry(redeemedAt);
    await ctx.db.patch(inviteCode._id, {
      use_count: inviteCode.use_count + 1,
    });
    await ctx.db.patch(subscription._id, {
      tier: grantTier,
      status: SUBSCRIPTION_STATUS.trialing,
      stripe_subscription_id: null,
      current_period_start: redeemedAt,
      current_period_end: expiresAt,
      updated_at: redeemedAt,
      ...(shouldWriteInviteMarker(subscription) ? { invite_code_id: inviteCode.id } : {}),
    });
    await ctx.db.insert("invite_code_redemptions", {
      id: randomIdFor("ired"),
      org_id: auth.orgId,
      invite_code_id: inviteCode.id,
      grant_tier: grantTier,
      status: INVITE_CODE_REDEMPTION_STATUS.active,
      redeemed_by: auth.userId,
      redeemed_at: redeemedAt,
      expires_at: expiresAt,
      updated_at: redeemedAt,
    });
    await insertAuditEvent(ctx, {
      orgId: auth.orgId,
      actorType: AUDIT_ACTOR_TYPE.user,
      actorId: auth.userId,
      eventType: AUDIT_EVENT_TYPES.billingInvitePromoRedeemed,
      payload: {
        invite_code_id: inviteCode.id,
        code: inviteCode.code,
        grant_tier: grantTier,
        expires_at: expiresAt,
      },
    });

    return {
      ok: true as const,
      inviteCodeId: inviteCode.id,
      code: inviteCode.code,
      grantTier,
      expiresAt,
    };
  },
});

export const convertActiveInvitePromo = internalMutation({
  args: {
    orgId: v.string(),
    stripeCustomerId: v.union(v.string(), v.null()),
    stripeSubscriptionId: v.union(v.string(), v.null()),
  },
  returns: invitePromoConversionResultValidator,
  handler: async (ctx, args) => {
    const activePromo = await getActivePaidInvitePromoForOrg(ctx, args.orgId);
    if (!activePromo) {
      return { converted: 0 };
    }

    const updatedAt = nowIso();
    await ctx.db.patch(activePromo._id, {
      status: INVITE_CODE_REDEMPTION_STATUS.converted,
      updated_at: updatedAt,
    });
    await insertAuditEvent(ctx, {
      orgId: args.orgId,
      actorType: AUDIT_ACTOR_TYPE.system,
      actorId: args.stripeSubscriptionId ?? args.stripeCustomerId ?? "billing_checkout",
      eventType: AUDIT_EVENT_TYPES.billingInvitePromoConverted,
      payload: {
        invite_code_redemption_id: activePromo.id,
        grant_tier: activePromo.grant_tier,
        stripe_customer_id: args.stripeCustomerId,
        stripe_subscription_id: args.stripeSubscriptionId,
      },
    });

    return {
      converted: 1,
    };
  },
});

export const expireInviteCodePromos = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: invitePromoSweepResultValidator,
  handler: async (ctx, args) => {
    const now = nowIso();
    const limit = Math.max(
      1,
      Math.min(PROMO_SCAN_LIMIT_DEFAULT, Math.floor(args.limit ?? PROMO_SCAN_LIMIT_DEFAULT)),
    );
    const rows = await ctx.db
      .query("invite_code_redemptions")
      .withIndex("by_status_and_expires_at", (q) =>
        q.eq("status", INVITE_CODE_REDEMPTION_STATUS.active).lt("expires_at", now),
      )
      .order("asc")
      .take(limit);

    let expired = 0;
    for (const row of rows) {
      if (!isPaidInviteGrantTier(row.grant_tier)) {
        continue;
      }

      const updatedAt = nowIso();
      await ctx.db.patch(row._id, {
        status: INVITE_CODE_REDEMPTION_STATUS.expired,
        updated_at: updatedAt,
      });

      const subscription = await getCurrentSubscriptionRow(ctx, row.org_id);
      let fellBackToFree = false;
      if (
        subscription &&
        subscription.tier === row.grant_tier &&
        subscription.status === SUBSCRIPTION_STATUS.trialing &&
        subscription.stripe_subscription_id === null
      ) {
        const period = getDefaultBillingPeriod(new Date());
        await ctx.db.patch(subscription._id, {
          tier: SUBSCRIPTION_TIER.free,
          status: SUBSCRIPTION_STATUS.active,
          stripe_subscription_id: null,
          current_period_start: period.periodStart,
          current_period_end: period.periodEnd,
          updated_at: updatedAt,
        });
        fellBackToFree = true;
      }

      await insertAuditEvent(ctx, {
        orgId: row.org_id,
        actorType: AUDIT_ACTOR_TYPE.system,
        actorId: "cron",
        eventType: AUDIT_EVENT_TYPES.billingInvitePromoExpired,
        payload: {
          invite_code_redemption_id: row.id,
          grant_tier: row.grant_tier,
          expired_at: row.expires_at,
          fell_back_to_free: fellBackToFree,
        },
      });
      expired += 1;
    }

    const continued = rows.length === limit;
    if (continued && rows.length > 0) {
      await ctx.scheduler.runAfter(0, internal.invite_codes.expireInviteCodePromos, {
        limit,
      });
    }

    return {
      processed: rows.length,
      expired,
      continued,
    };
  },
});
