import type { AutomationTierLimits, IncludedAiCredits } from "../automations.js";
import { SUBSCRIPTION_STATUS, SUBSCRIPTION_TIER, type SubscriptionStatus } from "../domain.js";
import type { SubscriptionTierId } from "../subscriptions.js";

export const BILLING_SOURCE = {
  free: "free",
  stripe: "stripe",
  invitePromo: "invite_promo",
} as const;

export type BillingSource = (typeof BILLING_SOURCE)[keyof typeof BILLING_SOURCE];

export const resolveInviteGrantTier = (
  grantTier: SubscriptionTierId | null | undefined,
): SubscriptionTierId => {
  return grantTier ?? SUBSCRIPTION_TIER.free;
};

export const isPaidInviteGrantTier = (
  tier: SubscriptionTierId,
): tier is typeof SUBSCRIPTION_TIER.starter | typeof SUBSCRIPTION_TIER.pro => {
  return tier === SUBSCRIPTION_TIER.starter || tier === SUBSCRIPTION_TIER.pro;
};

export const isActiveStripeSubscriptionStatus = (
  status: SubscriptionStatus,
): status is
  | typeof SUBSCRIPTION_STATUS.active
  | typeof SUBSCRIPTION_STATUS.pastDue
  | typeof SUBSCRIPTION_STATUS.trialing => {
  return (
    status === SUBSCRIPTION_STATUS.active ||
    status === SUBSCRIPTION_STATUS.pastDue ||
    status === SUBSCRIPTION_STATUS.trialing
  );
};

export const chooseLatestRedemption = <
  T extends {
    redeemed_at: string;
    updated_at: string;
  },
>(
  rows: T[],
): T | null => {
  if (rows.length === 0) {
    return null;
  }
  return (
    [...rows].sort((left, right) => {
      const leftStamp = left.updated_at || left.redeemed_at;
      const rightStamp = right.updated_at || right.redeemed_at;
      return rightStamp.localeCompare(leftStamp);
    })[0] ?? null
  );
};

export const calculatePromoExpiry = (redeemedAt: string): string => {
  const redeemed = new Date(redeemedAt);
  const targetMonthIndex = redeemed.getUTCMonth() + 1;
  const targetYear = redeemed.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex % 12;
  const lastDayOfTargetMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(redeemed.getUTCDate(), lastDayOfTargetMonth);
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      targetDay,
      redeemed.getUTCHours(),
      redeemed.getUTCMinutes(),
      redeemed.getUTCSeconds(),
      redeemed.getUTCMilliseconds(),
    ),
  ).toISOString();
};

export interface BillingReservation {
  period_start: string;
  tool_call_timeout_ms: number;
}

export interface TierConfig {
  id: SubscriptionTierId;
  label: string;
  price_cents_monthly: number;
  max_workspaces: number;
  max_members: number;
  max_tool_calls_per_month: number;
  tool_call_timeout_ms: number;
  max_total_tool_call_time_ms: number;
  automation_limits: AutomationTierLimits;
  included_ai_credits: IncludedAiCredits;
}

export interface OrgBillingUsage {
  id: string;
  org_id: string;
  period_start: string;
  period_end: string;
  tool_call_count: number;
  total_tool_call_time_ms: number;
  updated_at: string;
  notifications_fired?: string;
}

export interface OrgBilling {
  org_id: string;
  tier: SubscriptionTierId;
  status: string;
  billing_source: BillingSource;
  invite_promo: {
    code: string;
    grant_tier: SubscriptionTierId;
    redeemed_at: string;
    expires_at: string;
  } | null;
  period_start: string;
  period_end: string;
  usage: OrgBillingUsage;
  limits: Omit<TierConfig, "id" | "automation_limits">;
}

export interface BillingGate {
  beginToolCall(orgId: string): Promise<BillingReservation>;
  finishToolCall(orgId: string, periodStart: string, latencyMs: number): Promise<void>;
  getOrgBillingForWorkspace(workspaceId: string): Promise<OrgBilling>;
}

export interface TierGate {
  getTierConfig(tierId: SubscriptionTierId): TierConfig;
  isWorkspaceLimitReached(tierId: SubscriptionTierId, current: number): boolean;
  isMemberLimitReached(tierId: SubscriptionTierId, current: number): boolean;
}
