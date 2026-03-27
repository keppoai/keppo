import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { API_DEDUPE_SCOPE } from "../packages/shared/src/domain.js";
import { type Doc } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { deterministicIdFor, nowIso, randomIdFor, requireOrgMember, type Role } from "./_auth";
import {
  AUTOMATION_RUN_TOPUP_PURCHASE_STATUS,
  API_DEDUPE_STATUS,
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  NOTIFICATION_EVENT_ID,
  USER_ROLES,
  type AuditActorType,
} from "./domain_constants";
import { pickFields } from "./field_mapper";
import { automationRunTopupPurchaseStatusValidator } from "./validators";
import { AUTOMATION_RUN_TOPUP_EXPIRY_DAYS } from "../packages/shared/src/automations.js";
import { getDefaultBillingPeriod } from "../packages/shared/src/subscriptions.js";

const refs = {
  getSubscriptionForOrg: makeFunctionReference<"query">("billing:getSubscriptionForOrg"),
  emitNotificationForOrg: makeFunctionReference<"mutation">("notifications:emitNotificationForOrg"),
  claimApiDedupeKey: makeFunctionReference<"mutation">("api_dedupe:claimApiDedupeKey"),
  completeApiDedupeKey: makeFunctionReference<"mutation">("api_dedupe:completeApiDedupeKey"),
};

const automationRunTopupBalanceValidator = v.object({
  purchased_runs_balance: v.number(),
  purchased_tool_calls_balance: v.number(),
  purchased_tool_call_time_ms_balance: v.number(),
});

const automationRunTopupsRowValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  period_start: v.string(),
  period_end: v.string(),
  purchased_runs_balance: v.number(),
  purchased_tool_calls_balance: v.number(),
  purchased_tool_call_time_ms_balance: v.number(),
  updated_at: v.string(),
});

const automationRunTopupPurchaseValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  tier_at_purchase: v.string(),
  multiplier: v.string(),
  runs_total: v.number(),
  runs_remaining: v.number(),
  tool_calls_total: v.number(),
  tool_calls_remaining: v.number(),
  tool_call_time_ms: v.number(),
  price_cents: v.number(),
  stripe_payment_intent_id: v.union(v.string(), v.null()),
  purchased_at: v.string(),
  expires_at: v.string(),
  status: automationRunTopupPurchaseStatusValidator,
});

const automationRunTopupsRowFields = [
  "id",
  "org_id",
  "period_start",
  "period_end",
  "purchased_runs_balance",
  "purchased_tool_calls_balance",
  "purchased_tool_call_time_ms_balance",
  "updated_at",
] as const satisfies readonly (keyof Doc<"automation_run_topups">)[];

const automationRunTopupPurchaseFields = [
  "id",
  "org_id",
  "tier_at_purchase",
  "multiplier",
  "runs_total",
  "runs_remaining",
  "tool_calls_total",
  "tool_calls_remaining",
  "tool_call_time_ms",
  "price_cents",
  "stripe_payment_intent_id",
  "purchased_at",
  "expires_at",
  "status",
] as const satisfies readonly (keyof Doc<"automation_run_topup_purchases">)[];

const toAutomationRunTopupsRow = (row: Doc<"automation_run_topups">) =>
  pickFields(row, automationRunTopupsRowFields);

const toAutomationRunTopupPurchase = (row: Doc<"automation_run_topup_purchases">) =>
  pickFields(row, automationRunTopupPurchaseFields);

const zeroAutomationRunTopupBalance = () => ({
  purchased_runs_balance: 0,
  purchased_tool_calls_balance: 0,
  purchased_tool_call_time_ms_balance: 0,
});

const resolveBillingPeriod = (
  subscription:
    | {
        current_period_start: string;
        current_period_end: string;
      }
    | null
    | undefined,
) => {
  if (
    subscription?.current_period_start &&
    subscription.current_period_start.length > 0 &&
    subscription.current_period_end &&
    subscription.current_period_end.length > 0
  ) {
    return {
      periodStart: subscription.current_period_start,
      periodEnd: subscription.current_period_end,
    };
  }
  return getDefaultBillingPeriod(new Date());
};

const ensureSameOrgMembership = async (
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  allowedRoles: readonly Role[] = USER_ROLES,
) => {
  const auth = await requireOrgMember(ctx, allowedRoles);
  if (auth.orgId !== orgId) {
    throw new Error("Forbidden");
  }
  return auth;
};

const getAutomationRunTopupsRow = async (
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  periodStart: string,
) => {
  return await ctx.db
    .query("automation_run_topups")
    .withIndex("by_org_period", (q) => q.eq("org_id", orgId).eq("period_start", periodStart))
    .first();
};

const getSubscriptionForOrgRow = async (ctx: QueryCtx | MutationCtx, orgId: string) => {
  return await ctx.db
    .query("subscriptions")
    .withIndex("by_org", (q) => q.eq("org_id", orgId))
    .first();
};

const listUnexpiredPurchases = async (ctx: QueryCtx | MutationCtx, orgId: string, now: string) => {
  const rows = await ctx.db
    .query("automation_run_topup_purchases")
    .withIndex("by_org", (q) => q.eq("org_id", orgId))
    .collect();
  return rows
    .filter(
      (row) => row.status !== AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.expired && row.expires_at > now,
    )
    .sort((a, b) => a.purchased_at.localeCompare(b.purchased_at));
};

export const listActivePurchases = async (
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  now: string,
) => {
  const rows = await ctx.db
    .query("automation_run_topup_purchases")
    .withIndex("by_org_active", (q) =>
      q.eq("org_id", orgId).eq("status", AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.active),
    )
    .collect();
  return rows
    .filter(
      (row) => row.expires_at > now && (row.runs_remaining > 0 || row.tool_calls_remaining > 0),
    )
    .sort((a, b) => a.purchased_at.localeCompare(b.purchased_at));
};

const sumBalances = (
  rows: Array<{
    runs_remaining: number;
    tool_calls_remaining: number;
    tool_call_time_ms: number;
  }>,
) => ({
  purchased_runs_balance: rows.reduce((sum, row) => sum + Math.max(0, row.runs_remaining), 0),
  purchased_tool_calls_balance: rows.reduce(
    (sum, row) => sum + Math.max(0, row.tool_calls_remaining),
    0,
  ),
  purchased_tool_call_time_ms_balance: rows.reduce((sum, row) => sum + row.tool_call_time_ms, 0),
});

export const ensureTopupLedgerRow = async (
  ctx: MutationCtx,
  params: { orgId: string; periodStart: string; periodEnd: string },
) => {
  const id = await deterministicIdFor("art", `${params.orgId}:${params.periodStart}`);
  const existingById = await ctx.db
    .query("automation_run_topups")
    .withIndex("by_custom_id", (q) => q.eq("id", id))
    .first();
  if (existingById) {
    return existingById;
  }
  const existing = await getAutomationRunTopupsRow(ctx, params.orgId, params.periodStart);
  if (existing) {
    return existing;
  }
  await ctx.db.insert("automation_run_topups", {
    id,
    org_id: params.orgId,
    period_start: params.periodStart,
    period_end: params.periodEnd,
    purchased_runs_balance: 0,
    purchased_tool_calls_balance: 0,
    purchased_tool_call_time_ms_balance: 0,
    updated_at: nowIso(),
  });
  const created = await ctx.db
    .query("automation_run_topups")
    .withIndex("by_custom_id", (q) => q.eq("id", id))
    .first();
  if (!created) {
    throw new Error("FailedToCreateAutomationRunTopupLedger");
  }
  return created;
};

const addAuditEvent = async (
  ctx: MutationCtx,
  params: {
    orgId: string;
    actorId: string;
    actorType: AuditActorType;
    eventType: (typeof AUDIT_EVENT_TYPES)[keyof typeof AUDIT_EVENT_TYPES];
    payload: Record<string, unknown>;
  },
) => {
  await ctx.db.insert("audit_events", {
    id: randomIdFor("audit"),
    org_id: params.orgId,
    actor_type: params.actorType,
    actor_id: params.actorId,
    event_type: params.eventType,
    payload: params.payload,
    created_at: nowIso(),
  });
};

export const recomputeBalances = async (
  ctx: MutationCtx,
  orgId: string,
  periodStart: string,
  periodEnd: string,
) => {
  const row = await ensureTopupLedgerRow(ctx, {
    orgId,
    periodStart,
    periodEnd,
  });
  const balances = sumBalances(await listUnexpiredPurchases(ctx, orgId, nowIso()));
  await ctx.db.patch(row._id, {
    ...balances,
    updated_at: nowIso(),
  });
  const updated = await ctx.db
    .query("automation_run_topups")
    .withIndex("by_custom_id", (q) => q.eq("id", row.id))
    .first();
  if (!updated) {
    throw new Error("FailedToRecomputeAutomationRunTopupBalances");
  }
  return toAutomationRunTopupsRow(updated);
};

export const getAutomationRunTopupBalanceForOrg = async (
  ctx: QueryCtx | MutationCtx,
  orgId: string,
): Promise<{
  purchased_runs_balance: number;
  purchased_tool_calls_balance: number;
  purchased_tool_call_time_ms_balance: number;
}> => {
  const subscription = await getSubscriptionForOrgRow(ctx, orgId);
  const period = resolveBillingPeriod(subscription);
  const row = await getAutomationRunTopupsRow(ctx, orgId, period.periodStart);
  if (row) {
    return {
      purchased_runs_balance: row.purchased_runs_balance,
      purchased_tool_calls_balance: row.purchased_tool_calls_balance,
      purchased_tool_call_time_ms_balance: row.purchased_tool_call_time_ms_balance,
    };
  }
  const purchases = await listUnexpiredPurchases(ctx, orgId, nowIso());
  return purchases.length > 0 ? sumBalances(purchases) : zeroAutomationRunTopupBalance();
};

export const getAutomationRunTopupBalance = query({
  args: {
    org_id: v.string(),
  },
  returns: automationRunTopupBalanceValidator,
  handler: async (ctx, args) => {
    await ensureSameOrgMembership(ctx, args.org_id);
    return await getAutomationRunTopupBalanceForOrg(ctx, args.org_id);
  },
});

export const getAutomationRunTopupBalanceForOrgInternal = internalQuery({
  args: {
    org_id: v.string(),
  },
  returns: automationRunTopupBalanceValidator,
  handler: async (ctx, args) => {
    return await getAutomationRunTopupBalanceForOrg(ctx, args.org_id);
  },
});

export const getAutomationRunTopupsRowForOrgInternal = internalQuery({
  args: {
    org_id: v.string(),
    period_start: v.string(),
  },
  returns: v.union(automationRunTopupsRowValidator, v.null()),
  handler: async (ctx, args) => {
    const row = await getAutomationRunTopupsRow(ctx, args.org_id, args.period_start);
    return row ? toAutomationRunTopupsRow(row) : null;
  },
});

export const addPurchasedAutomationRuns = internalMutation({
  args: {
    orgId: v.string(),
    tier: v.string(),
    multiplier: v.string(),
    runs: v.number(),
    toolCalls: v.number(),
    toolCallTimeMs: v.number(),
    priceCents: v.number(),
    stripePaymentIntentId: v.union(v.string(), v.null()),
  },
  returns: automationRunTopupPurchaseValidator,
  handler: async (ctx, args) => {
    const now = nowIso();
    const expiresAt = new Date(
      Date.now() + AUTOMATION_RUN_TOPUP_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const subscription = await ctx.runQuery(refs.getSubscriptionForOrg, {
      orgId: args.orgId,
    });
    const period = resolveBillingPeriod(subscription);
    await ensureTopupLedgerRow(ctx, {
      orgId: args.orgId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    });

    const id = randomIdFor("artp");
    await ctx.db.insert("automation_run_topup_purchases", {
      id,
      org_id: args.orgId,
      tier_at_purchase: args.tier,
      multiplier: args.multiplier,
      runs_total: args.runs,
      runs_remaining: args.runs,
      tool_calls_total: args.toolCalls,
      tool_calls_remaining: args.toolCalls,
      tool_call_time_ms: args.toolCallTimeMs,
      price_cents: args.priceCents,
      stripe_payment_intent_id: args.stripePaymentIntentId,
      purchased_at: now,
      expires_at: expiresAt,
      status: AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.active,
    });

    await recomputeBalances(ctx, args.orgId, period.periodStart, period.periodEnd);
    await addAuditEvent(ctx, {
      orgId: args.orgId,
      actorType: AUDIT_ACTOR_TYPE.system,
      actorId: "automation_run_topups",
      eventType: AUDIT_EVENT_TYPES.automationRunTopupPurchased,
      payload: {
        tier_at_purchase: args.tier,
        multiplier: args.multiplier,
        runs: args.runs,
        tool_calls: args.toolCalls,
        tool_call_time_ms: args.toolCallTimeMs,
        price_cents: args.priceCents,
        stripe_payment_intent_id: args.stripePaymentIntentId,
        expires_at: expiresAt,
      },
    });

    const created = await ctx.db
      .query("automation_run_topup_purchases")
      .withIndex("by_custom_id", (q) => q.eq("id", id))
      .unique();
    if (!created) {
      throw new Error("FailedToCreateAutomationRunTopupPurchase");
    }
    return toAutomationRunTopupPurchase(created);
  },
});

const resolveCurrentPeriodForOrg = async (ctx: MutationCtx, orgId: string) => {
  const subscription = await getSubscriptionForOrgRow(ctx, orgId);
  return resolveBillingPeriod(subscription);
};

export const deductPurchasedRunInPlace = async (ctx: MutationCtx, orgId: string) => {
  const oldest =
    (await listActivePurchases(ctx, orgId, nowIso())).find((row) => row.runs_remaining > 0) ?? null;
  if (!oldest) {
    throw new Error("AutomationRunTopupRunBalanceDepleted");
  }
  const nextRunsRemaining = Math.max(0, oldest.runs_remaining - 1);
  await ctx.db.patch(oldest._id, {
    runs_remaining: nextRunsRemaining,
    status:
      nextRunsRemaining <= 0 && oldest.tool_calls_remaining <= 0
        ? AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.depleted
        : AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.active,
  });
  const period = await resolveCurrentPeriodForOrg(ctx, orgId);
  await recomputeBalances(ctx, orgId, period.periodStart, period.periodEnd);
  await addAuditEvent(ctx, {
    orgId,
    actorType: AUDIT_ACTOR_TYPE.system,
    actorId: "automation_run_topups",
    eventType: AUDIT_EVENT_TYPES.automationRunTopupDeducted,
    payload: {
      purchase_id: oldest.id,
      resource_type: "run",
      remaining_runs: nextRunsRemaining,
    },
  });
  return await getAutomationRunTopupBalanceForOrg(ctx, orgId);
};

export const deductPurchasedToolCallInPlace = async (ctx: MutationCtx, orgId: string) => {
  const oldest =
    (await listActivePurchases(ctx, orgId, nowIso())).find((row) => row.tool_calls_remaining > 0) ??
    null;
  if (!oldest) {
    throw new Error("AutomationRunTopupToolCallBalanceDepleted");
  }
  const nextToolCallsRemaining = Math.max(0, oldest.tool_calls_remaining - 1);
  await ctx.db.patch(oldest._id, {
    tool_calls_remaining: nextToolCallsRemaining,
    status:
      oldest.runs_remaining <= 0 && nextToolCallsRemaining <= 0
        ? AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.depleted
        : AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.active,
  });
  const period = await resolveCurrentPeriodForOrg(ctx, orgId);
  await recomputeBalances(ctx, orgId, period.periodStart, period.periodEnd);
  await addAuditEvent(ctx, {
    orgId,
    actorType: AUDIT_ACTOR_TYPE.system,
    actorId: "automation_run_topups",
    eventType: AUDIT_EVENT_TYPES.automationRunTopupDeducted,
    payload: {
      purchase_id: oldest.id,
      resource_type: "tool_call",
      remaining_tool_calls: nextToolCallsRemaining,
    },
  });
  return await getAutomationRunTopupBalanceForOrg(ctx, orgId);
};

export const deductPurchasedRun = internalMutation({
  args: {
    orgId: v.string(),
  },
  returns: automationRunTopupBalanceValidator,
  handler: async (ctx, args) => {
    return await deductPurchasedRunInPlace(ctx, args.orgId);
  },
});

export const deductPurchasedToolCall = internalMutation({
  args: {
    orgId: v.string(),
  },
  returns: automationRunTopupBalanceValidator,
  handler: async (ctx, args) => {
    return await deductPurchasedToolCallInPlace(ctx, args.orgId);
  },
});

export const expirePurchasedTopups = internalMutation({
  args: {},
  returns: v.object({
    expired_count: v.number(),
  }),
  handler: async (ctx) => {
    const now = nowIso();
    const nowMs = Date.parse(now);
    const sixDaysMs = 6 * 24 * 60 * 60 * 1000;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const sevenDaysFromNow = new Date(nowMs + sevenDaysMs).toISOString();
    const expiredCandidates = await ctx.db
      .query("automation_run_topup_purchases")
      .withIndex("by_expires_at", (q) => q.lt("expires_at", now))
      .collect();
    const expiringCandidates = await ctx.db
      .query("automation_run_topup_purchases")
      .withIndex("by_expires_at", (q) =>
        q.gte("expires_at", now).lt("expires_at", sevenDaysFromNow),
      )
      .collect();

    const affectedOrgs = new Set<string>();
    const expiredByOrg = new Map<string, { runs: number; toolCalls: number; count: number }>();
    let expiredCount = 0;

    for (const row of expiredCandidates) {
      if (row.status === AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.expired) {
        continue;
      }
      await ctx.db.patch(row._id, {
        status: AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.expired,
        runs_remaining: 0,
        tool_calls_remaining: 0,
      });
      affectedOrgs.add(row.org_id);
      expiredCount += 1;
      const current = expiredByOrg.get(row.org_id) ?? {
        runs: 0,
        toolCalls: 0,
        count: 0,
      };
      expiredByOrg.set(row.org_id, {
        runs: current.runs + row.runs_remaining,
        toolCalls: current.toolCalls + row.tool_calls_remaining,
        count: current.count + 1,
      });
    }

    for (const orgId of affectedOrgs) {
      const period = await resolveCurrentPeriodForOrg(ctx, orgId);
      await recomputeBalances(ctx, orgId, period.periodStart, period.periodEnd);
      const expired = expiredByOrg.get(orgId);
      if (!expired) {
        continue;
      }
      await addAuditEvent(ctx, {
        orgId,
        actorType: AUDIT_ACTOR_TYPE.system,
        actorId: "automation_run_topups",
        eventType: AUDIT_EVENT_TYPES.automationRunTopupExpired,
        payload: {
          expired_purchase_count: expired.count,
          runs: expired.runs,
          tool_calls: expired.toolCalls,
        },
      });
    }

    const expiringByOrg = new Map<string, { runs: number; toolCalls: number }>();
    for (const row of expiringCandidates) {
      if (
        row.status !== AUTOMATION_RUN_TOPUP_PURCHASE_STATUS.active ||
        (row.runs_remaining <= 0 && row.tool_calls_remaining <= 0)
      ) {
        continue;
      }
      const expiresAtMs = Date.parse(row.expires_at);
      if (Number.isNaN(expiresAtMs)) {
        continue;
      }
      const remainingMs = expiresAtMs - nowMs;
      if (remainingMs <= sixDaysMs || remainingMs > sevenDaysMs) {
        continue;
      }
      const current = expiringByOrg.get(row.org_id) ?? {
        runs: 0,
        toolCalls: 0,
      };
      expiringByOrg.set(row.org_id, {
        runs: current.runs + row.runs_remaining,
        toolCalls: current.toolCalls + row.tool_calls_remaining,
      });
    }

    for (const [orgId, resources] of expiringByOrg.entries()) {
      const dedupeKey = `automation-run-topups-expiring:${orgId}:${new Date(nowMs + sixDaysMs).toISOString().slice(0, 13)}`;
      const claimed = await ctx.runMutation(refs.claimApiDedupeKey, {
        scope: API_DEDUPE_SCOPE.webhookDelivery,
        dedupeKey,
        ttlMs: sevenDaysMs,
        initialStatus: API_DEDUPE_STATUS.pending,
      });
      if (!claimed.claimed) {
        continue;
      }
      await ctx.runMutation(refs.emitNotificationForOrg, {
        orgId,
        eventType: NOTIFICATION_EVENT_ID.automationRunTopupsExpiring,
        context: {
          orgId,
          orgName: orgId,
          runs: resources.runs,
          toolCalls: resources.toolCalls,
          daysRemaining: 7,
        },
        metadata: {
          runs: resources.runs,
          tool_calls: resources.toolCalls,
        },
      });
      await ctx.runMutation(refs.completeApiDedupeKey, {
        scope: API_DEDUPE_SCOPE.webhookDelivery,
        dedupeKey,
      });
    }

    return {
      expired_count: expiredCount,
    };
  },
});
