import { z } from "zod";
import { AUTOMATION_MEMORY_MAX_LENGTH } from "@keppo/shared/automations";
import {
  getProviderAutomationTriggers,
  resolveProviderAutomationTriggerDefinition,
} from "../../../../../packages/shared/src/providers/automation-trigger-registry.js";
import type {
  AutomationConfigTriggerType,
  AutomationModelClass,
  AutomationRunnerType,
  AiModelProvider,
  NetworkAccessMode,
} from "@/lib/automations-view-model";

const MODEL_CLASS_COMPATIBILITY: Record<
  AutomationModelClass,
  { provider: AiModelProvider; model: string; runner: AutomationRunnerType }
> = {
  auto: { provider: "openai", model: "gpt-5.4", runner: "chatgpt_codex" },
  frontier: { provider: "openai", model: "gpt-5.4", runner: "chatgpt_codex" },
  balanced: { provider: "openai", model: "gpt-5.4", runner: "chatgpt_codex" },
  value: { provider: "openai", model: "gpt-5.2", runner: "chatgpt_codex" },
};

const CRON_FIELD_PATTERN = /^[A-Za-z0-9*/,\-?LW#]+$/;

const isLikelyCronExpression = (value: string): boolean => {
  const parts = value.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    return false;
  }
  return parts.every((part) => part.length > 0 && CRON_FIELD_PATTERN.test(part));
};

const trimmedString = z.string().trim();
const providerTriggerFilterValueSchema = z.union([trimmedString, z.boolean()]);

const toStringValue = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

const splitCsvValue = (value: string): string[] => {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
};

const buildProviderTriggerFilterFormValues = (
  providerId: string,
  triggerKey: string,
  filter: Record<string, unknown>,
): Record<string, string | boolean> => {
  const trigger = resolveProviderAutomationTriggerDefinition(providerId, triggerKey);
  if (!trigger) {
    return {};
  }

  return Object.fromEntries(
    trigger.filterUi.fields.map((field) => {
      const value = filter[field.key];
      if (field.type === "boolean") {
        return [field.key, value === true];
      }
      if (field.type === "csv") {
        return [
          field.key,
          Array.isArray(value)
            ? value
                .filter((entry): entry is string => typeof entry === "string")
                .map((entry) => entry.trim())
                .filter(Boolean)
                .join(", ")
            : "",
        ];
      }
      return [field.key, toStringValue(value)];
    }),
  );
};

const buildProviderTriggerFilterPayload = (
  providerId: string,
  triggerKey: string,
  filterValues: Record<string, string | boolean>,
): Record<string, unknown> => {
  const trigger = resolveProviderAutomationTriggerDefinition(providerId, triggerKey);
  if (!trigger) {
    return {};
  }

  const filter: Record<string, unknown> = {};
  for (const field of trigger.filterUi.fields) {
    const rawValue = filterValues[field.key];
    if (field.type === "boolean") {
      if (rawValue === true) {
        filter[field.key] = true;
      }
      continue;
    }

    const stringValue = typeof rawValue === "string" ? rawValue.trim() : "";
    if (!stringValue) {
      continue;
    }

    if (field.type === "csv") {
      const entries = splitCsvValue(stringValue);
      if (entries.length > 0) {
        filter[field.key] = entries;
      }
      continue;
    }

    filter[field.key] = stringValue;
  }

  return filter;
};

export const getProviderTriggerFormDefaults = (params?: {
  providerId?: string | null;
  triggerKey?: string | null;
  filter?: Record<string, unknown> | null;
}) => {
  const providerId = typeof params?.providerId === "string" ? params.providerId : "";
  const resolvedTrigger = resolveProviderAutomationTriggerDefinition(
    providerId,
    typeof params?.triggerKey === "string" ? params.triggerKey : "",
  );

  return {
    provider_trigger_provider_id: providerId,
    provider_trigger_key: resolvedTrigger?.key ?? "",
    provider_trigger_filter: buildProviderTriggerFilterFormValues(
      providerId,
      resolvedTrigger?.key ?? "",
      params?.filter ?? {},
    ),
  };
};

export const automationFormSchema = z
  .object({
    name: trimmedString.min(1, "Name is required."),
    description: trimmedString,
    memory: z
      .string()
      .refine(
        (value) => value.replace(/\r\n?/g, "\n").trim().length <= AUTOMATION_MEMORY_MAX_LENGTH,
        `Memory must be ${String(AUTOMATION_MEMORY_MAX_LENGTH)} characters or fewer.`,
      ),
    mermaid_content: trimmedString,
    trigger_type: z.enum(["schedule", "event", "manual"]),
    schedule_cron: trimmedString,
    provider_trigger_provider_id: trimmedString,
    provider_trigger_key: trimmedString,
    provider_trigger_filter: z.record(z.string(), providerTriggerFilterValueSchema),
    model_class: z.enum(["auto", "frontier", "balanced", "value"]),
    runner_type: z.enum(["chatgpt_codex", "claude_code"]),
    ai_model_provider: z.enum(["openai", "anthropic"]),
    ai_model_name: trimmedString.min(1, "Model is required."),
    prompt: trimmedString.min(1, "Prompt is required."),
    network_access: z.enum(["mcp_only", "mcp_and_web"]),
    change_summary: trimmedString.optional(),
    generation_description: trimmedString.optional(),
  })
  .superRefine((values, context) => {
    if (values.trigger_type === "schedule") {
      if (!values.schedule_cron) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["schedule_cron"],
          message: "Cron expression is required.",
        });
      } else if (!isLikelyCronExpression(values.schedule_cron)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["schedule_cron"],
          message: "Enter a valid cron expression.",
        });
      }
    }

    if (values.trigger_type === "event") {
      if (!values.provider_trigger_provider_id) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["provider_trigger_provider_id"],
          message: "Choose a provider.",
        });
        return;
      }

      const triggerFacet = getProviderAutomationTriggers(values.provider_trigger_provider_id);
      if (!triggerFacet) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["provider_trigger_provider_id"],
          message: "This provider does not expose automation triggers yet.",
        });
        return;
      }

      const triggerDefinition = resolveProviderAutomationTriggerDefinition(
        values.provider_trigger_provider_id,
        values.provider_trigger_key,
      );
      if (!triggerDefinition) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["provider_trigger_key"],
          message: "Choose a trigger type.",
        });
        return;
      }

      for (const field of triggerDefinition.filterUi.fields) {
        if (!field.required) {
          continue;
        }
        const value = values.provider_trigger_filter[field.key];
        if (field.type === "boolean") {
          if (value !== true) {
            context.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["provider_trigger_filter", field.key],
              message: `${field.label} is required.`,
            });
          }
          continue;
        }

        if (typeof value !== "string" || value.trim().length === 0) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["provider_trigger_filter", field.key],
            message: `${field.label} is required.`,
          });
        }
      }
    }
  });

export type AutomationFormValues = z.infer<typeof automationFormSchema>;

type AutomationFormOverrides = Partial<AutomationFormValues>;

export const AI_MODELS: Record<AiModelProvider, string[]> = {
  openai: ["gpt-5.4", "gpt-5.2"],
  anthropic: ["claude-sonnet-4-6", "claude-opus-4"],
};

export const getDefaultModelForProvider = (provider: AiModelProvider): string => {
  return AI_MODELS[provider][0] ?? "gpt-5.4";
};

export const parseTriggerType = (value: string): AutomationConfigTriggerType => {
  if (value === "event") {
    return "event";
  }
  if (value === "manual") {
    return "manual";
  }
  return "schedule";
};

export const parseRunnerType = (value: string): AutomationRunnerType => {
  return value === "claude_code" ? "claude_code" : "chatgpt_codex";
};

export const parseAiModelProvider = (value: string): AiModelProvider => {
  return value === "anthropic" ? "anthropic" : "openai";
};

export const parseModelClass = (value: string): AutomationModelClass => {
  if (value === "frontier" || value === "balanced" || value === "value") {
    return value;
  }
  return "auto";
};

export const parseNetworkAccess = (value: string): NetworkAccessMode => {
  return value === "mcp_and_web" ? "mcp_and_web" : "mcp_only";
};

export const getDefaultAutomationFormValues = (
  overrides: AutomationFormOverrides = {},
): AutomationFormValues => ({
  name: "",
  description: "",
  memory: "",
  mermaid_content: "",
  trigger_type: "schedule",
  schedule_cron: "0 9 * * *",
  provider_trigger_provider_id: "",
  provider_trigger_key: "",
  provider_trigger_filter: {},
  model_class: "auto",
  runner_type: "chatgpt_codex",
  ai_model_provider: "openai",
  ai_model_name: "gpt-5.4",
  prompt: "",
  network_access: "mcp_only",
  change_summary: "",
  generation_description: "",
  ...overrides,
});

export const buildAutomationConfigInput = (
  values: AutomationFormValues,
  _options: { triggerCelEnabled: boolean },
) => {
  const compatibility = MODEL_CLASS_COMPATIBILITY[values.model_class];
  return {
    trigger_type: values.trigger_type,
    ...(values.trigger_type === "schedule" ? { schedule_cron: values.schedule_cron } : {}),
    ...(values.trigger_type === "event"
      ? (() => {
          const triggerDefinition = resolveProviderAutomationTriggerDefinition(
            values.provider_trigger_provider_id,
            values.provider_trigger_key,
          );
          if (!triggerDefinition) {
            return {
              event_provider: values.provider_trigger_provider_id,
              event_type: values.provider_trigger_key,
            };
          }
          const defaultTrigger = triggerDefinition.buildDefaultTrigger();
          return {
            provider_trigger: {
              ...defaultTrigger,
              provider_id: values.provider_trigger_provider_id,
              trigger_key: triggerDefinition.key,
              filter: buildProviderTriggerFilterPayload(
                values.provider_trigger_provider_id,
                triggerDefinition.key,
                values.provider_trigger_filter,
              ),
            },
          };
        })()
      : {}),
    model_class: values.model_class,
    runner_type: compatibility.runner,
    ai_model_provider: compatibility.provider,
    ai_model_name: compatibility.model,
    prompt: values.prompt,
    network_access: values.network_access,
  };
};
