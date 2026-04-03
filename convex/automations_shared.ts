import { v } from "convex/values";
import {
  buildLegacyEventProviderTrigger,
  buildLegacyEventProviderTriggerMigrationState,
  coerceAutomationModelClass,
  inferAutomationModelClassFromLegacyFields,
} from "../packages/shared/src/automations.js";
import type { Doc } from "./_generated/dataModel";
import { pickFields } from "./field_mapper";
import {
  automationStatusValidator,
  automationProviderTriggerMigrationStateValidator,
  automationProviderTriggerValidator,
  aiModelProviderValidator,
  configTriggerTypeValidator,
  modelClassValidator,
  networkAccessValidator,
  runnerTypeValidator,
} from "./validators";

export const automationConfigVersionValidator = v.object({
  id: v.string(),
  automation_id: v.string(),
  version_number: v.number(),
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
  model_class: modelClassValidator,
  runner_type: runnerTypeValidator,
  ai_model_provider: aiModelProviderValidator,
  ai_model_name: v.string(),
  prompt: v.string(),
  network_access: networkAccessValidator,
  created_by: v.string(),
  created_at: v.string(),
  change_summary: v.union(v.string(), v.null()),
});

export const automationConfigSummaryValidator = v.object({
  id: v.string(),
  version_number: v.number(),
  trigger_type: configTriggerTypeValidator,
  model_class: modelClassValidator,
  runner_type: runnerTypeValidator,
  ai_model_provider: aiModelProviderValidator,
  ai_model_name: v.string(),
  network_access: networkAccessValidator,
  created_at: v.string(),
});

export const automationRunSummaryValidator = v.object({
  id: v.string(),
  automation_id: v.string(),
  org_id: v.string(),
  workspace_id: v.string(),
  config_version_id: v.string(),
  trigger_type: v.union(v.literal("schedule"), v.literal("event"), v.literal("manual")),
  status: v.union(
    v.literal("pending"),
    v.literal("running"),
    v.literal("succeeded"),
    v.literal("failed"),
    v.literal("cancelled"),
    v.literal("timed_out"),
  ),
  created_at: v.string(),
  started_at: v.union(v.string(), v.null()),
  ended_at: v.union(v.string(), v.null()),
  error_message: v.union(v.string(), v.null()),
});

export const automationValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  workspace_id: v.string(),
  slug: v.string(),
  name: v.string(),
  description: v.string(),
  memory: v.string(),
  mermaid_content: v.union(v.string(), v.null()),
  mermaid_prompt_hash: v.union(v.string(), v.null()),
  status: automationStatusValidator,
  current_config_version_id: v.string(),
  created_by: v.string(),
  created_at: v.string(),
  updated_at: v.string(),
});

export const automationWithCurrentConfigValidator = v.object({
  automation: automationValidator,
  current_config_version: v.union(automationConfigVersionValidator, v.null()),
});

export const automationSummaryValidator = v.object({
  automation: automationValidator,
  current_config_version: v.union(automationConfigSummaryValidator, v.null()),
  latest_run: v.union(automationRunSummaryValidator, v.null()),
});

export const paginatedAutomationSummariesValidator = v.object({
  page: v.array(automationSummaryValidator),
  isDone: v.boolean(),
  continueCursor: v.string(),
});

export const automationConfigSummaryFields = [
  "id",
  "version_number",
  "trigger_type",
  "model_class",
  "runner_type",
  "ai_model_provider",
  "ai_model_name",
  "network_access",
  "created_at",
] as const satisfies readonly (keyof Doc<"automation_config_versions">)[];

export const automationConfigVersionViewFields = [
  "automation_id",
  "ai_model_name",
  "ai_model_provider",
  "change_summary",
  "created_at",
  "created_by",
  "provider_trigger",
  "provider_trigger_migration_state",
  "event_predicate",
  "event_provider",
  "event_type",
  "id",
  "network_access",
  "model_class",
  "prompt",
  "runner_type",
  "schedule_cron",
  "trigger_type",
  "version_number",
] as const satisfies readonly (keyof Doc<"automation_config_versions">)[];

export const automationViewFields = [
  "id",
  "org_id",
  "workspace_id",
  "slug",
  "name",
  "description",
  "memory",
  "mermaid_content",
  "mermaid_prompt_hash",
  "status",
  "current_config_version_id",
  "created_by",
  "created_at",
  "updated_at",
] as const satisfies readonly (keyof Doc<"automations">)[];

const resolveModelClassCompatibility = (config: Doc<"automation_config_versions">) => ({
  model_class:
    config.model_class !== undefined && config.model_class !== null
      ? coerceAutomationModelClass(config.model_class)
      : inferAutomationModelClassFromLegacyFields({
          aiModelProvider: config.ai_model_provider,
          aiModelName: config.ai_model_name,
        }),
});

export const toAutomationConfigSummary = (config: Doc<"automation_config_versions">) => ({
  ...pickFields(config, automationConfigSummaryFields),
  ...resolveModelClassCompatibility(config),
});

const resolveProviderTriggerCompatibility = (
  config: Doc<"automation_config_versions">,
): Pick<
  Doc<"automation_config_versions">,
  "provider_trigger" | "provider_trigger_migration_state"
> => {
  if (config.trigger_type !== "event") {
    return {
      provider_trigger: null,
      provider_trigger_migration_state: null,
    };
  }

  if (config.provider_trigger) {
    return {
      provider_trigger: config.provider_trigger,
      provider_trigger_migration_state: config.provider_trigger_migration_state ?? null,
    };
  }

  if (config.event_provider && config.event_type) {
    return {
      provider_trigger: buildLegacyEventProviderTrigger({
        eventProvider: config.event_provider,
        eventType: config.event_type,
        ...(config.event_predicate ? { eventPredicate: config.event_predicate } : {}),
      }),
      provider_trigger_migration_state: buildLegacyEventProviderTriggerMigrationState({
        eventProvider: config.event_provider,
        eventType: config.event_type,
        ...(config.event_predicate ? { eventPredicate: config.event_predicate } : {}),
      }),
    };
  }

  return {
    provider_trigger: null,
    provider_trigger_migration_state: config.provider_trigger_migration_state ?? null,
  };
};

export const toAutomationConfigVersionView = (config: Doc<"automation_config_versions">) => ({
  ...pickFields(config, automationConfigVersionViewFields),
  ...resolveModelClassCompatibility(config),
  ...resolveProviderTriggerCompatibility(config),
});

export const toAutomationView = (automation: Doc<"automations">) => ({
  ...pickFields(automation, automationViewFields),
  memory: automation.memory ?? "",
  mermaid_content: automation.mermaid_content ?? null,
  mermaid_prompt_hash: automation.mermaid_prompt_hash ?? null,
});
