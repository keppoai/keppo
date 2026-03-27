import { describe, expect, it } from "vitest";
import {
  SUBSCRIPTION_TIERS,
  coerceSubscriptionTierId,
  getDefaultBillingPeriod,
  getTierConfig,
  isMemberLimitReached,
  isToolCallLimitReached,
  isToolCallTimeLimitReached,
  isWorkspaceLimitReached,
  subscriptionStatusSchema,
  subscriptionTierIdSchema,
} from "./subscriptions.js";

describe("subscriptions", () => {
  it("resolves cloud tier limits for every tier id", () => {
    expect(getTierConfig("free")).toEqual(SUBSCRIPTION_TIERS.free);
    expect(getTierConfig("starter")).toEqual(SUBSCRIPTION_TIERS.starter);
    expect(getTierConfig("pro")).toEqual(SUBSCRIPTION_TIERS.pro);
    expect(getTierConfig("free").max_workspaces).toBe(2);
    expect(getTierConfig("pro").tool_call_timeout_ms).toBe(120_000);
    expect(getTierConfig("starter").price_cents_monthly).toBe(2_500);
    expect(getTierConfig("pro").price_cents_monthly).toBe(7_500);
  });

  it("coerces unknown tier ids to free", () => {
    expect(coerceSubscriptionTierId("pro")).toBe("pro");
    expect(coerceSubscriptionTierId("hobby")).toBe("starter");
    expect(coerceSubscriptionTierId("bad-tier")).toBe("free");
  });

  it("enforces workspace limits by tier", () => {
    expect(isWorkspaceLimitReached("free", 1)).toBe(false);
    expect(isWorkspaceLimitReached("free", 2)).toBe(true);
  });

  it("enforces member limits by tier", () => {
    expect(isMemberLimitReached("free", 0)).toBe(false);
    expect(isMemberLimitReached("free", 1)).toBe(true);
    expect(isMemberLimitReached("starter", 1)).toBe(false);
    expect(isMemberLimitReached("starter", 2)).toBe(true);
    expect(isMemberLimitReached("pro", 999_999)).toBe(false);
  });

  it("enforces tool call count limits by tier", () => {
    expect(getTierConfig("free").max_tool_calls_per_month).toBe(7_500);
    expect(getTierConfig("starter").max_tool_calls_per_month).toBe(75_000);
    expect(getTierConfig("pro").max_tool_calls_per_month).toBe(750_000);
    expect(isToolCallLimitReached("starter", 74_999)).toBe(false);
    expect(isToolCallLimitReached("starter", 75_000)).toBe(true);
  });

  it("enforces total tool call time limits by tier", () => {
    expect(isToolCallTimeLimitReached("pro", 299 * 60 * 1_000)).toBe(false);
    expect(isToolCallTimeLimitReached("pro", 300 * 60 * 1_000)).toBe(true);
  });

  it("builds monthly billing periods in UTC", () => {
    const period = getDefaultBillingPeriod(new Date("2026-03-16T12:30:00.000Z"));
    expect(period).toEqual({
      periodStart: "2026-03-01T00:00:00.000Z",
      periodEnd: "2026-04-01T00:00:00.000Z",
    });
  });

  it("exposes strict zod enums", () => {
    expect(subscriptionTierIdSchema.parse("free")).toBe("free");
    expect(subscriptionStatusSchema.parse("active")).toBe("active");
    expect(() => subscriptionTierIdSchema.parse("enterprise")).toThrow();
    expect(() => subscriptionStatusSchema.parse("paused")).toThrow();
  });
});
