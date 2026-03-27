import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_STATUS, SUBSCRIPTION_TIER } from "../../convex/domain_constants";
import { createConvexTestHarness } from "./harness";

const refs = {
  upsertSubscriptionForOrg: makeFunctionReference<"mutation">(
    "billing/subscriptions:upsertSubscriptionForOrg",
  ),
  beginToolCall: makeFunctionReference<"mutation">("billing:beginToolCall"),
  deductAiCredit: makeFunctionReference<"mutation">("ai_credits:deductAiCredit"),
};

const currentMonthlyPeriod = () => {
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const periodEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  ).toISOString();
  return { periodStart, periodEnd };
};

describe("convex billing functions", () => {
  it("creates one usage meter row under concurrent beginToolCall mutations", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_test_usage";
    const period = currentMonthlyPeriod();

    await t.mutation(refs.upsertSubscriptionForOrg, {
      orgId,
      tier: SUBSCRIPTION_TIER.free,
      status: SUBSCRIPTION_STATUS.active,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodStart: period.periodStart,
      currentPeriodEnd: period.periodEnd,
    });

    const calls = 6;
    await Promise.all(
      Array.from({ length: calls }, () =>
        t.mutation(refs.beginToolCall, {
          orgId,
        }),
      ),
    );

    const usageRows = await t.run((ctx) => {
      return ctx.db
        .query("usage_meters")
        .withIndex("by_org_period", (q) =>
          q.eq("org_id", orgId).eq("period_start", period.periodStart),
        )
        .collect();
    });

    expect(usageRows).toHaveLength(1);
    expect(usageRows[0]?.tool_call_count).toBe(calls);
  });

  it("creates one ai_credits row under concurrent deductAiCredit mutations", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_test_credits";
    const period = currentMonthlyPeriod();

    await t.mutation(refs.upsertSubscriptionForOrg, {
      orgId,
      tier: SUBSCRIPTION_TIER.free,
      status: SUBSCRIPTION_STATUS.active,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodStart: period.periodStart,
      currentPeriodEnd: period.periodEnd,
    });

    const deductions = 4;
    await Promise.all(
      Array.from({ length: deductions }, () =>
        t.mutation(refs.deductAiCredit, {
          org_id: orgId,
        }),
      ),
    );

    const creditRows = await t.run((ctx) => {
      return ctx.db
        .query("ai_credits")
        .withIndex("by_org_period", (q) =>
          q.eq("org_id", orgId).eq("period_start", period.periodStart),
        )
        .collect();
    });

    expect(creditRows).toHaveLength(1);
    expect(creditRows[0]?.allowance_used).toBe(deductions);
  });
});
