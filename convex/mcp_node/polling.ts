"use node";

import { type ActionCtx } from "../_generated/server";
import { createWorkerExecutionError } from "../mcp_node_shared";
import { ACTION_POLL_STATUS, ACTION_STATUS, type ActionStatus } from "../domain_constants";

type JsonRecord = Record<string, unknown>;

type PollRateLimit = {
  limited: boolean;
  retry_after_ms?: number | undefined;
};

type PollableAction = {
  id: string;
  status: ActionStatus;
  result_redacted: JsonRecord | null;
  payload_preview: JsonRecord;
};

type PollableActionState = {
  workspace: {
    id: string;
  };
  action: PollableAction;
};

type PollingDeps = {
  recordPollAttempt: (ctx: ActionCtx, credentialId: string) => Promise<PollRateLimit>;
  loadActionState: (ctx: ActionCtx, actionId: string) => Promise<PollableActionState | null>;
  toStatusPayload: (
    ctx: ActionCtx,
    params: {
      action: PollableAction;
      credentialId: string;
    },
  ) => Promise<JsonRecord>;
  executeApprovedAction: (
    ctx: ActionCtx,
    actionId: string,
  ) => Promise<{
    status: ActionStatus;
    action: PollableAction;
  }>;
  isInlineApprovedActionProcessingEnabled: () => boolean;
};

const POLL_INTERVAL_BASE_MS = 200;
const POLL_INTERVAL_MAX_MS = 1000;
const POLL_INTERVAL_BACKOFF_FACTOR = 1.5;

const applyPollBackoffJitter = (backoffMs: number): number => {
  if (!Number.isFinite(backoffMs) || backoffMs <= 0) {
    return POLL_INTERVAL_BASE_MS;
  }
  const multiplier = 0.5 + Math.random() * 0.5;
  const jittered = Math.floor(backoffMs * multiplier);
  return Math.min(POLL_INTERVAL_MAX_MS, Math.max(POLL_INTERVAL_BASE_MS, jittered));
};

const nextPollIntervalMs = (currentMs: number): number => {
  const nextBackoffMs = Math.min(
    POLL_INTERVAL_MAX_MS,
    Math.max(POLL_INTERVAL_BASE_MS, Math.floor(currentMs * POLL_INTERVAL_BACKOFF_FACTOR)),
  );
  return applyPollBackoffJitter(nextBackoffMs);
};

const sleepMs = async (durationMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, durationMs));
};

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const toExecutionFailedError = (message: string): Error => {
  return createWorkerExecutionError("execution_failed", message);
};

const toRateLimitedPayload = (retryAfterMs: number | undefined): JsonRecord => {
  return {
    status: ACTION_POLL_STATUS.rateLimited,
    retry_after_ms: retryAfterMs ?? 1000,
  };
};

const toPendingFallbackPayload = (retryAfterMs: number): JsonRecord => {
  return {
    status: ACTION_POLL_STATUS.stillPending,
    retry_after_ms: retryAfterMs,
  };
};

const clampMaxBlockMs = (maxBlockMs: number | undefined): number =>
  Math.max(500, Math.min(10_000, maxBlockMs ?? 5000));

const isTerminalActionStatus = (status: ActionStatus): boolean => {
  switch (status) {
    case ACTION_STATUS.succeeded:
    case ACTION_STATUS.failed:
    case ACTION_STATUS.rejected:
    case ACTION_STATUS.expired:
      return true;
    case ACTION_STATUS.pending:
    case ACTION_STATUS.approved:
    case ACTION_STATUS.executing:
      return false;
  }
};

const normalizePendingLikeStatusPayload = (actionId: string, payload: JsonRecord): JsonRecord => {
  const status = payload.status;
  const pendingPayload =
    status === ACTION_POLL_STATUS.stillPending
      ? payload
      : {
          status: ACTION_POLL_STATUS.stillPending,
          action: null,
        };
  return {
    action_id: actionId,
    ...pendingPayload,
  };
};

export const createPollingHandlers = (deps: PollingDeps) => {
  const waitForActionImpl = async (
    ctx: ActionCtx,
    params: {
      workspaceId: string;
      credentialId: string;
      actionId: string;
      maxBlockMs: number;
    },
  ): Promise<JsonRecord> => {
    const rate = await deps.recordPollAttempt(ctx, params.credentialId);
    if (rate.limited) {
      return toRateLimitedPayload(rate.retry_after_ms);
    }

    const deadline = Date.now() + params.maxBlockMs;
    let pollIntervalMs = POLL_INTERVAL_BASE_MS;
    let pollingErrorCount = 0;

    while (Date.now() <= deadline) {
      let state: PollableActionState | null;
      try {
        state = await deps.loadActionState(ctx, params.actionId);
        pollingErrorCount = 0;
        pollIntervalMs = POLL_INTERVAL_BASE_MS;
      } catch (error) {
        pollingErrorCount += 1;
        console.error("wait_for_action.poll_iteration_failed", {
          actionId: params.actionId,
          workspaceId: params.workspaceId,
          failures: pollingErrorCount,
          message: toErrorMessage(error),
        });
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          break;
        }
        await sleepMs(Math.min(pollIntervalMs, remainingMs));
        pollIntervalMs = nextPollIntervalMs(pollIntervalMs);
        continue;
      }

      if (!state) {
        throw toExecutionFailedError(`Action ${params.actionId} not found`);
      }

      if (state.workspace.id !== params.workspaceId) {
        throw toExecutionFailedError(
          `Action ${params.actionId} is not part of workspace ${params.workspaceId}`,
        );
      }

      try {
        if (
          state.action.status === ACTION_STATUS.approved &&
          deps.isInlineApprovedActionProcessingEnabled()
        ) {
          const execution = await deps.executeApprovedAction(ctx, params.actionId);
          if (!isTerminalActionStatus(execution.status)) {
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
              break;
            }
            await sleepMs(Math.min(pollIntervalMs, remainingMs));
            pollIntervalMs = nextPollIntervalMs(pollIntervalMs);
            continue;
          }
          return await deps.toStatusPayload(ctx, {
            action: execution.action,
            credentialId: params.credentialId,
          });
        }

        if (isTerminalActionStatus(state.action.status)) {
          return await deps.toStatusPayload(ctx, {
            action: state.action,
            credentialId: params.credentialId,
          });
        }
      } catch (error) {
        pollingErrorCount += 1;
        console.error("wait_for_action.poll_status_resolution_failed", {
          actionId: params.actionId,
          workspaceId: params.workspaceId,
          failures: pollingErrorCount,
          message: toErrorMessage(error),
        });
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          break;
        }
        await sleepMs(Math.min(pollIntervalMs, remainingMs));
        pollIntervalMs = nextPollIntervalMs(pollIntervalMs);
        continue;
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }
      await sleepMs(Math.min(pollIntervalMs, remainingMs));
      pollIntervalMs = nextPollIntervalMs(pollIntervalMs);
    }

    try {
      const state = await deps.loadActionState(ctx, params.actionId);
      if (!state || state.workspace.id !== params.workspaceId) {
        return toPendingFallbackPayload(pollIntervalMs);
      }
      return await deps.toStatusPayload(ctx, {
        action: state.action,
        credentialId: params.credentialId,
      });
    } catch (error) {
      console.error("wait_for_action.poll_final_read_failed", {
        actionId: params.actionId,
        workspaceId: params.workspaceId,
        message: toErrorMessage(error),
      });
      return toPendingFallbackPayload(pollIntervalMs);
    }
  };

  const waitForActionsImpl = async (
    ctx: ActionCtx,
    args: {
      workspaceId: string;
      credentialId: string;
      actionIds: string[];
      maxBlockMs?: number;
    },
  ): Promise<{ actions: JsonRecord[] }> => {
    const rate = await deps.recordPollAttempt(ctx, args.credentialId);
    if (rate.limited) {
      return {
        actions: [toRateLimitedPayload(rate.retry_after_ms)],
      };
    }

    const deadline = Date.now() + clampMaxBlockMs(args.maxBlockMs);
    let pollIntervalMs = POLL_INTERVAL_BASE_MS;
    let pollingErrorCount = 0;

    const loadStatuses = async (): Promise<JsonRecord[]> => {
      const statuses = await Promise.all(
        args.actionIds.map(async (actionId) => {
          const state = await deps.loadActionState(ctx, actionId);
          if (!state || state.workspace.id !== args.workspaceId) {
            return {
              action_id: actionId,
              status: ACTION_STATUS.expired,
            };
          }

          const payload = await deps.toStatusPayload(ctx, {
            action: state.action,
            credentialId: args.credentialId,
          });

          if (!isTerminalActionStatus(state.action.status)) {
            return normalizePendingLikeStatusPayload(actionId, payload);
          }

          return {
            action_id: actionId,
            ...payload,
          };
        }),
      );
      return statuses;
    };

    while (Date.now() <= deadline) {
      try {
        const statuses = await loadStatuses();
        pollingErrorCount = 0;
        pollIntervalMs = POLL_INTERVAL_BASE_MS;
        if (statuses.some((entry) => entry.status !== ACTION_POLL_STATUS.stillPending)) {
          return {
            actions: statuses,
          };
        }
      } catch (error) {
        pollingErrorCount += 1;
        console.error("wait_for_actions.poll_iteration_failed", {
          workspaceId: args.workspaceId,
          actionCount: args.actionIds.length,
          failures: pollingErrorCount,
          message: toErrorMessage(error),
        });
      }

      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }
      await sleepMs(Math.min(pollIntervalMs, remainingMs));
      pollIntervalMs = nextPollIntervalMs(pollIntervalMs);
    }

    try {
      return {
        actions: await loadStatuses(),
      };
    } catch (error) {
      console.error("wait_for_actions.poll_final_read_failed", {
        workspaceId: args.workspaceId,
        actionCount: args.actionIds.length,
        message: toErrorMessage(error),
      });
      return {
        actions: args.actionIds.map((actionId) => ({
          action_id: actionId,
          ...toPendingFallbackPayload(pollIntervalMs),
        })),
      };
    }
  };

  return {
    waitForActionImpl,
    waitForActionsImpl,
  };
};
