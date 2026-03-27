import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
  adminKey,
  convexUrl,
  createRandomToken,
  resetAllLocalConvexState,
  runWithOccRetry,
} from "./harness";

const createOrgId = (label: string): string => {
  return `org_race_${label}_${Date.now().toString(36)}_${createRandomToken()}`;
};

const monthPeriod = (): { start: string; end: string } => {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    start: start.toISOString(),
    end: end.toISOString(),
  };
};

const http = new ConvexHttpClient(convexUrl);
(http as { setAdminAuth?: (token: string) => void }).setAdminAuth?.(adminKey);

const refs = {
  reset: makeFunctionReference<"mutation">("e2e:reset"),
  getRaceConditionState: makeFunctionReference<"query">("e2e:getRaceConditionState"),
  upsertSubscriptionForOrg: makeFunctionReference<"mutation">("billing:upsertSubscriptionForOrg"),
  beginToolCall: makeFunctionReference<"mutation">("billing:beginToolCall"),
  deductAiCredit: makeFunctionReference<"mutation">("ai_credits:deductAiCredit"),
};

describe.sequential("Local Convex Race Conditions", () => {
  beforeEach(async () => {
    await resetAllLocalConvexState();
  });

  it("creates one usage meter row under concurrent beginToolCall", async () => {
    const orgId = createOrgId("usage");
    const period = monthPeriod();
    await http.mutation(refs.upsertSubscriptionForOrg, {
      orgId,
      tier: "free",
      status: "active",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
    });

    const attempts = 6;
    await Promise.all(
      Array.from({ length: attempts }, () =>
        runWithOccRetry(() =>
          http.mutation(refs.beginToolCall, {
            orgId,
          }),
        ),
      ),
    );

    const state = await http.query(refs.getRaceConditionState, {
      orgId,
      periodStart: period.start,
    });
    expect(state.subscriptionCount).toBe(1);
    expect(state.usageMeterCount).toBe(1);
    expect(state.usageToolCallCount).toBe(attempts);
  });

  it("creates one ai_credits row under concurrent deductAiCredit", async () => {
    const orgId = createOrgId("credits");
    const period = monthPeriod();
    await http.mutation(refs.upsertSubscriptionForOrg, {
      orgId,
      tier: "free",
      status: "active",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
    });

    const deductions = 4;
    await Promise.all(
      Array.from({ length: deductions }, () =>
        runWithOccRetry(() =>
          http.mutation(refs.deductAiCredit, {
            org_id: orgId,
          }),
        ),
      ),
    );

    const state = await http.query(refs.getRaceConditionState, {
      orgId,
      periodStart: period.start,
    });
    expect(state.subscriptionCount).toBe(1);
    expect(state.aiCreditsCount).toBe(1);
    expect(state.aiAllowanceUsed).toBe(deductions);
  }, 10_000);

  it("keeps one canonical subscription row under concurrent upserts", async () => {
    const orgId = createOrgId("sub");
    const period = monthPeriod();

    const upserts = await Promise.all(
      Array.from({ length: 8 }, () =>
        runWithOccRetry(() =>
          http.mutation(refs.upsertSubscriptionForOrg, {
            orgId,
            tier: "pro",
            status: "active",
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            currentPeriodStart: period.start,
            currentPeriodEnd: period.end,
          }),
        ),
      ),
    );

    const state = await http.query(refs.getRaceConditionState, {
      orgId,
      periodStart: period.start,
    });
    expect(state.subscriptionCount).toBe(1);
    expect(new Set(upserts.map((row) => row.id)).size).toBe(1);
  });
});
