import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { nowIso, randomIdFor, requireOrgMember } from "./_auth";
import {
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
  NOTIFICATION_ENDPOINT_TYPE,
  USER_ROLES,
  type NotificationChannelValue,
  type NotificationDeliveryStatus,
  type NotificationEndpointTypeValue,
  type UserRole,
  assertNever,
} from "./domain_constants";
import { pickFields } from "./field_mapper";
import {
  jsonRecordValidator,
  notificationChannelValidator,
  notificationDeliveryStatusValidator,
  notificationEndpointTypeValidator,
  notificationEventTypeValidator,
} from "./validators";
import {
  NOTIFICATION_EVENTS,
  buildNotificationPayload,
  getDefaultChannels,
  type NotificationChannel,
  type NotificationEventId,
} from "../packages/shared/src/notifications.js";
import { isJsonRecord, parseJsonValue } from "../packages/shared/src/providers/boundaries/json.js";

export { buildNotificationPayload, getDefaultChannels, NOTIFICATION_EVENTS };

export const refs = {
  deliverNotificationEvents: makeFunctionReference<"action">(
    "notifications_node:deliverNotificationEvents",
  ),
};

export type NotificationEventType = NotificationEventId;
export {
  NOTIFICATION_DELIVERY_STATUS,
  notificationChannelValidator,
  notificationEndpointTypeValidator,
  notificationEventTypeValidator,
};

export const endpointValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  user_id: v.string(),
  type: notificationEndpointTypeValidator,
  destination: v.string(),
  push_subscription: v.union(v.string(), v.null()),
  notification_preferences: v.optional(v.string()),
  enabled: v.boolean(),
  created_at: v.string(),
  delivery_warning: v.optional(
    v.object({
      recent_failure_count: v.number(),
      consecutive_failure_count: v.number(),
      last_error: v.string(),
      last_attempt_at: v.string(),
    }),
  ),
});

export const eventValidator = v.object({
  id: v.string(),
  org_id: v.string(),
  event_type: notificationEventTypeValidator,
  channel: notificationChannelValidator,
  title: v.string(),
  body: v.string(),
  cta_url: v.string(),
  cta_label: v.string(),
  metadata: v.optional(v.string()),
  action_id: v.union(v.string(), v.null()),
  endpoint_id: v.union(v.string(), v.null()),
  read_at: v.union(v.string(), v.null()),
  status: notificationDeliveryStatusValidator,
  attempts: v.number(),
  last_error: v.union(v.string(), v.null()),
  created_at: v.string(),
});

export const inAppEventViewValidator = v.object({
  id: v.string(),
  event_type: notificationEventTypeValidator,
  title: v.string(),
  body: v.string(),
  cta_url: v.string(),
  cta_label: v.string(),
  metadata: jsonRecordValidator,
  read_at: v.union(v.string(), v.null()),
  created_at: v.string(),
});

export const eventDefinitionValidator = v.object({
  id: notificationEventTypeValidator,
  title: v.string(),
  channels: v.array(notificationChannelValidator),
});

type NotificationDeliveryChannel = Exclude<NotificationChannel, typeof NOTIFICATION_CHANNEL.inApp>;

export const endpointTypeForChannel = (channel: NotificationDeliveryChannel): "email" | "push" => {
  switch (channel) {
    case NOTIFICATION_CHANNEL.email:
      return NOTIFICATION_ENDPOINT_TYPE.email;
    case NOTIFICATION_CHANNEL.push:
      return NOTIFICATION_ENDPOINT_TYPE.push;
    default:
      return assertNever(channel, "notification delivery channel");
  }
};

export const ensureSameOrgMembership = async (
  ctx: QueryCtx | MutationCtx,
  orgId: string,
  allowedRoles: readonly UserRole[] = USER_ROLES,
) => {
  const auth = await requireOrgMember(ctx, allowedRoles, {
    includeUser: false,
  });
  if (auth.orgId !== orgId) {
    throw new Error("Forbidden");
  }
  return auth;
};

const parsePreferences = (encoded: string | undefined): Record<string, boolean> => {
  if (!encoded) {
    return {};
  }
  try {
    const parsed = parseJsonValue(encoded);
    if (!isJsonRecord(parsed)) {
      return {};
    }
    const preferences: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "boolean") {
        preferences[key] = value;
      }
    }
    return preferences;
  } catch {
    return {};
  }
};

export const isEventEnabledForEndpoint = (
  endpoint: {
    type: NotificationEndpointTypeValue;
    notification_preferences?: string;
  },
  eventType: NotificationEventType,
): boolean => {
  const preferences = parsePreferences(endpoint.notification_preferences);
  const channelKey = `${endpoint.type}:${eventType}`;
  if (Object.prototype.hasOwnProperty.call(preferences, channelKey)) {
    return preferences[channelKey] ?? true;
  }
  if (Object.prototype.hasOwnProperty.call(preferences, eventType)) {
    return preferences[eventType] ?? true;
  }
  return true;
};

const parseMetadata = (encoded: string | undefined): Record<string, unknown> => {
  if (!encoded) {
    return {};
  }
  try {
    const parsed = parseJsonValue(encoded);
    if (!isJsonRecord(parsed)) {
      return {};
    }
    return parsed;
  } catch {
    return {};
  }
};

type EndpointRow = {
  id: string;
  org_id: string;
  user_id: string;
  type: NotificationEndpointTypeValue;
  destination: string;
  push_subscription: string | null;
  notification_preferences?: string;
  enabled: boolean;
  created_at: string;
};

type EndpointDeliveryWarning = {
  recent_failure_count: number;
  consecutive_failure_count: number;
  last_error: string;
  last_attempt_at: string;
};

type EventRow = {
  id: string;
  org_id: string;
  event_type: NotificationEventType;
  channel: NotificationChannelValue;
  title: string;
  body: string;
  cta_url: string;
  cta_label: string;
  metadata?: string;
  action_id: string | null;
  endpoint_id: string | null;
  read_at: string | null;
  status: NotificationDeliveryStatus;
  attempts: number;
  last_error: string | null;
  created_at: string;
};

const endpointViewFields = [
  "id",
  "org_id",
  "user_id",
  "type",
  "destination",
  "push_subscription",
  "enabled",
  "created_at",
] as const satisfies readonly (keyof EndpointRow)[];

const eventViewFields = [
  "id",
  "org_id",
  "title",
  "body",
  "cta_url",
  "cta_label",
  "action_id",
  "endpoint_id",
  "read_at",
  "status",
  "attempts",
  "last_error",
  "created_at",
] as const satisfies readonly (keyof EventRow)[];

export const toEndpointView = (
  endpoint: EndpointRow,
  warning?: EndpointDeliveryWarning | null,
) => ({
  ...pickFields(endpoint, endpointViewFields),
  ...(endpoint.notification_preferences
    ? { notification_preferences: endpoint.notification_preferences }
    : {}),
  ...(warning ? { delivery_warning: warning } : {}),
});

export const toEventView = (event: EventRow) => ({
  ...pickFields(event, eventViewFields),
  event_type: event.event_type as NotificationEventType,
  channel: event.channel as NotificationChannelValue,
  ...(event.metadata ? { metadata: event.metadata } : {}),
});

export const toInAppEventView = (event: {
  id: string;
  event_type: NotificationEventType;
  title: string;
  body: string;
  cta_url: string;
  cta_label: string;
  metadata?: string;
  read_at: string | null;
  created_at: string;
}) => ({
  id: event.id,
  event_type: event.event_type,
  title: event.title,
  body: event.body,
  cta_url: event.cta_url,
  cta_label: event.cta_label,
  metadata: parseMetadata(event.metadata) as Record<string, unknown>,
  read_at: event.read_at,
  created_at: event.created_at,
});

export const upsertEndpoint = async (
  ctx: MutationCtx,
  args: {
    orgId: string;
    userId: string;
    type: "email" | "push" | "webhook";
    destination: string;
    pushSubscription?: string;
    preferences?: Record<string, boolean>;
    enabled?: boolean;
  },
) => {
  const existing = await ctx.db
    .query("notification_endpoints")
    .withIndex("by_org_user_type", (q) =>
      q.eq("org_id", args.orgId).eq("user_id", args.userId).eq("type", args.type),
    )
    .collect();

  const destination = args.destination.trim();
  const matched =
    existing.find((row) => row.destination.toLowerCase() === destination.toLowerCase()) ?? null;

  const preferencesJson = args.preferences ? JSON.stringify(args.preferences) : undefined;

  if (matched) {
    await ctx.db.patch(matched._id, {
      destination,
      push_subscription: args.type === "push" ? (args.pushSubscription ?? null) : null,
      ...(preferencesJson ? { notification_preferences: preferencesJson } : {}),
      enabled: args.enabled ?? true,
    });
    const updated = await ctx.db
      .query("notification_endpoints")
      .withIndex("by_custom_id", (q) => q.eq("id", matched.id))
      .unique();
    if (!updated) {
      throw new Error("Failed to update endpoint");
    }
    return updated;
  }

  const id = randomIdFor("nend");
  await ctx.db.insert("notification_endpoints", {
    id,
    org_id: args.orgId,
    user_id: args.userId,
    type: args.type,
    destination,
    push_subscription: args.type === "push" ? (args.pushSubscription ?? null) : null,
    ...(preferencesJson ? { notification_preferences: preferencesJson } : {}),
    enabled: args.enabled ?? true,
    created_at: nowIso(),
  });
  const created = await ctx.db
    .query("notification_endpoints")
    .withIndex("by_custom_id", (q) => q.eq("id", id))
    .unique();
  if (!created) {
    throw new Error("Failed to create endpoint");
  }
  return created;
};
