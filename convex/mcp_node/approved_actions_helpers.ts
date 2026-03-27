"use node";

import {
  createWorkerExecutionError,
  convexActionExecutionStateSchema,
  convexActionStateSchema,
  convexActionStatusPayloadSchema,
  jsonRecordSchema,
  parseWorkerPayload,
  type ConvexActionExecutionState,
  type ConvexActionState,
  type ConvexActionStatusPayload,
} from "../mcp_node_shared";
import { decryptSecretValue } from "../crypto_helpers";
import { ACTION_STATUS, type ActionStatus } from "../domain_constants";
import { safeParsePayload, validationMessage } from "../safe_convex";

export const parseJsonEncodedRecord = async (
  encoded: string,
  errorMessage: string,
): Promise<Record<string, unknown>> => {
  try {
    const rawPayload = await decryptSecretValue(encoded, "sensitive_blob");
    return safeParsePayload("mcp_node.parseJsonEncodedRecord", () =>
      parseWorkerPayload(jsonRecordSchema, JSON.parse(rawPayload), {
        message: errorMessage,
      }),
    );
  } catch {
    throw createWorkerExecutionError("execution_failed", errorMessage);
  }
};

export const parseActionStatusPayload = (
  payload: unknown,
  message: string,
): ConvexActionStatusPayload => {
  return safeParsePayload("mcp_node.parseActionStatusPayload", () =>
    parseWorkerPayload(convexActionStatusPayloadSchema, payload, { message }),
  );
};

export const parseActionExecutionState = (
  payload: unknown,
  message: string,
): ConvexActionExecutionState => {
  return safeParsePayload("mcp_node.parseActionExecutionState", () =>
    parseWorkerPayload(convexActionExecutionStateSchema, payload, { message }),
  );
};

export const parseActionState = (payload: unknown, message: string): ConvexActionState => {
  return safeParsePayload("mcp_node.parseActionState", () =>
    parseWorkerPayload(convexActionStateSchema, payload, { message }),
  );
};

const TERMINAL_ACTION_STATUSES = new Set<ActionStatus>([
  ACTION_STATUS.succeeded,
  ACTION_STATUS.failed,
  ACTION_STATUS.rejected,
  ACTION_STATUS.expired,
]);

export const isTerminalStatus = (status: ActionStatus): boolean =>
  TERMINAL_ACTION_STATUSES.has(status);

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const isOptimisticConcurrencyControlFailure = (error: unknown): boolean => {
  return /OptimisticConcurrencyControlFailure/i.test(toErrorMessage(error));
};

export const isActionStatusTransitionConflict = (error: unknown): boolean => {
  return toErrorMessage(error).includes("action_status_transition_conflict");
};

export const actionValidationMessage = (actionId: string): string =>
  validationMessage(
    "mcp_node.getActionState",
    `Action state payload for ${actionId} failed validation.`,
  );
