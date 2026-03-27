// SPDX-License-Identifier: FSL-1.1-Apache-2.0

import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { SUBSCRIPTION_TIER } from "../../../convex/domain_constants";
import { internalMutation, internalQuery, query } from "../../../convex/_generated/server";
import { nowIso, requireOrgMember } from "../../../convex/_auth";
import { getTierConfig } from "@keppo/shared/subscriptions";
import {
  deductPurchasedToolCallInPlace,
  getAutomationRunTopupBalanceForOrg,
} from "../../../convex/automation_run_topups";
import { subscriptionTierValidator } from "../../../convex/validators";
import {
  type BillingUsageResponse,
  billingUsageResponseValidator,
  buildUsageResponse,
  ensureUsageMeter,
  limitError,
  parseNotificationFlags,
  resolveBillingPeriod,
  resolveCurrentSubscription,
  resolveCurrentTier,
  USAGE_WARNING_THRESHOLD,
} from "./shared";

const refs = {
  emitNotificationForOrg: makeFunctionReference<"mutation">("notifications:emitNotificationForOrg"),
};

const zeroAutomationRunTopupBalance = {
  purchased_runs_balance: 0,
  purchased_tool_calls_balance: 0,
  purchased_tool_call_time_ms_balance: 0,
} as const;

export const getCurrentOrgBilling = query({
  args: {},
  returns: billingUsageResponseValidator,
  handler: async (ctx): Promise<BillingUsageResponse> => {
    const auth = await requireOrgMember(ctx);
    return await buildUsageResponse(ctx, auth.orgId);
  },
});

export const getUsageForOrg = internalQuery({
  args: {
    orgId: v.string(),
  },
  returns: billingUsageResponseValidator,
  handler: async (ctx, args): Promise<BillingUsageResponse> => {
    return await buildUsageResponse(ctx, args.orgId);
  },
});

export const getOrgBillingForWorkspace = internalQuery({
  args: {
    workspaceId: v.string(),
  },
  returns: billingUsageResponseValidator,
  handler: async (ctx, args): Promise<BillingUsageResponse> => {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", args.workspaceId))
      .unique();
    if (!workspace) {
      throw new Error("Workspace not found");
    }
    return await buildUsageResponse(ctx, workspace.org_id);
  },
});

export const beginToolCall = internalMutation({
  args: {
    orgId: v.string(),
  },
  returns: v.object({
    tier: subscriptionTierValidator,
    tool_call_timeout_ms: v.number(),
    period_start: v.string(),
    period_end: v.string(),
    usage_after_call_count: v.number(),
    usage_total_time_ms: v.number(),
    max_tool_calls_per_month: v.number(),
    max_total_tool_call_time_ms: v.number(),
  }),
  handler: async (ctx, args) => {
    const tier = await resolveCurrentTier(ctx, args.orgId);
    const tierConfig = getTierConfig(tier);
    const subscription = await resolveCurrentSubscription(ctx, args.orgId);
    const period = resolveBillingPeriod(subscription);
    const usage = await ensureUsageMeter(ctx, {
      orgId: args.orgId,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    });
    const topupBalance =
      tier === SUBSCRIPTION_TIER.free
        ? zeroAutomationRunTopupBalance
        : await getAutomationRunTopupBalanceForOrg(ctx, args.orgId);
    const effectiveToolCallLimit =
      tierConfig.max_tool_calls_per_month + topupBalance.purchased_tool_calls_balance;
    const effectiveTimeLimit =
      tierConfig.max_total_tool_call_time_ms + topupBalance.purchased_tool_call_time_ms_balance;

    if (usage.tool_call_count >= effectiveToolCallLimit) {
      limitError("TOOL_CALL_LIMIT_REACHED", {
        current_count: usage.tool_call_count,
        max_count: effectiveToolCallLimit,
        tier,
      });
    }

    if (usage.total_tool_call_time_ms >= effectiveTimeLimit) {
      limitError("TOOL_CALL_TIME_LIMIT_REACHED", {
        current_total_ms: usage.total_tool_call_time_ms,
        max_total_ms: effectiveTimeLimit,
        tier,
      });
    }

    if (usage.tool_call_count >= tierConfig.max_tool_calls_per_month) {
      await deductPurchasedToolCallInPlace(ctx, args.orgId);
    }

    await ctx.db.patch(usage._id, {
      tool_call_count: usage.tool_call_count + 1,
      updated_at: nowIso(),
    });

    return {
      tier,
      tool_call_timeout_ms: tierConfig.tool_call_timeout_ms,
      period_start: period.periodStart,
      period_end: period.periodEnd,
      usage_after_call_count: usage.tool_call_count + 1,
      usage_total_time_ms: usage.total_tool_call_time_ms,
      max_tool_calls_per_month: effectiveToolCallLimit,
      max_total_tool_call_time_ms: effectiveTimeLimit,
    };
  },
});

export const finishToolCall = internalMutation({
  args: {
    orgId: v.string(),
    periodStart: v.string(),
    latencyMs: v.number(),
  },
  returns: v.object({
    period_start: v.string(),
    tool_call_count: v.number(),
    total_tool_call_time_ms: v.number(),
    stripe_subscription_id: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const tier = await resolveCurrentTier(ctx, args.orgId);
    const subscription = await resolveCurrentSubscription(ctx, args.orgId);
    const period = resolveBillingPeriod(subscription);
    const effectivePeriodStart = args.periodStart || period.periodStart;
    const usage = await ensureUsageMeter(ctx, {
      orgId: args.orgId,
      periodStart: effectivePeriodStart,
      periodEnd: period.periodEnd,
    });
    const previousCallCount = Math.max(0, usage.tool_call_count - 1);
    const previousTotalMs = usage.total_tool_call_time_ms;
    const latencyMs = Math.max(0, Math.floor(args.latencyMs));
    const nextTotal = usage.total_tool_call_time_ms + latencyMs;
    await ctx.db.patch(usage._id, {
      total_tool_call_time_ms: nextTotal,
      updated_at: nowIso(),
    });

    const limits = getTierConfig(tier);
    const topupBalance =
      tier === SUBSCRIPTION_TIER.free
        ? zeroAutomationRunTopupBalance
        : await getAutomationRunTopupBalanceForOrg(ctx, args.orgId);
    const effectiveToolCallLimit =
      limits.max_tool_calls_per_month + topupBalance.purchased_tool_calls_balance;
    const effectiveTimeLimit =
      limits.max_total_tool_call_time_ms + topupBalance.purchased_tool_call_time_ms_balance;
    const notificationFlags = parseNotificationFlags(usage.notifications_fired);
    const eventTypes: Array<
      | "tool_call_limit_warning"
      | "tool_call_limit_reached"
      | "tool_time_limit_warning"
      | "tool_time_limit_reached"
    > = [];

    const maybeQueueUsageEvent = (
      eventType:
        | "tool_call_limit_warning"
        | "tool_call_limit_reached"
        | "tool_time_limit_warning"
        | "tool_time_limit_reached",
      previousRatio: number,
      currentRatio: number,
      threshold: number,
    ) => {
      if (notificationFlags[eventType]) {
        return;
      }
      if (previousRatio < threshold && currentRatio >= threshold) {
        notificationFlags[eventType] = true;
        eventTypes.push(eventType);
      }
    };

    if (effectiveToolCallLimit > 0) {
      const previousCallRatio = previousCallCount / effectiveToolCallLimit;
      const currentCallRatio = usage.tool_call_count / effectiveToolCallLimit;
      maybeQueueUsageEvent(
        "tool_call_limit_warning",
        previousCallRatio,
        currentCallRatio,
        USAGE_WARNING_THRESHOLD,
      );
      maybeQueueUsageEvent("tool_call_limit_reached", previousCallRatio, currentCallRatio, 1);
    }

    if (effectiveTimeLimit > 0) {
      const previousTimeRatio = previousTotalMs / effectiveTimeLimit;
      const currentTimeRatio = nextTotal / effectiveTimeLimit;
      maybeQueueUsageEvent(
        "tool_time_limit_warning",
        previousTimeRatio,
        currentTimeRatio,
        USAGE_WARNING_THRESHOLD,
      );
      maybeQueueUsageEvent("tool_time_limit_reached", previousTimeRatio, currentTimeRatio, 1);
    }

    if (eventTypes.length > 0) {
      await ctx.db.patch(usage._id, {
        notifications_fired: JSON.stringify(notificationFlags),
      });
      for (const eventType of eventTypes) {
        await ctx.runMutation(refs.emitNotificationForOrg, {
          orgId: args.orgId,
          eventType,
          context: {
            currentCount: usage.tool_call_count,
            limit: effectiveToolCallLimit,
            currentTotalMs: nextTotal,
            limitMs: effectiveTimeLimit,
            tier,
          },
          metadata: {
            period_start: usage.period_start,
            tool_call_count: usage.tool_call_count,
            total_tool_call_time_ms: nextTotal,
            event_type: eventType,
          },
        });
      }
    }

    return {
      period_start: usage.period_start,
      tool_call_count: usage.tool_call_count,
      total_tool_call_time_ms: nextTotal,
      stripe_subscription_id: subscription?.stripe_subscription_id ?? null,
    };
  },
});
