"use node";

import { type FunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import {
  createWorkerExecutionError,
  convexActionIdListSchema,
  convexRunMaintenanceTickPayloadSchema,
  parseWorkerPayload,
} from "../mcp_node_shared";
import { ACTION_STATUS, DEAD_LETTER_SOURCE } from "../domain_constants";
import { MAINTENANCE_TASK_RETRY_POLICY } from "../retry_policies";
import { safeParsePayload, safeRunMutation, safeRunQuery, validationMessage } from "../safe_convex";

type AnyInternalQueryReference = FunctionReference<"query", "internal">;
type AnyInternalMutationReference = FunctionReference<"mutation", "internal">;

type MaintenanceActionDeps = {
  listActionsByStatusRef: AnyInternalQueryReference;
  scheduleApprovedActionRef: AnyInternalMutationReference;
  expirePendingActionsRef: AnyInternalMutationReference;
  timeoutInactiveRunsRef: AnyInternalMutationReference;
  runSecurityMaintenanceRef: AnyInternalMutationReference;
  recordCronSuccessRef: AnyInternalMutationReference;
  recordCronFailureRef: AnyInternalMutationReference;
  enqueueDeadLetterRef: AnyInternalMutationReference;
};

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const parseFiniteWorkerNumber = (payload: unknown, message: string): number => {
  if (typeof payload !== "number" || !Number.isFinite(payload)) {
    throw createWorkerExecutionError("execution_failed", message);
  }
  return payload;
};

export const processApprovedActionsImpl = async (
  ctx: ActionCtx,
  limit: number | undefined,
  deps: MaintenanceActionDeps,
): Promise<number> => {
  const approvedRaw = await safeRunQuery("mcp_node.listActionsByStatus", () =>
    ctx.runQuery(deps.listActionsByStatusRef, {
      status: ACTION_STATUS.approved,
      limit: Math.max(1, limit ?? 20),
    }),
  );
  const approved = safeParsePayload("mcp_node.listActionsByStatus", () =>
    parseWorkerPayload(convexActionIdListSchema, approvedRaw, {
      message: validationMessage(
        "mcp_node.listActionsByStatus",
        "Approved action list payload failed validation.",
      ),
    }),
  );

  let dispatched = 0;

  for (const action of approved) {
    try {
      const scheduledRaw = await safeRunMutation("mcp_node.scheduleApprovedAction", () =>
        ctx.runMutation(deps.scheduleApprovedActionRef, {
          actionId: action.id,
          source: "maintenance_tick",
        }),
      );
      const scheduled =
        scheduledRaw &&
        typeof scheduledRaw === "object" &&
        "dispatched" in scheduledRaw &&
        (scheduledRaw as { dispatched?: unknown }).dispatched === true;
      if (scheduled) {
        dispatched += 1;
      }
    } catch (error) {
      console.error("maintenance.approved_action.failed", {
        label: "processApprovedActions",
        result: "failure",
        actionId: action.id,
        error: toErrorMessage(error),
      });
    }
  }

  return dispatched;
};

export const createMaintenanceActions = (deps: MaintenanceActionDeps) => ({
  processApprovedActions: internalAction({
    args: {
      limit: v.optional(v.number()),
    },
    returns: v.number(),
    handler: async (ctx, args) => {
      return await processApprovedActionsImpl(ctx, args.limit, deps);
    },
  }),

  runMaintenanceTick: internalAction({
    args: {
      approvedLimit: v.optional(v.number()),
      ttlMinutes: v.optional(v.number()),
      inactivityMinutes: v.optional(v.number()),
    },
    returns: v.object({
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
    handler: async (ctx, args) => {
      const payload = parseWorkerPayload(convexRunMaintenanceTickPayloadSchema, {
        approvedLimit: Math.max(0, Math.floor(args.approvedLimit ?? 20)),
        ttlMinutes: Math.max(1, args.ttlMinutes ?? 60),
        inactivityMinutes: Math.max(1, args.inactivityMinutes ?? 30),
      });
      const runWithFallback = async <T>(
        label: string,
        task: () => Promise<T>,
        fallback: T,
      ): Promise<T> => {
        const heartbeatJob = `maintenance.${label}`;
        try {
          const result = await task();
          await safeRunMutation("mcp_node.recordCronSuccess", () =>
            ctx.runMutation(deps.recordCronSuccessRef, { jobName: heartbeatJob }),
          );
          return result;
        } catch (error) {
          const message = toErrorMessage(error);
          await safeRunMutation("mcp_node.recordCronFailure", () =>
            ctx.runMutation(deps.recordCronFailureRef, {
              jobName: heartbeatJob,
              error: message,
            }),
          );
          await safeRunMutation("mcp_node.enqueueDeadLetter", () =>
            ctx.runMutation(deps.enqueueDeadLetterRef, {
              sourceTable: DEAD_LETTER_SOURCE.maintenanceTask,
              sourceId: label,
              failureReason: message,
              payload: {
                job: "runMaintenanceTick",
                label,
                retryPolicy: {
                  maxRetries: MAINTENANCE_TASK_RETRY_POLICY.maxRetries,
                  baseBackoffMs: MAINTENANCE_TASK_RETRY_POLICY.baseBackoffMs,
                  maxBackoffMs: MAINTENANCE_TASK_RETRY_POLICY.maxBackoffMs,
                },
              },
              retryCount: 0,
              maxRetries: MAINTENANCE_TASK_RETRY_POLICY.maxRetries,
              lastAttemptAt: new Date().toISOString(),
            }),
          );
          console.error("maintenance.task.failed", {
            label,
            result: "fallback",
            error: message,
          });
          return fallback;
        }
      };

      const processed =
        payload.approvedLimit > 0
          ? await runWithFallback(
              "processApprovedActions",
              async () => await processApprovedActionsImpl(ctx, payload.approvedLimit, deps),
              0,
            )
          : 0;

      const expired = await runWithFallback(
        "expirePendingActions",
        async () =>
          parseFiniteWorkerNumber(
            await safeRunMutation("mcp_node.expirePendingActions", () =>
              ctx.runMutation(deps.expirePendingActionsRef, {
                ttlMinutes: payload.ttlMinutes,
              }),
            ),
            "Maintenance expirePendingActions returned non-numeric payload.",
          ),
        0,
      );

      const timedOutRuns = await runWithFallback(
        "timeoutInactiveRuns",
        async () =>
          parseFiniteWorkerNumber(
            await safeRunMutation("mcp_node.timeoutInactiveRuns", () =>
              ctx.runMutation(deps.timeoutInactiveRunsRef, {
                inactivityMinutes: payload.inactivityMinutes,
              }),
            ),
            "Maintenance timeoutInactiveRuns returned non-numeric payload.",
          ),
        0,
      );

      const securityMaintenance = await runWithFallback(
        "runSecurityMaintenance",
        async () => {
          const raw = (await safeRunMutation("mcp_node.runSecurityMaintenance", () =>
            ctx.runMutation(deps.runSecurityMaintenanceRef, {}),
          )) as Record<string, unknown>;
          return {
            credentialRotationRecommendations: parseFiniteWorkerNumber(
              raw.credentialRotationRecommendations,
              "Maintenance runSecurityMaintenance credentialRotationRecommendations is invalid.",
            ),
            cleanedCredentialFailures: parseFiniteWorkerNumber(
              raw.cleanedCredentialFailures,
              "Maintenance runSecurityMaintenance cleanedCredentialFailures is invalid.",
            ),
            emailPatternFlags: parseFiniteWorkerNumber(
              raw.emailPatternFlags,
              "Maintenance runSecurityMaintenance emailPatternFlags is invalid.",
            ),
            velocityFlags: parseFiniteWorkerNumber(
              raw.velocityFlags,
              "Maintenance runSecurityMaintenance velocityFlags is invalid.",
            ),
            usageFlags: parseFiniteWorkerNumber(
              raw.usageFlags,
              "Maintenance runSecurityMaintenance usageFlags is invalid.",
            ),
          };
        },
        {
          credentialRotationRecommendations: 0,
          cleanedCredentialFailures: 0,
          emailPatternFlags: 0,
          velocityFlags: 0,
          usageFlags: 0,
        },
      );

      const summary = {
        processed,
        expired,
        timedOutRuns,
        securityFlagsCreated:
          securityMaintenance.emailPatternFlags +
          securityMaintenance.velocityFlags +
          securityMaintenance.usageFlags,
        credentialLockoutRowsPurged: securityMaintenance.cleanedCredentialFailures,
        credentialRotationRecommendations: securityMaintenance.credentialRotationRecommendations,
        notificationsSent: 0,
        notificationsFailed: 0,
        purgedActions: 0,
        purgedBlobs: 0,
        purgedAudits: 0,
      };
      const shouldLogSummary =
        summary.processed > 0 ||
        summary.expired > 0 ||
        summary.timedOutRuns > 0 ||
        summary.securityFlagsCreated > 0 ||
        summary.credentialLockoutRowsPurged > 0 ||
        summary.credentialRotationRecommendations > 0 ||
        summary.notificationsSent > 0 ||
        summary.notificationsFailed > 0 ||
        summary.purgedActions > 0 ||
        summary.purgedBlobs > 0 ||
        summary.purgedAudits > 0;
      if (shouldLogSummary) {
        console.log("maintenance.tick.completed", {
          label: "runMaintenanceTick",
          result: "success",
          ...summary,
        });
      }
      return summary;
    },
  }),
});
