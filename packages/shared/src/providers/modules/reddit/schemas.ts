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

const ownedTools = getProviderToolDefinitions("reddit");

export const schemas: ProviderSchemasFacet = buildSchemasFacetFromTools(ownedTools);

const redditMessageFilterSchema = z.object({
  from: z.string().trim().optional(),
  subject_contains: z.string().trim().optional(),
  body_contains: z.string().trim().optional(),
});

export const redditMentionTriggerFilterSchema = redditMessageFilterSchema;
export const redditUnreadInboxMessageTriggerFilterSchema = redditMessageFilterSchema;

export const redditMentionTriggerEventSchema = z.object({
  delivery_id: z.string().trim().min(1),
  event_type: z.literal("reddit.inbox.mention"),
  message: z.object({
    id: z.string().trim().min(1),
    to: z.string().trim().min(1),
    from: z.string().trim().min(1),
    subject: z.string().trim(),
    body: z.string(),
    unread: z.boolean(),
  }),
});

export const redditUnreadInboxMessageTriggerEventSchema = z.object({
  delivery_id: z.string().trim().min(1),
  event_type: z.literal("reddit.inbox.unread_message"),
  message: z.object({
    id: z.string().trim().min(1),
    to: z.string().trim().min(1),
    from: z.string().trim().min(1),
    subject: z.string().trim(),
    body: z.string(),
    unread: z.literal(true),
  }),
});

const buildPollingTrigger = (triggerKey: string): AutomationProviderTrigger => ({
  provider_id: "reddit",
  trigger_key: triggerKey,
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

const matchesRedditMessageEvent = (
  filterSchema: typeof redditMessageFilterSchema,
  eventSchema:
    | typeof redditMentionTriggerEventSchema
    | typeof redditUnreadInboxMessageTriggerEventSchema,
  params: {
    filter: Record<string, unknown>;
    event: Record<string, unknown>;
  },
): boolean => {
  const parsedFilter = filterSchema.safeParse(params.filter);
  const parsedEvent = eventSchema.safeParse(params.event);
  if (!parsedFilter.success || !parsedEvent.success) {
    return false;
  }

  const filter = parsedFilter.data;
  const event = parsedEvent.data;
  const from = normalizeString(event.message.from);
  const subject = normalizeString(event.message.subject);
  const body = normalizeString(event.message.body);

  if (filter.from && from !== normalizeString(filter.from)) {
    return false;
  }
  if (filter.subject_contains && !subject.includes(normalizeString(filter.subject_contains))) {
    return false;
  }
  if (filter.body_contains && !body.includes(normalizeString(filter.body_contains))) {
    return false;
  }

  return true;
};

export const automationTriggers: ProviderAutomationTriggersFacet = {
  triggers: {
    mentions: {
      key: "mentions",
      eventType: "reddit.inbox.mention",
      schemaVersion: AUTOMATION_PROVIDER_TRIGGER_SCHEMA_VERSION,
      scheduler: {
        strategy: "polling",
        cadenceMinutes: 1,
        maxCandidatesPerReconcile: 100,
      },
      display: {
        label: "Mentions",
        description: "Start an automation when Reddit inbox mentions reference this account.",
      },
      filterUi: {
        title: "Match Reddit mentions",
        description: "Filter by sender or message content when you only care about some mentions.",
        fields: [
          {
            key: "from",
            label: "From username",
            type: "text",
            placeholder: "support_mod",
            description: "Only match mentions sent by this Reddit user.",
          },
          {
            key: "subject_contains",
            label: "Subject contains",
            type: "text",
            placeholder: "urgent",
            description: "Only match mentions whose subject includes this text.",
          },
          {
            key: "body_contains",
            label: "Body contains",
            type: "text",
            placeholder: "need help",
            description: "Only match mentions whose body includes this text.",
          },
        ],
      },
      filterSchema: redditMentionTriggerFilterSchema,
      eventSchema: redditMentionTriggerEventSchema,
      supportedDeliveryModes: [AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling],
      defaultDeliveryMode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
      buildDefaultTrigger: () => buildPollingTrigger("mentions"),
      matchesEvent: (params) =>
        matchesRedditMessageEvent(
          redditMentionTriggerFilterSchema,
          redditMentionTriggerEventSchema,
          params,
        ),
    },
    unread_inbox_message: {
      key: "unread_inbox_message",
      eventType: "reddit.inbox.unread_message",
      schemaVersion: AUTOMATION_PROVIDER_TRIGGER_SCHEMA_VERSION,
      scheduler: {
        strategy: "polling",
        cadenceMinutes: 1,
        maxCandidatesPerReconcile: 100,
      },
      display: {
        label: "Unread inbox message",
        description: "Start an automation when a new unread Reddit inbox message appears.",
      },
      filterUi: {
        title: "Match unread Reddit inbox messages",
        description: "Filter by sender or content while keeping delivery on unread inbox items.",
        fields: [
          {
            key: "from",
            label: "From username",
            type: "text",
            placeholder: "support_mod",
            description: "Only match unread messages sent by this Reddit user.",
          },
          {
            key: "subject_contains",
            label: "Subject contains",
            type: "text",
            placeholder: "incident",
            description: "Only match unread messages whose subject includes this text.",
          },
          {
            key: "body_contains",
            label: "Body contains",
            type: "text",
            placeholder: "escalate",
            description: "Only match unread messages whose body includes this text.",
          },
        ],
      },
      filterSchema: redditUnreadInboxMessageTriggerFilterSchema,
      eventSchema: redditUnreadInboxMessageTriggerEventSchema,
      supportedDeliveryModes: [AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling],
      defaultDeliveryMode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
      buildDefaultTrigger: () => buildPollingTrigger("unread_inbox_message"),
      matchesEvent: (params) =>
        matchesRedditMessageEvent(
          redditUnreadInboxMessageTriggerFilterSchema,
          redditUnreadInboxMessageTriggerEventSchema,
          params,
        ),
    },
  },
};
