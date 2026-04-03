import { resolveProviderAutomationTriggerDefinition } from "../../../../packages/shared/src/providers/automation-trigger-registry.js";
import { parseJsonRecord, parseJsonValue } from "@keppo/shared/providers/boundaries/json";
import {
  getAutomationModelClassDescription,
  getAutomationModelClassLabel,
  resolveAutomationExecutionReadiness,
} from "@keppo/shared/automations";
import { fullTimestamp } from "@/lib/format";
import { toUserFacingErrorMessage } from "./user-facing-errors";

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const asString = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

const asNullableString = (value: unknown): string | null => {
  return typeof value === "string" ? value : null;
};

const asNumber = (value: unknown): number => {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
};

const asBoolean = (value: unknown): boolean => {
  return value === true;
};

const asStringArray = (value: unknown): string[] => {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
};

export type AutomationStatus = "active" | "paused";
export type AutomationConfigTriggerType = "schedule" | "event" | "manual";
export type AutomationRunTriggerType = "schedule" | "event" | "manual";
export type AutomationRunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";
export type AutomationRunOutcomeSource = "agent_recorded" | "fallback_missing";
export type AutomationRunnerType = "chatgpt_codex" | "claude_code";
export type AiModelProvider = "openai" | "anthropic";
export type AutomationModelClass = "auto" | "frontier" | "balanced" | "value";
export type AiKeyMode = "byok" | "bundled" | "subscription_token";
export type NetworkAccessMode = "mcp_only" | "mcp_and_web";
export type AutomationProviderTriggerDeliveryMode = "webhook" | "polling";
export type AutomationProviderTriggerSubscriptionStatus =
  | "inactive"
  | "pending"
  | "active"
  | "degraded"
  | "expired"
  | "failed";
export type AutomationProviderTriggerMigrationStatus =
  | "native"
  | "legacy_passthrough"
  | "migration_required";
export type AutomationTriggerEventStatus = "pending" | "dispatched" | "skipped";
export type AutomationTriggerEventMatchStatus = "matched" | "skipped";
export type AutomationChoiceMeta = {
  label: string;
  description: string;
};

export type AutomationExecutionMode = "bundled" | "byok";
export type AutomationExecutionState = {
  mode: AutomationExecutionMode;
  requires_active_byok_key: boolean;
  has_active_byok_key: boolean;
  can_run: boolean;
};

const AI_MODEL_PROVIDER_LABELS: Record<AiModelProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
};

const MODEL_CLASS_META: Record<AutomationModelClass, AutomationChoiceMeta> = {
  auto: {
    label: getAutomationModelClassLabel("auto"),
    description: getAutomationModelClassDescription("auto"),
  },
  frontier: {
    label: getAutomationModelClassLabel("frontier"),
    description: getAutomationModelClassDescription("frontier"),
  },
  balanced: {
    label: getAutomationModelClassLabel("balanced"),
    description: getAutomationModelClassDescription("balanced"),
  },
  value: {
    label: getAutomationModelClassLabel("value"),
    description: getAutomationModelClassDescription("value"),
  },
};

const AI_KEY_MODE_META: Record<AiKeyMode, AutomationChoiceMeta> = {
  byok: {
    label: "Bring your own key",
    description: "Uses the provider key that your org manages directly in Settings.",
  },
  bundled: {
    label: "Bundled",
    description: "Uses Keppo-managed bundled AI credits.",
  },
  subscription_token: {
    label: "Subscription login (legacy)",
    description: "Legacy provider-hosted auth path kept for existing automations.",
  },
};

const NETWORK_ACCESS_META: Record<NetworkAccessMode, AutomationChoiceMeta> = {
  mcp_only: {
    label: "Connected tools only",
    description:
      "Web access is off. We recommend this safer default unless the automation really needs outside research.",
  },
  mcp_and_web: {
    label: "Connected tools + web",
    description:
      "Allows AI to search the web for information. We recommend disabling it for security unless it is necessary.",
  },
};

export const getModelProviderForRunner = (runnerType: AutomationRunnerType): AiModelProvider => {
  return runnerType === "claude_code" ? "anthropic" : "openai";
};

export const getRunnerTypeForModelProvider = (
  aiModelProvider: AiModelProvider,
): AutomationRunnerType => {
  return aiModelProvider === "anthropic" ? "claude_code" : "chatgpt_codex";
};

export const getAiModelProviderLabel = (provider: AiModelProvider): string => {
  return AI_MODEL_PROVIDER_LABELS[provider];
};

export const getAutomationModelClassMeta = (
  modelClass: AutomationModelClass,
): AutomationChoiceMeta => {
  return MODEL_CLASS_META[modelClass];
};

export const getAiKeyModeMeta = (mode: AiKeyMode): AutomationChoiceMeta => {
  return AI_KEY_MODE_META[mode];
};

export const getNetworkAccessMeta = (mode: NetworkAccessMode): AutomationChoiceMeta => {
  return NETWORK_ACCESS_META[mode];
};

export const getAutomationExecutionModeMeta = (
  mode: AutomationExecutionMode,
): AutomationChoiceMeta => {
  return mode === "bundled"
    ? {
        label: "Bundled runtime",
        description: "Runs on the org's bundled AI credits while credits remain available.",
      }
    : {
        label: "Self-managed API key",
        description: "Runs on an active org-managed provider API key in Settings.",
      };
};

export const resolveAutomationExecutionState = (params: {
  provider: AiModelProvider;
  creditBalance: AiCreditBalance | null;
  orgAiKeys: OrgAiKey[];
}): AutomationExecutionState => {
  const hasActiveByokKey = params.orgAiKeys.some(
    (key) =>
      key.provider === params.provider &&
      key.is_active &&
      (key.key_mode === "byok" ||
        (params.provider === "openai" && key.key_mode === "subscription_token")),
  );
  const readiness = resolveAutomationExecutionReadiness({
    bundledRuntimeEnabled: params.creditBalance?.bundled_runtime_enabled === true,
    totalCreditsAvailable: params.creditBalance?.total_available ?? 0,
    hasActiveByokKey,
  });
  return {
    mode: readiness.mode,
    requires_active_byok_key: readiness.requires_byok,
    has_active_byok_key: readiness.has_active_byok_key,
    can_run: readiness.can_run,
  };
};

const parseAutomationStatus = (value: unknown): AutomationStatus => {
  return value === "active" ? "active" : "paused";
};

const parseConfigTriggerType = (value: unknown): AutomationConfigTriggerType => {
  if (value === "event") {
    return "event";
  }
  if (value === "manual") {
    return "manual";
  }
  return "schedule";
};

const parseRunTriggerType = (value: unknown): AutomationRunTriggerType => {
  if (value === "event" || value === "manual") {
    return value;
  }
  return "schedule";
};

const parseRunStatus = (value: unknown): AutomationRunStatus => {
  if (
    value === "pending" ||
    value === "running" ||
    value === "succeeded" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "timed_out"
  ) {
    return value;
  }
  return "failed";
};

const parseRunOutcomeSource = (value: unknown): AutomationRunOutcomeSource => {
  return value === "fallback_missing" ? "fallback_missing" : "agent_recorded";
};

const parseTriggerEventStatus = (value: unknown): AutomationTriggerEventStatus => {
  if (value === "dispatched" || value === "skipped") {
    return value;
  }
  return "pending";
};

const parseRunnerType = (value: unknown): AutomationRunnerType => {
  return value === "claude_code" ? "claude_code" : "chatgpt_codex";
};

const parseAiProvider = (value: unknown): AiModelProvider => {
  return value === "anthropic" ? "anthropic" : "openai";
};

const parseModelClass = (value: unknown): AutomationModelClass => {
  if (value === "frontier" || value === "balanced" || value === "value") {
    return value;
  }
  return "auto";
};

const parseAiKeyMode = (value: unknown): AiKeyMode => {
  if (value === "bundled") {
    return "bundled";
  }
  if (value === "subscription_token") {
    return "subscription_token";
  }
  return "byok";
};

const parseNetworkAccess = (value: unknown): NetworkAccessMode => {
  return value === "mcp_and_web" ? "mcp_and_web" : "mcp_only";
};

export type Automation = {
  id: string;
  org_id: string;
  workspace_id: string;
  slug: string;
  name: string;
  description: string;
  mermaid_content: string | null;
  mermaid_prompt_hash: string | null;
  status: AutomationStatus;
  current_config_version_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type AutomationConfigVersion = {
  id: string;
  automation_id: string;
  version_number: number;
  trigger_type: AutomationConfigTriggerType;
  schedule_cron: string | null;
  provider_trigger: {
    provider_id: string;
    trigger_key: string;
    schema_version: number;
    filter: Record<string, unknown>;
    delivery: {
      preferred_mode: AutomationProviderTriggerDeliveryMode;
      supported_modes: AutomationProviderTriggerDeliveryMode[];
      fallback_mode: AutomationProviderTriggerDeliveryMode | null;
    };
    subscription_state: {
      status: AutomationProviderTriggerSubscriptionStatus;
      active_mode: AutomationProviderTriggerDeliveryMode | null;
      last_error: string | null;
      updated_at: string | null;
    };
  } | null;
  provider_trigger_migration_state: {
    status: AutomationProviderTriggerMigrationStatus;
    message: string;
    legacy_event_provider: string | null;
    legacy_event_type: string | null;
    legacy_event_predicate: string | null;
  } | null;
  event_provider: string | null;
  event_type: string | null;
  event_predicate: string | null;
  model_class: AutomationModelClass;
  runner_type: AutomationRunnerType;
  ai_model_provider: AiModelProvider;
  ai_model_name: string;
  prompt: string;
  network_access: NetworkAccessMode;
  created_by: string;
  created_at: string;
  change_summary: string | null;
};

export type AutomationConfigSummary = Pick<
  AutomationConfigVersion,
  | "id"
  | "version_number"
  | "trigger_type"
  | "model_class"
  | "runner_type"
  | "ai_model_provider"
  | "ai_model_name"
  | "network_access"
  | "created_at"
>;

export type AutomationTriggerEvent = {
  id: string;
  automation_id: string;
  config_version_id: string | null;
  trigger_key: string | null;
  event_provider: string;
  event_type: string;
  event_id: string;
  delivery_mode: AutomationProviderTriggerDeliveryMode | null;
  match_status: AutomationTriggerEventMatchStatus | null;
  failure_reason: string | null;
  status: AutomationTriggerEventStatus;
  automation_run_id: string | null;
  automation_run_status: AutomationRunStatus | null;
  created_at: string;
};

export type AutomationListItem = {
  automation: Automation;
  current_config_version: AutomationConfigSummary | null;
  latest_run: AutomationRun | null;
};

const reservedAutomationPathSegments = new Set(["build", "create"]);

export const getAutomationPathSegment = (automation: Pick<Automation, "id" | "slug">): string => {
  const slug = automation.slug.trim();
  if (slug.length > 0 && !reservedAutomationPathSegments.has(slug)) {
    return slug;
  }
  return automation.id;
};

export type AutomationRun = {
  id: string;
  automation_id: string;
  org_id: string;
  workspace_id: string;
  config_version_id: string;
  trigger_type: AutomationRunTriggerType;
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
  created_at: string;
};

export type AutomationRunEventType =
  | "system"
  | "automation_config"
  | "thinking"
  | "tool_call"
  | "output"
  | "error";

export type AutomationRunLogLine = {
  seq: number;
  level: "stdout" | "stderr" | "system";
  content: string;
  timestamp: string;
  event_type?: AutomationRunEventType;
  event_data?: unknown;
};

export type AutomationRunLogsPayload =
  | { mode: "hot"; lines: AutomationRunLogLine[] }
  | { mode: "cold"; storage_url: string }
  | { mode: "expired" };

export type OrgAiKey = {
  id: string;
  org_id: string;
  provider: AiModelProvider;
  key_mode: AiKeyMode;
  credential_kind: "secret" | "openai_oauth";
  key_hint: string;
  key_version: number;
  is_active: boolean;
  subject_email: string | null;
  account_id: string | null;
  token_expires_at: string | null;
  last_refreshed_at: string | null;
  last_validated_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type AiCreditBalance = {
  org_id: string;
  period_start: string;
  period_end: string;
  allowance_total: number;
  allowance_reset_period: "monthly" | "one_time";
  allowance_used: number;
  allowance_remaining: number;
  purchased_remaining: number;
  total_available: number;
  bundled_runtime_enabled: boolean;
};

export type Paginated<T> = {
  page: T[];
  isDone: boolean;
  continueCursor: string;
};

const parseAutomation = (value: unknown): Automation | null => {
  if (!isRecord(value)) {
    return null;
  }
  return {
    id: asString(value.id),
    org_id: asString(value.org_id),
    workspace_id: asString(value.workspace_id),
    slug: asString(value.slug),
    name: asString(value.name),
    description: asString(value.description),
    mermaid_content: asNullableString(value.mermaid_content),
    mermaid_prompt_hash: asNullableString(value.mermaid_prompt_hash),
    status: parseAutomationStatus(value.status),
    current_config_version_id: asString(value.current_config_version_id),
    created_by: asString(value.created_by),
    created_at: asString(value.created_at),
    updated_at: asString(value.updated_at),
  };
};

const parseConfigVersion = (value: unknown): AutomationConfigVersion | null => {
  if (!isRecord(value)) {
    return null;
  }
  const providerTriggerValue = isRecord(value.provider_trigger) ? value.provider_trigger : null;
  const providerTriggerDelivery = providerTriggerValue?.delivery;
  const providerTriggerSubscription = providerTriggerValue?.subscription_state;
  const providerTriggerMigration = isRecord(value.provider_trigger_migration_state)
    ? value.provider_trigger_migration_state
    : null;
  return {
    id: asString(value.id),
    automation_id: asString(value.automation_id),
    version_number: asNumber(value.version_number),
    trigger_type: parseConfigTriggerType(value.trigger_type),
    schedule_cron: asNullableString(value.schedule_cron),
    provider_trigger:
      providerTriggerValue &&
      isRecord(providerTriggerDelivery) &&
      isRecord(providerTriggerSubscription)
        ? {
            provider_id: asString(providerTriggerValue.provider_id),
            trigger_key: asString(providerTriggerValue.trigger_key),
            schema_version: asNumber(providerTriggerValue.schema_version),
            filter: isRecord(providerTriggerValue.filter) ? providerTriggerValue.filter : {},
            delivery: {
              preferred_mode:
                providerTriggerDelivery.preferred_mode === "polling" ? "polling" : "webhook",
              supported_modes: asStringArray(providerTriggerDelivery.supported_modes).filter(
                (mode): mode is AutomationProviderTriggerDeliveryMode =>
                  mode === "webhook" || mode === "polling",
              ),
              fallback_mode:
                providerTriggerDelivery.fallback_mode === "webhook" ||
                providerTriggerDelivery.fallback_mode === "polling"
                  ? providerTriggerDelivery.fallback_mode
                  : null,
            },
            subscription_state: {
              status:
                providerTriggerSubscription.status === "pending" ||
                providerTriggerSubscription.status === "active" ||
                providerTriggerSubscription.status === "degraded" ||
                providerTriggerSubscription.status === "expired" ||
                providerTriggerSubscription.status === "failed"
                  ? providerTriggerSubscription.status
                  : "inactive",
              active_mode:
                providerTriggerSubscription.active_mode === "webhook" ||
                providerTriggerSubscription.active_mode === "polling"
                  ? providerTriggerSubscription.active_mode
                  : null,
              last_error: asNullableString(providerTriggerSubscription.last_error),
              updated_at: asNullableString(providerTriggerSubscription.updated_at),
            },
          }
        : null,
    provider_trigger_migration_state: providerTriggerMigration
      ? {
          status:
            providerTriggerMigration.status === "legacy_passthrough" ||
            providerTriggerMigration.status === "migration_required"
              ? providerTriggerMigration.status
              : "native",
          message: asString(providerTriggerMigration.message),
          legacy_event_provider: asNullableString(providerTriggerMigration.legacy_event_provider),
          legacy_event_type: asNullableString(providerTriggerMigration.legacy_event_type),
          legacy_event_predicate: asNullableString(providerTriggerMigration.legacy_event_predicate),
        }
      : null,
    event_provider: asNullableString(value.event_provider),
    event_type: asNullableString(value.event_type),
    event_predicate: asNullableString(value.event_predicate),
    model_class: parseModelClass(value.model_class),
    runner_type: parseRunnerType(value.runner_type),
    ai_model_provider: parseAiProvider(value.ai_model_provider),
    ai_model_name: asString(value.ai_model_name),
    prompt: asString(value.prompt),
    network_access: parseNetworkAccess(value.network_access),
    created_by: asString(value.created_by),
    created_at: asString(value.created_at),
    change_summary: asNullableString(value.change_summary),
  };
};

const parseConfigSummary = (value: unknown): AutomationConfigSummary | null => {
  const parsed = parseConfigVersion({
    ...((isRecord(value) ? value : {}) as Record<string, unknown>),
    prompt: "",
    created_by: "",
    change_summary: null,
  });
  if (!parsed) {
    return null;
  }
  return {
    id: parsed.id,
    version_number: parsed.version_number,
    trigger_type: parsed.trigger_type,
    model_class: parsed.model_class,
    runner_type: parsed.runner_type,
    ai_model_provider: parsed.ai_model_provider,
    ai_model_name: parsed.ai_model_name,
    network_access: parsed.network_access,
    created_at: parsed.created_at,
  };
};

const parseAutomationListItem = (value: unknown): AutomationListItem | null => {
  if (!isRecord(value)) {
    return null;
  }
  const automation = parseAutomation(value.automation);
  if (!automation) {
    return null;
  }
  return {
    automation,
    current_config_version: value.current_config_version
      ? parseConfigSummary(value.current_config_version)
      : null,
    latest_run: value.latest_run ? parseAutomationRunRow(value.latest_run) : null,
  };
};

export const parsePaginatedAutomations = (value: unknown): Paginated<AutomationListItem> => {
  if (!isRecord(value)) {
    return { page: [], isDone: true, continueCursor: "" };
  }
  const page = Array.isArray(value.page)
    ? value.page
        .map(parseAutomationListItem)
        .filter((row): row is AutomationListItem => row !== null)
    : [];
  return {
    page,
    isDone: asBoolean(value.isDone),
    continueCursor: asString(value.continueCursor),
  };
};

export const parseAutomationWithConfig = (
  value: unknown,
): {
  automation: Automation;
  current_config_version: AutomationConfigVersion | null;
} | null => {
  if (!isRecord(value)) {
    return null;
  }
  const automation = parseAutomation(value.automation);
  if (!automation) {
    return null;
  }
  return {
    automation,
    current_config_version: parseConfigVersion(value.current_config_version),
  };
};

export const parseConfigVersions = (value: unknown): AutomationConfigVersion[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(parseConfigVersion)
    .filter((row): row is AutomationConfigVersion => row !== null)
    .sort((a, b) => b.version_number - a.version_number);
};

const parseAutomationRunRow = (value: unknown): AutomationRun | null => {
  if (!isRecord(value)) {
    return null;
  }
  const outcomeValue = isRecord(value.outcome) ? value.outcome : null;
  return {
    id: asString(value.id),
    automation_id: asString(value.automation_id),
    org_id: asString(value.org_id),
    workspace_id: asString(value.workspace_id),
    config_version_id: asString(value.config_version_id),
    trigger_type: parseRunTriggerType(value.trigger_type),
    status: parseRunStatus(value.status),
    started_at: asNullableString(value.started_at),
    ended_at: asNullableString(value.ended_at),
    error_message: asNullableString(value.error_message),
    sandbox_id: asNullableString(value.sandbox_id),
    mcp_session_id: asNullableString(value.mcp_session_id),
    outcome:
      outcomeValue &&
      typeof outcomeValue.summary === "string" &&
      outcomeValue.summary.trim().length > 0
        ? {
            success: outcomeValue.success === true,
            summary: outcomeValue.summary,
            source: parseRunOutcomeSource(outcomeValue.source),
            recorded_at: asString(outcomeValue.recorded_at),
          }
        : null,
    created_at: asString(value.created_at),
  };
};

const parseAutomationTriggerEventRow = (value: unknown): AutomationTriggerEvent | null => {
  if (!isRecord(value)) {
    return null;
  }
  return {
    id: asString(value.id),
    automation_id: asString(value.automation_id),
    config_version_id: asNullableString(value.config_version_id),
    trigger_key: asNullableString(value.trigger_key),
    event_provider: asString(value.event_provider),
    event_type: asString(value.event_type),
    event_id: asString(value.event_id),
    delivery_mode:
      value.delivery_mode === "polling" || value.delivery_mode === "webhook"
        ? value.delivery_mode
        : null,
    match_status:
      value.match_status === "matched" || value.match_status === "skipped"
        ? value.match_status
        : null,
    failure_reason: asNullableString(value.failure_reason),
    status: parseTriggerEventStatus(value.status),
    automation_run_id: asNullableString(value.automation_run_id),
    automation_run_status:
      value.automation_run_status === undefined || value.automation_run_status === null
        ? null
        : parseRunStatus(value.automation_run_status),
    created_at: asString(value.created_at),
  };
};

export const parsePaginatedRuns = (value: unknown): Paginated<AutomationRun> => {
  if (!isRecord(value)) {
    return { page: [], isDone: true, continueCursor: "" };
  }
  const page = Array.isArray(value.page)
    ? value.page.map(parseAutomationRunRow).filter((row): row is AutomationRun => row !== null)
    : [];
  return {
    page,
    isDone: asBoolean(value.isDone),
    continueCursor: asString(value.continueCursor),
  };
};

export const parseAutomationTriggerEvents = (value: unknown): AutomationTriggerEvent[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(parseAutomationTriggerEventRow)
    .filter((row): row is AutomationTriggerEvent => row !== null);
};

export const parseAutomationRun = (value: unknown): AutomationRun | null => {
  return parseAutomationRunRow(value);
};

export const parseAutomationRunLogs = (value: unknown): AutomationRunLogsPayload => {
  if (!isRecord(value)) {
    return { mode: "expired" };
  }
  const mode = value.mode;
  if (mode === "cold") {
    return {
      mode,
      storage_url: asString(value.storage_url),
    };
  }
  if (mode === "hot") {
    const lines = Array.isArray(value.lines)
      ? value.lines
          .map((item) => {
            if (!isRecord(item)) {
              return null;
            }
            const level = item.level;
            if (level !== "stdout" && level !== "stderr" && level !== "system") {
              return null;
            }
            const eventType = parseEventType(item.event_type);
            const line: AutomationRunLogLine = {
              seq: asNumber(item.seq),
              level,
              content: asString(item.content),
              timestamp: asString(item.timestamp),
            };
            if (eventType !== undefined) {
              line.event_type = eventType;
            }
            if (item.event_data !== undefined && item.event_data !== null) {
              line.event_data = item.event_data;
            }
            return line;
          })
          .filter((line): line is AutomationRunLogLine => line !== null)
      : [];
    return { mode, lines };
  }
  return { mode: "expired" };
};

export const parseOrgAiKeys = (value: unknown): OrgAiKey[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!isRecord(item)) {
        return null;
      }
      return {
        id: asString(item.id),
        org_id: asString(item.org_id),
        provider: parseAiProvider(item.provider),
        key_mode: parseAiKeyMode(item.key_mode),
        credential_kind: item.credential_kind === "openai_oauth" ? "openai_oauth" : "secret",
        key_hint: asString(item.key_hint),
        key_version: asNumber(item.key_version),
        is_active: asBoolean(item.is_active),
        subject_email: asNullableString(item.subject_email),
        account_id: asNullableString(item.account_id),
        token_expires_at: asNullableString(item.token_expires_at),
        last_refreshed_at: asNullableString(item.last_refreshed_at),
        last_validated_at: asNullableString(item.last_validated_at),
        created_by: asString(item.created_by),
        created_at: asString(item.created_at),
        updated_at: asString(item.updated_at),
      };
    })
    .filter((row): row is OrgAiKey => row !== null);
};

export const parseAiCreditBalance = (value: unknown): AiCreditBalance | null => {
  if (!isRecord(value)) {
    return null;
  }
  return {
    org_id: asString(value.org_id),
    period_start: asString(value.period_start),
    period_end: asString(value.period_end),
    allowance_total: asNumber(value.allowance_total),
    allowance_reset_period: value.allowance_reset_period === "one_time" ? "one_time" : "monthly",
    allowance_used: asNumber(value.allowance_used),
    allowance_remaining: asNumber(value.allowance_remaining),
    purchased_remaining: asNumber(value.purchased_remaining),
    total_available: asNumber(value.total_available),
    bundled_runtime_enabled: asBoolean(value.bundled_runtime_enabled),
  };
};

export const runStatusBadgeVariant = (
  status: AutomationRunStatus,
): "default" | "secondary" | "destructive" | "outline" => {
  if (status === "succeeded") {
    return "default";
  }
  if (status === "running" || status === "pending") {
    return "secondary";
  }
  if (status === "cancelled") {
    return "outline";
  }
  return "destructive";
};

export const automationStatusBadgeVariant = (
  status: AutomationStatus,
): "default" | "secondary" | "outline" => {
  if (status === "active") {
    return "default";
  }
  return "secondary";
};

export const humanizeTriggerType = (
  trigger: AutomationConfigTriggerType | AutomationRunTriggerType,
): string => {
  if (trigger === "manual") {
    return "Manual";
  }
  return trigger === "event" ? "Event" : "Schedule";
};

export const getAutomationTriggerLabel = (config: AutomationConfigVersion): string => {
  if (config.trigger_type !== "event") {
    return humanizeTriggerType(config.trigger_type);
  }
  if (!config.provider_trigger) {
    if (config.event_provider && config.event_type) {
      return `${config.event_provider}.${config.event_type}`;
    }
    return "Provider event";
  }
  const definition = resolveProviderAutomationTriggerDefinition(
    config.provider_trigger.provider_id,
    config.provider_trigger.trigger_key,
  );
  if (!definition) {
    return `${config.provider_trigger.provider_id}.${config.provider_trigger.trigger_key}`;
  }
  return definition.display.label;
};

export const getAutomationTriggerDetail = (config: AutomationConfigVersion): string | null => {
  if (config.trigger_type === "schedule" && config.schedule_cron) {
    return config.schedule_cron;
  }
  if (config.trigger_type !== "event" || !config.provider_trigger) {
    return null;
  }
  const definition = resolveProviderAutomationTriggerDefinition(
    config.provider_trigger.provider_id,
    config.provider_trigger.trigger_key,
  );
  return definition?.display.description ?? null;
};

export const getProviderTriggerSubscriptionSummary = (
  config: AutomationConfigVersion,
): string | null => {
  if (config.trigger_type !== "event" || !config.provider_trigger) {
    return null;
  }
  const subscription = config.provider_trigger.subscription_state;
  const activeMode = subscription.active_mode ?? config.provider_trigger.delivery.preferred_mode;
  switch (subscription.status) {
    case "active":
      return `Active via ${activeMode}`;
    case "pending":
      return "Waiting for provider delivery to activate";
    case "degraded":
      return subscription.last_error
        ? `Degraded: ${subscription.last_error}`
        : "Degraded and using fallback delivery";
    case "expired":
      return "Provider subscription expired and needs renewal";
    case "failed":
      return subscription.last_error
        ? `Failed: ${subscription.last_error}`
        : "Provider delivery failed";
    case "inactive":
    default:
      return "Not yet activated";
  }
};

export const getTriggerEventSummary = (event: AutomationTriggerEvent): string => {
  if (event.status === "dispatched" && event.automation_run_id) {
    return "Matched and started an automation run.";
  }
  if (event.failure_reason) {
    return event.failure_reason.replaceAll("_", " ");
  }
  if (event.match_status === "matched") {
    return "Matched and queued for dispatch.";
  }
  return "Skipped before dispatch.";
};

export const humanizeRunner = (runner: AutomationRunnerType): string => {
  return runner === "claude_code" ? "Claude Code" : "ChatGPT Codex";
};

export const humanizeRunStatus = (status: AutomationRunStatus): string => {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "timed_out":
      return "Timed out";
  }
};

export const getRunStatusSummary = (run: AutomationRun): string => {
  if (run.outcome) {
    return run.outcome.summary;
  }
  if (run.status === "pending") {
    return "Queued to start in this workspace.";
  }
  if (run.status === "running") {
    return "Currently executing with live logs available.";
  }
  if (run.status === "succeeded") {
    return "Finished without reported errors.";
  }
  if (run.status === "cancelled") {
    return "Stopped before the workflow completed.";
  }
  if (run.status === "timed_out") {
    return "Ended after exceeding the runtime window.";
  }
  if (run.error_message) {
    return toUserFacingErrorMessage(run.error_message, "Ended with an error that needs review.");
  }
  return "Ended with an error that needs review.";
};

export const getRunOutcomeBadgeLabel = (run: AutomationRun): string | null => {
  if (!run.outcome) {
    return null;
  }
  if (run.outcome.source === "fallback_missing") {
    return run.outcome.success ? "Fallback success" : "Fallback failure";
  }
  return run.outcome.success ? "Reported success" : "Reported failure";
};

export const getRunOutcomeBadgeVariant = (
  run: AutomationRun,
): "default" | "secondary" | "destructive" | "outline" => {
  if (!run.outcome) {
    return "outline";
  }
  return run.outcome.success ? "default" : "destructive";
};

export const getRunOutcomeTitle = (run: AutomationRun): string => {
  if (run.outcome) {
    if (run.outcome.source === "fallback_missing") {
      return run.outcome.success
        ? "Completion inferred from terminal status"
        : "Outcome missing from automation";
    }
    return run.outcome.success ? "Automation reported success" : "Automation reported failure";
  }
  if (run.status === "failed" || run.status === "timed_out") {
    return "Needs investigation";
  }
  if (run.status === "succeeded") {
    return "Run completed cleanly";
  }
  return "Execution summary";
};

export const summarizeLastRun = (run: AutomationRun | null): string => {
  if (!run) {
    return "No runs";
  }
  const statusLabel = humanizeRunStatus(run.status);
  if (!run.created_at) {
    return statusLabel;
  }
  return `${statusLabel} · ${fullTimestamp(run.created_at)}`;
};

const EVENT_TYPES: Set<string> = new Set([
  "system",
  "automation_config",
  "thinking",
  "tool_call",
  "output",
  "error",
]);

const parseEventType = (value: unknown): AutomationRunEventType | undefined => {
  if (typeof value === "string" && EVENT_TYPES.has(value)) {
    return value as AutomationRunEventType;
  }
  return undefined;
};

const parseJsonString = (value: string): unknown | undefined => {
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    (!(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
      !(trimmed.startsWith("[") && trimmed.endsWith("]")))
  ) {
    return undefined;
  }
  try {
    return parseJsonValue(trimmed);
  } catch {
    return undefined;
  }
};

const asRecord = (value: unknown): Record<string, unknown> => {
  return isRecord(value) ? value : {};
};

const joinTextFragments = (fragments: string[]): string => {
  return fragments
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0)
    .join("\n");
};

export const mergeRunLogLines = (
  previous: AutomationRunLogLine[],
  incoming: AutomationRunLogLine[],
): AutomationRunLogLine[] => {
  if (incoming.length === 0) {
    return previous;
  }

  const existing = new Map(previous.map((line) => [line.seq, line]));
  let changed = false;

  for (const line of incoming) {
    const prior = existing.get(line.seq);
    if (
      !prior ||
      prior.content !== line.content ||
      prior.level !== line.level ||
      prior.timestamp !== line.timestamp ||
      prior.event_type !== line.event_type ||
      prior.event_data !== line.event_data
    ) {
      existing.set(line.seq, line);
      changed = true;
    }
  }

  if (!changed) {
    return previous;
  }

  return Array.from(existing.values()).sort((a, b) => a.seq - b.seq);
};

export const parseColdArchiveLines = async (
  storageUrl: string,
): Promise<AutomationRunLogLine[]> => {
  const response = await fetch(storageUrl);
  if (!response.ok) {
    throw new Error(`Failed to load archived logs (${response.status})`);
  }

  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const decoded = isGzip
    ? await (async () => {
        if (typeof DecompressionStream === "undefined") {
          throw new Error("This browser does not support gzip decompression.");
        }
        const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
        const decompressed = await new Response(stream).arrayBuffer();
        return new TextDecoder().decode(new Uint8Array(decompressed));
      })()
    : new TextDecoder().decode(bytes);

  const payload = parseJsonRecord(decoded);
  const parsed = parseAutomationRunLogs({
    mode: "hot",
    lines: Array.isArray(payload.lines) ? payload.lines : [],
  });
  return parsed.mode === "hot" ? parsed.lines : [];
};

type RunEventBase = {
  seq: number;
  timestamp: string;
  lastSeq: number;
  lastTimestamp: string;
  debugLines: AutomationRunLogLine[];
};

export type RunEventSystem = {
  type: "system";
  message: string;
  messages: string[];
  outcome?: {
    success: boolean;
    summary: string;
    source: AutomationRunOutcomeSource;
  };
} & RunEventBase;

export type RunEventAutomationConfigEntry = {
  key: string;
  label: string;
  value: unknown;
  valueText: string;
};

export type RunEventAutomationConfig = {
  type: "automation_config";
  entries: RunEventAutomationConfigEntry[];
  config?: Record<string, unknown>;
} & RunEventBase;

export type RunEventThinking = {
  type: "thinking";
  text: string;
  fragments: string[];
} & RunEventBase;

export type RunEventToolCall = {
  type: "tool_call";
  toolName: string;
  args?: Record<string, unknown>;
  result?: unknown;
  resultText?: string;
  resultFormat?: "text" | "json";
  durationMs?: number;
  status?: "success" | "error";
  awaitingResult?: boolean;
} & RunEventBase;

export type RunEventOutput = {
  type: "output";
  text: string;
  format?: "text" | "json";
  parsed?: unknown;
  chunks: string[];
} & RunEventBase;

export type RunEventError = {
  type: "error";
  message: string;
  code?: string;
} & RunEventBase;

export type RunEventRaw = {
  type: "raw";
  level: string;
  content: string;
} & RunEventBase;

type RunEventDraft =
  | RunEventSystem
  | RunEventAutomationConfig
  | RunEventThinking
  | RunEventToolCall
  | RunEventOutput
  | RunEventError
  | RunEventRaw;

export type RunEvent =
  | RunEventSystem
  | RunEventAutomationConfig
  | RunEventThinking
  | RunEventToolCall
  | RunEventOutput
  | RunEventError
  | RunEventRaw;

const createEventBase = (line: AutomationRunLogLine): RunEventBase => ({
  seq: line.seq,
  timestamp: line.timestamp,
  lastSeq: line.seq,
  lastTimestamp: line.timestamp,
  debugLines: [line],
});

const appendDebugLine = <T extends RunEventBase>(event: T, line: AutomationRunLogLine): T => {
  event.lastSeq = line.seq;
  event.lastTimestamp = line.timestamp;
  event.debugLines.push(line);
  return event;
};

const humanizeConfigLabel = (key: string): string => {
  return key
    .split(/\s+/u)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const toConfigEntry = (
  data: Record<string, unknown>,
  line: AutomationRunLogLine,
): RunEventAutomationConfigEntry | null => {
  const key = asString(data.key).trim();
  if (!key) {
    return null;
  }
  const value = data.value ?? line.content;
  return {
    key,
    label: humanizeConfigLabel(key),
    value,
    valueText: typeof value === "string" ? value : (JSON.stringify(value, null, 2) ?? ""),
  };
};

const lineToEvent = (line: AutomationRunLogLine): RunEventDraft => {
  const base = createEventBase(line);
  if (!line.event_type) {
    return { type: "raw", level: line.level, content: line.content, ...base };
  }

  const data = asRecord(line.event_data);
  switch (line.event_type) {
    case "system": {
      const message = asString(data.message) || line.content;
      const outcomeValue = isRecord(data.outcome) ? data.outcome : null;
      const outcome =
        data.kind === "automation_outcome" &&
        outcomeValue &&
        typeof outcomeValue.summary === "string" &&
        outcomeValue.summary.trim().length > 0
          ? {
              success: outcomeValue.success === true,
              summary: outcomeValue.summary,
              source: parseRunOutcomeSource(outcomeValue.source),
            }
          : undefined;
      return {
        type: "system",
        message,
        messages: [message],
        ...(outcome ? { outcome } : {}),
        ...base,
      };
    }
    case "automation_config": {
      const entry = toConfigEntry(data, line);
      return entry
        ? { type: "automation_config", entries: [entry], ...base }
        : { type: "automation_config", entries: [], config: data, ...base };
    }
    case "thinking": {
      const text = asString(data.text) || line.content;
      return { type: "thinking", text, fragments: [text], ...base };
    }
    case "tool_call": {
      const toolName = asString(data.tool_name);
      const status = data.status === "success" || data.status === "error" ? data.status : undefined;
      const durationMs = typeof data.duration_ms === "number" ? data.duration_ms : undefined;
      const args = isRecord(data.args) ? (data.args as Record<string, unknown>) : undefined;
      const rawResult = data.result ?? data.output ?? undefined;
      const resultText =
        typeof data.result_text === "string"
          ? data.result_text
          : typeof rawResult === "string"
            ? rawResult
            : undefined;
      const parsedResult =
        rawResult !== undefined
          ? rawResult
          : resultText
            ? (parseJsonString(resultText) ?? resultText)
            : undefined;
      return {
        type: "tool_call",
        toolName,
        ...(args !== undefined ? { args } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
        ...(parsedResult !== undefined ? { result: parsedResult } : {}),
        ...(resultText !== undefined ? { resultText } : {}),
        ...(parsedResult !== undefined
          ? { resultFormat: typeof parsedResult === "string" ? "text" : "json" }
          : {}),
        ...(data.is_result === true && parsedResult === undefined ? { awaitingResult: true } : {}),
        ...base,
      };
    }
    case "output": {
      const text = asString(data.text) || line.content;
      const parsed = data.parsed ?? parseJsonString(text);
      const format = data.format === "json" || parsed !== undefined ? "json" : "text";
      return {
        type: "output",
        text,
        format,
        ...(parsed !== undefined ? { parsed } : {}),
        chunks: [text],
        ...base,
      };
    }
    case "error":
      return {
        type: "error",
        message: asString(data.message) || line.content,
        ...(typeof data.code === "string" ? { code: data.code } : {}),
        ...base,
      };
    default:
      return { type: "raw", level: line.level, content: line.content, ...base };
  }
};

const mergeToolCallResult = (
  previous: RunEventToolCall,
  current: RunEventToolCall,
  line: AutomationRunLogLine,
): RunEventToolCall => {
  if (current.status !== undefined) {
    previous.status = current.status;
  }
  if (current.durationMs !== undefined) {
    previous.durationMs = current.durationMs;
  }
  if (current.result !== undefined) {
    previous.result = current.result;
    if (current.resultText !== undefined) {
      previous.resultText = current.resultText;
    }
    if (current.resultFormat !== undefined) {
      previous.resultFormat = current.resultFormat;
    }
    previous.awaitingResult = false;
  } else if (current.awaitingResult) {
    previous.awaitingResult = true;
  }
  return appendDebugLine(previous, line);
};

const mergeToolCallStart = (
  previous: RunEventToolCall,
  current: RunEventToolCall,
  line: AutomationRunLogLine,
): RunEventToolCall => {
  if (previous.args === undefined && current.args !== undefined) {
    previous.args = current.args;
  }
  if (previous.status === undefined && current.status !== undefined) {
    previous.status = current.status;
  }
  if (previous.durationMs === undefined && current.durationMs !== undefined) {
    previous.durationMs = current.durationMs;
  }
  if (previous.result === undefined && current.result !== undefined) {
    previous.result = current.result;
  }
  if (previous.resultText === undefined && current.resultText !== undefined) {
    previous.resultText = current.resultText;
  }
  if (previous.resultFormat === undefined && current.resultFormat !== undefined) {
    previous.resultFormat = current.resultFormat;
  }
  return appendDebugLine(previous, line);
};

export const toRunEvents = (lines: AutomationRunLogLine[]): RunEvent[] => {
  const events: RunEvent[] = [];

  for (const line of lines) {
    const event = lineToEvent(line);
    const previous = events[events.length - 1];
    const toolMeta = asRecord(line.event_data) as { is_result?: boolean };

    if (event.type === "tool_call" && toolMeta.is_result === true) {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const candidate = events[index];
        if (candidate?.type === "tool_call" && candidate.toolName === event.toolName) {
          mergeToolCallResult(candidate, event, line);
          break;
        }
      }
      continue;
    }

    if (
      event.type === "tool_call" &&
      previous?.type === "tool_call" &&
      previous.toolName === event.toolName &&
      previous.status === undefined &&
      previous.result === undefined &&
      event.status === undefined &&
      event.result === undefined &&
      event.awaitingResult !== true
    ) {
      mergeToolCallStart(previous, event, line);
      continue;
    }

    if (
      event.type === "output" &&
      previous?.type === "tool_call" &&
      previous.awaitingResult === true &&
      previous.result === undefined
    ) {
      previous.result = event.parsed ?? event.text;
      previous.resultText = event.text;
      if (event.format !== undefined) {
        previous.resultFormat = event.format;
      }
      previous.awaitingResult = false;
      appendDebugLine(previous, line);
      continue;
    }

    if (
      previous?.type === "system" &&
      event.type === "system" &&
      previous.outcome === undefined &&
      event.outcome === undefined
    ) {
      previous.messages.push(event.message);
      previous.message = joinTextFragments(previous.messages);
      appendDebugLine(previous, line);
      continue;
    }

    if (previous?.type === "automation_config" && event.type === "automation_config") {
      previous.entries.push(...event.entries);
      if (previous.config === undefined && event.config !== undefined) {
        previous.config = event.config;
      }
      appendDebugLine(previous, line);
      continue;
    }

    if (previous?.type === "thinking" && event.type === "thinking") {
      previous.fragments.push(...event.fragments);
      previous.text = joinTextFragments(previous.fragments);
      appendDebugLine(previous, line);
      continue;
    }

    if (
      previous?.type === "output" &&
      event.type === "output" &&
      previous.format === event.format &&
      previous.format !== "json"
    ) {
      previous.chunks.push(...event.chunks);
      previous.text = previous.chunks.join("\n");
      appendDebugLine(previous, line);
      continue;
    }

    if (previous?.type === "raw" && event.type === "raw" && previous.level === event.level) {
      previous.content = `${previous.content}\n${event.content}`;
      appendDebugLine(previous, line);
      continue;
    }

    events.push(event);
  }

  return events;
};

export const getRunSummaryLine = (events: RunEvent[]): string => {
  for (const event of events) {
    if (event.type === "thinking" && event.text.length > 0) {
      return event.text.length > 80 ? event.text.slice(0, 77) + "..." : event.text;
    }
    if (event.type === "output" && event.text.length > 0) {
      return event.text.length > 80 ? event.text.slice(0, 77) + "..." : event.text;
    }
  }
  return "";
};
