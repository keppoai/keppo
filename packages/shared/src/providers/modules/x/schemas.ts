import { z } from "zod";
import {
  AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE,
  AUTOMATION_PROVIDER_TRIGGER_SCHEMA_VERSION,
  AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS,
  type AutomationProviderTrigger,
} from "../../../automations.js";
import type {
  ProviderAutomationTriggersFacet,
  ProviderSchemasFacet,
} from "../../registry/types.js";
import { buildSchemasFacetFromTools, getProviderToolDefinitions } from "../shared.js";

const ownedTools = getProviderToolDefinitions("x");

export const schemas: ProviderSchemasFacet = buildSchemasFacetFromTools(ownedTools);

export const xMentionTriggerFilterSchema = z.object({
  text_contains: z.string().trim().optional(),
  author_id: z.string().trim().optional(),
});

export const xMentionTriggerEventSchema = z.object({
  delivery_id: z.string().trim().min(1),
  event_type: z.literal("x.mentions.post"),
  mention: z.object({
    id: z.string().trim().min(1),
    text: z.string(),
    author_id: z.string().trim().optional(),
    created_at: z.string().trim().optional(),
  }),
});

const buildMentionDefaultTrigger = (): AutomationProviderTrigger => ({
  provider_id: "x",
  trigger_key: "mentions",
  schema_version: AUTOMATION_PROVIDER_TRIGGER_SCHEMA_VERSION,
  filter: {},
  delivery: {
    preferred_mode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
    supported_modes: [AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling],
    fallback_mode: null,
  },
  subscription_state: {
    status: AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS.inactive,
    active_mode: null,
    last_error: null,
    updated_at: null,
  },
});

const normalizeString = (value: unknown): string => {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
};

const matchesMentionTrigger = (params: {
  filter: Record<string, unknown>;
  event: Record<string, unknown>;
}): boolean => {
  const parsedFilter = xMentionTriggerFilterSchema.safeParse(params.filter);
  const parsedEvent = xMentionTriggerEventSchema.safeParse(params.event);
  if (!parsedFilter.success || !parsedEvent.success) {
    return false;
  }

  const filter = parsedFilter.data;
  const event = parsedEvent.data;
  const text = normalizeString(event.mention.text);
  const authorId = normalizeString(event.mention.author_id);

  if (filter.text_contains && !text.includes(normalizeString(filter.text_contains))) {
    return false;
  }
  if (filter.author_id && authorId !== normalizeString(filter.author_id)) {
    return false;
  }

  return true;
};

export const automationTriggers: ProviderAutomationTriggersFacet = {
  triggers: {
    mentions: {
      key: "mentions",
      eventType: "x.mentions.post",
      schemaVersion: AUTOMATION_PROVIDER_TRIGGER_SCHEMA_VERSION,
      scheduler: {
        strategy: "polling",
        cadenceMinutes: 1,
        maxCandidatesPerReconcile: 100,
      },
      display: {
        label: "Mentions",
        description: "Start an automation when X mentions this connected account in a post.",
      },
      filterUi: {
        title: "Match X mentions",
        description: "Filter by author id or post text if you only want a subset of mentions.",
        fields: [
          {
            key: "text_contains",
            label: "Post text contains",
            type: "text",
            placeholder: "incident",
            description: "Only match mentions whose post text includes this text.",
          },
          {
            key: "author_id",
            label: "Author id",
            type: "text",
            placeholder: "u_101",
            description: "Only match mentions from this X user id.",
          },
        ],
      },
      filterSchema: xMentionTriggerFilterSchema,
      eventSchema: xMentionTriggerEventSchema,
      supportedDeliveryModes: [AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling],
      defaultDeliveryMode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
      buildDefaultTrigger: buildMentionDefaultTrigger,
      matchesEvent: matchesMentionTrigger,
    },
  },
};
