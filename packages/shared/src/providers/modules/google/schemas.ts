import { z } from "zod";
import {
  AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE,
  AUTOMATION_PROVIDER_TRIGGER_SCHEMA_VERSION,
  AUTOMATION_PROVIDER_TRIGGER_SUBSCRIPTION_STATUS,
  type AutomationProviderTrigger,
} from "../../../automations.js";
import type { ProviderSchemasFacet } from "../../registry/types.js";
import type { ProviderAutomationTriggersFacet } from "../../registry/types.js";
import { buildSchemasFacetFromTools, getProviderToolDefinitions } from "../shared.js";

const ownedTools = getProviderToolDefinitions("google");

export const schemas: ProviderSchemasFacet = buildSchemasFacetFromTools(ownedTools);

export const gmailIncomingEmailTriggerFilterSchema = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  subject_contains: z.string().trim().optional(),
  has_any_labels: z.array(z.string().trim().min(1)).default([]),
  unread_only: z.boolean().default(false),
});

export const gmailIncomingEmailTriggerEventSchema = z.object({
  delivery_id: z.string().trim().min(1),
  event_type: z.literal("google.gmail.incoming_email"),
  history_id: z.string().trim().min(1),
  message: z.object({
    id: z.string().trim().min(1),
    thread_id: z.string().trim().min(1),
    from: z.string().trim().optional(),
    to: z.array(z.string().trim().min(1)).default([]),
    subject: z.string().trim().optional(),
    label_ids: z.array(z.string().trim().min(1)).default([]),
    snippet: z.string().optional(),
    internal_date: z.string().trim().optional(),
  }),
});

const buildIncomingEmailDefaultTrigger = (): AutomationProviderTrigger => ({
  provider_id: "google",
  trigger_key: "incoming_email",
  schema_version: AUTOMATION_PROVIDER_TRIGGER_SCHEMA_VERSION,
  filter: {
    has_any_labels: [],
    unread_only: false,
  },
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
});

const normalizeString = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

const normalizeLowercase = (value: unknown): string => {
  return normalizeString(value).toLowerCase();
};

const normalizeStringArray = (value: unknown): string[] => {
  return Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry.length > 0)
    : [];
};

const normalizeEmailAddress = (value: unknown): string => {
  const normalized = normalizeLowercase(value);
  if (normalized.length === 0) {
    return "";
  }
  const angleMatch = /<([^>]+)>/.exec(normalized);
  if (angleMatch?.[1]) {
    return angleMatch[1].trim();
  }
  return normalized;
};

const matchesIncomingEmailTrigger = (params: {
  filter: Record<string, unknown>;
  event: Record<string, unknown>;
}): boolean => {
  const parsedFilter = gmailIncomingEmailTriggerFilterSchema.safeParse(params.filter);
  const parsedEvent = gmailIncomingEmailTriggerEventSchema.safeParse(params.event);
  if (!parsedFilter.success || !parsedEvent.success) {
    return false;
  }

  const filter = parsedFilter.data;
  const event = parsedEvent.data;
  const messageFrom = normalizeEmailAddress(event.message.from);
  const messageSubject = normalizeLowercase(event.message.subject);
  const recipientList = normalizeStringArray(event.message.to).map((recipient) =>
    recipient.toLowerCase(),
  );
  const labelIds = new Set(normalizeStringArray(event.message.label_ids));

  if (filter.from && messageFrom !== normalizeEmailAddress(filter.from)) {
    return false;
  }
  if (filter.to) {
    const expectedRecipient = normalizeLowercase(filter.to);
    if (!recipientList.includes(expectedRecipient)) {
      return false;
    }
  }
  if (filter.subject_contains) {
    const expectedSubject = normalizeLowercase(filter.subject_contains);
    if (!messageSubject.includes(expectedSubject)) {
      return false;
    }
  }
  if (filter.has_any_labels.length > 0) {
    const hasMatchingLabel = filter.has_any_labels.some((label) => labelIds.has(label));
    if (!hasMatchingLabel) {
      return false;
    }
  }
  if (filter.unread_only && !labelIds.has("UNREAD")) {
    return false;
  }

  return true;
};

export const automationTriggers: ProviderAutomationTriggersFacet = {
  triggers: {
    incoming_email: {
      key: "incoming_email",
      eventType: "google.gmail.incoming_email",
      schemaVersion: AUTOMATION_PROVIDER_TRIGGER_SCHEMA_VERSION,
      scheduler: {
        strategy: "polling",
        cadenceMinutes: 1,
        maxCandidatesPerReconcile: 100,
      },
      display: {
        label: "Incoming email",
        description:
          "Start an automation when Gmail receives a message that matches structured filters.",
      },
      filterUi: {
        title: "Match incoming Gmail messages",
        description:
          "Add only the filters you care about. Leave any field blank to match all inbound mail.",
        fields: [
          {
            key: "from",
            label: "From address",
            type: "email",
            placeholder: "alerts@example.com",
            description: "Only match messages from this sender.",
          },
          {
            key: "to",
            label: "Delivered to",
            type: "email",
            placeholder: "ops@example.com",
            description: "Only match messages sent to this recipient.",
          },
          {
            key: "subject_contains",
            label: "Subject contains",
            type: "text",
            placeholder: "incident",
            description: "Match when the subject line contains this text.",
          },
          {
            key: "has_any_labels",
            label: "Has any Gmail labels",
            type: "csv",
            placeholder: "IMPORTANT,Label_123",
            description: "Comma-separated Gmail label ids. Matching any one label is enough.",
          },
          {
            key: "unread_only",
            label: "Unread only",
            type: "boolean",
            description: "Only trigger for messages that still carry the UNREAD label.",
          },
        ],
      },
      filterSchema: gmailIncomingEmailTriggerFilterSchema,
      eventSchema: gmailIncomingEmailTriggerEventSchema,
      supportedDeliveryModes: [
        AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.webhook,
        AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
      ],
      defaultDeliveryMode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.webhook,
      fallbackDeliveryMode: AUTOMATION_PROVIDER_TRIGGER_DELIVERY_MODE.polling,
      buildDefaultTrigger: buildIncomingEmailDefaultTrigger,
      matchesEvent: matchesIncomingEmailTrigger,
    },
  },
};
