import { describe, expect, it } from "vitest";
import {
  getBillingCtaVisibility,
  getBillingUsageView,
  parseRedirectUrl,
  toTierLabel,
  toMinutes,
  toPercent,
} from "./billing-view-model";

describe("billing view-model helpers", () => {
  it("formats free-tier usage metrics deterministically", () => {
    const view = getBillingUsageView({
      tier: "free",
      billing_source: "free",
      invite_promo: null,
      period_start: "2026-03-01T00:00:00.000Z",
      period_end: "2026-04-01T00:00:00.000Z",
      usage: {
        tool_call_count: 18,
        total_tool_call_time_ms: 120_000,
      },
      limits: {
        price_cents_monthly: 0,
        max_tool_calls_per_month: 100,
        max_total_tool_call_time_ms: 900_000,
        included_ai_credits: {
          total: 20,
          bundled_runtime_enabled: false,
          reset_period: "one_time",
        },
      },
    });

    expect(view.callsValue).toBe("18/100");
    expect(view.timeValue).toBe("2.0 / 15.0 min");
    expect(view.periodRangeValue).toBe("2026-03-01 to 2026-04-01");
    expect(view.nextInvoicePreview).toBe("No upcoming invoice on the Free trial tier.");
  });

  it("formats recurring plan preview without overage language", () => {
    const view = getBillingUsageView({
      tier: "pro",
      billing_source: "stripe",
      invite_promo: null,
      period_start: "2026-03-01T00:00:00.000Z",
      period_end: "2026-04-01T00:00:00.000Z",
      usage: {
        tool_call_count: 1250,
        total_tool_call_time_ms: 4_200_000,
      },
      limits: {
        price_cents_monthly: 7_500,
        max_tool_calls_per_month: 5000,
        max_total_tool_call_time_ms: 18_000_000,
        included_ai_credits: {
          total: 300,
          bundled_runtime_enabled: true,
        },
      },
    });

    expect(view.callsValue).toBe("1250/5000");
    expect(view.timeValue).toBe("70.0 / 300.0 min");
    expect(view.periodRangeValue).toBe("2026-03-01 to 2026-04-01");
    expect(view.nextInvoicePreview).toBe("$75.00 due around 2026-04-01.");
  });

  it("computes billing CTA visibility for free, stripe-paid, and invite-promo orgs", () => {
    expect(
      getBillingCtaVisibility({ tier: "free", billing_source: "free", invite_promo: null }),
    ).toEqual({
      showUpgradeStarter: true,
      showUpgradePro: true,
      showChangePlan: false,
      showManageSubscription: false,
      showNextInvoicePreview: true,
      showPeriodRange: true,
    });

    expect(
      getBillingCtaVisibility({ tier: "starter", billing_source: "stripe", invite_promo: null }),
    ).toEqual({
      showUpgradeStarter: false,
      showUpgradePro: false,
      showChangePlan: true,
      showManageSubscription: true,
      showNextInvoicePreview: true,
      showPeriodRange: true,
    });

    expect(
      getBillingCtaVisibility({
        tier: "pro",
        billing_source: "invite_promo",
        invite_promo: {
          code: "PRO123",
          grant_tier: "pro",
          redeemed_at: "2026-03-15T10:00:00.000Z",
          expires_at: "2026-04-15T10:00:00.000Z",
        },
      }),
    ).toEqual({
      showUpgradeStarter: false,
      showUpgradePro: true,
      showChangePlan: false,
      showManageSubscription: false,
      showNextInvoicePreview: true,
      showPeriodRange: true,
    });
  });

  it("formats invite promo next-invoice copy without Stripe language", () => {
    const view = getBillingUsageView({
      tier: "starter",
      billing_source: "invite_promo",
      invite_promo: {
        code: "PRO123",
        grant_tier: "starter",
        redeemed_at: "2026-03-15T10:00:00.000Z",
        expires_at: "2026-04-15T10:00:00.000Z",
      },
      period_start: "2026-03-15T10:00:00.000Z",
      period_end: "2026-04-15T10:00:00.000Z",
      usage: {
        tool_call_count: 20,
        total_tool_call_time_ms: 90_000,
      },
      limits: {
        price_cents_monthly: 2_500,
        max_tool_calls_per_month: 100,
        max_total_tool_call_time_ms: 900_000,
        included_ai_credits: {
          total: 100,
          bundled_runtime_enabled: true,
        },
      },
    });

    expect(view.nextInvoicePreview).toBe(
      "No recurring invoice while this invite promo is active. Promo access ends around 2026-04-15.",
    );
  });

  it("maps internal tier ids to display labels", () => {
    expect(toTierLabel("free")).toBe("Free trial");
    expect(toTierLabel("starter")).toBe("Starter");
    expect(toTierLabel("pro")).toBe("Pro");
  });

  it("clamps percentage calculations and handles invalid limits", () => {
    expect(toPercent(25, 100)).toBe(25);
    expect(toPercent(150, 100)).toBe(100);
    expect(toPercent(5, 0)).toBe(0);
    expect(toMinutes(90_000)).toBe("1.5");
  });

  it("parses checkout and credit-checkout redirect payloads safely", () => {
    expect(parseRedirectUrl({ url: "https://billing.example.test/session" })).toBe(
      "https://billing.example.test/session",
    );
    expect(parseRedirectUrl({ checkout_url: "https://billing.example.test/credits" })).toBe(
      "https://billing.example.test/credits",
    );
    expect(parseRedirectUrl({ url: "" })).toBeNull();
    expect(parseRedirectUrl([])).toBeNull();
    expect(parseRedirectUrl(null)).toBeNull();
  });
});
