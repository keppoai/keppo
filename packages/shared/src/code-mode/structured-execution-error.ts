import { isJsonRecord, parseJsonValue } from "../providers/boundaries/json.js";

export const CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE = {
  approvalRequired: "approval_required",
  blocked: "blocked",
  executionFailed: "execution_failed",
} as const;

export const CODE_MODE_STRUCTURED_EXECUTION_ERROR_CODE = {
  approvalRequired: "approval_required",
  policyDenied: "policy_denied",
  actionRejected: "action_rejected",
  providerDisabled: "provider_disabled",
  integrationNotConnected: "integration_not_connected",
  validationFailed: "validation_failed",
  timeout: "timeout",
  sandboxUnavailable: "sandbox_unavailable",
  sandboxStartupFailed: "sandbox_startup_failed",
  sandboxRuntimeFailed: "sandbox_runtime_failed",
} as const;

export const CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPES = [
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.approvalRequired,
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.blocked,
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE.executionFailed,
] as const;

export type CodeModeStructuredExecutionErrorType =
  (typeof CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPES)[number];

const CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE_SET = new Set<string>(
  CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPES,
);

export type CodeModeStructuredExecutionErrorPayload = {
  type: CodeModeStructuredExecutionErrorType;
  toolName: string;
  reason: string;
  errorCode?: string;
  actionId?: string;
};

const isCodeModeStructuredExecutionErrorType = (
  value: unknown,
): value is CodeModeStructuredExecutionErrorType => {
  return typeof value === "string" && CODE_MODE_STRUCTURED_EXECUTION_ERROR_TYPE_SET.has(value);
};

export const formatCodeModeStructuredExecutionError = (
  payload: CodeModeStructuredExecutionErrorPayload,
): string => {
  return JSON.stringify({
    type: payload.type,
    toolName: payload.toolName,
    reason: payload.reason,
    ...(payload.errorCode ? { error_code: payload.errorCode } : {}),
    ...(payload.actionId ? { action_id: payload.actionId } : {}),
  });
};

export const createCodeModeStructuredExecutionError = (
  payload: CodeModeStructuredExecutionErrorPayload,
): Error => {
  return new Error(formatCodeModeStructuredExecutionError(payload));
};

export const parseCodeModeStructuredExecutionError = (
  error: unknown,
): CodeModeStructuredExecutionErrorPayload | null => {
  const message = error instanceof Error ? error.message : String(error);
  if (!message) {
    return null;
  }
  try {
    const parsed = parseJsonValue(message);
    if (
      !isJsonRecord(parsed) ||
      !isCodeModeStructuredExecutionErrorType(parsed.type) ||
      typeof parsed.toolName !== "string" ||
      typeof parsed.reason !== "string"
    ) {
      return null;
    }
    return {
      type: parsed.type,
      toolName: parsed.toolName,
      reason: parsed.reason,
      ...(typeof parsed.error_code === "string" && parsed.error_code.trim().length > 0
        ? { errorCode: parsed.error_code }
        : {}),
      ...(typeof parsed.action_id === "string" ? { actionId: parsed.action_id } : {}),
    };
  } catch {
    return null;
  }
};
