import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction, internalMutation, query, type ActionCtx } from "./_generated/server";
import { nowIso, randomIdFor } from "./_auth";
import { CRON_HEALTH_STATUS, type CronHealthStatus } from "./domain_constants";
import { isHostedPreviewEnvironment } from "./environment";
import { cronHealthStatusValidator } from "./validators";

const BASE_CRON_EXPECTATIONS = [
  { jobName: "automation-scheduler-check", intervalMs: 60_000 },
  { jobName: "automation-provider-trigger-reconcile", intervalMs: 60_000 },
  { jobName: "automation-trigger-event-processor", intervalMs: 60_000 },
  { jobName: "automation-stale-run-reaper", intervalMs: 60_000 },
  { jobName: "maintenance-sweep", intervalMs: 2 * 60_000 },
  { jobName: "automation-hot-log-archival", intervalMs: 60 * 60_000 },
  { jobName: "automation-cold-log-expiry", intervalMs: 60 * 60_000 },
  { jobName: "ai-credit-expiry", intervalMs: 60 * 60_000 },
  { jobName: "automation-run-topup-expiry", intervalMs: 60 * 60_000 },
  { jobName: "invite-promo-expiry", intervalMs: 60 * 60_000 },
  { jobName: "api-dedupe-expiry-cleanup", intervalMs: 15 * 60_000 },
  { jobName: "dlq-auto-retry", intervalMs: 5 * 60_000 },
  { jobName: "synthetic-canary", intervalMs: 5 * 60_000 },
] as const;

const PREVIEW_DISABLED_CRON_JOB_NAMES = new Set([
  "automation-provider-trigger-reconcile",
  "maintenance-sweep",
]);

const getCronExpectations = () =>
  BASE_CRON_EXPECTATIONS.filter(
    (expectation) =>
      !isHostedPreviewEnvironment() || !PREVIEW_DISABLED_CRON_JOB_NAMES.has(expectation.jobName),
  );

const parseIsoTimestamp = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getDeploymentActivityStartMs = (
  rows: Array<{
    last_success_at: string | null;
    last_failure_at: string | null;
    updated_at: string;
  }>,
): number | null => {
  const timestamps = rows.flatMap((row) =>
    [row.last_success_at, row.last_failure_at, row.updated_at]
      .map((value) => parseIsoTimestamp(value))
      .filter((value): value is number => value !== null),
  );
  if (timestamps.length === 0) {
    return null;
  }
  return Math.min(...timestamps);
};

const refs = {
  recordSuccessInternal: makeFunctionReference<"mutation">("cron_heartbeats:recordSuccessInternal"),
  recordFailureInternal: makeFunctionReference<"mutation">("cron_heartbeats:recordFailureInternal"),
  acquireLeaseInternal: makeFunctionReference<"mutation">("cron_heartbeats:acquireLeaseInternal"),
  releaseLeaseInternal: makeFunctionReference<"mutation">("cron_heartbeats:releaseLeaseInternal"),
  checkScheduledAutomations: makeFunctionReference<"mutation">(
    "automation_scheduler:checkScheduledAutomations",
  ),
  reconcileProviderTriggerSubscriptions: makeFunctionReference<"action">(
    "automation_scheduler_node:reconcileProviderTriggerSubscriptions",
  ),
  processAutomationTriggerEvents: makeFunctionReference<"mutation">(
    "automation_scheduler:processAutomationTriggerEvents",
  ),
  reapStaleRuns: makeFunctionReference<"mutation">("automation_scheduler:reapStaleRuns"),
  archiveHotLogs: makeFunctionReference<"action">("automation_scheduler:archiveHotLogs"),
  expireColdLogs: makeFunctionReference<"mutation">("automation_scheduler:expireColdLogs"),
  expirePurchasedCredits: makeFunctionReference<"mutation">("ai_credits:expirePurchasedCredits"),
  expirePurchasedAutomationRunTopups: makeFunctionReference<"mutation">(
    "automation_run_topups:expirePurchasedTopups",
  ),
  expireInviteCodePromos: makeFunctionReference<"mutation">("invite_codes:expireInviteCodePromos"),
  purgeExpiredApiDedupeKeys: makeFunctionReference<"mutation">(
    "api_dedupe:purgeExpiredApiDedupeKeys",
  ),
  autoRetryTransientEntries: makeFunctionReference<"mutation">(
    "dead_letter:autoRetryTransientEntries",
  ),
  runCanaryCheck: makeFunctionReference<"action">("canary:runCanaryCheck"),
  listApprovedActionDispatches: makeFunctionReference<"query">("mcp:listApprovedActionDispatches"),
  scheduleApprovedAction: makeFunctionReference<"mutation">("mcp_dispatch:scheduleApprovedAction"),
  runMaintenanceTick: makeFunctionReference<"action">("mcp_node:runMaintenanceTick"),
  cleanupExpiredInvites: makeFunctionReference<"mutation">("invites:cleanupExpiredInvites"),
};

const resolveErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const LEASE_HELD_SKIPPED_REASON = "lease_held" as const;

const shouldBypassBackgroundCronInE2E = (): boolean => process.env.KEPPO_E2E_MODE === "true";

const zeroMaintenanceResult = () => ({
  processed: 0,
  expired: 0,
  timedOutRuns: 0,
  securityFlagsCreated: 0,
  credentialLockoutRowsPurged: 0,
  credentialRotationRecommendations: 0,
  notificationsSent: 0,
  notificationsFailed: 0,
  purgedActions: 0,
  purgedBlobs: 0,
  purgedAudits: 0,
});

const zeroSweepResult = () => ({
  queue: {
    attempted: 0,
    dispatched: 0,
    skipped: 0,
  },
  skippedReason: null as typeof LEASE_HELD_SKIPPED_REASON | null,
  maintenance: zeroMaintenanceResult(),
  invites: {
    expired: 0,
  },
});

const MAINTENANCE_SWEEP_LEASE_MS = 4 * 60_000;

const parseNonNegativeInteger = (
  raw: string | undefined,
  defaultValue: number,
  minimum: number,
): number => {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }
  return Math.max(minimum, Math.floor(parsed));
};

const resolveMaintenanceSweepArgs = (args: {
  approvedSweepLimit?: number;
  maintenanceApprovedLimit?: number;
  ttlMinutes?: number;
  inactivityMinutes?: number;
}) => ({
  approvedSweepLimit: Math.max(
    0,
    Math.floor(
      args.approvedSweepLimit ??
        parseNonNegativeInteger(process.env.KEPPO_QUEUE_ENQUEUE_SWEEP_LIMIT, 50, 0),
    ),
  ),
  maintenanceApprovedLimit: Math.max(0, Math.floor(args.maintenanceApprovedLimit ?? 0)),
  ttlMinutes: Math.max(
    1,
    Math.floor(
      args.ttlMinutes ?? parseNonNegativeInteger(process.env.KEPPO_ACTION_TTL_MINUTES, 60, 1),
    ),
  ),
  inactivityMinutes: Math.max(
    1,
    Math.floor(
      args.inactivityMinutes ??
        parseNonNegativeInteger(process.env.KEPPO_RUN_INACTIVITY_MINUTES, 30, 1),
    ),
  ),
});

const runScheduledMaintenanceSweep = async (
  ctx: ActionCtx,
  args: {
    approvedSweepLimit?: number;
    maintenanceApprovedLimit?: number;
    ttlMinutes?: number;
    inactivityMinutes?: number;
  },
  options: {
    jobName: string;
    recordHeartbeat: boolean;
  },
) => {
  const jobName = options.jobName;
  const leaseOwner = randomIdFor("cron_lock");
  const acquired = await ctx.runMutation(refs.acquireLeaseInternal, {
    jobName,
    owner: leaseOwner,
    leaseMs: MAINTENANCE_SWEEP_LEASE_MS,
  });
  if (!acquired) {
    console.warn("maintenance.sweep.locked", {
      jobName,
      recordHeartbeat: options.recordHeartbeat,
    });
    if (options.recordHeartbeat) {
      throw new Error("maintenance_sweep_lease_held");
    }
    return {
      ...zeroSweepResult(),
      skippedReason: LEASE_HELD_SKIPPED_REASON,
    };
  }

  let runError: unknown = null;
  try {
    const resolvedArgs = resolveMaintenanceSweepArgs(args);
    const approved =
      resolvedArgs.approvedSweepLimit > 0
        ? await ctx.runQuery(refs.listApprovedActionDispatches, {
            limit: resolvedArgs.approvedSweepLimit,
          })
        : [];
    let dispatched = 0;
    let skipped = 0;

    for (const item of approved) {
      try {
        const result = await ctx.runMutation(refs.scheduleApprovedAction, {
          actionId: item.actionId,
          source: "cron_sweep",
        });
        if (result.dispatched) {
          dispatched += 1;
        } else {
          skipped += 1;
        }
      } catch (error) {
        skipped += 1;
        console.error("maintenance.approved_action.dispatch_failed", {
          actionId: item.actionId,
          workspaceId: item.workspaceId,
          error: resolveErrorMessage(error),
        });
      }
    }

    const maintenance = await ctx.runAction(refs.runMaintenanceTick, {
      approvedLimit: resolvedArgs.maintenanceApprovedLimit,
      ttlMinutes: resolvedArgs.ttlMinutes,
      inactivityMinutes: resolvedArgs.inactivityMinutes,
    });
    const invites = await ctx.runMutation(refs.cleanupExpiredInvites, {});

    return {
      queue: {
        attempted: approved.length,
        dispatched,
        skipped,
      },
      skippedReason: null,
      maintenance,
      invites,
    };
  } catch (error) {
    runError = error;
    throw error;
  } finally {
    try {
      await ctx.runMutation(refs.releaseLeaseInternal, {
        jobName,
        owner: leaseOwner,
      });
    } catch (releaseError) {
      console.error("maintenance.sweep.lease_release_failed", {
        jobName,
        error: resolveErrorMessage(releaseError),
      });
      if (runError === null) {
        throw releaseError;
      }
    }
  }
};

const withHeartbeat = async <T>(params: {
  jobName: string;
  run: () => Promise<T>;
  recordSuccess: () => Promise<void>;
  recordFailure: (message: string) => Promise<void>;
}): Promise<T> => {
  try {
    const result = await params.run();
    await params.recordSuccess();
    return result;
  } catch (error) {
    await params.recordFailure(resolveErrorMessage(error));
    throw error;
  }
};

export const recordSuccessInternal = internalMutation({
  args: {
    jobName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const heartbeat = await ctx.db
      .query("cron_heartbeats")
      .withIndex("by_job", (q) => q.eq("job_name", args.jobName))
      .unique();
    const now = nowIso();
    if (heartbeat) {
      await ctx.db.patch(heartbeat._id, {
        last_success_at: now,
        last_error: null,
        consecutive_failures: 0,
        updated_at: now,
      });
      return null;
    }

    await ctx.db.insert("cron_heartbeats", {
      id: randomIdFor("cron_hb"),
      job_name: args.jobName,
      last_success_at: now,
      last_failure_at: null,
      last_error: null,
      consecutive_failures: 0,
      lock_owner: null,
      lock_expires_at: null,
      updated_at: now,
    });
    return null;
  },
});

export const recordFailureInternal = internalMutation({
  args: {
    jobName: v.string(),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const heartbeat = await ctx.db
      .query("cron_heartbeats")
      .withIndex("by_job", (q) => q.eq("job_name", args.jobName))
      .unique();
    const now = nowIso();
    if (heartbeat) {
      await ctx.db.patch(heartbeat._id, {
        last_failure_at: now,
        last_error: args.error,
        consecutive_failures: heartbeat.consecutive_failures + 1,
        updated_at: now,
      });
      return null;
    }

    await ctx.db.insert("cron_heartbeats", {
      id: randomIdFor("cron_hb"),
      job_name: args.jobName,
      last_success_at: null,
      last_failure_at: now,
      last_error: args.error,
      consecutive_failures: 1,
      lock_owner: null,
      lock_expires_at: null,
      updated_at: now,
    });
    return null;
  },
});

export const acquireLeaseInternal = internalMutation({
  args: {
    jobName: v.string(),
    owner: v.string(),
    leaseMs: v.number(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const heartbeat = await ctx.db
      .query("cron_heartbeats")
      .withIndex("by_job", (q) => q.eq("job_name", args.jobName))
      .unique();
    const now = Date.now();
    const nowIsoValue = new Date(now).toISOString();
    const nextLeaseAt = new Date(now + Math.max(1_000, Math.floor(args.leaseMs))).toISOString();
    const currentLeaseMs = Date.parse(heartbeat?.lock_expires_at ?? "");
    const leaseActive =
      heartbeat?.lock_owner &&
      Number.isFinite(currentLeaseMs) &&
      currentLeaseMs > now &&
      heartbeat.lock_owner !== args.owner;
    if (leaseActive) {
      return false;
    }

    if (heartbeat) {
      await ctx.db.patch(heartbeat._id, {
        lock_owner: args.owner,
        lock_expires_at: nextLeaseAt,
        updated_at: nowIsoValue,
      });
      return true;
    }

    await ctx.db.insert("cron_heartbeats", {
      id: randomIdFor("cron_hb"),
      job_name: args.jobName,
      last_success_at: null,
      last_failure_at: null,
      last_error: null,
      consecutive_failures: 0,
      lock_owner: args.owner,
      lock_expires_at: nextLeaseAt,
      updated_at: nowIsoValue,
    });
    return true;
  },
});

export const releaseLeaseInternal = internalMutation({
  args: {
    jobName: v.string(),
    owner: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const heartbeat = await ctx.db
      .query("cron_heartbeats")
      .withIndex("by_job", (q) => q.eq("job_name", args.jobName))
      .unique();
    if (!heartbeat || heartbeat.lock_owner !== args.owner) {
      return null;
    }
    await ctx.db.patch(heartbeat._id, {
      lock_owner: null,
      lock_expires_at: null,
      updated_at: nowIso(),
    });
    return null;
  },
});

export const checkCronHealth = query({
  args: {},
  returns: v.array(
    v.object({
      jobName: v.string(),
      status: cronHealthStatusValidator,
      intervalMs: v.number(),
      lastSuccessAt: v.union(v.string(), v.null()),
      lastFailureAt: v.union(v.string(), v.null()),
      lastError: v.union(v.string(), v.null()),
      consecutiveFailures: v.number(),
      staleThresholdMs: v.number(),
      staleByMs: v.union(v.number(), v.null()),
    }),
  ),
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db.query("cron_heartbeats").collect();
    const rowByJob = new Map(rows.map((row) => [row.job_name, row]));
    const deploymentActivityStartMs = getDeploymentActivityStartMs(rows);
    const expectations = getCronExpectations();

    return expectations.map((expectation) => {
      const row = rowByJob.get(expectation.jobName) ?? null;
      const lastSuccessAt = row?.last_success_at ?? null;
      const lastSuccessMs = parseIsoTimestamp(lastSuccessAt);
      const staleThresholdMs = expectation.intervalMs * 2;
      const staleByMs =
        lastSuccessMs !== null
          ? Math.max(0, now - lastSuccessMs - staleThresholdMs)
          : row === null && deploymentActivityStartMs !== null
            ? Math.max(0, now - deploymentActivityStartMs - staleThresholdMs)
            : null;

      let status: CronHealthStatus = CRON_HEALTH_STATUS.healthy;
      if ((row?.consecutive_failures ?? 0) >= 3) {
        status = CRON_HEALTH_STATUS.failing;
      } else if (staleByMs !== null && staleByMs > 0) {
        status = CRON_HEALTH_STATUS.stale;
      }

      return {
        jobName: expectation.jobName,
        status,
        intervalMs: expectation.intervalMs,
        lastSuccessAt,
        lastFailureAt: row?.last_failure_at ?? null,
        lastError: row?.last_error ?? null,
        consecutiveFailures: row?.consecutive_failures ?? 0,
        staleThresholdMs,
        staleByMs,
      };
    });
  },
});

export const checkScheduledAutomationsWithHeartbeat = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const jobName = "automation-scheduler-check";
    if (shouldBypassBackgroundCronInE2E()) {
      await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      return null;
    }
    await withHeartbeat({
      jobName,
      run: async () => {
        await ctx.runMutation(
          refs.checkScheduledAutomations,
          args.limit !== undefined ? { limit: args.limit } : {},
        );
      },
      recordSuccess: async () => {
        await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      },
      recordFailure: async (error) => {
        await ctx.runMutation(refs.recordFailureInternal, { jobName, error });
      },
    });
    return null;
  },
});

export const reconcileProviderTriggerSubscriptionsWithHeartbeat = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const jobName = "automation-provider-trigger-reconcile";
    if (shouldBypassBackgroundCronInE2E()) {
      await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      return null;
    }
    await withHeartbeat({
      jobName,
      run: async () => {
        await ctx.runAction(
          refs.reconcileProviderTriggerSubscriptions,
          args.limit !== undefined ? { limit: args.limit } : {},
        );
      },
      recordSuccess: async () => {
        await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      },
      recordFailure: async (error) => {
        await ctx.runMutation(refs.recordFailureInternal, { jobName, error });
      },
    });
    return null;
  },
});

export const processAutomationTriggerEventsWithHeartbeat = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const jobName = "automation-trigger-event-processor";
    if (shouldBypassBackgroundCronInE2E()) {
      await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      return null;
    }
    await withHeartbeat({
      jobName,
      run: async () => {
        await ctx.runMutation(
          refs.processAutomationTriggerEvents,
          args.limit !== undefined ? { limit: args.limit } : {},
        );
      },
      recordSuccess: async () => {
        await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      },
      recordFailure: async (error) => {
        await ctx.runMutation(refs.recordFailureInternal, { jobName, error });
      },
    });
    return null;
  },
});

export const reapStaleRunsWithHeartbeat = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const jobName = "automation-stale-run-reaper";
    if (shouldBypassBackgroundCronInE2E()) {
      await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      return null;
    }
    await withHeartbeat({
      jobName,
      run: async () => {
        await ctx.runMutation(
          refs.reapStaleRuns,
          args.limit !== undefined ? { limit: args.limit } : {},
        );
      },
      recordSuccess: async () => {
        await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      },
      recordFailure: async (error) => {
        await ctx.runMutation(refs.recordFailureInternal, { jobName, error });
      },
    });
    return null;
  },
});

export const scheduledMaintenanceSweepWithHeartbeat = internalAction({
  args: {
    approvedSweepLimit: v.optional(v.number()),
    maintenanceApprovedLimit: v.optional(v.number()),
    ttlMinutes: v.optional(v.number()),
    inactivityMinutes: v.optional(v.number()),
  },
  returns: v.object({
    queue: v.object({
      attempted: v.number(),
      dispatched: v.number(),
      skipped: v.number(),
    }),
    skippedReason: v.union(v.literal(LEASE_HELD_SKIPPED_REASON), v.null()),
    maintenance: v.object({
      processed: v.number(),
      expired: v.number(),
      timedOutRuns: v.number(),
      securityFlagsCreated: v.number(),
      credentialLockoutRowsPurged: v.number(),
      credentialRotationRecommendations: v.number(),
      notificationsSent: v.number(),
      notificationsFailed: v.number(),
      purgedActions: v.number(),
      purgedBlobs: v.number(),
      purgedAudits: v.number(),
    }),
    invites: v.object({
      expired: v.number(),
    }),
  }),
  handler: async (ctx, args) => {
    const jobName = "maintenance-sweep";
    if (shouldBypassBackgroundCronInE2E()) {
      await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      return zeroSweepResult();
    }
    return await withHeartbeat({
      jobName,
      run: async () =>
        await runScheduledMaintenanceSweep(ctx, args, { jobName, recordHeartbeat: true }),
      recordSuccess: async () => {
        await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      },
      recordFailure: async (error) => {
        await ctx.runMutation(refs.recordFailureInternal, { jobName, error });
      },
    });
  },
});

export const scheduledMaintenanceSweepManual = internalAction({
  args: {
    approvedSweepLimit: v.optional(v.number()),
    maintenanceApprovedLimit: v.optional(v.number()),
    ttlMinutes: v.optional(v.number()),
    inactivityMinutes: v.optional(v.number()),
  },
  returns: v.object({
    queue: v.object({
      attempted: v.number(),
      dispatched: v.number(),
      skipped: v.number(),
    }),
    skippedReason: v.union(v.literal(LEASE_HELD_SKIPPED_REASON), v.null()),
    maintenance: v.object({
      processed: v.number(),
      expired: v.number(),
      timedOutRuns: v.number(),
      securityFlagsCreated: v.number(),
      credentialLockoutRowsPurged: v.number(),
      credentialRotationRecommendations: v.number(),
      notificationsSent: v.number(),
      notificationsFailed: v.number(),
      purgedActions: v.number(),
      purgedBlobs: v.number(),
      purgedAudits: v.number(),
    }),
    invites: v.object({
      expired: v.number(),
    }),
  }),
  handler: async (ctx, args) =>
    await runScheduledMaintenanceSweep(ctx, args, {
      jobName: "maintenance-sweep",
      recordHeartbeat: false,
    }),
});

export const autoRetryDlqWithHeartbeat = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const jobName = "dlq-auto-retry";
    await withHeartbeat({
      jobName,
      run: async () => {
        await ctx.runMutation(
          refs.autoRetryTransientEntries,
          args.limit !== undefined ? { limit: args.limit } : {},
        );
      },
      recordSuccess: async () => {
        await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      },
      recordFailure: async (error) => {
        await ctx.runMutation(refs.recordFailureInternal, { jobName, error });
      },
    });
    return null;
  },
});

export const syntheticCanaryWithHeartbeat = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const jobName = "synthetic-canary";
    await withHeartbeat({
      jobName,
      run: async () => {
        await ctx.runAction(refs.runCanaryCheck, {});
      },
      recordSuccess: async () => {
        await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      },
      recordFailure: async (error) => {
        await ctx.runMutation(refs.recordFailureInternal, { jobName, error });
      },
    });
    return null;
  },
});

export const archiveHotLogsWithHeartbeat = internalAction({
  args: {
    limit: v.optional(v.number()),
    scanLimit: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const jobName = "automation-hot-log-archival";
    await withHeartbeat({
      jobName,
      run: async () => {
        await ctx.runAction(refs.archiveHotLogs, {
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
          ...(args.scanLimit !== undefined ? { scanLimit: args.scanLimit } : {}),
        });
      },
      recordSuccess: async () => {
        await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      },
      recordFailure: async (error) => {
        await ctx.runMutation(refs.recordFailureInternal, { jobName, error });
      },
    });
    return null;
  },
});

export const expireColdLogsWithHeartbeat = internalMutation({
  args: {
    limit: v.optional(v.number()),
    scanLimit: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const jobName = "automation-cold-log-expiry";
    await withHeartbeat({
      jobName,
      run: async () => {
        await ctx.runMutation(refs.expireColdLogs, {
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
          ...(args.scanLimit !== undefined ? { scanLimit: args.scanLimit } : {}),
        });
      },
      recordSuccess: async () => {
        await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      },
      recordFailure: async (error) => {
        await ctx.runMutation(refs.recordFailureInternal, { jobName, error });
      },
    });
    return null;
  },
});

export const expirePurchasedCreditsWithHeartbeat = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const jobName = "ai-credit-expiry";
    await withHeartbeat({
      jobName,
      run: async () => {
        await ctx.runMutation(refs.expirePurchasedCredits, {});
      },
      recordSuccess: async () => {
        await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      },
      recordFailure: async (error) => {
        await ctx.runMutation(refs.recordFailureInternal, { jobName, error });
      },
    });
    return null;
  },
});

export const expirePurchasedAutomationRunTopupsWithHeartbeat = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const jobName = "automation-run-topup-expiry";
    await withHeartbeat({
      jobName,
      run: async () => {
        await ctx.runMutation(refs.expirePurchasedAutomationRunTopups, {});
      },
      recordSuccess: async () => {
        await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      },
      recordFailure: async (error) => {
        await ctx.runMutation(refs.recordFailureInternal, { jobName, error });
      },
    });
    return null;
  },
});

export const expireInviteCodePromosWithHeartbeat = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const jobName = "invite-promo-expiry";
    await withHeartbeat({
      jobName,
      run: async () => {
        await ctx.runMutation(
          refs.expireInviteCodePromos,
          args.limit !== undefined ? { limit: args.limit } : {},
        );
      },
      recordSuccess: async () => {
        await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      },
      recordFailure: async (error) => {
        await ctx.runMutation(refs.recordFailureInternal, { jobName, error });
      },
    });
    return null;
  },
});

export const purgeExpiredApiDedupeKeysWithHeartbeat = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const jobName = "api-dedupe-expiry-cleanup";
    await withHeartbeat({
      jobName,
      run: async () => {
        await ctx.runMutation(
          refs.purgeExpiredApiDedupeKeys,
          args.limit !== undefined ? { limit: args.limit } : {},
        );
      },
      recordSuccess: async () => {
        await ctx.runMutation(refs.recordSuccessInternal, { jobName });
      },
      recordFailure: async (error) => {
        await ctx.runMutation(refs.recordFailureInternal, { jobName, error });
      },
    });
    return null;
  },
});
