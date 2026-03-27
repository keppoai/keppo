export * from "./error-codes.js";

export const WORKER_EXECUTION_ERROR_CODES = [
  "provider_registry_disabled",
  "provider_disabled",
  "provider_capability_mismatch",
  "provider_mismatch",
  "missing_refresh_token",
  "integration_not_connected",
  "allowlist_blocked",
  "write_mode_blocked",
  "missing_scopes",
  "credential_error",
  "network_blocked",
  "rate_limited",
  "execution_failed",
] as const;

export type WorkerExecutionErrorCode = (typeof WORKER_EXECUTION_ERROR_CODES)[number];

const WORKER_EXECUTION_ERROR_CODE_SET = new Set<string>(WORKER_EXECUTION_ERROR_CODES);

export const isWorkerExecutionErrorCode = (value: unknown): value is WorkerExecutionErrorCode => {
  return typeof value === "string" && WORKER_EXECUTION_ERROR_CODE_SET.has(value);
};

export const formatWorkerExecutionErrorMessage = (
  code: WorkerExecutionErrorCode,
  message: string,
): string => {
  return `${code}: ${message}`;
};

export const createWorkerExecutionError = (
  code: WorkerExecutionErrorCode,
  message: string,
): Error => {
  return new Error(formatWorkerExecutionErrorMessage(code, message));
};

export const parseWorkerExecutionErrorCode = (
  errorMessage: string | undefined,
): WorkerExecutionErrorCode | null => {
  if (!errorMessage) {
    return null;
  }
  const match = /^([a-z0-9_]+):\s/u.exec(errorMessage.trim());
  if (!match) {
    return null;
  }
  const parsed = match[1]?.trim();
  if (!parsed) {
    return null;
  }
  return isWorkerExecutionErrorCode(parsed) ? parsed : null;
};

export const toWorkerExecutionError = (
  error: unknown,
  fallbackCode: WorkerExecutionErrorCode = "execution_failed",
): Error => {
  if (error instanceof Error && parseWorkerExecutionErrorCode(error.message)) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return createWorkerExecutionError(fallbackCode, message);
};

export const INTEGRATION_ERROR_CODES = [
  "missing_scopes",
  "credential_error",
  "allowlist_blocked",
  "write_mode_blocked",
  "provider_disabled",
  "capability_mismatch",
  "provider_mismatch",
  "network_blocked",
  "rate_limited",
  "execution_failed",
] as const;

export type IntegrationErrorCode = (typeof INTEGRATION_ERROR_CODES)[number];

const INTEGRATION_ERROR_CODE_SET = new Set<string>(INTEGRATION_ERROR_CODES);

export const isIntegrationErrorCode = (value: unknown): value is IntegrationErrorCode => {
  return typeof value === "string" && INTEGRATION_ERROR_CODE_SET.has(value);
};

export const INTEGRATION_ERROR_CATEGORIES = ["auth", "policy", "network", "provider_api"] as const;

export type IntegrationErrorCategory = (typeof INTEGRATION_ERROR_CATEGORIES)[number];

const INTEGRATION_ERROR_CATEGORY_SET = new Set<string>(INTEGRATION_ERROR_CATEGORIES);

export const isIntegrationErrorCategory = (value: unknown): value is IntegrationErrorCategory => {
  return typeof value === "string" && INTEGRATION_ERROR_CATEGORY_SET.has(value);
};

export const INTEGRATION_ERROR_CLASSIFICATIONS = {
  missing_scopes: {
    errorCategory: "auth",
    degradedReason: "Missing required provider scopes. Reconnect with required permissions.",
  },
  credential_error: {
    errorCategory: "auth",
    degradedReason: "Credential is invalid or expired. Reconnect integration.",
  },
  allowlist_blocked: {
    errorCategory: "policy",
    degradedReason: "Requested resource is outside configured integration allowlist.",
  },
  write_mode_blocked: {
    errorCategory: "policy",
    degradedReason: "Stripe write mode policy blocked this operation.",
  },
  provider_disabled: {
    errorCategory: "policy",
    degradedReason: "Provider is disabled by rollout policy.",
  },
  capability_mismatch: {
    errorCategory: "policy",
    degradedReason: "Provider capability policy blocked the requested operation.",
  },
  provider_mismatch: {
    errorCategory: "policy",
    degradedReason: "Provider mismatch detected between tool ownership and integration context.",
  },
  network_blocked: {
    errorCategory: "network",
    degradedReason: "Outbound provider request blocked by allowlist policy.",
  },
  rate_limited: {
    errorCategory: "provider_api",
    degradedReason: "Provider API rate limited the request.",
  },
  execution_failed: {
    errorCategory: "provider_api",
    degradedReason: "Provider operation failed.",
  },
} as const satisfies Record<
  IntegrationErrorCode,
  {
    errorCategory: IntegrationErrorCategory;
    degradedReason: string;
  }
>;

export type IntegrationErrorClassification = {
  errorCode: IntegrationErrorCode;
  errorCategory: IntegrationErrorCategory;
  degradedReason: string;
};

export const WORKER_ERROR_TO_INTEGRATION_ERROR = {
  provider_registry_disabled: "provider_disabled",
  provider_disabled: "provider_disabled",
  provider_capability_mismatch: "capability_mismatch",
  provider_mismatch: "provider_mismatch",
  missing_refresh_token: "credential_error",
  integration_not_connected: "credential_error",
  allowlist_blocked: "allowlist_blocked",
  write_mode_blocked: "write_mode_blocked",
  missing_scopes: "missing_scopes",
  credential_error: "credential_error",
  network_blocked: "network_blocked",
  rate_limited: "rate_limited",
  execution_failed: "execution_failed",
} as const satisfies Record<WorkerExecutionErrorCode, IntegrationErrorCode>;

export const INTEGRATION_ERROR_TO_WORKER_ERROR = {
  missing_scopes: "missing_scopes",
  credential_error: "credential_error",
  allowlist_blocked: "allowlist_blocked",
  write_mode_blocked: "write_mode_blocked",
  provider_disabled: "provider_disabled",
  capability_mismatch: "provider_capability_mismatch",
  provider_mismatch: "provider_mismatch",
  network_blocked: "network_blocked",
  rate_limited: "rate_limited",
  execution_failed: "execution_failed",
} as const satisfies Record<IntegrationErrorCode, WorkerExecutionErrorCode>;

export const toIntegrationErrorClassification = (
  errorCode: IntegrationErrorCode,
): IntegrationErrorClassification => {
  const details = INTEGRATION_ERROR_CLASSIFICATIONS[errorCode];
  return {
    errorCode,
    errorCategory: details.errorCategory,
    degradedReason: details.degradedReason,
  };
};

export const toIntegrationErrorCodeFromWorkerCode = (
  code: WorkerExecutionErrorCode,
): IntegrationErrorCode => {
  return WORKER_ERROR_TO_INTEGRATION_ERROR[code];
};

export const toWorkerExecutionErrorCode = (
  code: IntegrationErrorCode,
): WorkerExecutionErrorCode => {
  return INTEGRATION_ERROR_TO_WORKER_ERROR[code];
};
