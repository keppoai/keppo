import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_CREDIT_PURCHASE_STATUS,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TIER,
} from "../../convex/domain_constants";
import {
  AI_CREDIT_ERROR_CODE,
  parseAiCreditErrorCode,
} from "../../packages/shared/src/ai-credit-errors.js";
import { AI_CREDIT_USAGE_SOURCE } from "../../packages/shared/src/automations.js";
import {
  getDefaultBillingPeriod,
  getAiCreditAllowanceForTier,
} from "../../packages/shared/src/subscriptions.js";
import { createConvexTestHarness } from "./harness";

const refs = {
  upsertSubscriptionForOrg: makeFunctionReference<"mutation">(
    "billing/subscriptions:upsertSubscriptionForOrg",
  ),
  deductAiCredit: makeFunctionReference<"mutation">("ai_credits:deductAiCredit"),
  expirePurchasedCredits: makeFunctionReference<"mutation">("ai_credits:expirePurchasedCredits"),
  resetMonthlyAllowance: makeFunctionReference<"mutation">("ai_credits:resetMonthlyAllowance"),
};

const seedSubscription = async (
  t: ReturnType<typeof createConvexTestHarness>,
  orgId: string,
  tier: keyof typeof SUBSCRIPTION_TIER,
) => {
  const period = getDefaultBillingPeriod(new Date());
  await t.mutation(refs.upsertSubscriptionForOrg, {
    orgId,
    tier: SUBSCRIPTION_TIER[tier],
    status: SUBSCRIPTION_STATUS.active,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodStart: period.periodStart,
    currentPeriodEnd: period.periodEnd,
  });
  return period;
};

const insertAiCreditsRow = async (
  t: ReturnType<typeof createConvexTestHarness>,
  params: {
    orgId: string;
    periodStart: string;
    periodEnd: string;
    allowanceTotal: number;
    allowanceResetPeriod?: "monthly" | "one_time";
    allowanceUsed: number;
    purchasedBalance: number;
  },
) => {
  await t.run(async (ctx) => {
    await ctx.db.insert("ai_credits", {
      id: `aic_${params.orgId}_${params.periodStart}`,
      org_id: params.orgId,
      period_start: params.periodStart,
      period_end: params.periodEnd,
      allowance_total: params.allowanceTotal,
      allowance_reset_period: params.allowanceResetPeriod,
      allowance_used: params.allowanceUsed,
      purchased_balance: params.purchasedBalance,
      updated_at: new Date().toISOString(),
    });
  });
};

const insertPurchase = async (
  t: ReturnType<typeof createConvexTestHarness>,
  params: {
    id: string;
    orgId: string;
    creditsRemaining: number;
    purchasedAt: string;
    expiresAt: string;
    status?: (typeof AI_CREDIT_PURCHASE_STATUS)[keyof typeof AI_CREDIT_PURCHASE_STATUS];
  },
) => {
  await t.run(async (ctx) => {
    await ctx.db.insert("ai_credit_purchases", {
      id: params.id,
      org_id: params.orgId,
      credits: params.creditsRemaining,
      price_cents: 500,
      stripe_payment_intent_id: null,
      purchased_at: params.purchasedAt,
      expires_at: params.expiresAt,
      credits_remaining: params.creditsRemaining,
      status: params.status ?? AI_CREDIT_PURCHASE_STATUS.active,
    });
  });
};

const expectLimitReached = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    throw new Error("Expected limit error");
  } catch (error) {
    expect(parseAiCreditErrorCode(error)).toBe(AI_CREDIT_ERROR_CODE.limitReached);
  }
};

describe("convex ai credit functions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deducts from the monthly allowance before purchased credits", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_ai_allowance_first";
    const period = await seedSubscription(t, orgId, "starter");

    await insertPurchase(t, {
      id: "aicp_allowance_first",
      orgId,
      creditsRemaining: 3,
      purchasedAt: "2026-03-01T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });
    await insertAiCreditsRow(t, {
      orgId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      allowanceTotal: getAiCreditAllowanceForTier(SUBSCRIPTION_TIER.starter),
      allowanceUsed: 0,
      purchasedBalance: 3,
    });

    await t.mutation(refs.deductAiCredit, {
      org_id: orgId,
    });

    const [row, purchase] = await Promise.all([
      t.run((ctx) =>
        ctx.db
          .query("ai_credits")
          .withIndex("by_org_period", (q) =>
            q.eq("org_id", orgId).eq("period_start", period.periodStart),
          )
          .unique(),
      ),
      t.run((ctx) =>
        ctx.db
          .query("ai_credit_purchases")
          .withIndex("by_custom_id", (q) => q.eq("id", "aicp_allowance_first"))
          .unique(),
      ),
    ]);

    expect(row?.allowance_used).toBe(1);
    expect(row?.purchased_balance).toBe(3);
    expect(purchase?.credits_remaining).toBe(3);
  });

  it("uses the oldest purchased credit once the allowance is exhausted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_ai_oldest_purchase";
    const period = await seedSubscription(t, orgId, "free");

    await insertAiCreditsRow(t, {
      orgId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      allowanceTotal: 1,
      allowanceUsed: 1,
      purchasedBalance: 2,
    });
    await insertPurchase(t, {
      id: "aicp_oldest",
      orgId,
      creditsRemaining: 1,
      purchasedAt: "2026-03-01T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });
    await insertPurchase(t, {
      id: "aicp_newer",
      orgId,
      creditsRemaining: 1,
      purchasedAt: "2026-03-10T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });

    const balance = await t.mutation(refs.deductAiCredit, {
      org_id: orgId,
    });

    const [oldest, newer, row] = await Promise.all([
      t.run((ctx) =>
        ctx.db
          .query("ai_credit_purchases")
          .withIndex("by_custom_id", (q) => q.eq("id", "aicp_oldest"))
          .unique(),
      ),
      t.run((ctx) =>
        ctx.db
          .query("ai_credit_purchases")
          .withIndex("by_custom_id", (q) => q.eq("id", "aicp_newer"))
          .unique(),
      ),
      t.run((ctx) =>
        ctx.db
          .query("ai_credits")
          .withIndex("by_org_period", (q) =>
            q.eq("org_id", orgId).eq("period_start", period.periodStart),
          )
          .unique(),
      ),
    ]);

    expect(oldest?.credits_remaining).toBe(0);
    expect(oldest?.status).toBe(AI_CREDIT_PURCHASE_STATUS.depleted);
    expect(newer?.credits_remaining).toBe(1);
    expect(row?.purchased_balance).toBe(1);
    expect(balance.purchased_remaining).toBe(1);
  });

  it("consumes purchased credits in FIFO order", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_ai_fifo";
    const period = await seedSubscription(t, orgId, "free");

    await insertAiCreditsRow(t, {
      orgId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      allowanceTotal: 0,
      allowanceUsed: 0,
      purchasedBalance: 3,
    });
    await insertPurchase(t, {
      id: "aicp_fifo_1",
      orgId,
      creditsRemaining: 1,
      purchasedAt: "2026-03-01T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });
    await insertPurchase(t, {
      id: "aicp_fifo_2",
      orgId,
      creditsRemaining: 1,
      purchasedAt: "2026-03-02T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });
    await insertPurchase(t, {
      id: "aicp_fifo_3",
      orgId,
      creditsRemaining: 1,
      purchasedAt: "2026-03-03T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });

    await t.mutation(refs.deductAiCredit, { org_id: orgId });
    await t.mutation(refs.deductAiCredit, { org_id: orgId });
    await t.mutation(refs.deductAiCredit, { org_id: orgId });

    const purchases = await t.run((ctx) =>
      ctx.db
        .query("ai_credit_purchases")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .collect(),
    );

    expect(
      purchases
        .sort((left, right) => left.purchased_at.localeCompare(right.purchased_at))
        .map((purchase) => ({
          id: purchase.id,
          credits_remaining: purchase.credits_remaining,
          status: purchase.status,
        })),
    ).toEqual([
      {
        id: "aicp_fifo_1",
        credits_remaining: 0,
        status: AI_CREDIT_PURCHASE_STATUS.depleted,
      },
      {
        id: "aicp_fifo_2",
        credits_remaining: 0,
        status: AI_CREDIT_PURCHASE_STATUS.depleted,
      },
      {
        id: "aicp_fifo_3",
        credits_remaining: 0,
        status: AI_CREDIT_PURCHASE_STATUS.depleted,
      },
    ]);
  });

  it("throws the canonical limit error when all credits are exhausted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_ai_exhausted";
    const period = await seedSubscription(t, orgId, "free");

    await insertAiCreditsRow(t, {
      orgId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      allowanceTotal: 0,
      allowanceUsed: 0,
      purchasedBalance: 0,
    });

    await expectLimitReached(() =>
      t.mutation(refs.deductAiCredit, {
        org_id: orgId,
      }),
    );
  });

  it("expires purchases older than ninety days and zeros their balances", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_ai_expire";
    const period = await seedSubscription(t, orgId, "starter");

    await insertAiCreditsRow(t, {
      orgId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      allowanceTotal: getAiCreditAllowanceForTier(SUBSCRIPTION_TIER.starter),
      allowanceUsed: 0,
      purchasedBalance: 3,
    });
    await insertPurchase(t, {
      id: "aicp_expired",
      orgId,
      creditsRemaining: 3,
      purchasedAt: "2025-11-01T00:00:00.000Z",
      expiresAt: "2026-03-01T00:00:00.000Z",
    });

    const result = await t.mutation(refs.expirePurchasedCredits, {});
    expect(result.expired_count).toBe(1);

    const [purchase, row] = await Promise.all([
      t.run((ctx) =>
        ctx.db
          .query("ai_credit_purchases")
          .withIndex("by_custom_id", (q) => q.eq("id", "aicp_expired"))
          .unique(),
      ),
      t.run((ctx) =>
        ctx.db
          .query("ai_credits")
          .withIndex("by_org_period", (q) =>
            q.eq("org_id", orgId).eq("period_start", period.periodStart),
          )
          .unique(),
      ),
    ]);

    expect(purchase?.status).toBe(AI_CREDIT_PURCHASE_STATUS.expired);
    expect(purchase?.credits_remaining).toBe(0);
    expect(row?.purchased_balance).toBe(0);
  });

  it("does not expire purchases that are still inside the ninety day window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_ai_not_expired";
    const period = await seedSubscription(t, orgId, "starter");

    await insertAiCreditsRow(t, {
      orgId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      allowanceTotal: getAiCreditAllowanceForTier(SUBSCRIPTION_TIER.starter),
      allowanceUsed: 0,
      purchasedBalance: 2,
    });
    await insertPurchase(t, {
      id: "aicp_still_valid",
      orgId,
      creditsRemaining: 2,
      purchasedAt: "2026-03-01T00:00:00.000Z",
      expiresAt: "2026-04-15T00:00:00.000Z",
    });

    const result = await t.mutation(refs.expirePurchasedCredits, {});
    expect(result.expired_count).toBe(0);

    const purchase = await t.run((ctx) =>
      ctx.db
        .query("ai_credit_purchases")
        .withIndex("by_custom_id", (q) => q.eq("id", "aicp_still_valid"))
        .unique(),
    );

    expect(purchase?.status).toBe(AI_CREDIT_PURCHASE_STATUS.active);
    expect(purchase?.credits_remaining).toBe(2);
  });

  it("rejects runtime credit usage on free tier orgs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_ai_runtime_free";

    await seedSubscription(t, orgId, "free");

    await expectLimitReached(() =>
      t.mutation(refs.deductAiCredit, {
        org_id: orgId,
        usage_source: AI_CREDIT_USAGE_SOURCE.runtime,
      }),
    );
  });

  it("creates a new monthly allowance row with zero usage", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_ai_reset";
    await seedSubscription(t, orgId, "starter");

    await insertPurchase(t, {
      id: "aicp_reset_1",
      orgId,
      creditsRemaining: 2,
      purchasedAt: "2026-03-01T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });
    await insertPurchase(t, {
      id: "aicp_reset_2",
      orgId,
      creditsRemaining: 3,
      purchasedAt: "2026-03-05T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });

    const reset = await t.mutation(refs.resetMonthlyAllowance, {
      org_id: orgId,
      period_start: "2026-04-01T00:00:00.000Z",
      period_end: "2026-05-01T00:00:00.000Z",
    });

    expect(reset.allowance_used).toBe(0);
    expect(reset.allowance_total).toBe(getAiCreditAllowanceForTier(SUBSCRIPTION_TIER.starter));
    expect(reset.purchased_balance).toBe(5);
  });

  it("persists one-time reset rows when purchased credits still remain", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_ai_one_time_reset_with_purchase";

    const period = await seedSubscription(t, orgId, "free");
    await insertPurchase(t, {
      id: "aicp_one_time_reset_1",
      orgId,
      creditsRemaining: 4,
      purchasedAt: "2026-03-05T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });
    await insertAiCreditsRow(t, {
      orgId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      allowanceTotal: 0,
      allowanceResetPeriod: "one_time",
      allowanceUsed: 20,
      purchasedBalance: 4,
    });

    const reset = await t.mutation(refs.resetMonthlyAllowance, {
      org_id: orgId,
      period_start: "2026-04-01T00:00:00.000Z",
      period_end: "2026-05-01T00:00:00.000Z",
    });

    expect(reset.allowance_total).toBe(0);
    expect(reset.allowance_reset_period).toBe("one_time");
    expect(reset.purchased_balance).toBe(4);

    const persisted = await t.run((ctx) =>
      ctx.db
        .query("ai_credits")
        .withIndex("by_org_period", (q) =>
          q.eq("org_id", orgId).eq("period_start", "2026-04-01T00:00:00.000Z"),
        )
        .unique(),
    );
    expect(persisted?.period_start).toBe("2026-04-01T00:00:00.000Z");
    expect(persisted?.allowance_total).toBe(0);
    expect(persisted?.purchased_balance).toBe(4);
  });
});
