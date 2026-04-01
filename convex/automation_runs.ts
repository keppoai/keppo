import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { type Doc, type Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { nowIso, randomIdFor, requireOrgMember, requireWorkspaceRole } from "./_auth";
import { getDefaultBillingPeriod, getTierConfig } from "../packages/shared/src/subscriptions.js";
import {
  automationRunStatusValidator,
  automationStatusValidator,
  automationRunLogLevelValidator,
  automationRunEventTypeValidator,
  automationRunOutcomeSourceValidator,
  automationProviderTriggerMigrationStateValidator,
  automationProviderTriggerValidator,
  aiModelProviderValidator,
  configTriggerTypeValidator,
  networkAccessValidator,
  runTriggerTypeValidator,
  runnerTypeValidator,
  jsonRecordValidator,
} from "./validators";
import {
  AUTOMATION_STATUS,
  NOTIFICATION_EVENT_ID,
  AUTOMATION_RUN_STATUS,
  AUTOMATION_RUN_OUTCOME_SOURCE,
  AUTOMATION_RUN_OUTCOME_SUMMARY_MAX_LENGTH,
  RUN_TRIGGER_TYPE,
  RUN_STATUS,
  SUBSCRIPTION_TIER,
  USER_ROLE,
  assertNever,
  isAutomationRunFailureStatus,
  isAutomationRunTerminalStatus,
  type AutomationRunOutcomeSource,
  type AutomationRunStatus,
  type RunStatus,
  type RunTriggerType,
} from "./domain_constants";
import { normalizeAutomationRunStatus, toRunStatus } from "./automation_run_status";
import { toAutomationConfigVersionView } from "./automations_shared";
import { assertAutomationExecutionReady } from "./automations";
import {
  automationSchedulerRefs,
  buildDispatchAutomationRunArgs,
} from "./automation_scheduler_shared";
import {
  deductPurchasedRunInPlace,
  getAutomationRunTopupBalanceForOrg,
} from "./automation_run_topups";

const refs = {
  getSubscriptionForOrg: makeFunctionReference<"query">("billing:getSubscriptionForOrg"),
  emitNotificationForOrg: makeFunctionReference<"mutation">("notifications:emitNotificationForOrg"),
  dispatchAutomationRun: automationSchedulerRefs.dispatchAutomationRun,
};

const zeroAutomationRunTopupBalance = {
  purchased_runs_balance: 0,
  purchased_tool_calls_balance: 0,
  purchased_tool_call_time_ms_balance: 0,
} as const;

const automationRunOutcomeViewValidator = v.object({
  success: v.boolean(),
  summary: v.string(),
  source: automationRunOutcomeSourceValidator,
  recorded_at: v.string(),
});

const automationRunViewValidator = v.object({
  id: v.string(),
  automation_id: v.string(),
  org_id: v.string(),
  workspace_id: v.string(),
  config_version_id: v.string(),
  trigger_type: runTriggerTypeValidator,
  status: automationRunStatusValidator,
  started_at: v.union(v.string(), v.null()),
  ended_at: v.union(v.string(), v.null()),
  error_message: v.union(v.string(), v.null()),
  sandbox_id: v.union(v.string(), v.null()),
  mcp_session_id: v.union(v.string(), v.null()),
  outcome: v.union(automationRunOutcomeViewValidator, v.null()),
  log_storage_id: v.union(v.id("_storage"), v.null()),
  created_at: v.string(),
});

const automationRunLogLineValidator = v.object({
  seq: v.number(),
  level: automationRunLogLevelValidator,
  content: v.string(),
  timestamp: v.string(),
  event_type: v.optional(automationRunEventTypeValidator),
  event_data: v.optional(jsonRecordValidator),
});

const paginatedAutomationRunsValidator = v.object({
  page: v.array(automationRunViewValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

const currentOrgAutomationRunUsageValidator = v.object({
  period_start: v.string(),
  period_end: v.string(),
  run_count: v.number(),
  purchased_runs_balance: v.number(),
  max_runs_per_period: v.number(),
});

const hotLogsResponseValidator = v.object({
  mode: v.literal("hot"),
  lines: v.array(automationRunLogLineValidator),
});

const coldLogsResponseValidator = v.object({
  mode: v.literal("cold"),
  storage_url: v.string(),
});

const expiredLogsResponseValidator = v.object({
  mode: v.literal("expired"),
});

const automationRunLogsResponseValidator = v.union(
  hotLogsResponseValidator,
  coldLogsResponseValidator,
  expiredLogsResponseValidator,
);

const automationRunDispatchContextValidator = v.object({
  run: automationRunViewValidator,
  automation: v.object({
    id: v.string(),
    org_id: v.string(),
    workspace_id: v.string(),
    name: v.string(),
    status: automationStatusValidator,
  }),
  config: v.object({
    id: v.string(),
    automation_id: v.string(),
    trigger_type: configTriggerTypeValidator,
    schedule_cron: v.union(v.string(), v.null()),
    provider_trigger: v.union(automationProviderTriggerValidator, v.null()),
    provider_trigger_migration_state: v.union(
      automationProviderTriggerMigrationStateValidator,
      v.null(),
    ),
    event_provider: v.union(v.string(), v.null()),
    event_type: v.union(v.string(), v.null()),
    event_predicate: v.union(v.string(), v.null()),
    runner_type: runnerTypeValidator,
    ai_model_provider: aiModelProviderValidator,
    ai_model_name: v.string(),
    prompt: v.string(),
    network_access: networkAccessValidator,
  }),
});

type AutomationRunRow = Doc<"automation_runs"> & {
  automation_id: string;
  org_id: string;
  workspace_id: string;
  config_version_id: string;
  trigger_type: RunTriggerType;
  outcome_success: boolean | null;
  outcome_summary: string | null;
  outcome_source: AutomationRunOutcomeSource | null;
  outcome_recorded_at: string | null;
  created_at: string;
  log_storage_id: Id<"_storage"> | null;
};

const requireAutomationRunShape = (run: Doc<"automation_runs"> | null): AutomationRunRow => {
  if (
    !run ||
    !run.automation_id ||
    !run.org_id ||
    !run.workspace_id ||
    !run.config_version_id ||
    !run.trigger_type
  ) {
    throw new Error("AutomationRunNotFound");
  }
  return {
    ...run,
    automation_id: run.automation_id,
    org_id: run.org_id,
    workspace_id: run.workspace_id,
    config_version_id: run.config_version_id,
    trigger_type: run.trigger_type,
    outcome_success: run.outcome_success ?? null,
    outcome_summary: run.outcome_summary ?? null,
    outcome_source: run.outcome_source ?? null,
    outcome_recorded_at: run.outcome_recorded_at ?? null,
    created_at: run.created_at ?? run.started_at,
    log_storage_id: run.log_storage_id ?? null,
  };
};

const toAutomationRunOutcomeView = (
  run: AutomationRunRow,
): {
  success: boolean;
  summary: string;
  source: AutomationRunOutcomeSource;
  recorded_at: string;
} | null => {
  if (
    typeof run.outcome_success !== "boolean" ||
    typeof run.outcome_summary !== "string" ||
    run.outcome_summary.trim().length === 0 ||
    typeof run.outcome_source !== "string" ||
    typeof run.outcome_recorded_at !== "string" ||
    run.outcome_recorded_at.trim().length === 0
  ) {
    return null;
  }

  return {
    success: run.outcome_success,
    summary: run.outcome_summary,
    source: run.outcome_source,
    recorded_at: run.outcome_recorded_at,
  };
};

const toAutomationRunView = (
  run: AutomationRunRow,
): {
  id: string;
  automation_id: string;
  org_id: string;
  workspace_id: string;
  config_version_id: string;
  trigger_type: RunTriggerType;
  status: AutomationRunStatus;
  started_at: string | null;
  ended_at: string | null;
  error_message: string | null;
  sandbox_id: string | null;
  mcp_session_id: string | null;
  outcome: {
    success: boolean;
    summary: string;
    source: AutomationRunOutcomeSource;
    recorded_at: string;
  } | null;
  log_storage_id: Id<"_storage"> | null;
  created_at: string;
} => {
  return {
    id: run.id,
    automation_id: run.automation_id,
    org_id: run.org_id,
    workspace_id: run.workspace_id,
    config_version_id: run.config_version_id,
    trigger_type: run.trigger_type,
    status: normalizeAutomationRunStatus(run),
    started_at: run.started_at ?? null,
    ended_at: run.ended_at ?? null,
    error_message: run.error_message ?? null,
    sandbox_id: run.sandbox_id ?? null,
    mcp_session_id: run.mcp_session_id ?? null,
    outcome: toAutomationRunOutcomeView(run),
    log_storage_id: run.log_storage_id,
    created_at: run.created_at,
  };
};

const requireAutomation = async (ctx: QueryCtx | MutationCtx, automationId: string) => {
  const automation = await ctx.db
    .query("automations")
    .withIndex("by_custom_id", (q) => q.eq("id", automationId))
    .unique();
  if (!automation) {
    throw new Error("AutomationNotFound");
  }
  const auth = await requireWorkspaceRole(ctx, automation.workspace_id);
  if (auth.orgId !== automation.org_id) {
    throw new Error("Forbidden");
  }
  return { auth, automation };
};

const getAutomationRunById = async (
  ctx: QueryCtx | MutationCtx,
  automationRunId: string,
): Promise<AutomationRunRow> => {
  const run = await ctx.db
    .query("automation_runs")
    .withIndex("by_custom_id", (q) => q.eq("id", automationRunId))
    .unique();
  return requireAutomationRunShape(run);
};

const runPeriod = (
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

const periodRunCountForOrg = async (
  ctx: MutationCtx,
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<number> => {
  const statuses: RunStatus[] = [RUN_STATUS.active, RUN_STATUS.ended, RUN_STATUS.timedOut];
  let total = 0;
  for (const status of statuses) {
    const rows = await ctx.db
      .query("automation_runs")
      .withIndex("by_org_status", (q) => q.eq("org_id", orgId).eq("status", status))
      .collect();
    total += rows.filter(
      (row) =>
        typeof row.automation_id === "string" &&
        typeof row.created_at === "string" &&
        row.created_at >= periodStart &&
        row.created_at < periodEnd,
    ).length;
  }
  return total;
};

const concurrentAutomationRunCountForOrg = async (
  ctx: MutationCtx,
  orgId: string,
): Promise<number> => {
  const activeRows = await ctx.db
    .query("automation_runs")
    .withIndex("by_org_status", (q) => q.eq("org_id", orgId).eq("status", RUN_STATUS.active))
    .collect();
  return activeRows.filter((row) => typeof row.automation_id === "string").length;
};

const ensureTransition = (current: AutomationRunStatus, next: AutomationRunStatus): void => {
  if (current === next) {
    return;
  }
  switch (current) {
    case AUTOMATION_RUN_STATUS.pending:
      if (next === AUTOMATION_RUN_STATUS.running || next === AUTOMATION_RUN_STATUS.cancelled) {
        return;
      }
      break;
    case AUTOMATION_RUN_STATUS.running:
      if (
        next === AUTOMATION_RUN_STATUS.succeeded ||
        next === AUTOMATION_RUN_STATUS.failed ||
        next === AUTOMATION_RUN_STATUS.cancelled ||
        next === AUTOMATION_RUN_STATUS.timedOut
      ) {
        return;
      }
      break;
    case AUTOMATION_RUN_STATUS.succeeded:
    case AUTOMATION_RUN_STATUS.failed:
    case AUTOMATION_RUN_STATUS.cancelled:
    case AUTOMATION_RUN_STATUS.timedOut:
      break;
    default:
      assertNever(current, "automation run status transition source");
  }
  throw new Error(`InvalidAutomationRunStatusTransition: ${current} -> ${next}`);
};

const utf8Bytes = (value: string): number => {
  return new TextEncoder().encode(value).length;
};

const truncateToUtf8Bytes = (value: string, maxBytes: number): string => {
  if (utf8Bytes(value) <= maxBytes) {
    return value;
  }
  let output = "";
  for (const char of value) {
    const next = output + char;
    if (utf8Bytes(next) > maxBytes) {
      break;
    }
    output = next;
  }
  return output;
};

const formatAutomationRunOutcomeLogMessage = (params: {
  success: boolean;
  summary: string;
  source: AutomationRunOutcomeSource;
}): string => {
  const label = params.success ? "Success" : "Failure";
  const source =
    params.source === AUTOMATION_RUN_OUTCOME_SOURCE.agentRecorded
      ? "agent recorded"
      : "fallback generated";
  return `Automation outcome (${source}): ${label}. ${params.summary}`;
};

const buildFallbackAutomationRunOutcomeSummary = (params: {
  status: AutomationRunStatus;
}): string => {
  switch (params.status) {
    case AUTOMATION_RUN_STATUS.succeeded:
      return "The run completed, but the automation did not record a final outcome.";
    case AUTOMATION_RUN_STATUS.failed:
      return "The run failed before the automation recorded a final outcome.";
    case AUTOMATION_RUN_STATUS.cancelled:
      return "The run was cancelled before the automation recorded a final outcome.";
    case AUTOMATION_RUN_STATUS.timedOut:
      return "The run timed out before the automation recorded a final outcome.";
    case AUTOMATION_RUN_STATUS.pending:
    case AUTOMATION_RUN_STATUS.running:
      return "The run has not reached a terminal state.";
    default:
      return assertNever(params.status, "automation run outcome fallback status");
  }
};

const normalizeAutomationRunOutcomeSummary = (summary: string): string => {
  const normalized = summary.trim();
  if (normalized.length === 0) {
    throw new Error("AutomationRunOutcomeSummaryRequired");
  }
  if (normalized.length > AUTOMATION_RUN_OUTCOME_SUMMARY_MAX_LENGTH) {
    throw new Error("AutomationRunOutcomeSummaryTooLong");
  }
  return normalized;
};

const buildAutomationRunOutcomeRecord = (params: {
  success: boolean;
  summary: string;
  source: AutomationRunOutcomeSource;
}) => {
  const summary = normalizeAutomationRunOutcomeSummary(params.summary);
  const recordedAt = nowIso();
  const outcome = {
    success: params.success,
    summary,
    source: params.source,
    recorded_at: recordedAt,
  } as const;
  const message = formatAutomationRunOutcomeLogMessage({
    success: params.success,
    summary,
    source: params.source,
  });
  return {
    outcome,
    message,
    patch: {
      outcome_success: outcome.success,
      outcome_summary: outcome.summary,
      outcome_source: outcome.source,
      outcome_recorded_at: outcome.recorded_at,
    },
  };
};

const appendAutomationRunOutcomeLogInternal = async (
  ctx: MutationCtx,
  params: {
    automation_run_id: string;
    outcome: {
      success: boolean;
      summary: string;
      source: AutomationRunOutcomeSource;
      recorded_at: string;
    };
    message: string;
  },
) => {
  await appendAutomationRunLogInternal(ctx, {
    automation_run_id: params.automation_run_id,
    level: "system",
    content: params.message,
    event_type: "system",
    event_data: {
      message: params.message,
      kind: "automation_outcome",
      outcome: params.outcome,
    },
  });
};

const createAutomationRunInternal = async (
  ctx: MutationCtx,
  params: {
    automation_id: string;
    trigger_type: RunTriggerType;
    config_version_id?: string;
  },
) => {
  const automation = await ctx.db
    .query("automations")
    .withIndex("by_custom_id", (q) => q.eq("id", params.automation_id))
    .unique();
  if (!automation) {
    throw new Error("AutomationNotFound");
  }
  if (automation.status !== AUTOMATION_STATUS.active) {
    throw new Error("AutomationPaused");
  }

  const subscription = await ctx.runQuery(refs.getSubscriptionForOrg, {
    orgId: automation.org_id,
  });
  const tier = subscription?.tier ?? SUBSCRIPTION_TIER.free;
  const limits = getTierConfig(tier).automation_limits;
  const period = runPeriod(subscription);
  const topupBalance =
    tier === SUBSCRIPTION_TIER.free
      ? zeroAutomationRunTopupBalance
      : await getAutomationRunTopupBalanceForOrg(ctx, automation.org_id);
  const effectiveRunLimit = limits.max_runs_per_period + topupBalance.purchased_runs_balance;

  const runsThisPeriod = await periodRunCountForOrg(
    ctx,
    automation.org_id,
    period.periodStart,
    period.periodEnd,
  );
  if (runsThisPeriod >= effectiveRunLimit) {
    await ctx.runMutation(refs.emitNotificationForOrg, {
      orgId: automation.org_id,
      eventType: NOTIFICATION_EVENT_ID.automationRunLimitReached,
      context: {
        orgId: automation.org_id,
        orgName: automation.org_id,
        maxCount: effectiveRunLimit,
        currentCount: runsThisPeriod,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
      },
      metadata: {
        automation_id: automation.id,
        workspace_id: automation.workspace_id,
      },
    });
    throw new Error(
      JSON.stringify({
        code: "AUTOMATION_RUN_LIMIT_REACHED",
        period_start: period.periodStart,
        period_end: period.periodEnd,
        current_count: runsThisPeriod,
        max_count: effectiveRunLimit,
        tier,
      }),
    );
  }

  const concurrentRuns = await concurrentAutomationRunCountForOrg(ctx, automation.org_id);
  if (concurrentRuns >= limits.max_concurrent_runs) {
    throw new Error(
      JSON.stringify({
        code: "AUTOMATION_CONCURRENCY_LIMIT_REACHED",
        current_count: concurrentRuns,
        max_count: limits.max_concurrent_runs,
        tier,
      }),
    );
  }

  const configVersionId = params.config_version_id ?? automation.current_config_version_id;
  const configVersion = await ctx.db
    .query("automation_config_versions")
    .withIndex("by_custom_id", (q) => q.eq("id", configVersionId))
    .unique();
  if (!configVersion || configVersion.automation_id !== automation.id) {
    throw new Error("AutomationConfigVersionNotFound");
  }
  await assertAutomationExecutionReady(ctx, {
    orgId: automation.org_id,
    provider: configVersion.ai_model_provider,
  });

  if (runsThisPeriod >= limits.max_runs_per_period) {
    await deductPurchasedRunInPlace(ctx, automation.org_id);
  }

  const id = randomIdFor("arun");
  const createdAt = nowIso();
  await ctx.db.insert("automation_runs", {
    id,
    automation_id: automation.id,
    org_id: automation.org_id,
    workspace_id: automation.workspace_id,
    config_version_id: configVersionId,
    trigger_type: params.trigger_type,
    error_message: null,
    sandbox_id: null,
    outcome_success: null,
    outcome_summary: null,
    outcome_source: null,
    outcome_recorded_at: null,
    log_storage_id: null,
    created_at: createdAt,
    mcp_session_id: null,
    client_type: "other",
    metadata: {
      automation_run_status: AUTOMATION_RUN_STATUS.pending,
      log_bytes: 0,
      log_eviction_noted: false,
    },
    started_at: createdAt,
    ended_at: null,
    status: RUN_STATUS.active,
  });

  const created = await ctx.db
    .query("automation_runs")
    .withIndex("by_custom_id", (q) => q.eq("id", id))
    .unique();
  return toAutomationRunView(requireAutomationRunShape(created));
};

const appendAutomationRunLogInternal = async (
  ctx: MutationCtx,
  args: {
    automation_run_id: string;
    level: "stdout" | "stderr" | "system";
    content: string;
    event_type?: "system" | "automation_config" | "thinking" | "tool_call" | "output" | "error";
    event_data?: Record<string, unknown>;
  },
) => {
  const run = await getAutomationRunById(ctx, args.automation_run_id);
  const subscription = await ctx.runQuery(refs.getSubscriptionForOrg, {
    orgId: run.org_id,
  });
  const tier = subscription?.tier ?? SUBSCRIPTION_TIER.free;
  const maxLogBytes = getTierConfig(tier).automation_limits.max_log_bytes_per_run;

  const timestamp = nowIso();
  const content = truncateToUtf8Bytes(args.content, 4096);
  const lineBytes = utf8Bytes(content);

  const latest = await ctx.db
    .query("automation_run_logs")
    .withIndex("by_run_seq", (q) => q.eq("automation_run_id", args.automation_run_id))
    .order("desc")
    .first();
  let nextSeq = latest ? latest.seq + 1 : 1;

  const currentLogBytesFromMeta =
    typeof run.metadata?.log_bytes === "number" ? run.metadata.log_bytes : null;
  let currentBytes = currentLogBytesFromMeta;
  if (currentBytes === null) {
    const allRows = await ctx.db
      .query("automation_run_logs")
      .withIndex("by_run_seq", (q) => q.eq("automation_run_id", args.automation_run_id))
      .collect();
    currentBytes = allRows.reduce((sum, row) => sum + utf8Bytes(row.content), 0);
  }

  let logEvictionNoted = run.metadata?.log_eviction_noted === true;
  const evictionNotice = "Log ring buffer capacity reached; older lines were evicted.";
  const evictionNoticeBytes = utf8Bytes(evictionNotice);
  const reserveForNotice = logEvictionNoted ? 0 : evictionNoticeBytes;
  const targetBeforeAppend = maxLogBytes - lineBytes - reserveForNotice;

  if (currentBytes > targetBeforeAppend) {
    let bytesToFree = currentBytes - Math.max(0, targetBeforeAppend);
    const oldestRows = await ctx.db
      .query("automation_run_logs")
      .withIndex("by_run_seq", (q) => q.eq("automation_run_id", args.automation_run_id))
      .collect();

    for (const row of oldestRows) {
      if (bytesToFree <= 0) {
        break;
      }
      const rowBytes = utf8Bytes(row.content);
      await ctx.db.delete(row._id);
      currentBytes -= rowBytes;
      bytesToFree -= rowBytes;
    }

    if (!logEvictionNoted) {
      await ctx.db.insert("automation_run_logs", {
        automation_run_id: args.automation_run_id,
        seq: nextSeq,
        level: "system",
        content: evictionNotice,
        timestamp,
      });
      nextSeq += 1;
      currentBytes += evictionNoticeBytes;
      logEvictionNoted = true;
    }
  }

  await ctx.db.insert("automation_run_logs", {
    automation_run_id: args.automation_run_id,
    seq: nextSeq,
    level: args.level,
    content,
    timestamp,
    ...(args.event_type !== undefined ? { event_type: args.event_type } : {}),
    ...(args.event_data !== undefined ? { event_data: args.event_data } : {}),
  });
  currentBytes += lineBytes;

  await ctx.db.patch(run._id, {
    metadata: {
      ...run.metadata,
      automation_run_status: normalizeAutomationRunStatus(run),
      log_bytes: currentBytes,
      log_eviction_noted: logEvictionNoted,
    },
  });

  return {
    seq: nextSeq,
    level: args.level,
    content,
    timestamp,
    ...(args.event_type !== undefined ? { event_type: args.event_type } : {}),
    ...(args.event_data !== undefined ? { event_data: args.event_data } : {}),
  };
};

const recordAutomationRunOutcomeInternal = async (
  ctx: MutationCtx,
  params: {
    automation_run_id: string;
    workspace_id?: string;
    success: boolean;
    summary: string;
    source: AutomationRunOutcomeSource;
    on_existing: "error" | "ignore";
  },
) => {
  const run = await getAutomationRunById(ctx, params.automation_run_id);
  if (params.workspace_id !== undefined && run.workspace_id !== params.workspace_id) {
    throw new Error("AutomationRunWorkspaceMismatch");
  }
  const existingOutcome = toAutomationRunOutcomeView(run);
  if (existingOutcome) {
    if (params.on_existing === "ignore") {
      return existingOutcome;
    }
    throw new Error("AutomationRunOutcomeAlreadyRecorded");
  }

  const record = buildAutomationRunOutcomeRecord(params);
  await ctx.db.patch(run._id, record.patch);
  await appendAutomationRunOutcomeLogInternal(ctx, {
    automation_run_id: params.automation_run_id,
    outcome: record.outcome,
    message: record.message,
  });
  return record.outcome;
};

const updateAutomationRunStatusInternal = async (
  ctx: MutationCtx,
  params: {
    automation_run_id: string;
    status: AutomationRunStatus;
    error_message?: string;
    sandbox_id?: string | null;
    mcp_session_id?: string | null;
  },
) => {
  const run = await getAutomationRunById(ctx, params.automation_run_id);
  const current = normalizeAutomationRunStatus(run);
  ensureTransition(current, params.status);

  const metadata = {
    ...run.metadata,
    automation_run_status: params.status,
  };
  const now = nowIso();
  const legacyStatus = toRunStatus(params.status);
  const terminal = isAutomationRunTerminalStatus(params.status);
  const existingOutcome = toAutomationRunOutcomeView(run);

  const errorMessage = isAutomationRunFailureStatus(params.status)
    ? params.error_message?.trim() || run.error_message || null
    : null;

  const shouldReplaceExistingOutcome =
    isAutomationRunFailureStatus(params.status) && existingOutcome?.success === true;
  const terminalOutcomeRecord =
    terminal && (!existingOutcome || shouldReplaceExistingOutcome)
      ? buildAutomationRunOutcomeRecord({
          success: params.status === AUTOMATION_RUN_STATUS.succeeded,
          summary: buildFallbackAutomationRunOutcomeSummary({
            status: params.status,
          }),
          source: AUTOMATION_RUN_OUTCOME_SOURCE.fallbackMissing,
        })
      : null;
  await ctx.db.patch(run._id, {
    status: legacyStatus,
    metadata,
    ...(params.status === AUTOMATION_RUN_STATUS.running && current === AUTOMATION_RUN_STATUS.pending
      ? { started_at: now }
      : {}),
    ...(terminal ? { ended_at: now } : {}),
    error_message: errorMessage,
    ...(params.sandbox_id !== undefined ? { sandbox_id: params.sandbox_id } : {}),
    ...(params.mcp_session_id !== undefined ? { mcp_session_id: params.mcp_session_id } : {}),
    ...(terminalOutcomeRecord ? terminalOutcomeRecord.patch : {}),
  });

  if (terminal) {
    const workspaceCredentials = await ctx.db
      .query("workspace_credentials")
      .withIndex("by_workspace", (q) => q.eq("workspace_id", run.workspace_id))
      .collect();
    for (const credential of workspaceCredentials) {
      if (
        credential.revoked_at === null &&
        typeof credential.metadata?.automation_run_id === "string" &&
        credential.metadata.automation_run_id.trim() === run.id
      ) {
        await ctx.db.patch(credential._id, { revoked_at: now });
      }
    }
  }

  if (
    params.status === AUTOMATION_RUN_STATUS.failed ||
    params.status === AUTOMATION_RUN_STATUS.timedOut
  ) {
    const automation = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", run.automation_id))
      .unique();
    await ctx.runMutation(refs.emitNotificationForOrg, {
      orgId: run.org_id,
      eventType: NOTIFICATION_EVENT_ID.automationRunFailed,
      context: {
        orgId: run.org_id,
        orgName: run.org_id,
        automationId: run.automation_id,
        automationName: automation?.name ?? run.automation_id,
        automationRunId: run.id,
        status: params.status,
        errorMessage: errorMessage ?? "",
      },
      metadata: {
        automation_id: run.automation_id,
        run_id: run.id,
        status: params.status,
      },
      ctaUrl: `/automations/${run.automation_id}`,
      ctaLabel: "View Run",
    });
  }

  if (terminalOutcomeRecord) {
    await appendAutomationRunOutcomeLogInternal(ctx, {
      automation_run_id: params.automation_run_id,
      outcome: terminalOutcomeRecord.outcome,
      message: terminalOutcomeRecord.message,
    });
  }

  const updated = await getAutomationRunById(ctx, params.automation_run_id);
  return toAutomationRunView(updated);
};

export const listAutomationRuns = query({
  args: {
    automation_id: v.string(),
    status: v.optional(automationRunStatusValidator),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginatedAutomationRunsValidator,
  handler: async (ctx, args) => {
    await requireAutomation(ctx, args.automation_id);
    const legacyStatusFilter = args.status ? toRunStatus(args.status) : null;

    const pageResult = legacyStatusFilter
      ? await ctx.db
          .query("automation_runs")
          .withIndex("by_automation_status", (q) =>
            q.eq("automation_id", args.automation_id).eq("status", legacyStatusFilter),
          )
          .order("desc")
          .paginate(args.paginationOpts)
      : await ctx.db
          .query("automation_runs")
          .withIndex("by_automation", (q) => q.eq("automation_id", args.automation_id))
          .order("desc")
          .paginate(args.paginationOpts);

    const mapped = pageResult.page
      .map((run) => toAutomationRunView(requireAutomationRunShape(run)))
      .filter((run) => (args.status ? run.status === args.status : true));

    return {
      page: mapped,
      isDone: pageResult.isDone,
      continueCursor: pageResult.continueCursor,
    };
  },
});

export const getCurrentOrgAutomationRunUsage = query({
  args: {},
  returns: currentOrgAutomationRunUsageValidator,
  handler: async (ctx) => {
    const auth = await requireOrgMember(ctx);
    const subscription = await ctx.runQuery(refs.getSubscriptionForOrg, {
      orgId: auth.orgId,
    });
    const tier = subscription?.tier ?? SUBSCRIPTION_TIER.free;
    const period = subscription
      ? {
          periodStart: subscription.current_period_start,
          periodEnd: subscription.current_period_end,
        }
      : getDefaultBillingPeriod(new Date());
    const statuses = [RUN_STATUS.active, RUN_STATUS.ended, RUN_STATUS.timedOut] as const;
    const rows = await Promise.all(
      statuses.map(async (status) => {
        return await ctx.db
          .query("automation_runs")
          .withIndex("by_org_status_created", (q) =>
            q
              .eq("org_id", auth.orgId)
              .eq("status", status)
              .gte("created_at", period.periodStart)
              .lt("created_at", period.periodEnd),
          )
          .collect();
      }),
    );
    const runCount = rows.flat().length;
    const topupBalance =
      tier === SUBSCRIPTION_TIER.free
        ? zeroAutomationRunTopupBalance
        : await getAutomationRunTopupBalanceForOrg(ctx, auth.orgId);
    const baseLimit = getTierConfig(tier).automation_limits.max_runs_per_period;

    return {
      period_start: period.periodStart,
      period_end: period.periodEnd,
      run_count: runCount,
      purchased_runs_balance: topupBalance.purchased_runs_balance,
      max_runs_per_period: baseLimit + topupBalance.purchased_runs_balance,
    };
  },
});

export const getAutomationRun = query({
  args: {
    automation_run_id: v.string(),
  },
  returns: v.union(automationRunViewValidator, v.null()),
  handler: async (ctx, args) => {
    const run = await getAutomationRunById(ctx, args.automation_run_id);
    await requireWorkspaceRole(ctx, run.workspace_id);
    return toAutomationRunView(run);
  },
});

export const getAutomationRunLogs = query({
  args: {
    automation_run_id: v.string(),
    after_seq: v.optional(v.number()),
  },
  returns: automationRunLogsResponseValidator,
  handler: async (ctx, args) => {
    const run = await getAutomationRunById(ctx, args.automation_run_id);
    await requireWorkspaceRole(ctx, run.workspace_id);

    if (run.log_storage_id) {
      const storageUrl = await ctx.storage.getUrl(run.log_storage_id);
      if (!storageUrl) {
        return { mode: "expired" as const };
      }
      return { mode: "cold" as const, storage_url: storageUrl };
    }

    const afterSeq = args.after_seq;
    const lines =
      afterSeq !== undefined
        ? await ctx.db
            .query("automation_run_logs")
            .withIndex("by_run_seq", (q) =>
              q.eq("automation_run_id", args.automation_run_id).gt("seq", afterSeq),
            )
            .take(500)
        : await ctx.db
            .query("automation_run_logs")
            .withIndex("by_run_seq", (q) => q.eq("automation_run_id", args.automation_run_id))
            .take(500);

    return {
      mode: "hot" as const,
      lines: lines.map((line) => ({
        seq: line.seq,
        level: line.level,
        content: line.content,
        timestamp: line.timestamp,
        ...(line.event_type !== undefined ? { event_type: line.event_type } : {}),
        ...(line.event_data !== undefined ? { event_data: line.event_data } : {}),
      })),
    };
  },
});

export const getAutomationRunDispatchContext = internalQuery({
  args: {
    automation_run_id: v.string(),
  },
  returns: v.union(automationRunDispatchContextValidator, v.null()),
  handler: async (ctx, args) => {
    const run = await getAutomationRunById(ctx, args.automation_run_id);
    const automation = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", run.automation_id))
      .unique();
    if (!automation) {
      return null;
    }

    const config = await ctx.db
      .query("automation_config_versions")
      .withIndex("by_custom_id", (q) => q.eq("id", run.config_version_id))
      .unique();
    if (!config) {
      return null;
    }
    const configView = toAutomationConfigVersionView(config);

    return {
      run: toAutomationRunView(run),
      automation: {
        id: automation.id,
        org_id: automation.org_id,
        workspace_id: automation.workspace_id,
        name: automation.name,
        status: automation.status,
      },
      config: {
        id: configView.id,
        automation_id: configView.automation_id,
        trigger_type: configView.trigger_type,
        schedule_cron: configView.schedule_cron,
        provider_trigger: configView.provider_trigger,
        provider_trigger_migration_state: configView.provider_trigger_migration_state,
        event_provider: configView.event_provider,
        event_type: configView.event_type,
        event_predicate: configView.event_predicate,
        runner_type: configView.runner_type,
        ai_model_provider: configView.ai_model_provider,
        ai_model_name: configView.ai_model_name,
        prompt: configView.prompt,
        network_access: configView.network_access,
      },
    };
  },
});

export const createAutomationRun = internalMutation({
  args: {
    automation_id: v.string(),
    trigger_type: runTriggerTypeValidator,
    config_version_id: v.optional(v.string()),
  },
  returns: automationRunViewValidator,
  handler: async (ctx, args) => {
    return await createAutomationRunInternal(ctx, args);
  },
});

export const updateAutomationRunStatus = internalMutation({
  args: {
    automation_run_id: v.string(),
    status: automationRunStatusValidator,
    error_message: v.optional(v.string()),
    sandbox_id: v.optional(v.union(v.string(), v.null())),
    mcp_session_id: v.optional(v.union(v.string(), v.null())),
  },
  returns: automationRunViewValidator,
  handler: async (ctx, args) => {
    return await updateAutomationRunStatusInternal(ctx, args);
  },
});

export const appendAutomationRunLog = internalMutation({
  args: {
    automation_run_id: v.string(),
    level: automationRunLogLevelValidator,
    content: v.string(),
    event_type: v.optional(automationRunEventTypeValidator),
    event_data: v.optional(jsonRecordValidator),
  },
  returns: automationRunLogLineValidator,
  handler: async (ctx, args) => {
    return await appendAutomationRunLogInternal(ctx, args);
  },
});

export const recordAutomationRunOutcome = internalMutation({
  args: {
    automation_run_id: v.string(),
    workspace_id: v.optional(v.string()),
    success: v.boolean(),
    summary: v.string(),
    source: v.optional(automationRunOutcomeSourceValidator),
    on_existing: v.optional(v.union(v.literal("error"), v.literal("ignore"))),
  },
  returns: automationRunOutcomeViewValidator,
  handler: async (ctx, args) => {
    return await recordAutomationRunOutcomeInternal(ctx, {
      automation_run_id: args.automation_run_id,
      ...(args.workspace_id ? { workspace_id: args.workspace_id } : {}),
      success: args.success,
      summary: args.summary,
      source: args.source ?? AUTOMATION_RUN_OUTCOME_SOURCE.agentRecorded,
      on_existing: args.on_existing ?? "error",
    });
  },
});

export const triggerAutomationRunManual = mutation({
  args: {
    automation_id: v.string(),
  },
  returns: automationRunViewValidator,
  handler: async (ctx, args) => {
    const { automation } = await requireAutomation(ctx, args.automation_id);
    if (automation.status !== AUTOMATION_STATUS.active) {
      throw new Error("AutomationPaused");
    }
    const run = await createAutomationRunInternal(ctx, {
      automation_id: args.automation_id,
      trigger_type: RUN_TRIGGER_TYPE.manual,
    });
    try {
      await ctx.scheduler.runAfter(
        0,
        refs.dispatchAutomationRun,
        buildDispatchAutomationRunArgs(run.id),
      );
      return run;
    } catch {
      return await updateAutomationRunStatusInternal(ctx, {
        automation_run_id: run.id,
        status: AUTOMATION_RUN_STATUS.cancelled,
        error_message: "Dispatch failed: unable to schedule dispatch action",
      });
    }
  },
});

export const cancelAutomationRun = mutation({
  args: {
    automation_run_id: v.string(),
  },
  returns: automationRunViewValidator,
  handler: async (ctx, args) => {
    const run = await getAutomationRunById(ctx, args.automation_run_id);
    await requireWorkspaceRole(ctx, run.workspace_id, [USER_ROLE.owner, USER_ROLE.admin]);
    const status = normalizeAutomationRunStatus(run);
    if (
      status === AUTOMATION_RUN_STATUS.succeeded ||
      status === AUTOMATION_RUN_STATUS.failed ||
      status === AUTOMATION_RUN_STATUS.cancelled ||
      status === AUTOMATION_RUN_STATUS.timedOut
    ) {
      return toAutomationRunView(run);
    }
    return await updateAutomationRunStatusInternal(ctx, {
      automation_run_id: args.automation_run_id,
      status: AUTOMATION_RUN_STATUS.cancelled,
      error_message: "Run cancelled manually",
    });
  },
});
