import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
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
  AI_CREDIT_PURCHASE_STATUS,
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  NOTIFICATION_EVENT_ID,
  SUBSCRIPTION_TIER,
  type AuditActorType,
  USER_ROLES,
} from "./domain_constants";
import { pickFields } from "./field_mapper";
import {
  getDefaultBillingPeriod,
  getIncludedAiCreditsForTier,
} from "../packages/shared/src/subscriptions.js";
import {
  supportsBundledAiRuntime,
  AI_CREDIT_USAGE_SOURCE,
  AI_CREDIT_USAGE_SOURCES,
  isGatewayRuntimeEnabled,
  type AiCreditUsageSource,
} from "../packages/shared/src/automations.js";
import {
  AI_CREDIT_ERROR_CODE,
  formatAiCreditErrorPayload,
} from "../packages/shared/src/ai-credit-errors.js";
import { aiCreditPurchaseStatusValidator } from "./validators";

const refs = {
  getSubscriptionForOrg: makeFunctionReference<"query">("billing:getSubscriptionForOrg"),
  emitNotificationForOrg: makeFunctionReference<"mutation">("notifications:emitNotificationForOrg"),
};
const AI_CREDIT_EXPIRY_DAYS = 90;
const hasGatewayRuntime = (): boolean => isGatewayRuntimeEnabled(process.env.KEPPO_LLM_GATEWAY_URL);

const emitAiCreditLimitNotificationBestEffort = async (
  ctx: MutationCtx,
  orgId: string,
): Promise<void> => {
  try {
    await ctx.runMutation(refs.emitNotificationForOrg, {
      orgId,
      eventType: NOTIFICATION_EVENT_ID.aiCreditLimitReached,
      context: {
        orgId,
        orgName: orgId,
      },
    });
  } catch (error) {
    console.error("ai_credits.emit_limit_notification.failed", {
      orgId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Credit exhaustion must still surface as the canonical limit error even if
    // notification creation fails.
  }
};

const aiCreditBalanceValidator = v.object({
  org_id: v.string(),
  period_start: v.string(),
  period_end: v.string(),
  allowance_total: v.number(),
  allowance_reset_period: v.union(v.literal("monthly"), v.literal("one_time")),
  allowance_used: v.number(),
  allowance_remaining: v.number(),
  purchased_remaining: v.number(),
  total_available: v.number(),
  bundled_runtime_enabled: v.boolean(),
});

const aiCreditsRowValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  period_start: v.string(),
  period_end: v.string(),
  allowance_total: v.number(),
  allowance_reset_period: v.optional(v.union(v.literal("monthly"), v.literal("one_time"))),
  allowance_used: v.number(),
  purchased_balance: v.number(),
  updated_at: v.string(),
});

const purchaseValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  credits: v.number(),
  price_cents: v.number(),
  stripe_payment_intent_id: v.union(v.string(), v.null()),
  purchased_at: v.string(),
  expires_at: v.string(),
  credits_remaining: v.number(),
  status: aiCreditPurchaseStatusValidator,
});

const aiCreditsRowFields = [
  "id",
  "org_id",
  "period_start",
  "period_end",
  "allowance_total",
  "allowance_reset_period",
  "allowance_used",
  "purchased_balance",
  "updated_at",
] as const satisfies readonly (keyof Doc<"ai_credits">)[];

const purchaseFields = [
  "id",
  "org_id",
  "credits",
  "price_cents",
  "stripe_payment_intent_id",
  "purchased_at",
  "expires_at",
  "credits_remaining",
  "status",
] as const satisfies readonly (keyof Doc<"ai_credit_purchases">)[];

const toAiCreditsRow = (row: Doc<"ai_credits">) => pickFields(row, aiCreditsRowFields);

const toPurchase = (row: Doc<"ai_credit_purchases">) => pickFields(row, purchaseFields);

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

const getAiCreditsRow = async (ctx: QueryCtx | MutationCtx, orgId: string, periodStart: string) => {
  return await ctx.db
    .query("ai_credits")
    .withIndex("by_org_period", (q) => q.eq("org_id", orgId).eq("period_start", periodStart))
    .first();
};

const getLatestAiCreditsRowForOrg = async (ctx: QueryCtx | MutationCtx, orgId: string) => {
  return await ctx.db
    .query("ai_credits")
    .withIndex("by_org_period", (q) => q.eq("org_id", orgId))
    .order("desc")
    .first();
};

const listActivePurchases = async (ctx: QueryCtx | MutationCtx, orgId: string, now: string) => {
  const active = await ctx.db
    .query("ai_credit_purchases")
    .withIndex("by_org_active", (q) =>
      q.eq("org_id", orgId).eq("status", AI_CREDIT_PURCHASE_STATUS.active),
    )
    .collect();
  return active
    .filter((row) => row.expires_at > now && row.credits_remaining > 0)
    .sort((a, b) => a.purchased_at.localeCompare(b.purchased_at));
};

const sumPurchasedBalance = (rows: Array<{ credits_remaining: number }>): number => {
  return rows.reduce((sum, row) => sum + row.credits_remaining, 0);
};

const ensureAiCreditsRow = async (
  ctx: MutationCtx,
  params: {
    orgId: string;
    periodStart: string;
    periodEnd: string;
    allowanceTotal: number;
    allowanceResetPeriod: "monthly" | "one_time";
  },
) => {
  const id = await deterministicIdFor("aic", `${params.orgId}:${params.periodStart}`);
  const existingById = await ctx.db
    .query("ai_credits")
    .withIndex("by_custom_id", (q) => q.eq("id", id))
    .first();
  if (existingById) {
    return existingById;
  }
  const existing = await getAiCreditsRow(ctx, params.orgId, params.periodStart);
  if (existing) {
    return existing;
  }
  const now = nowIso();
  await ctx.db.insert("ai_credits", {
    id,
    org_id: params.orgId,
    period_start: params.periodStart,
    period_end: params.periodEnd,
    allowance_total: params.allowanceTotal,
    allowance_reset_period: params.allowanceResetPeriod,
    allowance_used: 0,
    purchased_balance: 0,
    updated_at: now,
  });
  const created = await ctx.db
    .query("ai_credits")
    .withIndex("by_custom_id", (q) => q.eq("id", id))
    .first();
  if (!created) {
    throw new Error("FailedToCreateAiCredits");
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

const computeBalance = async (
  ctx: QueryCtx | MutationCtx,
  params: {
    orgId: string;
    periodStart: string;
    periodEnd: string;
    allowanceTotal: number;
    allowanceResetPeriod: "monthly" | "one_time";
    now: string;
    bundledRuntimeEnabled: boolean;
  },
) => {
  const row = await getAiCreditsRow(ctx, params.orgId, params.periodStart);
  const purchases = await listActivePurchases(ctx, params.orgId, params.now);
  const allowanceUsed = row?.allowance_used ?? 0;
  const allowanceTotal = row?.allowance_total ?? params.allowanceTotal;
  const allowanceRemaining = Math.max(0, allowanceTotal - allowanceUsed);
  const purchasedRemaining = sumPurchasedBalance(purchases);
  return {
    org_id: params.orgId,
    period_start: params.periodStart,
    period_end: params.periodEnd,
    allowance_total: allowanceTotal,
    allowance_reset_period: row?.allowance_reset_period ?? params.allowanceResetPeriod,
    allowance_used: allowanceUsed,
    allowance_remaining: allowanceRemaining,
    purchased_remaining: purchasedRemaining,
    total_available: allowanceRemaining + purchasedRemaining,
    bundled_runtime_enabled: params.bundledRuntimeEnabled,
  };
};

const resolveAllowanceConfigForTier = async (
  ctx: QueryCtx | MutationCtx,
  params: { orgId: string; tier: string; periodStart: string },
): Promise<{ allowanceTotal: number; allowanceResetPeriod: "monthly" | "one_time" }> => {
  const included = getIncludedAiCreditsForTier(
    params.tier === SUBSCRIPTION_TIER.starter || params.tier === SUBSCRIPTION_TIER.pro
      ? params.tier
      : SUBSCRIPTION_TIER.free,
  );
  if (params.tier !== SUBSCRIPTION_TIER.free) {
    return {
      allowanceTotal: included.total,
      allowanceResetPeriod: included.reset_period,
    };
  }

  const currentRow = await getAiCreditsRow(ctx, params.orgId, params.periodStart);
  if (currentRow) {
    return {
      allowanceTotal: currentRow.allowance_total,
      allowanceResetPeriod: currentRow.allowance_reset_period ?? "monthly",
    };
  }

  const latestRow = await getLatestAiCreditsRowForOrg(ctx, params.orgId);
  if (latestRow?.allowance_reset_period === "one_time") {
    return {
      allowanceTotal: 0,
      allowanceResetPeriod: "one_time",
    };
  }

  if (latestRow && latestRow.allowance_total !== included.total) {
    return {
      allowanceTotal: latestRow.allowance_total,
      allowanceResetPeriod: latestRow.allowance_reset_period ?? "monthly",
    };
  }

  return {
    allowanceTotal: included.total,
    allowanceResetPeriod: included.reset_period,
  };
};

export const getAiCreditBalanceForOrg = async (
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  subscription?: {
    tier?: string | null;
    current_period_start?: string | null;
    current_period_end?: string | null;
  } | null,
): Promise<{
  org_id: string;
  period_start: string;
  period_end: string;
  allowance_total: number;
  allowance_reset_period: "monthly" | "one_time";
  allowance_used: number;
  allowance_remaining: number;
  purchased_remaining: number;
  total_available: number;
  bundled_runtime_enabled: boolean;
}> => {
  const now = nowIso();
  const resolvedSubscription =
    subscription ?? (await ctx.runQuery(refs.getSubscriptionForOrg, { orgId }));
  const tier = resolvedSubscription?.tier ?? SUBSCRIPTION_TIER.free;
  const period = resolveBillingPeriod(resolvedSubscription);
  const allowanceConfig = await resolveAllowanceConfigForTier(ctx, {
    orgId,
    tier,
    periodStart: period.periodStart,
  });
  const bundledRuntimeEnabled = supportsBundledAiRuntime(tier) && hasGatewayRuntime();
  return await computeBalance(ctx, {
    orgId,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    allowanceTotal: allowanceConfig.allowanceTotal,
    allowanceResetPeriod: allowanceConfig.allowanceResetPeriod,
    now,
    bundledRuntimeEnabled,
  });
};

export const getAiCreditBalanceForOrgInternal = internalQuery({
  args: {
    org_id: v.string(),
  },
  returns: aiCreditBalanceValidator,
  handler: async (ctx, args) => {
    return await getAiCreditBalanceForOrg(ctx, args.org_id);
  },
});

export const getAiCreditBalance = query({
  args: {
    org_id: v.string(),
  },
  returns: aiCreditBalanceValidator,
  handler: async (ctx, args) => {
    await ensureSameOrgMembership(ctx, args.org_id);
    return await getAiCreditBalanceForOrg(ctx, args.org_id);
  },
});

export const listAiCreditPurchases = query({
  args: {
    org_id: v.string(),
  },
  returns: v.array(purchaseValidator),
  handler: async (ctx, args) => {
    await ensureSameOrgMembership(ctx, args.org_id);
    const rows = await ctx.db
      .query("ai_credit_purchases")
      .withIndex("by_org", (q) => q.eq("org_id", args.org_id))
      .order("desc")
      .collect();
    return rows.map(toPurchase);
  },
});

export const deductAiCredit = internalMutation({
  args: {
    org_id: v.string(),
    usage_source: v.optional(
      v.union(v.literal(AI_CREDIT_USAGE_SOURCES[0]), v.literal(AI_CREDIT_USAGE_SOURCES[1])),
    ),
  },
  returns: aiCreditBalanceValidator,
  handler: async (ctx, args) => {
    const now = nowIso();
    const subscription = await ctx.runQuery(refs.getSubscriptionForOrg, { orgId: args.org_id });
    const tier = subscription?.tier ?? SUBSCRIPTION_TIER.free;
    const period = resolveBillingPeriod(subscription);
    const usageSource: AiCreditUsageSource = args.usage_source ?? AI_CREDIT_USAGE_SOURCE.generation;
    const allowanceConfig = await resolveAllowanceConfigForTier(ctx, {
      orgId: args.org_id,
      tier,
      periodStart: period.periodStart,
    });
    const bundledRuntimeEnabled = supportsBundledAiRuntime(tier) && hasGatewayRuntime();
    if (usageSource === AI_CREDIT_USAGE_SOURCE.runtime && !bundledRuntimeEnabled) {
      throw new Error(
        formatAiCreditErrorPayload({
          code: AI_CREDIT_ERROR_CODE.limitReached,
          org_id: args.org_id,
        }),
      );
    }
    const row = await ensureAiCreditsRow(ctx, {
      orgId: args.org_id,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      allowanceTotal: allowanceConfig.allowanceTotal,
      allowanceResetPeriod: allowanceConfig.allowanceResetPeriod,
    });

    if (row.allowance_used < row.allowance_total) {
      await ctx.db.patch(row._id, {
        allowance_used: row.allowance_used + 1,
        updated_at: now,
      });
      await addAuditEvent(ctx, {
        orgId: args.org_id,
        actorType: AUDIT_ACTOR_TYPE.system,
        actorId: "ai_credits",
        eventType: AUDIT_EVENT_TYPES.aiCreditDeducted,
        payload: {
          source: "allowance",
          usage_source: usageSource,
          period_start: period.periodStart,
        },
      });
      const balance = await computeBalance(ctx, {
        orgId: args.org_id,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        allowanceTotal: row.allowance_total,
        allowanceResetPeriod: row.allowance_reset_period ?? allowanceConfig.allowanceResetPeriod,
        now,
        bundledRuntimeEnabled,
      });
      if (balance.total_available === 0) {
        await emitAiCreditLimitNotificationBestEffort(ctx, args.org_id);
      }
      return balance;
    }

    const purchases = await listActivePurchases(ctx, args.org_id, now);
    const oldest = purchases[0] ?? null;
    if (!oldest) {
      await emitAiCreditLimitNotificationBestEffort(ctx, args.org_id);
      throw new Error(
        formatAiCreditErrorPayload({
          code: AI_CREDIT_ERROR_CODE.limitReached,
          org_id: args.org_id,
        }),
      );
    }

    const nextRemaining = oldest.credits_remaining - 1;
    await ctx.db.patch(oldest._id, {
      credits_remaining: nextRemaining,
      status:
        nextRemaining <= 0 ? AI_CREDIT_PURCHASE_STATUS.depleted : AI_CREDIT_PURCHASE_STATUS.active,
    });

    await ctx.db.patch(row._id, {
      purchased_balance: Math.max(0, row.purchased_balance - 1),
      updated_at: now,
    });

    await addAuditEvent(ctx, {
      orgId: args.org_id,
      actorType: AUDIT_ACTOR_TYPE.system,
      actorId: "ai_credits",
      eventType: AUDIT_EVENT_TYPES.aiCreditDeducted,
      payload: {
        source: "purchased",
        usage_source: usageSource,
        purchase_id: oldest.id,
      },
    });

    const balance = await computeBalance(ctx, {
      orgId: args.org_id,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      allowanceTotal: row.allowance_total,
      allowanceResetPeriod: row.allowance_reset_period ?? allowanceConfig.allowanceResetPeriod,
      now,
      bundledRuntimeEnabled,
    });
    if (balance.total_available === 0) {
      await emitAiCreditLimitNotificationBestEffort(ctx, args.org_id);
    }
    return balance;
  },
});

export const addPurchasedCredits = internalMutation({
  args: {
    org_id: v.string(),
    credits: v.number(),
    price_cents: v.number(),
    stripe_payment_intent_id: v.union(v.string(), v.null()),
  },
  returns: purchaseValidator,
  handler: async (ctx, args) => {
    const now = nowIso();
    const expiresAt = new Date(
      Date.now() + AI_CREDIT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    const subscription = await ctx.runQuery(refs.getSubscriptionForOrg, { orgId: args.org_id });
    const tier = subscription?.tier ?? SUBSCRIPTION_TIER.free;
    const period = resolveBillingPeriod(subscription);
    const allowanceConfig = await resolveAllowanceConfigForTier(ctx, {
      orgId: args.org_id,
      tier,
      periodStart: period.periodStart,
    });
    const row = await ensureAiCreditsRow(ctx, {
      orgId: args.org_id,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      allowanceTotal: allowanceConfig.allowanceTotal,
      allowanceResetPeriod: allowanceConfig.allowanceResetPeriod,
    });

    const id = randomIdFor("aicp");
    await ctx.db.insert("ai_credit_purchases", {
      id,
      org_id: args.org_id,
      credits: args.credits,
      price_cents: args.price_cents,
      stripe_payment_intent_id: args.stripe_payment_intent_id,
      purchased_at: now,
      expires_at: expiresAt,
      credits_remaining: args.credits,
      status: AI_CREDIT_PURCHASE_STATUS.active,
    });

    await ctx.db.patch(row._id, {
      purchased_balance: row.purchased_balance + args.credits,
      updated_at: now,
    });

    await addAuditEvent(ctx, {
      orgId: args.org_id,
      actorType: AUDIT_ACTOR_TYPE.system,
      actorId: "ai_credits",
      eventType: AUDIT_EVENT_TYPES.aiCreditPurchased,
      payload: {
        credits: args.credits,
        price_cents: args.price_cents,
        stripe_payment_intent_id: args.stripe_payment_intent_id,
        expires_at: expiresAt,
      },
    });

    const created = await ctx.db
      .query("ai_credit_purchases")
      .withIndex("by_custom_id", (q) => q.eq("id", id))
      .unique();
    if (!created) {
      throw new Error("FailedToCreateAiCreditPurchase");
    }
    return toPurchase(created);
  },
});

export const expirePurchasedCredits = internalMutation({
  args: {},
  returns: v.object({
    expired_count: v.number(),
  }),
  handler: async (ctx) => {
    const now = nowIso();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const sixDaysMs = 6 * 24 * 60 * 60 * 1000;
    const nowMs = Date.parse(now);
    const expiredCandidates = await ctx.db
      .query("ai_credit_purchases")
      .withIndex("by_expires_at", (q) => q.lt("expires_at", now))
      .collect();

    const expiringCandidates = await ctx.db
      .query("ai_credit_purchases")
      .withIndex("by_expires_at", (q) => q.gte("expires_at", now))
      .collect();

    const updatesByOrg: Record<string, number> = {};
    let expiredCount = 0;
    for (const row of expiredCandidates) {
      if (row.status !== AI_CREDIT_PURCHASE_STATUS.active) {
        continue;
      }
      const remaining = row.credits_remaining;
      await ctx.db.patch(row._id, {
        status: AI_CREDIT_PURCHASE_STATUS.expired,
        credits_remaining: 0,
      });
      updatesByOrg[row.org_id] = (updatesByOrg[row.org_id] ?? 0) + remaining;
      expiredCount += 1;
    }

    for (const [orgId, expiredCredits] of Object.entries(updatesByOrg)) {
      if (expiredCredits <= 0) {
        continue;
      }
      const row = await getLatestAiCreditsRowForOrg(ctx, orgId);
      if (row) {
        await ctx.db.patch(row._id, {
          purchased_balance: Math.max(0, row.purchased_balance - expiredCredits),
          updated_at: now,
        });
      }
      await addAuditEvent(ctx, {
        orgId,
        actorType: AUDIT_ACTOR_TYPE.system,
        actorId: "ai_credits",
        eventType: AUDIT_EVENT_TYPES.aiCreditExpired,
        payload: {
          credits: expiredCredits,
        },
      });
    }

    const expiringByOrg: Record<string, number> = {};
    for (const row of expiringCandidates) {
      if (row.status !== AI_CREDIT_PURCHASE_STATUS.active || row.credits_remaining <= 0) {
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
      expiringByOrg[row.org_id] = (expiringByOrg[row.org_id] ?? 0) + row.credits_remaining;
    }
    for (const [orgId, credits] of Object.entries(expiringByOrg)) {
      await ctx.runMutation(refs.emitNotificationForOrg, {
        orgId,
        eventType: NOTIFICATION_EVENT_ID.aiCreditsExpiring,
        context: {
          orgId,
          orgName: orgId,
          credits,
          daysRemaining: 7,
        },
        metadata: {
          credits,
        },
      });
    }

    return {
      expired_count: expiredCount,
    };
  },
});

export const resetMonthlyAllowance = internalMutation({
  args: {
    org_id: v.string(),
    period_start: v.string(),
    period_end: v.string(),
  },
  returns: aiCreditsRowValidator,
  handler: async (ctx, args) => {
    const subscription = await ctx.runQuery(refs.getSubscriptionForOrg, { orgId: args.org_id });
    const tier = subscription?.tier ?? SUBSCRIPTION_TIER.free;
    const allowanceConfig = await resolveAllowanceConfigForTier(ctx, {
      orgId: args.org_id,
      tier,
      periodStart: args.period_start,
    });
    const allowanceTotal = allowanceConfig.allowanceTotal;
    const existing = await getAiCreditsRow(ctx, args.org_id, args.period_start);
    if (existing) {
      return toAiCreditsRow(existing);
    }

    const activePurchases = await listActivePurchases(ctx, args.org_id, nowIso());
    const purchasedBalance = sumPurchasedBalance(activePurchases);
    const id = await deterministicIdFor("aic", `${args.org_id}:${args.period_start}`);
    const existingById = await ctx.db
      .query("ai_credits")
      .withIndex("by_custom_id", (q) => q.eq("id", id))
      .first();
    if (existingById) {
      return toAiCreditsRow(existingById);
    }
    const now = nowIso();
    await ctx.db.insert("ai_credits", {
      id,
      org_id: args.org_id,
      period_start: args.period_start,
      period_end: args.period_end,
      allowance_total: allowanceTotal,
      allowance_reset_period: allowanceConfig.allowanceResetPeriod,
      allowance_used: 0,
      purchased_balance: purchasedBalance,
      updated_at: now,
    });

    await addAuditEvent(ctx, {
      orgId: args.org_id,
      actorType: AUDIT_ACTOR_TYPE.system,
      actorId: "ai_credits",
      eventType: AUDIT_EVENT_TYPES.aiCreditAllowanceReset,
      payload: {
        period_start: args.period_start,
        period_end: args.period_end,
        allowance_total: allowanceTotal,
      },
    });

    const created = await ctx.db
      .query("ai_credits")
      .withIndex("by_custom_id", (q) => q.eq("id", id))
      .first();
    if (!created) {
      throw new Error("FailedToResetAllowance");
    }
    return toAiCreditsRow(created);
  },
});
