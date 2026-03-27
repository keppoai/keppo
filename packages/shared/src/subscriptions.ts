import { z } from "zod";
import {
  AUTOMATION_TIER_LIMITS,
  INCLUDED_AI_CREDITS,
  TOOL_CALLS_PER_RUN_MULTIPLIER,
  type AutomationTierLimits,
  type IncludedAiCredits,
} from "./automations.js";
import {
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_TIERS as SUBSCRIPTION_TIER_IDS,
  type SubscriptionStatus as DomainSubscriptionStatus,
  type SubscriptionTier as DomainSubscriptionTierId,
} from "./domain.js";

export const subscriptionTierIdSchema = z.enum(SUBSCRIPTION_TIER_IDS);
export type SubscriptionTierId = DomainSubscriptionTierId;

export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export type SubscriptionStatus = DomainSubscriptionStatus;

type SubscriptionTierConfig = {
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
};

const automationLimitsFor = (tierId: SubscriptionTierId): AutomationTierLimits => {
  return AUTOMATION_TIER_LIMITS[tierId] ?? AUTOMATION_TIER_LIMITS.free;
};

const aiCreditAllowanceFor = (tierId: SubscriptionTierId): number =>
  INCLUDED_AI_CREDITS[tierId]?.total ?? INCLUDED_AI_CREDITS.free.total;

const toolCallAllowanceFor = (tierId: SubscriptionTierId): number =>
  automationLimitsFor(tierId).max_runs_per_period * TOOL_CALLS_PER_RUN_MULTIPLIER;

export const SUBSCRIPTION_TIERS: Record<SubscriptionTierId, SubscriptionTierConfig> = {
  free: {
    id: "free",
    label: "Free",
    price_cents_monthly: 0,
    max_workspaces: 2,
    max_members: 1,
    max_tool_calls_per_month: toolCallAllowanceFor("free"),
    tool_call_timeout_ms: 10_000,
    max_total_tool_call_time_ms: 15 * 60 * 1_000,
    automation_limits: automationLimitsFor("free"),
    included_ai_credits: INCLUDED_AI_CREDITS.free,
  },
  starter: {
    id: "starter",
    label: "Starter",
    price_cents_monthly: 2_500,
    max_workspaces: 5,
    max_members: 2,
    max_tool_calls_per_month: toolCallAllowanceFor("starter"),
    tool_call_timeout_ms: 60_000,
    max_total_tool_call_time_ms: 120 * 60 * 1_000,
    automation_limits: automationLimitsFor("starter"),
    included_ai_credits: INCLUDED_AI_CREDITS.starter,
  },
  pro: {
    id: "pro",
    label: "Pro",
    price_cents_monthly: 7_500,
    max_workspaces: 25,
    max_members: Infinity,
    max_tool_calls_per_month: toolCallAllowanceFor("pro"),
    tool_call_timeout_ms: 120_000,
    max_total_tool_call_time_ms: 300 * 60 * 1_000,
    automation_limits: automationLimitsFor("pro"),
    included_ai_credits: INCLUDED_AI_CREDITS.pro,
  },
} as const;

export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[SubscriptionTierId];

export const resolveRuntimeStripePriceIds = (): {
  starter: string | null;
  pro: string | null;
} => {
  const toNullable = (value: string | undefined): string | null => {
    if (!value) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  return {
    starter: toNullable(process.env.STRIPE_STARTER_PRICE_ID),
    pro: toNullable(process.env.STRIPE_PRO_PRICE_ID),
  };
};

export const getTierConfig = (tierId: SubscriptionTierId): SubscriptionTier => {
  return SUBSCRIPTION_TIERS[tierId];
};

export const getAiCreditAllowanceForTier = (tierId: SubscriptionTierId): number => {
  return aiCreditAllowanceFor(tierId);
};

export const coerceSubscriptionTierId = (value: unknown): SubscriptionTierId => {
  if (value === "hobby") {
    return "starter";
  }
  const parsed = subscriptionTierIdSchema.safeParse(value);
  return parsed.success ? parsed.data : "free";
};

export const isWorkspaceLimitReached = (
  tierId: SubscriptionTierId,
  currentCount: number,
): boolean => {
  return currentCount >= getTierConfig(tierId).max_workspaces;
};

export const isMemberLimitReached = (tierId: SubscriptionTierId, currentCount: number): boolean => {
  return currentCount >= getTierConfig(tierId).max_members;
};

export const isToolCallLimitReached = (
  tierId: SubscriptionTierId,
  currentCount: number,
): boolean => {
  return currentCount >= getTierConfig(tierId).max_tool_calls_per_month;
};

export const isToolCallTimeLimitReached = (
  tierId: SubscriptionTierId,
  currentTotalMs: number,
): boolean => {
  return currentTotalMs >= getTierConfig(tierId).max_total_tool_call_time_ms;
};

const firstOfMonthIso = (year: number, monthZeroBased: number): string => {
  return new Date(Date.UTC(year, monthZeroBased, 1, 0, 0, 0, 0)).toISOString();
};

export const getDefaultBillingPeriod = (
  forDate = new Date(),
): {
  periodStart: string;
  periodEnd: string;
} => {
  const year = forDate.getUTCFullYear();
  const month = forDate.getUTCMonth();
  const periodStart = firstOfMonthIso(year, month);
  const periodEnd = firstOfMonthIso(year, month + 1);
  return { periodStart, periodEnd };
};
