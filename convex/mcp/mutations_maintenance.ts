import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { normalizeJsonRecord } from "../mcp_runtime_shared";
import { nowIso, randomIdFor } from "../_auth";
import {
  ACTION_STATUS,
  AUDIT_ACTOR_TYPE,
  AUDIT_EVENT_TYPES,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_EVENT_ID,
  RUN_STATUS,
} from "../domain_constants";
import { safeRunMutation } from "../safe_convex";

const refs = {
  timeoutInactiveRuns: makeFunctionReference<"mutation">("mcp:timeoutInactiveRuns"),
  expirePendingActions: makeFunctionReference<"mutation">("mcp:expirePendingActions"),
  runSecurityMaintenance: makeFunctionReference<"mutation">("mcp:runSecurityMaintenance"),
  cleanupCredentialAuthFailures: makeFunctionReference<"mutation">(
    "abuse:cleanupCredentialAuthFailures",
  ),
};
const CREDENTIAL_ROTATION_BATCH_SIZE = 25;
const DEFAULT_MAINTENANCE_SWEEP_BATCH_SIZE = 50;
const E2E_MAINTENANCE_SWEEP_BATCH_SIZE = 3;
const MAINTENANCE_SWEEP_BATCH_SIZE =
  process.env.KEPPO_E2E_MODE === "true"
    ? E2E_MAINTENANCE_SWEEP_BATCH_SIZE
    : DEFAULT_MAINTENANCE_SWEEP_BATCH_SIZE;
const shouldScheduleMaintenanceContinuation = process.env.NODE_ENV !== "test";
const isE2EMode = process.env.KEPPO_E2E_MODE === "true";

export const shouldContinueTimeoutSweep = (args: { fetchedRuns: number; timedOutRuns: number }) =>
  args.timedOutRuns > 0 && args.fetchedRuns === MAINTENANCE_SWEEP_BATCH_SIZE;

const readCredentialRotationBatch = async (
  ctx: MutationCtx,
  args: {
    rotationCutoff: string;
    cursorCreatedAt?: string;
    cursorId?: string;
  },
) => {
  const rows: Array<{
    id: string;
    workspace_id: string;
    created_at: string;
    last_used_at: string | null;
  }> = [];
  let remaining = CREDENTIAL_ROTATION_BATCH_SIZE + 1;

  if (args.cursorCreatedAt && args.cursorId) {
    const sameTimestampRows = await ctx.db
      .query("workspace_credentials")
      .withIndex("by_revoked_created_id", (q) =>
        q.eq("revoked_at", null).eq("created_at", args.cursorCreatedAt!).gt("id", args.cursorId!),
      )
      .take(remaining);
    rows.push(...sameTimestampRows);
    remaining -= sameTimestampRows.length;
  }

  if (remaining > 0) {
    const laterRows =
      args.cursorCreatedAt && args.cursorId
        ? await ctx.db
            .query("workspace_credentials")
            .withIndex("by_revoked_created_id", (q) =>
              q
                .eq("revoked_at", null)
                .gt("created_at", args.cursorCreatedAt!)
                .lte("created_at", args.rotationCutoff),
            )
            .take(remaining)
        : await ctx.db
            .query("workspace_credentials")
            .withIndex("by_revoked_created_id", (q) =>
              q.eq("revoked_at", null).lte("created_at", args.rotationCutoff),
            )
            .take(remaining);
    rows.push(...laterRows);
  }

  const atScanBudget = rows.length > CREDENTIAL_ROTATION_BATCH_SIZE;
  return {
    atScanBudget,
    credentials: atScanBudget ? rows.slice(0, CREDENTIAL_ROTATION_BATCH_SIZE) : rows,
  };
};

export const timeoutInactiveRuns = internalMutation({
  args: {
    inactivityMinutes: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const thresholdMs = Math.max(1, args.inactivityMinutes) * 60_000;
    const inactivityCutoff = new Date(now - thresholdMs).toISOString();
    // Bound the sweep to runs old enough to possibly be inactive. This avoids
    // scanning every active run on each maintenance tick in CI/e2e.
    const runs = await ctx.db
      .query("automation_runs")
      .withIndex("by_status_started", (q) =>
        q.eq("status", RUN_STATUS.active).lt("started_at", inactivityCutoff),
      )
      .take(MAINTENANCE_SWEEP_BATCH_SIZE);
    let timedOut = 0;

    for (const run of runs) {
      const metadata = normalizeJsonRecord(run.metadata);
      const lastActivityRaw =
        typeof metadata.last_activity_at === "string" ? metadata.last_activity_at : run.started_at;
      const lastActivity = Date.parse(lastActivityRaw);
      if (!Number.isFinite(lastActivity)) {
        continue;
      }
      if (now - lastActivity < thresholdMs) {
        continue;
      }
      await ctx.db.patch(run._id, {
        status: RUN_STATUS.timedOut,
        ended_at: nowIso(),
      });
      timedOut += 1;
    }

    if (
      shouldScheduleMaintenanceContinuation &&
      shouldContinueTimeoutSweep({
        fetchedRuns: runs.length,
        timedOutRuns: timedOut,
      })
    ) {
      await ctx.scheduler.runAfter(0, refs.timeoutInactiveRuns, {
        inactivityMinutes: args.inactivityMinutes,
      });
    }

    return timedOut;
  },
});

export const expirePendingActions = internalMutation({
  args: {
    ttlMinutes: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const ttlMs = Math.max(1, args.ttlMinutes) * 60_000;
    const expirationCutoff = new Date(now - ttlMs).toISOString();
    const actions = await ctx.db
      .query("actions")
      .withIndex("by_status_created", (q) =>
        q.eq("status", ACTION_STATUS.pending).lt("created_at", expirationCutoff),
      )
      .take(MAINTENANCE_SWEEP_BATCH_SIZE);
    let expired = 0;

    for (const action of actions) {
      await ctx.db.patch(action._id, {
        status: ACTION_STATUS.expired,
        resolved_at: nowIso(),
      });

      if (!isE2EMode) {
        const relatedEvents = await ctx.db
          .query("notification_events")
          .withIndex("by_action", (q) => q.eq("action_id", action.id))
          .take(50);
        const stamp = nowIso();
        for (const event of relatedEvents) {
          if (
            event.event_type === NOTIFICATION_EVENT_ID.approvalNeeded &&
            event.channel === NOTIFICATION_CHANNEL.inApp &&
            event.read_at === null
          ) {
            await ctx.db.patch(event._id, { read_at: stamp });
          }
        }

        const run = await ctx.db
          .query("automation_runs")
          .withIndex("by_custom_id", (q) => q.eq("id", action.automation_run_id))
          .unique();
        if (run?.workspace_id) {
          const workspace = await ctx.db
            .query("workspaces")
            .withIndex("by_custom_id", (q) => q.eq("id", run.workspace_id!))
            .unique();
          if (workspace) {
            await ctx.db.insert("audit_events", {
              id: randomIdFor("audit"),
              org_id: workspace.org_id,
              action_id: action.id,
              actor_type: AUDIT_ACTOR_TYPE.system,
              actor_id: "expiry",
              event_type: AUDIT_EVENT_TYPES.actionExpired,
              payload: {
                action_id: action.id,
                ttl_minutes: args.ttlMinutes,
              },
              created_at: nowIso(),
            });
          }
        }
      }

      expired += 1;
    }

    if (shouldScheduleMaintenanceContinuation && actions.length === MAINTENANCE_SWEEP_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, refs.expirePendingActions, {
        ttlMinutes: args.ttlMinutes,
      });
    }

    return expired;
  },
});

export const runSecurityMaintenance = internalMutation({
  args: {
    credentialRotationDays: v.optional(v.number()),
    credentialFailureRetentionHours: v.optional(v.number()),
    rotationCursorCreatedAt: v.optional(v.string()),
    rotationCursorId: v.optional(v.string()),
  },
  returns: v.object({
    credentialRotationRecommendations: v.number(),
    cleanedCredentialFailures: v.number(),
    emailPatternFlags: v.number(),
    velocityFlags: v.number(),
    usageFlags: v.number(),
  }),
  handler: async (ctx, args) => {
    // Abuse heuristics now run on their own cron so the bounded maintenance
    // mutation does not hold the synchronous tick open on a full-org scan.
    if (process.env.KEPPO_E2E_MODE === "true") {
      return {
        credentialRotationRecommendations: 0,
        cleanedCredentialFailures: 0,
        emailPatternFlags: 0,
        velocityFlags: 0,
        usageFlags: 0,
      };
    }

    const now = Date.now();
    const nowIsoValue = nowIso();
    const rotationDays = Math.max(1, args.credentialRotationDays ?? 90);
    const rotationThresholdMs = rotationDays * 24 * 60 * 60 * 1000;
    const rotationCutoff = new Date(now - rotationThresholdMs).toISOString();
    const recommendationCutoff = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const rotationBatchArgs: {
      rotationCutoff: string;
      cursorCreatedAt?: string;
      cursorId?: string;
    } = {
      rotationCutoff,
    };
    if (args.rotationCursorCreatedAt && args.rotationCursorId) {
      rotationBatchArgs.cursorCreatedAt = args.rotationCursorCreatedAt;
      rotationBatchArgs.cursorId = args.rotationCursorId;
    }
    const { atScanBudget, credentials } = await readCredentialRotationBatch(ctx, rotationBatchArgs);
    let credentialRotationRecommendations = 0;

    for (const credential of credentials) {
      if (credential.last_used_at === null) {
        continue;
      }
      const createdAt = Date.parse(credential.created_at);
      if (!Number.isFinite(createdAt)) {
        continue;
      }

      const workspace = await ctx.db
        .query("workspaces")
        .withIndex("by_custom_id", (q) => q.eq("id", credential.workspace_id))
        .unique();
      if (!workspace) {
        continue;
      }

      const recentAudits = await ctx.db
        .query("audit_events")
        .withIndex("by_org_created", (q) =>
          q
            .eq("org_id", workspace.org_id)
            .gte("created_at", recommendationCutoff)
            .lte("created_at", nowIsoValue),
        )
        .take(200);
      const alreadyRecommended = recentAudits.some((event) => {
        if (event.event_type !== AUDIT_EVENT_TYPES.securityCredentialRotationRecommended) {
          return false;
        }
        return event.payload.credential_id === credential.id;
      });
      if (alreadyRecommended) {
        continue;
      }

      await ctx.db.insert("audit_events", {
        id: randomIdFor("audit"),
        org_id: workspace.org_id,
        actor_type: AUDIT_ACTOR_TYPE.system,
        actor_id: "maintenance",
        event_type: AUDIT_EVENT_TYPES.securityCredentialRotationRecommended,
        payload: {
          workspace_id: workspace.id,
          credential_id: credential.id,
          credential_age_days: Math.floor((now - createdAt) / (24 * 60 * 60 * 1000)),
          threshold_days: rotationDays,
        },
        created_at: nowIsoValue,
      });
      credentialRotationRecommendations += 1;
    }

    if (atScanBudget) {
      console.warn("mcp.runSecurityMaintenance.rotation_scan_budget_reached", {
        scan_budget: CREDENTIAL_ROTATION_BATCH_SIZE,
      });
      const lastCredential =
        credentials.length > 0 ? credentials[credentials.length - 1] : undefined;
      if (shouldScheduleMaintenanceContinuation && lastCredential) {
        await ctx.scheduler.runAfter(0, refs.runSecurityMaintenance, {
          credentialRotationDays: args.credentialRotationDays,
          credentialFailureRetentionHours: args.credentialFailureRetentionHours,
          rotationCursorCreatedAt: lastCredential.created_at,
          rotationCursorId: lastCredential.id,
        });
      }
    }

    const cleanedCredentialFailures = (await safeRunMutation(
      "mcp.cleanupCredentialAuthFailures",
      () =>
        ctx.runMutation(refs.cleanupCredentialAuthFailures, {
          olderThanHours: Math.max(1, args.credentialFailureRetentionHours ?? 24),
        }),
    )) as number;

    return {
      credentialRotationRecommendations,
      cleanedCredentialFailures,
      // Abuse heuristics run on their dedicated cron, not inline here.
      emailPatternFlags: 0,
      velocityFlags: 0,
      usageFlags: 0,
    };
  },
});
