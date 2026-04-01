// SPDX-License-Identifier: FSL-1.1-Apache-2.0

import { v } from "convex/values";
import type { Doc } from "../../../convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../../convex/_generated/server";
import { deterministicIdFor, nowIso } from "../../../convex/_auth";
import {
  chooseLatestRedemption,
  isActiveStripeSubscriptionStatus,
  isPaidInviteGrantTier,
} from "../../../packages/shared/src/contracts/billing.js";
import {
  getDefaultBillingPeriod,
  getTierConfig,
  type SubscriptionTierId,
} from "@keppo/shared/subscriptions";
import { SUBSCRIPTION_STATUS, SUBSCRIPTION_TIER } from "../../../convex/domain_constants";
import { getAutomationRunTopupBalanceForOrg } from "../../../convex/automation_run_topups";
import { pickFields } from "../../../convex/field_mapper";
import { subscriptionStatusValidator, subscriptionTierValidator } from "../../../convex/validators";

export const USAGE_WARNING_THRESHOLD = 0.8;
export { getDefaultBillingPeriod };

const zeroAutomationRunTopupBalance = {
  purchased_runs_balance: 0,
  purchased_tool_calls_balance: 0,
  purchased_tool_call_time_ms_balance: 0,
} as const;

export type DbCtx = QueryCtx | MutationCtx;

export const subscriptionValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  tier: subscriptionTierValidator,
  status: subscriptionStatusValidator,
  stripe_customer_id: v.union(v.string(), v.null()),
  stripe_subscription_id: v.union(v.string(), v.null()),
  current_period_start: v.string(),
  current_period_end: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
});

export const billingSourceValidator = v.union(
  v.literal("free"),
  v.literal("stripe"),
  v.literal("invite_promo"),
);

export const invitePromoMetadataValidator = v.union(
  v.object({
    code: v.string(),
    grant_tier: subscriptionTierValidator,
    redeemed_at: v.string(),
    expires_at: v.string(),
  }),
  v.null(),
);

export const usageMeterValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  period_start: v.string(),
  period_end: v.string(),
  tool_call_count: v.number(),
  total_tool_call_time_ms: v.number(),
  notifications_fired: v.optional(v.string()),
  updated_at: v.string(),
});

const subscriptionFields = [
  "id",
  "org_id",
  "tier",
  "status",
  "stripe_customer_id",
  "stripe_subscription_id",
  "current_period_start",
  "current_period_end",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof Doc<"subscriptions">)[];

const usageMeterFields = [
  "id",
  "org_id",
  "period_start",
  "period_end",
  "tool_call_count",
  "total_tool_call_time_ms",
  "updated_at",
] as const satisfies readonly (keyof Doc<"usage_meters">)[];

export const toSubscription = (row: Doc<"subscriptions">) => pickFields(row, subscriptionFields);

export const toUsageMeter = (row: Doc<"usage_meters">) => ({
  ...pickFields(row, usageMeterFields),
  ...(row.notifications_fired ? { notifications_fired: row.notifications_fired } : {}),
});

export const parseNotificationFlags = (value: string | undefined): Record<string, boolean> => {
  if (!value) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const next: Record<string, boolean> = {};
    for (const [key, raw] of Object.entries(parsed)) {
      if (typeof raw === "boolean") {
        next[key] = raw;
      }
    }
    return next;
  } catch {
    return {};
  }
};

export const limitError = (
  code: "TOOL_CALL_LIMIT_REACHED" | "TOOL_CALL_TIME_LIMIT_REACHED",
  details: Record<string, unknown>,
): never => {
  throw new Error(
    JSON.stringify({
      code,
      ...details,
    }),
  );
};

export const chooseLatestSubscription = <
  T extends {
    updated_at: string;
    created_at: string;
    status: string | undefined;
  },
>(
  rows: T[],
): T | null => {
  if (rows.length === 0) {
    return null;
  }
  const sorted = [...rows].sort((a, b) => {
    const aStamp = a.updated_at || a.created_at;
    const bStamp = b.updated_at || b.created_at;
    return bStamp.localeCompare(aStamp);
  });
  return sorted[0] ?? null;
};

export const resolveCurrentSubscription = async (ctx: DbCtx, orgId: string) => {
  const rows = await ctx.db
    .query("subscriptions")
    .withIndex("by_org", (q) => q.eq("org_id", orgId))
    .collect();
  return chooseLatestSubscription(rows);
};

export const resolveCurrentTier = async (
  ctx: DbCtx,
  orgId: string,
): Promise<SubscriptionTierId> => {
  const subscription = await resolveCurrentSubscription(ctx, orgId);
  return subscription?.tier ?? SUBSCRIPTION_TIER.free;
};

export const getUsageMeter = async (ctx: DbCtx, params: { orgId: string; periodStart: string }) => {
  const existing = await ctx.db
    .query("usage_meters")
    .withIndex("by_org_period", (q) =>
      q.eq("org_id", params.orgId).eq("period_start", params.periodStart),
    )
    .first();
  return existing ?? null;
};

export const usageMeterIdFor = async (orgId: string, periodStart: string): Promise<string> =>
  deterministicIdFor("meter", `${orgId}:${periodStart}`);

export const subscriptionIdForOrg = async (orgId: string): Promise<string> =>
  deterministicIdFor("sub", orgId);

export const ensureUsageMeter = async (
  ctx: MutationCtx,
  params: { orgId: string; periodStart: string; periodEnd: string },
) => {
  const id = await usageMeterIdFor(params.orgId, params.periodStart);
  const existingById = await ctx.db
    .query("usage_meters")
    .withIndex("by_custom_id", (q) => q.eq("id", id))
    .first();
  if (existingById) {
    return existingById;
  }
  const existing = await getUsageMeter(ctx, {
    orgId: params.orgId,
    periodStart: params.periodStart,
  });
  if (existing) {
    return existing;
  }
  await ctx.db.insert("usage_meters", {
    id,
    org_id: params.orgId,
    period_start: params.periodStart,
    period_end: params.periodEnd,
    tool_call_count: 0,
    total_tool_call_time_ms: 0,
    notifications_fired: "{}",
    updated_at: nowIso(),
  });
  const created = await ctx.db
    .query("usage_meters")
    .withIndex("by_custom_id", (q) => q.eq("id", id))
    .first();
  if (!created) {
    throw new Error("Failed to create usage meter");
  }
  return created;
};

export const resolveBillingPeriod = (
  subscription: {
    current_period_start: string;
    current_period_end: string;
  } | null,
): { periodStart: string; periodEnd: string } => {
  if (
    subscription &&
    subscription.current_period_start.length > 0 &&
    subscription.current_period_end.length > 0
  ) {
    return {
      periodStart: subscription.current_period_start,
      periodEnd: subscription.current_period_end,
    };
  }
  return getDefaultBillingPeriod(new Date());
};

export const billingUsageResponseValidator = v.object({
  org_id: v.string(),
  tier: subscriptionTierValidator,
  status: subscriptionStatusValidator,
  billing_source: billingSourceValidator,
  invite_promo: invitePromoMetadataValidator,
  period_start: v.string(),
  period_end: v.string(),
  usage: usageMeterValidator,
  limits: v.object({
    price_cents_monthly: v.number(),
    max_workspaces: v.number(),
    max_members: v.number(),
    max_tool_calls_per_month: v.number(),
    tool_call_timeout_ms: v.number(),
    max_total_tool_call_time_ms: v.number(),
    included_ai_credits: v.object({
      total: v.number(),
      bundled_runtime_enabled: v.boolean(),
      reset_period: v.union(v.literal("monthly"), v.literal("one_time")),
    }),
  }),
});

export type BillingUsageResponse = {
  org_id: string;
  tier: "free" | "starter" | "pro";
  status: "active" | "canceled" | "past_due" | "trialing";
  billing_source: "free" | "stripe" | "invite_promo";
  invite_promo: {
    code: string;
    grant_tier: "free" | "starter" | "pro";
    redeemed_at: string;
    expires_at: string;
  } | null;
  period_start: string;
  period_end: string;
  usage: {
    id: string;
    org_id: string;
    period_start: string;
    period_end: string;
    tool_call_count: number;
    total_tool_call_time_ms: number;
    updated_at: string;
  };
  limits: {
    price_cents_monthly: number;
    max_workspaces: number;
    max_members: number;
    max_tool_calls_per_month: number;
    tool_call_timeout_ms: number;
    max_total_tool_call_time_ms: number;
    included_ai_credits: {
      total: number;
      bundled_runtime_enabled: boolean;
      reset_period: "monthly" | "one_time";
    };
  };
};

export const resolveActiveInvitePromo = async (ctx: DbCtx, orgId: string, now = nowIso()) => {
  const rows = await ctx.db
    .query("invite_code_redemptions")
    .withIndex("by_org_status", (q) => q.eq("org_id", orgId).eq("status", "active"))
    .take(16);
  const redemption = chooseLatestRedemption(
    rows.filter(
      (row) => isPaidInviteGrantTier(row.grant_tier) && row.expires_at.localeCompare(now) > 0,
    ),
  );
  if (!redemption) {
    return null;
  }
  const inviteCode = await ctx.db
    .query("invite_codes")
    .withIndex("by_custom_id", (q) => q.eq("id", redemption.invite_code_id))
    .unique();
  return {
    code: inviteCode?.code ?? redemption.invite_code_id,
    grant_tier: redemption.grant_tier,
    redeemed_at: redemption.redeemed_at,
    expires_at: redemption.expires_at,
  } as const;
};

export const resolveBillingSource = (params: {
  subscription: Doc<"subscriptions"> | null;
  invitePromo: BillingUsageResponse["invite_promo"];
}): BillingUsageResponse["billing_source"] => {
  if (params.invitePromo && (params.subscription?.stripe_subscription_id ?? null) === null) {
    return "invite_promo";
  }
  if (
    params.subscription &&
    params.subscription.tier !== SUBSCRIPTION_TIER.free &&
    typeof params.subscription.stripe_subscription_id === "string" &&
    isActiveStripeSubscriptionStatus(params.subscription.status)
  ) {
    return "stripe";
  }
  return "free";
};

export const buildUsageResponse = async (
  ctx: DbCtx,
  orgId: string,
): Promise<BillingUsageResponse> => {
  const subscription = await resolveCurrentSubscription(ctx, orgId);
  const invitePromo =
    subscription &&
    subscription.tier !== SUBSCRIPTION_TIER.free &&
    typeof subscription.stripe_subscription_id === "string" &&
    isActiveStripeSubscriptionStatus(subscription.status)
      ? null
      : await resolveActiveInvitePromo(ctx, orgId);
  const billingSource = resolveBillingSource({
    subscription,
    invitePromo,
  });
  const tier =
    billingSource === "invite_promo"
      ? (invitePromo?.grant_tier ?? subscription?.tier ?? SUBSCRIPTION_TIER.free)
      : (subscription?.tier ?? SUBSCRIPTION_TIER.free);
  const period =
    billingSource === "invite_promo" && invitePromo
      ? {
          periodStart: subscription?.current_period_start ?? invitePromo.redeemed_at,
          periodEnd: subscription?.current_period_end ?? invitePromo.expires_at,
        }
      : resolveBillingPeriod(subscription);
  const usageRow = await getUsageMeter(ctx, {
    orgId,
    periodStart: period.periodStart,
  });
  const usage = usageRow ?? {
    id: `meter_virtual_${orgId}_${period.periodStart}`,
    org_id: orgId,
    period_start: period.periodStart,
    period_end: period.periodEnd,
    tool_call_count: 0,
    total_tool_call_time_ms: 0,
    updated_at: nowIso(),
  };
  const limits = getTierConfig(tier);
  const topupBalance =
    tier === SUBSCRIPTION_TIER.free
      ? zeroAutomationRunTopupBalance
      : await getAutomationRunTopupBalanceForOrg(ctx, orgId);
  return {
    org_id: orgId,
    tier,
    status:
      billingSource === "invite_promo"
        ? (subscription?.status ?? SUBSCRIPTION_STATUS.trialing)
        : (subscription?.status ?? SUBSCRIPTION_STATUS.active),
    billing_source: billingSource,
    invite_promo: billingSource === "invite_promo" ? invitePromo : null,
    period_start: period.periodStart,
    period_end: period.periodEnd,
    usage: {
      id: usage.id,
      org_id: usage.org_id,
      period_start: usage.period_start,
      period_end: usage.period_end,
      tool_call_count: usage.tool_call_count,
      total_tool_call_time_ms: usage.total_tool_call_time_ms,
      updated_at: usage.updated_at,
    },
    limits: {
      price_cents_monthly: limits.price_cents_monthly,
      max_workspaces: limits.max_workspaces,
      max_members: limits.max_members,
      max_tool_calls_per_month:
        limits.max_tool_calls_per_month + topupBalance.purchased_tool_calls_balance,
      tool_call_timeout_ms: limits.tool_call_timeout_ms,
      max_total_tool_call_time_ms:
        limits.max_total_tool_call_time_ms + topupBalance.purchased_tool_call_time_ms_balance,
      included_ai_credits: limits.included_ai_credits,
    },
  };
};
