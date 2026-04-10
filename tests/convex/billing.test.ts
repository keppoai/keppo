import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_STATUS, SUBSCRIPTION_TIER } from "../../convex/domain_constants";
import { createConvexTestHarness } from "./harness";

const refs = {
  ensureFreeSubscriptionForOrg: makeFunctionReference<"mutation">(
    "billing/subscriptions:ensureFreeSubscriptionForOrg",
  ),
  setWorkspaceCountForOrg: makeFunctionReference<"mutation">(
    "billing/subscriptions:setWorkspaceCountForOrg",
  ),
  getBillingContextForOrg: makeFunctionReference<"query">(
    "billing/subscriptions:getBillingContextForOrg",
  ),
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

  it("resolves billing context through the billing-owned bootstrap, counter, and period boundary", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_billing_context";

    await t.mutation(refs.ensureFreeSubscriptionForOrg, {
      orgId,
      workspaceCountSeed: 1,
    });
    await t.mutation(refs.setWorkspaceCountForOrg, {
      orgId,
      workspaceCount: 3,
    });

    const freeContext = await t.query(refs.getBillingContextForOrg, { orgId });
    expect(freeContext).toMatchObject({
      org_id: orgId,
      effective_tier: SUBSCRIPTION_TIER.free,
      billing_source: "free",
      workspace_count: 3,
    });

    const upgradedPeriod = {
      periodStart: "2026-04-01T00:00:00.000Z",
      periodEnd: "2026-05-01T00:00:00.000Z",
    };
    await t.mutation(refs.upsertSubscriptionForOrg, {
      orgId,
      tier: SUBSCRIPTION_TIER.starter,
      status: SUBSCRIPTION_STATUS.active,
      stripeCustomerId: "cus_billing_ctx",
      stripeSubscriptionId: "sub_billing_ctx",
      currentPeriodStart: upgradedPeriod.periodStart,
      currentPeriodEnd: upgradedPeriod.periodEnd,
    });

    const upgradedContext = await t.query(refs.getBillingContextForOrg, { orgId });
    expect(upgradedContext).toMatchObject({
      org_id: orgId,
      effective_tier: SUBSCRIPTION_TIER.starter,
      effective_status: SUBSCRIPTION_STATUS.active,
      billing_source: "stripe",
      period_start: upgradedPeriod.periodStart,
      period_end: upgradedPeriod.periodEnd,
      workspace_count: 3,
      invite_promo: null,
    });
  });
});
