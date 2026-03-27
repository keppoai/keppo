import { AUTOMATION_TIER_LIMITS, INCLUDED_AI_CREDITS } from "../../automations.js";
import type {
  BillingGate,
  BillingReservation,
  OrgBilling,
  TierConfig,
  TierGate,
} from "../billing.js";
import type { SubscriptionTierId } from "../../subscriptions.js";

const OSS_FREE_TIER: TierConfig = {
  id: "free",
  label: "Free",
  price_cents_monthly: 0,
  max_workspaces: Number.POSITIVE_INFINITY,
  max_members: Number.POSITIVE_INFINITY,
  max_tool_calls_per_month: Number.POSITIVE_INFINITY,
  tool_call_timeout_ms: 300_000,
  max_total_tool_call_time_ms: Number.POSITIVE_INFINITY,
  included_ai_credits: INCLUDED_AI_CREDITS.free,
  automation_limits: {
    ...AUTOMATION_TIER_LIMITS.free,
    max_automations_per_workspace: Number.POSITIVE_INFINITY,
    max_runs_per_period: Number.POSITIVE_INFINITY,
    max_run_duration_ms: 300_000,
    max_concurrent_runs: Number.POSITIVE_INFINITY,
    max_log_bytes_per_run: Number.POSITIVE_INFINITY,
    log_retention_days: Number.POSITIVE_INFINITY,
  },
};

const billingPeriodFor = (date = new Date()): { start: string; end: string } => {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)).toISOString();
  const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0)).toISOString();
  return { start, end };
};

export const defaultBillingReservation = (): BillingReservation => ({
  period_start: billingPeriodFor().start,
  tool_call_timeout_ms: OSS_FREE_TIER.tool_call_timeout_ms,
});

export const defaultTierGate: TierGate = {
  getTierConfig(_tierId: SubscriptionTierId): TierConfig {
    return OSS_FREE_TIER;
  },
  isWorkspaceLimitReached(_tierId: SubscriptionTierId, _current: number): boolean {
    return false;
  },
  isMemberLimitReached(_tierId: SubscriptionTierId, _current: number): boolean {
    return false;
  },
};

export const defaultBillingGate: BillingGate = {
  async beginToolCall(_orgId: string): Promise<BillingReservation> {
    return defaultBillingReservation();
  },
  async finishToolCall(_orgId: string, _periodStart: string, _latencyMs: number): Promise<void> {},
  async getOrgBillingForWorkspace(workspaceId: string): Promise<OrgBilling> {
    const period = billingPeriodFor();
    return {
      org_id: workspaceId,
      tier: OSS_FREE_TIER.id,
      status: "active",
      billing_source: "free",
      invite_promo: null,
      period_start: period.start,
      period_end: period.end,
      usage: {
        id: `oss_usage_${workspaceId}_${period.start}`,
        org_id: workspaceId,
        period_start: period.start,
        period_end: period.end,
        tool_call_count: 0,
        total_tool_call_time_ms: 0,
        updated_at: period.start,
      },
      limits: {
        label: OSS_FREE_TIER.label,
        price_cents_monthly: OSS_FREE_TIER.price_cents_monthly,
        max_workspaces: OSS_FREE_TIER.max_workspaces,
        max_members: OSS_FREE_TIER.max_members,
        max_tool_calls_per_month: OSS_FREE_TIER.max_tool_calls_per_month,
        tool_call_timeout_ms: OSS_FREE_TIER.tool_call_timeout_ms,
        max_total_tool_call_time_ms: OSS_FREE_TIER.max_total_tool_call_time_ms,
        included_ai_credits: OSS_FREE_TIER.included_ai_credits,
      },
    };
  },
};
