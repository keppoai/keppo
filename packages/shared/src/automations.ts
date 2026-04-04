import type { CanonicalProviderId } from "./provider-ids.js";
import type { SubscriptionTierId } from "./subscriptions.js";
import { assertNever } from "./domain.js";

export const AUTOMATION_RUNNER_TYPES = ["chatgpt_codex", "claude_code"] as const;
export type AutomationRunnerType = (typeof AUTOMATION_RUNNER_TYPES)[number];
export const AUTOMATION_RUNNER_TYPE = {
  chatgptCodex: "chatgpt_codex",
  claudeCode: "claude_code",
} as const satisfies Record<string, AutomationRunnerType>;

export const AUTOMATION_MODEL_CLASSES = ["auto", "frontier", "balanced", "value"] as const;
export type AutomationModelClass = (typeof AUTOMATION_MODEL_CLASSES)[number];
export const AUTOMATION_MODEL_CLASS = {
  auto: "auto",
  frontier: "frontier",
  balanced: "balanced",
  value: "value",
} as const satisfies Record<string, AutomationModelClass>;

export const AUTOMATION_CONFIG_TRIGGER_TYPES = ["schedule", "event", "manual"] as const;
export type AutomationConfigTriggerType = (typeof AUTOMATION_CONFIG_TRIGGER_TYPES)[number];

export const AUTOMATION_RUN_TRIGGER_TYPES = ["schedule", "event", "manual"] as const;
export type AutomationRunTriggerType = (typeof AUTOMATION_RUN_TRIGGER_TYPES)[number];

export const AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODES = ["webhook", "polling"] as const;
export type AutomationProviderTriggerDeliveryMode =
  (typeof AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODES)[number];
export const AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE = {
  webhook: "webhook",
  polling: "polling",
} as const satisfies Record<string, AutomationProviderTriggerDeliveryMode>;

export const AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUSES = [
  "inactive",
  "pending",
  "active",
  "degraded",
  "expired",
  "failed",
] as const;
export type AutomationProviderTriggerSubscriptionStatus =
  (typeof AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUSES)[number];
export const AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS = {
  inactive: "inactive",
  pending: "pending",
  active: "active",
  degraded: "degraded",
  expired: "expired",
  failed: "failed",
} as const satisfies Record<string, AutomationProviderTriggerSubscriptionStatus>;

export const AUTOMATION_PROVIDER_TRIGGER_MIGRATION_STATUSES = [
  "native",
  "legacy_passthrough",
  "migration_required",
] as const;
export type AutomationProviderTriggerMigrationStatus =
  (typeof AUTOMATION_PROVIDER_TRIGGER_MIGRATION_STATUSES)[number];
export const AUTOMATION_PROVIDER_TRIGGER_MIGRATION_STATUS = {
  native: "native",
  legacyPassthrough: "legacy_passthrough",
  migrationRequired: "migration_required",
} as const satisfies Record<string, AutomationProviderTriggerMigrationStatus>;

export const AUTOMATION_PROVIDER_TRIGGER_SCHEMA_VERSION = 1 as const;

export type AutomationProviderTriggerDeliveryMetadata = {
  preferred_mode: AutomationProviderTriggerDeliveryMode;
  supported_modes: Array<AutomationProviderTriggerDeliveryMode>;
  fallback_mode: AutomationProviderTriggerDeliveryMode | null;
};

export type AutomationProviderTriggerSubscriptionState = {
  status: AutomationProviderTriggerSubscriptionStatus;
  active_mode: AutomationProviderTriggerDeliveryMode | null;
  last_error: string | null;
  updated_at: string | null;
};

export type AutomationProviderTrigger = {
  provider_id: CanonicalProviderId | string;
  trigger_key: string;
  schema_version: number;
  filter: Record<string, unknown>;
  delivery: AutomationProviderTriggerDeliveryMetadata;
  subscription_state: AutomationProviderTriggerSubscriptionState;
};

export type AutomationProviderTriggerMigrationState = {
  status: AutomationProviderTriggerMigrationStatus;
  message: string;
  legacy_event_provider: string | null;
  legacy_event_type: string | null;
  legacy_event_predicate: string | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const cloneJsonRecord = (value: unknown): Record<string, unknown> => {
  return isRecord(value) ? { ...value } : {};
};

export const normalizeAutomationProviderTrigger = (
  value: AutomationProviderTrigger,
): AutomationProviderTrigger => {
  return {
    provider_id: value.provider_id,
    trigger_key: value.trigger_key,
    schema_version: value.schema_version,
    filter: cloneJsonRecord(value.filter),
    delivery: {
      preferred_mode: value.delivery.preferred_mode,
      supported_modes: [...value.delivery.supported_modes],
      fallback_mode: value.delivery.fallback_mode,
    },
    subscription_state: {
      status: value.subscription_state.status,
      active_mode: value.subscription_state.active_mode,
      last_error: value.subscription_state.last_error,
      updated_at: value.subscription_state.updated_at,
    },
  };
};

export const normalizeAutomationProviderTriggerMigrationState = (
  value: AutomationProviderTriggerMigrationState,
): AutomationProviderTriggerMigrationState => {
  return {
    status: value.status,
    message: value.message,
    legacy_event_provider: value.legacy_event_provider,
    legacy_event_type: value.legacy_event_type,
    legacy_event_predicate: value.legacy_event_predicate,
  };
};

export const buildLegacyEventProviderTrigger = (params: {
  eventProvider: string;
  eventType: string;
  eventPredicate?: string | null;
}): AutomationProviderTrigger => {
  const predicate = params.eventPredicate?.trim();
  return {
    provider_id: params.eventProvider,
    trigger_key: params.eventType,
    schema_version: AUTOMATION_PROVIDER_TRIGGER_SCHEMA_VERSION,
    filter: predicate ? { predicate } : {},
    delivery: {
      preferred_mode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.webhook,
      supported_modes: [
        AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.webhook,
        AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
      ],
      fallback_mode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
    },
    subscription_state: {
      status: AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.inactive,
      active_mode: null,
      last_error: null,
      updated_at: null,
    },
  };
};

export const buildLegacyEventProviderTriggerMigrationState = (params: {
  eventProvider: string;
  eventType: string;
  eventPredicate?: string | null;
}): AutomationProviderTriggerMigrationState => {
  return {
    status: AUTOMATION_PROVIDER_TRIGGER_MIGRATION_STATUS.legacyPassthrough,
    message:
      "This trigger was migrated from legacy event fields and still needs a provider-owned schema.",
    legacy_event_provider: params.eventProvider,
    legacy_event_type: params.eventType,
    legacy_event_predicate: params.eventPredicate?.trim() || null,
  };
};

export const AUTOMATION_RUN_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];
export const AUTOMATION_RUN_STATUS = {
  pending: "pending",
  running: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
  timedOut: "timed_out",
} as const satisfies Record<string, AutomationRunStatus>;
export const AUTOMATION_RUN_TERMINAL_STATUSES = [
  AUTOMATION_RUN_STATUS.succeeded,
  AUTOMATION_RUN_STATUS.failed,
  AUTOMATION_RUN_STATUS.cancelled,
  AUTOMATION_RUN_STATUS.timedOut,
] as const;
export type AutomationRunTerminalStatus = (typeof AUTOMATION_RUN_TERMINAL_STATUSES)[number];
export type AutomationRunFailureStatus =
  | typeof AUTOMATION_RUN_STATUS.failed
  | typeof AUTOMATION_RUN_STATUS.cancelled
  | typeof AUTOMATION_RUN_STATUS.timedOut;

export const AUTOMATION_RUN_OUTCOME_SOURCES = ["agent_recorded", "fallback_missing"] as const;
export type AutomationRunOutcomeSource = (typeof AUTOMATION_RUN_OUTCOME_SOURCES)[number];
export const AUTOMATION_RUN_OUTCOME_SOURCE = {
  agentRecorded: "agent_recorded",
  fallbackMissing: "fallback_missing",
} as const satisfies Record<string, AutomationRunOutcomeSource>;
export const AUTOMATION_RUN_TRACE_EXPORT_STATUSES = ["exported", "disabled", "failed"] as const;
export type AutomationRunTraceExportStatus = (typeof AUTOMATION_RUN_TRACE_EXPORT_STATUSES)[number];
export const AUTOMATION_RUN_TRACE_EXPORT_STATUS = {
  exported: "exported",
  disabled: "disabled",
  failed: "failed",
} as const satisfies Record<string, AutomationRunTraceExportStatus>;
export const AUTOMATION_RUN_OUTCOME_SUMMARY_MAX_LENGTH = 2000;
export const AUTOMATION_MEMORY_MAX_LENGTH = 20_000;
export const AUTOMATION_DISPATCH_TOKEN_REUSE_WINDOW_MS = 60_000;

const normalizeAutomationMemoryLineEndings = (value: string): string =>
  value.replace(/\r\n?/g, "\n");

const automationMemoryLimitMessage = (): string =>
  `automation_memory_too_long: Automation memory must be ${String(AUTOMATION_MEMORY_MAX_LENGTH)} characters or fewer.`;

export const normalizeAutomationMemory = (value: string | null | undefined): string => {
  const normalized = normalizeAutomationMemoryLineEndings(value ?? "").trim();
  if (normalized.length > AUTOMATION_MEMORY_MAX_LENGTH) {
    throw new Error(automationMemoryLimitMessage());
  }
  return normalized;
};

export const normalizeAutomationMemorySnippet = (value: string): string => {
  const normalized = normalizeAutomationMemoryLineEndings(value).trim();
  if (normalized.length === 0) {
    throw new Error("automation_memory_required: Memory text is required.");
  }
  if (normalized.length > AUTOMATION_MEMORY_MAX_LENGTH) {
    throw new Error(automationMemoryLimitMessage());
  }
  return normalized;
};

export const appendAutomationMemory = (
  currentMemory: string | null | undefined,
  addition: string,
): string => {
  const current = normalizeAutomationMemory(currentMemory);
  const next = current
    ? `${current}\n\n${normalizeAutomationMemorySnippet(addition)}`
    : normalizeAutomationMemorySnippet(addition);
  if (next.length > AUTOMATION_MEMORY_MAX_LENGTH) {
    throw new Error(
      `automation_memory_limit_exceeded: Automation memory cannot exceed ${String(AUTOMATION_MEMORY_MAX_LENGTH)} characters. Use edit_memory to remove or compact older memory before adding more.`,
    );
  }
  return next;
};

const countLiteralOccurrences = (haystack: string, needle: string): number => {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let index = 0;
  while (true) {
    const foundAt = haystack.indexOf(needle, index);
    if (foundAt < 0) {
      return count;
    }
    count += 1;
    index = foundAt + needle.length;
  }
};

export const editAutomationMemory = (params: {
  currentMemory: string | null | undefined;
  search: string;
  replace: string;
  replaceAll?: boolean;
}): { memory: string; replacements: number } => {
  const current = normalizeAutomationMemory(params.currentMemory);
  const search = normalizeAutomationMemoryLineEndings(params.search);
  const replace = normalizeAutomationMemoryLineEndings(params.replace);
  if (search.length === 0) {
    throw new Error(
      "automation_memory_search_required: edit_memory requires a non-empty search string.",
    );
  }

  const replacements = countLiteralOccurrences(current, search);
  if (replacements === 0) {
    throw new Error(
      "automation_memory_search_not_found: edit_memory could not find the provided search string in automation memory.",
    );
  }
  if (params.replaceAll !== true && replacements !== 1) {
    throw new Error(
      "automation_memory_search_ambiguous: edit_memory found multiple matches. Use a more specific search string or set replace_all to true.",
    );
  }

  const next =
    params.replaceAll === true
      ? current.split(search).join(replace)
      : current.replace(search, replace);
  const normalizedNext = normalizeAutomationMemory(next);
  if (normalizedNext.length > AUTOMATION_MEMORY_MAX_LENGTH) {
    throw new Error(automationMemoryLimitMessage());
  }

  return {
    memory: normalizedNext,
    replacements: params.replaceAll === true ? replacements : 1,
  };
};

const automationRunStatusSet = new Set<AutomationRunStatus>(AUTOMATION_RUN_STATUSES);

export const isAutomationRunStatus = (value: unknown): value is AutomationRunStatus => {
  return typeof value === "string" && automationRunStatusSet.has(value as AutomationRunStatus);
};

export const isAutomationRunTerminalStatus = (
  status: AutomationRunStatus,
): status is AutomationRunTerminalStatus => {
  switch (status) {
    case AUTOMATION_RUN_STATUS.pending:
    case AUTOMATION_RUN_STATUS.running:
      return false;
    case AUTOMATION_RUN_STATUS.succeeded:
    case AUTOMATION_RUN_STATUS.failed:
    case AUTOMATION_RUN_STATUS.cancelled:
    case AUTOMATION_RUN_STATUS.timedOut:
      return true;
    default:
      return assertNever(status, "automation run status");
  }
};

export const isAutomationRunFailureStatus = (
  status: AutomationRunStatus,
): status is AutomationRunFailureStatus => {
  switch (status) {
    case AUTOMATION_RUN_STATUS.failed:
    case AUTOMATION_RUN_STATUS.cancelled:
    case AUTOMATION_RUN_STATUS.timedOut:
      return true;
    case AUTOMATION_RUN_STATUS.pending:
    case AUTOMATION_RUN_STATUS.running:
    case AUTOMATION_RUN_STATUS.succeeded:
      return false;
    default:
      return assertNever(status, "automation run status");
  }
};

export const AUTOMATION_STATUSES = ["active", "paused"] as const;
export type AutomationStatus = (typeof AUTOMATION_STATUSES)[number];
export const AUTOMATION_STATUS = {
  active: "active",
  paused: "paused",
} as const satisfies Record<string, AutomationStatus>;

export const AUTOMATION_TRIGGER_EVENT_STATUSES = ["pending", "dispatched", "skipped"] as const;
export type AutomationTriggerEventStatus = (typeof AUTOMATION_TRIGGER_EVENT_STATUSES)[number];
export const AUTOMATION_TRIGGER_EVENT_STATUS = {
  pending: "pending",
  dispatched: "dispatched",
  skipped: "skipped",
} as const satisfies Record<string, AutomationTriggerEventStatus>;

const AUTOMATION_PROMPT_HASH_SEED = 2166136261;

const normalizePromptHashInput = (value: string): string => value.trim().replace(/\s+/g, " ");

export const computeAutomationPromptHash = (prompt: string): string => {
  const normalized = normalizePromptHashInput(prompt);
  let hash = AUTOMATION_PROMPT_HASH_SEED;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const isAutomationMermaidStale = (params: {
  prompt: string;
  mermaidContent?: string | null;
  mermaidPromptHash?: string | null;
}): boolean => {
  const mermaidContent = params.mermaidContent?.trim() ?? "";
  if (mermaidContent.length === 0) {
    return false;
  }
  const storedHash = params.mermaidPromptHash?.trim() ?? "";
  if (storedHash.length === 0) {
    return false;
  }
  return computeAutomationPromptHash(params.prompt) !== storedHash;
};

export const AUTOMATION_TRIGGER_EVENT_MATCH_STATUSES = ["matched", "skipped"] as const;
export type AutomationTriggerEventMatchStatus =
  (typeof AUTOMATION_TRIGGER_EVENT_MATCH_STATUSES)[number];
export const AUTOMATION_TRIGGER_EVENT_MATCH_STATUS = {
  matched: "matched",
  skipped: "skipped",
} as const satisfies Record<string, AutomationTriggerEventMatchStatus>;

export const AUTOMATION_DISPATCH_ACTION_STATUSES = [
  "dispatched",
  "dispatch_url_missing",
  "dispatch_http_error",
  "dispatch_run_not_pending",
  "dispatch_request_failed",
] as const;
export type AutomationDispatchActionStatus = (typeof AUTOMATION_DISPATCH_ACTION_STATUSES)[number];
export const AUTOMATION_DISPATCH_ACTION_STATUS = {
  dispatched: "dispatched",
  dispatchUrlMissing: "dispatch_url_missing",
  dispatchHttpError: "dispatch_http_error",
  dispatchRunNotPending: "dispatch_run_not_pending",
  dispatchRequestFailed: "dispatch_request_failed",
} as const satisfies Record<string, AutomationDispatchActionStatus>;

export const AUTOMATION_TERMINATE_ACTION_STATUSES = [
  "terminated",
  "terminate_url_missing",
  "terminate_http_error",
  "terminate_request_failed",
] as const;
export type AutomationTerminateActionStatus = (typeof AUTOMATION_TERMINATE_ACTION_STATUSES)[number];
export const AUTOMATION_TERMINATE_ACTION_STATUS = {
  terminated: "terminated",
  terminateUrlMissing: "terminate_url_missing",
  terminateHttpError: "terminate_http_error",
  terminateRequestFailed: "terminate_request_failed",
} as const satisfies Record<string, AutomationTerminateActionStatus>;

export const AI_MODEL_PROVIDERS = ["openai", "anthropic"] as const;
export type AiModelProvider = (typeof AI_MODEL_PROVIDERS)[number];
export const AI_MODEL_PROVIDER = {
  openai: "openai",
  anthropic: "anthropic",
} as const satisfies Record<string, AiModelProvider>;

export const AI_KEY_MODES = ["byok", "bundled", "subscription_token"] as const;
export type AiKeyMode = (typeof AI_KEY_MODES)[number];
export const AI_KEY_MODE = {
  byok: "byok",
  bundled: "bundled",
  subscriptionToken: "subscription_token",
} as const satisfies Record<string, AiKeyMode>;

export const getAiModelProviderLabel = (provider: AiModelProvider): string => {
  return provider === AI_MODEL_PROVIDER.openai ? "OpenAI" : "Anthropic";
};

export const getAutomationModelClassLabel = (modelClass: AutomationModelClass): string => {
  switch (modelClass) {
    case AUTOMATION_MODEL_CLASS.frontier:
      return "Frontier";
    case AUTOMATION_MODEL_CLASS.balanced:
      return "Balanced";
    case AUTOMATION_MODEL_CLASS.value:
      return "Value";
    case AUTOMATION_MODEL_CLASS.auto:
    default:
      return "Auto";
  }
};

export const getAutomationModelClassDescription = (modelClass: AutomationModelClass): string => {
  switch (modelClass) {
    case AUTOMATION_MODEL_CLASS.frontier:
      return "Highest capability for harder work.";
    case AUTOMATION_MODEL_CLASS.balanced:
      return "Balanced speed and quality for most automations.";
    case AUTOMATION_MODEL_CLASS.value:
      return "Lower-cost model choice for simpler tasks.";
    case AUTOMATION_MODEL_CLASS.auto:
    default:
      return "Recommended default. Currently routes to the balanced model.";
  }
};

export const coerceAutomationModelClass = (value: unknown): AutomationModelClass => {
  switch (value) {
    case AUTOMATION_MODEL_CLASS.frontier:
    case AUTOMATION_MODEL_CLASS.balanced:
    case AUTOMATION_MODEL_CLASS.value:
      return value;
    case AUTOMATION_MODEL_CLASS.auto:
    default:
      return AUTOMATION_MODEL_CLASS.auto;
  }
};

export const inferAutomationModelClassFromLegacyFields = (params: {
  aiModelProvider?: string | null;
  aiModelName?: string | null;
}): AutomationModelClass => {
  const provider = params.aiModelProvider?.trim().toLowerCase();
  const modelName = params.aiModelName?.trim().toLowerCase() ?? "";
  if (provider === AI_MODEL_PROVIDER.anthropic || modelName.includes("opus")) {
    return AUTOMATION_MODEL_CLASS.frontier;
  }
  if (modelName.includes("mini") || modelName.includes("haiku") || modelName.includes("5.2")) {
    return AUTOMATION_MODEL_CLASS.value;
  }
  return AUTOMATION_MODEL_CLASS.auto;
};

export const getAiKeyModeLabel = (keyMode: AiKeyMode): string => {
  if (keyMode === AI_KEY_MODE.byok) {
    return "API key";
  }
  if (keyMode === AI_KEY_MODE.bundled) {
    return "bundled gateway key";
  }
  return "subscription token";
};

export const AI_KEY_CREDENTIAL_KINDS = ["secret", "openai_oauth"] as const;
export type AiKeyCredentialKind = (typeof AI_KEY_CREDENTIAL_KINDS)[number];
export const AI_KEY_CREDENTIAL_KIND = {
  secret: "secret",
  openaiOauth: "openai_oauth",
} as const satisfies Record<string, AiKeyCredentialKind>;

export const NETWORK_ACCESS_MODES = ["mcp_only", "mcp_and_web"] as const;
export type NetworkAccessMode = (typeof NETWORK_ACCESS_MODES)[number];
export const NETWORK_ACCESS_MODE = {
  mcpOnly: "mcp_only",
  mcpAndWeb: "mcp_and_web",
} as const satisfies Record<string, NetworkAccessMode>;

export const AUTOMATION_RUN_LOG_LEVELS = ["stdout", "stderr", "system"] as const;
export type AutomationRunLogLevel = (typeof AUTOMATION_RUN_LOG_LEVELS)[number];
export const AUTOMATION_RUN_LOG_LEVEL = {
  stdout: "stdout",
  stderr: "stderr",
  system: "system",
} as const satisfies Record<string, AutomationRunLogLevel>;

export const AUTOMATION_RUN_EVENT_TYPES = [
  "system",
  "automation_config",
  "thinking",
  "tool_call",
  "output",
  "error",
] as const;
export type AutomationRunEventType = (typeof AUTOMATION_RUN_EVENT_TYPES)[number];
export const AUTOMATION_RUN_EVENT_TYPE = {
  system: "system",
  automationConfig: "automation_config",
  thinking: "thinking",
  toolCall: "tool_call",
  output: "output",
  error: "error",
} as const satisfies Record<string, AutomationRunEventType>;

export const AUTOMATION_RUN_CONFIG_KEYS = [
  "workdir",
  "cwd",
  "model",
  "provider",
  "approval",
  "approval policy",
  "sandbox",
  "network access",
  "reasoning effort",
  "reasoning summaries",
  "session id",
] as const;
export type AutomationRunConfigKey = (typeof AUTOMATION_RUN_CONFIG_KEYS)[number];

export const AUTOMATION_ROUTE_STATUSES = [
  "unauthorized",
  "invalid_payload",
  "rate_limited",
  "workspace_forbidden",
  "workspace_not_found",
  "bundled_not_available",
  "ai_credit_limit_reached",
  "credit_deduction_failed",
  "generation_failed",
  "run_not_found",
  "sandbox_missing",
  "terminate_failed",
  "automation_paused",
  "run_not_pending",
  "missing_ai_key",
  "dispatch_failed",
  "log_failed",
  "trace_failed",
  "complete_failed",
  "invalid_signature",
] as const;
export type AutomationRouteStatus = (typeof AUTOMATION_ROUTE_STATUSES)[number];
export const AUTOMATION_ROUTE_STATUS = {
  unauthorized: "unauthorized",
  invalidPayload: "invalid_payload",
  rateLimited: "rate_limited",
  workspaceForbidden: "workspace_forbidden",
  workspaceNotFound: "workspace_not_found",
  bundledNotAvailable: "bundled_not_available",
  aiCreditLimitReached: "ai_credit_limit_reached",
  creditDeductionFailed: "credit_deduction_failed",
  generationFailed: "generation_failed",
  runNotFound: "run_not_found",
  sandboxMissing: "sandbox_missing",
  terminateFailed: "terminate_failed",
  automationPaused: "automation_paused",
  runNotPending: "run_not_pending",
  missingAiKey: "missing_ai_key",
  dispatchFailed: "dispatch_failed",
  logFailed: "log_failed",
  traceFailed: "trace_failed",
  completeFailed: "complete_failed",
  invalidSignature: "invalid_signature",
} as const satisfies Record<string, AutomationRouteStatus>;

export const AUTOMATION_ROUTE_ERROR_CODES = [
  "invalid_payload",
  "missing_env",
  "invalid_hex",
  "invalid_ciphertext",
  "missing_automation_run_id",
  "missing_dispatch_token",
  "invalid_automation_run_terminal_status",
  "missing_workspace_id",
  "missing_user_description",
  "user_description_too_long",
  "missing_openai_api_key",
  "automation_route_failed",
] as const;
export type AutomationRouteErrorCode = (typeof AUTOMATION_ROUTE_ERROR_CODES)[number];

const automationRouteErrorCodeSet = new Set<AutomationRouteErrorCode>(AUTOMATION_ROUTE_ERROR_CODES);

export const isAutomationRouteErrorCode = (value: unknown): value is AutomationRouteErrorCode => {
  return (
    typeof value === "string" && automationRouteErrorCodeSet.has(value as AutomationRouteErrorCode)
  );
};

export const formatAutomationRouteErrorMessage = (
  code: AutomationRouteErrorCode,
  message: string,
): string => {
  return `${code}: ${message}`;
};

export const createAutomationRouteError = (
  code: AutomationRouteErrorCode,
  message: string,
): Error => {
  return new Error(formatAutomationRouteErrorMessage(code, message));
};

export const parseAutomationRouteErrorCode = (
  errorMessage: string | undefined,
): AutomationRouteErrorCode | null => {
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
  return isAutomationRouteErrorCode(parsed) ? parsed : null;
};

export const toAutomationRouteError = (
  error: unknown,
  fallbackCode: AutomationRouteErrorCode = "automation_route_failed",
): Error => {
  if (error instanceof Error && parseAutomationRouteErrorCode(error.message)) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return createAutomationRouteError(fallbackCode, message);
};

export type AutomationTierLimits = {
  max_automations_per_workspace: number;
  max_runs_per_period: number;
  max_run_duration_ms: number;
  max_concurrent_runs: number;
  max_log_bytes_per_run: number;
  log_retention_days: number;
};

export const AUTOMATION_TIER_LIMITS: Record<SubscriptionTierId, AutomationTierLimits> = {
  free: {
    max_automations_per_workspace: 2,
    max_runs_per_period: 150,
    max_run_duration_ms: 300_000,
    max_concurrent_runs: 1,
    max_log_bytes_per_run: 1_048_576,
    log_retention_days: 7,
  },
  starter: {
    max_automations_per_workspace: 5,
    max_runs_per_period: 1_500,
    max_run_duration_ms: 900_000,
    max_concurrent_runs: 3,
    max_log_bytes_per_run: 2_097_152,
    log_retention_days: 30,
  },
  pro: {
    max_automations_per_workspace: 25,
    max_runs_per_period: 15_000,
    max_run_duration_ms: 1_800_000,
    max_concurrent_runs: 10,
    max_log_bytes_per_run: 2_097_152,
    log_retention_days: 90,
  },
} as const;

export const AI_CREDIT_ALLOWANCES: Record<SubscriptionTierId, number> = {
  free: 20,
  starter: 100,
  pro: 300,
} as const;

export const AI_CREDIT_USAGE_SOURCES = ["generation", "runtime"] as const;
export type AiCreditUsageSource = (typeof AI_CREDIT_USAGE_SOURCES)[number];
export const AI_CREDIT_USAGE_SOURCE = {
  generation: "generation",
  runtime: "runtime",
} as const satisfies Record<string, AiCreditUsageSource>;

export type IncludedAiCredits = {
  total: number;
  // Tier-level eligibility only. Actual bundled runtime also requires the hosted gateway.
  bundled_runtime_enabled: boolean;
  reset_period: "monthly" | "one_time";
};

export const INCLUDED_AI_CREDITS: Record<SubscriptionTierId, IncludedAiCredits> = {
  free: {
    total: AI_CREDIT_ALLOWANCES.free,
    bundled_runtime_enabled: true,
    reset_period: "one_time",
  },
  starter: {
    total: AI_CREDIT_ALLOWANCES.starter,
    bundled_runtime_enabled: true,
    reset_period: "monthly",
  },
  pro: {
    total: AI_CREDIT_ALLOWANCES.pro,
    bundled_runtime_enabled: true,
    reset_period: "monthly",
  },
} as const;

export const DYAD_GATEWAY_BUDGET_USD_PER_300_AI_CREDITS = 20;
export const DYAD_GATEWAY_BUDGET_AI_CREDITS = 300;
export const TOOL_CALLS_PER_RUN_MULTIPLIER = 50;
const DYAD_GATEWAY_BUDGET_PRECISION = 4;

export const normalizeAiCreditAmount = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Number.parseFloat(value.toFixed(DYAD_GATEWAY_BUDGET_PRECISION));
};

export const normalizeDyadGatewayBudgetUsd = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Number.parseFloat(value.toFixed(DYAD_GATEWAY_BUDGET_PRECISION));
};

export const convertAiCreditsToDyadGatewayBudgetUsd = (credits: number): number => {
  return normalizeDyadGatewayBudgetUsd(
    (normalizeAiCreditAmount(credits) * DYAD_GATEWAY_BUDGET_USD_PER_300_AI_CREDITS) /
      DYAD_GATEWAY_BUDGET_AI_CREDITS,
  );
};

export const convertDyadGatewayBudgetUsdToAiCredits = (budgetUsd: number): number => {
  return normalizeAiCreditAmount(
    (normalizeDyadGatewayBudgetUsd(budgetUsd) * DYAD_GATEWAY_BUDGET_AI_CREDITS) /
      DYAD_GATEWAY_BUDGET_USD_PER_300_AI_CREDITS,
  );
};

export const isGatewayRuntimeEnabled = (gatewayUrl: string | null | undefined): boolean => {
  return Boolean(gatewayUrl?.trim());
};

export const AI_CREDIT_PACKAGES = [
  { price_cents: 1_000, credits: 100 },
  { price_cents: 2_500, credits: 250 },
] as const;

export const AI_CREDIT_EXPIRY_DAYS = 90;
export const AUTOMATION_RUN_TOPUP_EXPIRY_DAYS = 90;

export type AutomationRunPackage = {
  multiplier: "1x" | "2x";
  runs: number;
  tool_calls: number;
  tool_call_time_ms: number;
  price_cents: number;
};

export const AUTOMATION_RUN_PACKAGES: Record<
  Exclude<SubscriptionTierId, "free">,
  readonly AutomationRunPackage[]
> = {
  starter: [
    {
      multiplier: "1x",
      runs: 1_500,
      tool_calls: 1_500 * TOOL_CALLS_PER_RUN_MULTIPLIER,
      tool_call_time_ms: 7_200_000,
      price_cents: 1_500,
    },
    {
      multiplier: "2x",
      runs: 3_000,
      tool_calls: 3_000 * TOOL_CALLS_PER_RUN_MULTIPLIER,
      tool_call_time_ms: 14_400_000,
      price_cents: 2_500,
    },
  ],
  pro: [
    {
      multiplier: "1x",
      runs: 15_000,
      tool_calls: 15_000 * TOOL_CALLS_PER_RUN_MULTIPLIER,
      tool_call_time_ms: 18_000_000,
      price_cents: 4_500,
    },
    {
      multiplier: "2x",
      runs: 30_000,
      tool_calls: 30_000 * TOOL_CALLS_PER_RUN_MULTIPLIER,
      tool_call_time_ms: 36_000_000,
      price_cents: 7_500,
    },
  ],
} as const;

const EMPTY_AUTOMATION_RUN_PACKAGES: readonly AutomationRunPackage[] = [];

export const getAutomationTierLimits = (tierId: SubscriptionTierId): AutomationTierLimits => {
  return AUTOMATION_TIER_LIMITS[tierId];
};

export const isAutomationLimitReached = (
  tierId: SubscriptionTierId,
  currentCount: number,
): boolean => {
  return currentCount >= getAutomationTierLimits(tierId).max_automations_per_workspace;
};

export const isRunPeriodLimitReached = (
  tierId: SubscriptionTierId,
  currentCount: number,
): boolean => {
  return currentCount >= getAutomationTierLimits(tierId).max_runs_per_period;
};

export const isConcurrencyLimitReached = (
  tierId: SubscriptionTierId,
  currentCount: number,
): boolean => {
  return currentCount >= getAutomationTierLimits(tierId).max_concurrent_runs;
};

export const getAiCreditAllowance = (tierId: SubscriptionTierId): number => {
  return AI_CREDIT_ALLOWANCES[tierId];
};

export const getIncludedAiCredits = (tierId: SubscriptionTierId): IncludedAiCredits => {
  return INCLUDED_AI_CREDITS[tierId];
};

export const supportsBundledAiRuntime = (tierId: SubscriptionTierId): boolean => {
  return INCLUDED_AI_CREDITS[tierId].bundled_runtime_enabled;
};

export const getAutomationRunPackagesForTier = (
  tierId: SubscriptionTierId,
): readonly AutomationRunPackage[] => {
  if (tierId === "free") {
    return EMPTY_AUTOMATION_RUN_PACKAGES;
  }
  return AUTOMATION_RUN_PACKAGES[tierId];
};

export const AUTOMATION_EXECUTION_MODES = ["bundled", "byok"] as const;
export type AutomationExecutionMode = (typeof AUTOMATION_EXECUTION_MODES)[number];

export type AutomationExecutionReadiness = {
  mode: AutomationExecutionMode;
  bundled_runtime_enabled: boolean;
  bundled_credits_available: boolean;
  requires_byok: boolean;
  has_active_byok_key: boolean;
  can_run: boolean;
};

export const resolveAutomationExecutionReadiness = (params: {
  bundledRuntimeEnabled: boolean;
  totalCreditsAvailable: number;
  hasActiveByokKey: boolean;
}): AutomationExecutionReadiness => {
  const bundledCreditsAvailable = params.bundledRuntimeEnabled && params.totalCreditsAvailable > 0;

  if (params.bundledRuntimeEnabled) {
    return {
      mode: "bundled",
      bundled_runtime_enabled: true,
      bundled_credits_available: bundledCreditsAvailable,
      requires_byok: false,
      has_active_byok_key: params.hasActiveByokKey,
      can_run: bundledCreditsAvailable,
    };
  }

  return {
    mode: "byok",
    bundled_runtime_enabled: false,
    bundled_credits_available: false,
    requires_byok: true,
    has_active_byok_key: params.hasActiveByokKey,
    can_run: params.hasActiveByokKey,
  };
};
