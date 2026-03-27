import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTOMATION_RUN_TOPUP_PURCHASE_STATUS,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TIER,
} from "../../convex/domain_constants";
import {
  getAutomationRunTopupBalanceForOrg,
  recomputeBalances,
} from "../../convex/automation_run_topups";
import { AUTOMATION_RUN_TOPUP_EXPIRY_DAYS } from "../../packages/shared/src/automations.js";
import { getDefaultBillingPeriod } from "../../packages/shared/src/subscriptions.js";
import { createConvexTestHarness } from "./harness";

const refs = {
  upsertSubscriptionForOrg: makeFunctionReference<"mutation">(
    "billing/subscriptions:upsertSubscriptionForOrg",
  ),
  addPurchasedAutomationRuns: makeFunctionReference<"mutation">(
    "automation_run_topups:addPurchasedAutomationRuns",
  ),
  deductPurchasedRun: makeFunctionReference<"mutation">("automation_run_topups:deductPurchasedRun"),
  deductPurchasedToolCall: makeFunctionReference<"mutation">(
    "automation_run_topups:deductPurchasedToolCall",
  ),
  expirePurchasedTopups: makeFunctionReference<"mutation">(
    "automation_run_topups:expirePurchasedTopups",
  ),
};

const seedSubscription = async (t: ReturnType<typeof createConvexTestHarness>, orgId: string) => {
  const period = getDefaultBillingPeriod(new Date());
  await t.mutation(refs.upsertSubscriptionForOrg, {
    orgId,
    tier: SUBSCRIPTION_TIER.starter,
    status: SUBSCRIPTION_STATUS.active,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    currentPeriodStart: period.periodStart,
    currentPeriodEnd: period.periodEnd,
  });
  return period;
};

const insertPurchase = async (
  t: ReturnType<typeof createConvexTestHarness>,
  params: {
    id: string;
    orgId: string;
    runsRemaining: number;
    toolCallsRemaining: number;
    toolCallTimeMs: number;
    purchasedAt: string;
    expiresAt: string;
    status?: (typeof AUTOMATION_RUN_TOPUP_PURCHASE_STATUS)[keyof typeof AUTOMATION_RUN_TOPUP_PURCHASE_STATUS];
  },
) => {
  await t.run(async (ctx) => {
    await ctx.db.insert("automation_run_topup_purchases", {
      id: params.id,
      org_id: params.orgId,
      tier_at_purchase: SUBSCRIPTION_TIER.starter,
      multiplier: "x1",
      runs_total: params.runsRemaining,
      runs_remaining: params.runsRemaining,
      tool_calls_total: params.toolCallsRemaining,
      tool_calls_remaining: params.toolCallsRemaining,
      tool_call_time_ms: params.toolCallTimeMs,
      price_cents: 2500,
      stripe_payment_intent_id: null,
      purchased_at: params.purchasedAt,
      expires_at: params.expiresAt,
      status: params.status ?? AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.active,
    });
  });
};

describe("convex automation run topup functions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates purchased topups with the expected balances and ninety-day expiry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_topups_add";
    const period = await seedSubscription(t, orgId);

    const purchase = await t.mutation(refs.addPurchasedAutomationRuns, {
      orgId,
      tier: SUBSCRIPTION_TIER.starter,
      multiplier: "x2",
      runs: 5,
      toolCalls: 20,
      toolCallTimeMs: 120_000,
      priceCents: 2500,
      stripePaymentIntentId: "pi_topup_add",
    });

    expect(purchase.runs_remaining).toBe(5);
    expect(purchase.tool_calls_remaining).toBe(20);
    expect(purchase.tool_call_time_ms).toBe(120_000);
    expect(purchase.expires_at).toBe(
      new Date(Date.now() + AUTOMATION_RUN_TOPUP_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    );

    const ledger = await t.run((ctx) =>
      ctx.db
        .query("automation_run_topups")
        .withIndex("by_org_period", (q) =>
          q.eq("org_id", orgId).eq("period_start", period.periodStart),
        )
        .unique(),
    );

    expect(ledger?.purchased_runs_balance).toBe(5);
    expect(ledger?.purchased_tool_calls_balance).toBe(20);
    expect(ledger?.purchased_tool_call_time_ms_balance).toBe(120_000);
  });

  it("deducts purchased runs from the oldest active purchase", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_topups_deduct_run";
    const period = await seedSubscription(t, orgId);

    await insertPurchase(t, {
      id: "artp_run_oldest",
      orgId,
      runsRemaining: 1,
      toolCallsRemaining: 2,
      toolCallTimeMs: 60_000,
      purchasedAt: "2026-03-01T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });
    await insertPurchase(t, {
      id: "artp_run_newer",
      orgId,
      runsRemaining: 1,
      toolCallsRemaining: 2,
      toolCallTimeMs: 60_000,
      purchasedAt: "2026-03-10T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });

    await t.run(async (ctx) => {
      await recomputeBalances(ctx, orgId, period.periodStart, period.periodEnd);
    });

    await t.mutation(refs.deductPurchasedRun, { orgId });

    const [oldest, newer] = await Promise.all([
      t.run((ctx) =>
        ctx.db
          .query("automation_run_topup_purchases")
          .withIndex("by_custom_id", (q) => q.eq("id", "artp_run_oldest"))
          .unique(),
      ),
      t.run((ctx) =>
        ctx.db
          .query("automation_run_topup_purchases")
          .withIndex("by_custom_id", (q) => q.eq("id", "artp_run_newer"))
          .unique(),
      ),
    ]);

    expect(oldest?.runs_remaining).toBe(0);
    expect(newer?.runs_remaining).toBe(1);
  });

  it("deducts purchased tool calls from the oldest active purchase", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_topups_deduct_tool";
    const period = await seedSubscription(t, orgId);

    await insertPurchase(t, {
      id: "artp_tool_oldest",
      orgId,
      runsRemaining: 2,
      toolCallsRemaining: 1,
      toolCallTimeMs: 60_000,
      purchasedAt: "2026-03-01T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });
    await insertPurchase(t, {
      id: "artp_tool_newer",
      orgId,
      runsRemaining: 2,
      toolCallsRemaining: 1,
      toolCallTimeMs: 60_000,
      purchasedAt: "2026-03-10T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });

    await t.run(async (ctx) => {
      await recomputeBalances(ctx, orgId, period.periodStart, period.periodEnd);
    });

    await t.mutation(refs.deductPurchasedToolCall, { orgId });

    const [oldest, newer] = await Promise.all([
      t.run((ctx) =>
        ctx.db
          .query("automation_run_topup_purchases")
          .withIndex("by_custom_id", (q) => q.eq("id", "artp_tool_oldest"))
          .unique(),
      ),
      t.run((ctx) =>
        ctx.db
          .query("automation_run_topup_purchases")
          .withIndex("by_custom_id", (q) => q.eq("id", "artp_tool_newer"))
          .unique(),
      ),
    ]);

    expect(oldest?.tool_calls_remaining).toBe(0);
    expect(newer?.tool_calls_remaining).toBe(1);
  });

  it("consumes purchased runs in FIFO order across multiple purchases", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_topups_fifo";
    const period = await seedSubscription(t, orgId);

    await insertPurchase(t, {
      id: "artp_fifo_1",
      orgId,
      runsRemaining: 1,
      toolCallsRemaining: 0,
      toolCallTimeMs: 60_000,
      purchasedAt: "2026-03-01T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });
    await insertPurchase(t, {
      id: "artp_fifo_2",
      orgId,
      runsRemaining: 1,
      toolCallsRemaining: 0,
      toolCallTimeMs: 60_000,
      purchasedAt: "2026-03-02T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });
    await insertPurchase(t, {
      id: "artp_fifo_3",
      orgId,
      runsRemaining: 1,
      toolCallsRemaining: 0,
      toolCallTimeMs: 60_000,
      purchasedAt: "2026-03-03T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });

    await t.run(async (ctx) => {
      await recomputeBalances(ctx, orgId, period.periodStart, period.periodEnd);
    });

    await t.mutation(refs.deductPurchasedRun, { orgId });
    await t.mutation(refs.deductPurchasedRun, { orgId });
    await t.mutation(refs.deductPurchasedRun, { orgId });

    const purchases = await t.run((ctx) =>
      ctx.db
        .query("automation_run_topup_purchases")
        .withIndex("by_org", (q) => q.eq("org_id", orgId))
        .collect(),
    );

    expect(
      purchases
        .sort((left, right) => left.purchased_at.localeCompare(right.purchased_at))
        .map((purchase) => ({
          id: purchase.id,
          runs_remaining: purchase.runs_remaining,
          status: purchase.status,
        })),
    ).toEqual([
      {
        id: "artp_fifo_1",
        runs_remaining: 0,
        status: AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.depleted,
      },
      {
        id: "artp_fifo_2",
        runs_remaining: 0,
        status: AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.depleted,
      },
      {
        id: "artp_fifo_3",
        runs_remaining: 0,
        status: AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.depleted,
      },
    ]);
  });

  it("expires old purchases and recomputes the remaining balances", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_topups_expire";
    const period = await seedSubscription(t, orgId);

    await insertPurchase(t, {
      id: "artp_expired",
      orgId,
      runsRemaining: 2,
      toolCallsRemaining: 4,
      toolCallTimeMs: 120_000,
      purchasedAt: "2025-11-01T00:00:00.000Z",
      expiresAt: "2026-03-01T00:00:00.000Z",
    });

    await t.run(async (ctx) => {
      await recomputeBalances(ctx, orgId, period.periodStart, period.periodEnd);
    });

    const result = await t.mutation(refs.expirePurchasedTopups, {});
    expect(result.expired_count).toBe(1);

    const [purchase, ledger] = await Promise.all([
      t.run((ctx) =>
        ctx.db
          .query("automation_run_topup_purchases")
          .withIndex("by_custom_id", (q) => q.eq("id", "artp_expired"))
          .unique(),
      ),
      t.run((ctx) =>
        ctx.db
          .query("automation_run_topups")
          .withIndex("by_org_period", (q) =>
            q.eq("org_id", orgId).eq("period_start", period.periodStart),
          )
          .unique(),
      ),
    ]);

    expect(purchase?.status).toBe(AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.expired);
    expect(purchase?.runs_remaining).toBe(0);
    expect(purchase?.tool_calls_remaining).toBe(0);
    expect(ledger?.purchased_runs_balance).toBe(0);
    expect(ledger?.purchased_tool_calls_balance).toBe(0);
    expect(ledger?.purchased_tool_call_time_ms_balance).toBe(0);
  });

  it("does not expire purchases that are still within the expiry window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_topups_not_expired";
    const period = await seedSubscription(t, orgId);

    await insertPurchase(t, {
      id: "artp_still_valid",
      orgId,
      runsRemaining: 2,
      toolCallsRemaining: 4,
      toolCallTimeMs: 120_000,
      purchasedAt: "2026-03-01T00:00:00.000Z",
      expiresAt: "2026-04-15T00:00:00.000Z",
    });

    await t.run(async (ctx) => {
      await recomputeBalances(ctx, orgId, period.periodStart, period.periodEnd);
    });

    const result = await t.mutation(refs.expirePurchasedTopups, {});
    expect(result.expired_count).toBe(0);

    const purchase = await t.run((ctx) =>
      ctx.db
        .query("automation_run_topup_purchases")
        .withIndex("by_custom_id", (q) => q.eq("id", "artp_still_valid"))
        .unique(),
    );

    expect(purchase?.status).toBe(AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.active);
    expect(purchase?.runs_remaining).toBe(2);
    expect(purchase?.tool_calls_remaining).toBe(4);
  });

  it("sums balances across all unexpired purchases for an org", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_topups_balance";
    await seedSubscription(t, orgId);

    await insertPurchase(t, {
      id: "artp_balance_1",
      orgId,
      runsRemaining: 2,
      toolCallsRemaining: 3,
      toolCallTimeMs: 60_000,
      purchasedAt: "2026-03-01T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });
    await insertPurchase(t, {
      id: "artp_balance_2",
      orgId,
      runsRemaining: 4,
      toolCallsRemaining: 5,
      toolCallTimeMs: 120_000,
      purchasedAt: "2026-03-05T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });
    await insertPurchase(t, {
      id: "artp_balance_expired",
      orgId,
      runsRemaining: 99,
      toolCallsRemaining: 99,
      toolCallTimeMs: 999_000,
      purchasedAt: "2025-11-01T00:00:00.000Z",
      expiresAt: "2026-03-01T00:00:00.000Z",
    });

    const balance = await t.run((ctx) => getAutomationRunTopupBalanceForOrg(ctx, orgId));

    expect(balance).toEqual({
      purchased_runs_balance: 6,
      purchased_tool_calls_balance: 8,
      purchased_tool_call_time_ms_balance: 180_000,
    });
  });

  it("recomputes the ledger row from the actual purchase balances", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-22T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_topups_recompute";
    const period = await seedSubscription(t, orgId);

    await t.run(async (ctx) => {
      await ctx.db.insert("automation_run_topups", {
        id: "art_recompute",
        org_id: orgId,
        period_start: period.periodStart,
        period_end: period.periodEnd,
        purchased_runs_balance: 999,
        purchased_tool_calls_balance: 999,
        purchased_tool_call_time_ms_balance: 999_000,
        updated_at: new Date().toISOString(),
      });
    });
    await insertPurchase(t, {
      id: "artp_recompute_1",
      orgId,
      runsRemaining: 2,
      toolCallsRemaining: 1,
      toolCallTimeMs: 60_000,
      purchasedAt: "2026-03-01T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });
    await insertPurchase(t, {
      id: "artp_recompute_2",
      orgId,
      runsRemaining: 3,
      toolCallsRemaining: 4,
      toolCallTimeMs: 120_000,
      purchasedAt: "2026-03-10T00:00:00.000Z",
      expiresAt: "2026-06-20T12:00:00.000Z",
    });

    const recomputed = await t.run((ctx) =>
      recomputeBalances(ctx, orgId, period.periodStart, period.periodEnd),
    );

    expect(recomputed).toEqual({
      id: "art_recompute",
      org_id: orgId,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      purchased_runs_balance: 5,
      purchased_tool_calls_balance: 5,
      purchased_tool_call_time_ms_balance: 180_000,
      updated_at: recomputed.updated_at,
    });
  });
});
