import { BILLING_SOURCE, type BillingSource } from "@keppo/shared/contracts/billing";
import { billingRedirectResponseSchema } from "@keppo/shared/billing-contracts";
export type BillingSnapshot = {
  tier: "free" | "starter" | "pro";
  billing_source: BillingSource;
  invite_promo: {
    code: string;
    grant_tier: "free" | "starter" | "pro";
    redeemed_at: string;
    expires_at: string;
  } | null;
  period_start: string;
  period_end: string;
  usage: {
    tool_call_count: number;
    total_tool_call_time_ms: number;
  };
  limits: {
    price_cents_monthly: number;
    max_tool_calls_per_month: number;
    max_total_tool_call_time_ms: number;
    included_ai_credits: {
      total: number;
      bundled_runtime_enabled: boolean;
    };
  };
};

export type BillingCtaVisibility = {
  showUpgradeStarter: boolean;
  showUpgradePro: boolean;
  showChangePlan: boolean;
  showManageSubscription: boolean;
  showNextInvoicePreview: boolean;
  showPeriodRange: boolean;
};

export const toTierLabel = (tier: BillingSnapshot["tier"]): string => {
  switch (tier) {
    case "starter":
      return "Starter";
    case "pro":
      return "Pro";
    default:
      return "Free";
  }
};

export const toMinutes = (valueMs: number): string => {
  return (valueMs / 60_000).toFixed(1);
};

export const toPercent = (used: number, max: number): number => {
  if (!Number.isFinite(max) || max <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((used / max) * 100)));
};

export const parseRedirectUrl = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const record = payload as { url?: unknown; checkout_url?: unknown };
  if (typeof record.url === "string" && record.url.length > 0) {
    return record.url;
  }
  return typeof record.checkout_url === "string" && record.checkout_url.length > 0
    ? record.checkout_url
    : null;
};

const isoDate = (value: string): string => {
  if (typeof value !== "string" || value.length < 10) {
    return "Unknown date";
  }
  return value.slice(0, 10);
};

const toUsd = (cents: number): string => {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
};

export const getBillingCtaVisibility = (
  billing: Pick<BillingSnapshot, "tier" | "billing_source" | "invite_promo">,
): BillingCtaVisibility => {
  if (billing.billing_source === BILLING_SOURCE.invitePromo) {
    return {
      showUpgradeStarter: billing.invite_promo?.grant_tier !== "pro",
      showUpgradePro: true,
      showChangePlan: false,
      showManageSubscription: false,
      showNextInvoicePreview: true,
      showPeriodRange: true,
    };
  }
  return {
    showUpgradeStarter: billing.tier === "free",
    showUpgradePro: billing.tier === "free",
    showChangePlan: billing.billing_source === BILLING_SOURCE.stripe,
    showManageSubscription: billing.billing_source === BILLING_SOURCE.stripe,
    showNextInvoicePreview: true,
    showPeriodRange: true,
  };
};

const nextInvoicePreview = (billing: BillingSnapshot): string => {
  if (billing.billing_source === BILLING_SOURCE.invitePromo && billing.invite_promo) {
    return `No recurring invoice while this invite promo is active. Promo access ends around ${isoDate(
      billing.invite_promo.expires_at,
    )}.`;
  }
  if (billing.tier === "free") {
    return `No upcoming invoice on the ${toTierLabel(billing.tier)} tier.`;
  }
  const recurring = toUsd(Math.floor(Math.max(0, billing.limits.price_cents_monthly)));
  const dueDate = isoDate(billing.period_end);
  return `${recurring} due around ${dueDate}.`;
};

export const getBillingUsageView = (billing: BillingSnapshot) => {
  const visibility = getBillingCtaVisibility(billing);
  return {
    callsProgress: toPercent(
      billing.usage.tool_call_count,
      billing.limits.max_tool_calls_per_month,
    ),
    timeProgress: toPercent(
      billing.usage.total_tool_call_time_ms,
      billing.limits.max_total_tool_call_time_ms,
    ),
    callsValue: `${billing.usage.tool_call_count}/${billing.limits.max_tool_calls_per_month}`,
    timeValue: `${toMinutes(billing.usage.total_tool_call_time_ms)} / ${toMinutes(
      billing.limits.max_total_tool_call_time_ms,
    )} min`,
    periodRangeValue: `${isoDate(billing.period_start)} to ${isoDate(billing.period_end)}`,
    nextInvoicePreview: nextInvoicePreview(billing),
    ...visibility,
  };
};
