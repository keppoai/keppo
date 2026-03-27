// SPDX-License-Identifier: FSL-1.1-Apache-2.0

import { v } from "convex/values";
import { getProviderAutomationTriggers } from "../../packages/shared/src/providers/automation-trigger-registry.js";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "../../convex/_generated/server";
import { nowIso, randomIdFor, hasFeatureAccess, requireWorkspaceRole } from "../../convex/_auth";
import { normalizeAutomationRunStatus } from "../../convex/automation_run_status";
import { toAutomationConfigVersionView } from "../../convex/automations_shared";
import {
  AUTOMATION_STATUS,
  AUTOMATION_TRIGGER_EVENT_MATCH_STATUS,
  AUTOMATION_TRIGGER_EVENT_STATUS,
  RUN_TRIGGER_TYPE,
} from "../../convex/domain_constants";
import {
  automationRunStatusValidator,
  automationProviderTriggerSubscriptionStatusValidator,
  automationProviderTriggerDeliveryModeValidator,
  automationProviderTriggerValidator,
  automationTriggerEventMatchStatusValidator,
  automationTriggerEventStatusValidator,
  jsonRecordValidator,
} from "../../convex/validators";

const TRIGGER_CEL_FEATURE_KEY = "trigger_cel";

const readPathValue = (payload: Record<string, unknown>, path: string): unknown => {
  const parts = path.split(".").filter((segment) => segment.length > 0);
  let current: unknown = payload;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const parseLiteral = (raw: string): unknown => {
  const trimmed = raw.trim();
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null") {
    return null;
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : trimmed;
};

const evaluateSimplePredicate = (predicate: string, payload: Record<string, unknown>): boolean => {
  const match =
    /^\s*payload\.([A-Za-z0-9_.]+)\s*(==|!=)\s*(".*?"|'.*?'|true|false|null|-?\d+(?:\.\d+)?)\s*$/.exec(
      predicate,
    );
  if (!match) {
    return false;
  }
  const leftValue = readPathValue(payload, match[1] ?? "");
  const rightValue = parseLiteral(match[3] ?? "");
  return match[2] === "!=" ? leftValue !== rightValue : leftValue === rightValue;
};

const buildTriggerId = (automationId: string, configVersionId: string): string => {
  return `${automationId}:${configVersionId}`;
};

const normalizeFailureReason = (value: string): string => {
  return value.trim().slice(0, 256) || "trigger_delivery_skipped";
};

const getAutomationTriggerDefinition = (providerId: string, triggerKey: string) => {
  return getProviderAutomationTriggers(providerId)?.triggers[triggerKey] ?? null;
};

export const listAutomationTriggerEvents = query({
  args: {
    automation_id: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      automation_id: v.string(),
      config_version_id: v.union(v.string(), v.null()),
      trigger_key: v.union(v.string(), v.null()),
      event_provider: v.string(),
      event_type: v.string(),
      event_id: v.string(),
      delivery_mode: v.union(automationProviderTriggerDeliveryModeValidator, v.null()),
      match_status: v.union(automationTriggerEventMatchStatusValidator, v.null()),
      failure_reason: v.union(v.string(), v.null()),
      status: automationTriggerEventStatusValidator,
      automation_run_id: v.union(v.string(), v.null()),
      automation_run_status: v.union(automationRunStatusValidator, v.null()),
      created_at: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const automation = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", args.automation_id))
      .unique();
    if (!automation) {
      throw new Error("AutomationNotFound");
    }

    await requireWorkspaceRole(ctx, automation.workspace_id);

    const limit = Math.max(1, Math.min(25, Math.floor(args.limit ?? 10)));
    const rows = await ctx.db
      .query("automation_trigger_events")
      .withIndex("by_automation", (q) => q.eq("automation_id", args.automation_id))
      .order("desc")
      .take(limit);

    return await Promise.all(
      rows.map(async (row) => {
        const runId = row.automation_run_id ?? null;
        const run =
          runId === null
            ? null
            : await ctx.db
                .query("automation_runs")
                .withIndex("by_custom_id", (q) => q.eq("id", runId))
                .unique();
        return {
          id: row.id,
          automation_id: row.automation_id,
          config_version_id: row.config_version_id ?? null,
          trigger_key: row.trigger_key ?? null,
          event_provider: row.event_provider,
          event_type: row.event_type,
          event_id: row.event_id,
          delivery_mode: row.delivery_mode ?? null,
          match_status: row.match_status ?? null,
          failure_reason: row.failure_reason ?? null,
          status: row.status,
          automation_run_id: runId,
          automation_run_status: run ? normalizeAutomationRunStatus(run) : null,
          created_at: row.created_at,
        };
      }),
    );
  },
});

export const listProviderTriggerCandidates = internalQuery({
  args: {
    provider: v.string(),
    trigger_key: v.string(),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      org_id: v.string(),
      workspace_id: v.string(),
      provider: v.string(),
      trigger_key: v.string(),
      automation_id: v.string(),
      config_version_id: v.string(),
      provider_trigger: automationProviderTriggerValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 100)));
    const configQuery = ctx.db
      .query("automation_config_versions")
      .withIndex("by_trigger_provider_type", (q) =>
        q
          .eq("trigger_type", RUN_TRIGGER_TYPE.event)
          .eq("event_provider", args.provider)
          .eq("event_type", args.trigger_key),
      )
      .order("desc");

    const results: Array<{
      org_id: string;
      workspace_id: string;
      provider: string;
      trigger_key: string;
      automation_id: string;
      config_version_id: string;
      provider_trigger: {
        provider_id: string;
        trigger_key: string;
        schema_version: number;
        filter: Record<string, unknown>;
        delivery: {
          preferred_mode: "webhook" | "polling";
          supported_modes: Array<"webhook" | "polling">;
          fallback_mode: "webhook" | "polling" | null;
        };
        subscription_state: {
          status: "inactive" | "pending" | "active" | "degraded" | "expired" | "failed";
          active_mode: "webhook" | "polling" | null;
          last_error: string | null;
          updated_at: string | null;
        };
      };
    }> = [];

    const maxScannedRows = Math.max(limit, Math.min(2_000, limit * 5));
    let cursor: string | null = null;
    let scannedRows = 0;
    let done = false;

    while (results.length < limit && scannedRows < maxScannedRows && !done) {
      const page = await configQuery.paginate({
        numItems: Math.min(100, maxScannedRows - scannedRows),
        cursor,
      });
      scannedRows += page.page.length;
      cursor = page.continueCursor;
      done = page.isDone;

      for (const config of page.page) {
        if (!config.provider_trigger || config.provider_trigger.trigger_key !== args.trigger_key) {
          continue;
        }
        const automation = await ctx.db
          .query("automations")
          .withIndex("by_custom_id", (q) => q.eq("id", config.automation_id))
          .unique();
        if (
          !automation ||
          automation.status !== AUTOMATION_STATUS.active ||
          automation.current_config_version_id !== config.id
        ) {
          continue;
        }
        results.push({
          org_id: automation.org_id,
          workspace_id: automation.workspace_id,
          provider: args.provider,
          trigger_key: args.trigger_key,
          automation_id: automation.id,
          config_version_id: config.id,
          provider_trigger: config.provider_trigger,
        });
        if (results.length >= limit) {
          break;
        }
      }
    }

    return results;
  },
});

export const updateProviderTriggerSubscriptionState = internalMutation({
  args: {
    config_version_ids: v.array(v.string()),
    subscription_state: v.object({
      status: automationProviderTriggerSubscriptionStatusValidator,
      active_mode: v.union(automationProviderTriggerDeliveryModeValidator, v.null()),
      last_error: v.union(v.string(), v.null()),
      updated_at: v.union(v.string(), v.null()),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    for (const configVersionId of args.config_version_ids) {
      const config = await ctx.db
        .query("automation_config_versions")
        .withIndex("by_custom_id", (q) => q.eq("id", configVersionId))
        .unique();
      if (!config?.provider_trigger) {
        continue;
      }
      await ctx.db.patch(config._id, {
        provider_trigger: {
          ...config.provider_trigger,
          subscription_state: args.subscription_state,
        },
      });
    }
    return null;
  },
});

export const ingestProviderEvent = internalMutation({
  args: {
    org_id: v.string(),
    provider: v.string(),
    trigger_key: v.optional(v.string()),
    provider_event_id: v.string(),
    provider_event_type: v.string(),
    delivery_mode: automationProviderTriggerDeliveryModeValidator,
    event_payload: v.optional(jsonRecordValidator),
    event_payload_ref: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    queued_count: v.number(),
    skipped_count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await ingestProviderEventInternal(ctx, args);
  },
});

const ingestProviderEventInternal = async (
  ctx: MutationCtx,
  args: {
    org_id: string;
    provider: string;
    trigger_key?: string;
    provider_event_id: string;
    provider_event_type: string;
    delivery_mode: "webhook" | "polling";
    event_payload?: Record<string, unknown>;
    event_payload_ref?: string | null;
  },
) => {
  const payload = args.event_payload ?? {};
  const automations = await ctx.db
    .query("automations")
    .withIndex("by_org", (q) => q.eq("org_id", args.org_id))
    .collect();
  const activeAutomations = automations.filter(
    (automation) => automation.status === AUTOMATION_STATUS.active,
  );
  const triggerCelEnabled = await hasFeatureAccess(ctx, args.org_id, TRIGGER_CEL_FEATURE_KEY);
  const existingRows = await ctx.db
    .query("automation_trigger_events")
    .withIndex("by_event_id", (q) => q.eq("event_id", args.provider_event_id))
    .collect();

  let queued = 0;
  let skipped = 0;

  for (const automation of activeAutomations) {
    const config = await ctx.db
      .query("automation_config_versions")
      .withIndex("by_custom_id", (q) => q.eq("id", automation.current_config_version_id))
      .unique();
    if (!config || config.trigger_type !== RUN_TRIGGER_TYPE.event) {
      continue;
    }

    const configView = toAutomationConfigVersionView(config);
    const providerTrigger = configView.provider_trigger;
    if (!providerTrigger || providerTrigger.provider_id !== args.provider) {
      continue;
    }

    const triggerId = buildTriggerId(automation.id, configView.id);
    const alreadyRecorded = existingRows.some((row) => {
      return (
        row.event_provider === args.provider &&
        row.automation_id === automation.id &&
        (row.config_version_id ?? configView.id) === configView.id
      );
    });
    if (alreadyRecorded) {
      skipped += 1;
      continue;
    }

    const recordSkipped = async (reason: string) => {
      await ctx.db.insert("automation_trigger_events", {
        id: randomIdFor("ate"),
        automation_id: automation.id,
        org_id: automation.org_id,
        config_version_id: configView.id,
        trigger_id: triggerId,
        trigger_key: providerTrigger.trigger_key,
        delivery_mode: args.delivery_mode,
        match_status: AUTOMATION_TRIGGER_EVENT_MATCH_STATUS.skipped,
        failure_reason: normalizeFailureReason(reason),
        event_provider: args.provider,
        event_type: args.provider_event_type,
        event_id: args.provider_event_id,
        event_payload_ref: args.event_payload_ref ?? null,
        status: AUTOMATION_TRIGGER_EVENT_STATUS.skipped,
        automation_run_id: null,
        created_at: nowIso(),
      });
      skipped += 1;
    };

    const triggerDefinition = getAutomationTriggerDefinition(
      String(providerTrigger.provider_id),
      providerTrigger.trigger_key,
    );

    if (triggerDefinition) {
      if (args.trigger_key !== undefined && args.trigger_key !== providerTrigger.trigger_key) {
        continue;
      }
      const parsedEvent = triggerDefinition.eventSchema.safeParse(payload);
      if (!parsedEvent.success) {
        await recordSkipped("invalid_event_payload");
        continue;
      }
      const matched = triggerDefinition.matchesEvent({
        filter: providerTrigger.filter,
        event: parsedEvent.data as Record<string, unknown>,
      });
      if (!matched) {
        await recordSkipped("filter_mismatch");
        continue;
      }
    } else {
      if (
        config.event_provider !== args.provider ||
        config.event_type !== args.provider_event_type
      ) {
        continue;
      }
      if (triggerCelEnabled && config.event_predicate) {
        const matched = evaluateSimplePredicate(config.event_predicate, payload);
        if (!matched) {
          await recordSkipped("legacy_predicate_mismatch");
          continue;
        }
      }
    }

    await ctx.db.insert("automation_trigger_events", {
      id: randomIdFor("ate"),
      automation_id: automation.id,
      org_id: automation.org_id,
      config_version_id: configView.id,
      trigger_id: triggerId,
      trigger_key: providerTrigger.trigger_key,
      delivery_mode: args.delivery_mode,
      match_status: AUTOMATION_TRIGGER_EVENT_MATCH_STATUS.matched,
      failure_reason: null,
      event_provider: args.provider,
      event_type: args.provider_event_type,
      event_id: args.provider_event_id,
      event_payload_ref: args.event_payload_ref ?? null,
      status: AUTOMATION_TRIGGER_EVENT_STATUS.pending,
      automation_run_id: null,
      created_at: nowIso(),
    });
    queued += 1;
  }

  return {
    queued_count: queued,
    skipped_count: skipped,
  };
};

export const matchAndQueueAutomationTriggers = internalMutation({
  args: {
    org_id: v.string(),
    event_provider: v.string(),
    event_type: v.string(),
    event_id: v.string(),
    event_payload: v.optional(jsonRecordValidator),
    event_payload_ref: v.optional(v.string()),
    webhook_event_id: v.optional(v.string()),
  },
  returns: v.object({
    queued_count: v.number(),
    skipped_count: v.number(),
  }),
  handler: async (ctx, args) => {
    return await ingestProviderEventInternal(ctx, {
      org_id: args.org_id,
      provider: args.event_provider,
      provider_event_id: args.event_id,
      provider_event_type: args.event_type,
      delivery_mode: "webhook",
      event_payload: args.event_payload ?? {},
      event_payload_ref: args.event_payload_ref ?? args.webhook_event_id ?? null,
    });
  },
});
