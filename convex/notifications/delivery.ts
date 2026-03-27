import { v } from "convex/values";
import { components } from "../_generated/api";
import { internalMutation, internalQuery } from "../_generated/server";
import { nowIso, randomIdFor } from "../_auth";
import {
  DEAD_LETTER_SOURCE,
  DEAD_LETTER_STATUS,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
  type NotificationDeliveryStatus,
  assertNever,
} from "../domain_constants";
import { classifyErrorCode } from "../error_codes";
import {
  endpointTypeForChannel,
  endpointValidator,
  eventValidator,
  isEventEnabledForEndpoint,
  notificationChannelValidator,
  notificationEventTypeValidator,
  refs,
  toEndpointView,
  toEventView,
  buildNotificationPayload,
  getDefaultChannels,
} from "../notifications_shared";
import { computeRetryDelayMs, NOTIFICATION_DELIVERY_RETRY_POLICY } from "../retry_policies";
import { jsonRecordValidator, notificationDeliveryStatusValidator } from "../validators";

export const createNotificationEvent = internalMutation({
  args: {
    orgId: v.string(),
    eventType: notificationEventTypeValidator,
    channel: notificationChannelValidator,
    title: v.string(),
    body: v.string(),
    ctaUrl: v.string(),
    ctaLabel: v.string(),
    metadata: v.optional(v.string()),
    actionId: v.optional(v.string()),
    endpointId: v.optional(v.string()),
  },
  returns: eventValidator,
  handler: async (ctx, args) => {
    const id = randomIdFor("nev");
    const now = nowIso();
    await ctx.db.insert("notification_events", {
      id,
      org_id: args.orgId,
      event_type: args.eventType,
      channel: args.channel,
      title: args.title,
      body: args.body,
      cta_url: args.ctaUrl,
      cta_label: args.ctaLabel,
      ...(args.metadata ? { metadata: args.metadata } : {}),
      action_id: args.actionId ?? null,
      endpoint_id: args.endpointId ?? null,
      read_at: null,
      status:
        args.channel === NOTIFICATION_CHANNEL.inApp
          ? NOTIFICATION_DELIVERY_STATUS.sent
          : NOTIFICATION_DELIVERY_STATUS.pending,
      attempts: 0,
      last_error: null,
      created_at: now,
    });

    const created = await ctx.db
      .query("notification_events")
      .withIndex("by_custom_id", (q) => q.eq("id", id))
      .unique();
    if (!created) {
      throw new Error("Failed to create notification event");
    }

    return toEventView(created);
  },
});

export const emitNotificationForOrg = internalMutation({
  args: {
    orgId: v.string(),
    eventType: notificationEventTypeValidator,
    context: v.optional(jsonRecordValidator),
    metadata: v.optional(jsonRecordValidator),
    actionId: v.optional(v.string()),
    ctaUrl: v.optional(v.string()),
    ctaLabel: v.optional(v.string()),
  },
  returns: v.object({
    created: v.number(),
    queued: v.number(),
  }),
  handler: async (ctx, args) => {
    const org = await ctx.runQuery(components.betterAuth.queries.getOrgById, {
      orgId: args.orgId,
    });

    const context = {
      orgId: args.orgId,
      orgName: org?.name ?? args.orgId,
      ...args.context,
      ...(args.ctaUrl ? { ctaUrl: args.ctaUrl } : {}),
      ...(args.ctaLabel ? { ctaLabel: args.ctaLabel } : {}),
    };
    const rendered = buildNotificationPayload(args.eventType, {
      ...context,
      metadata: args.metadata ?? {},
    });

    const channels = getDefaultChannels(args.eventType);
    const metadataJson = JSON.stringify(rendered.metadata);

    let createdCount = 0;
    const queuedEventIds: string[] = [];

    for (const channel of channels) {
      switch (channel) {
        case NOTIFICATION_CHANNEL.inApp: {
          const eventId = randomIdFor("nev");
          await ctx.db.insert("notification_events", {
            id: eventId,
            org_id: args.orgId,
            event_type: args.eventType,
            channel,
            title: rendered.title,
            body: rendered.body,
            cta_url: rendered.ctaUrl,
            cta_label: rendered.ctaLabel,
            metadata: metadataJson,
            action_id: args.actionId ?? null,
            endpoint_id: null,
            read_at: null,
            status: NOTIFICATION_DELIVERY_STATUS.sent,
            attempts: 0,
            last_error: null,
            created_at: nowIso(),
          });
          createdCount += 1;
          continue;
        }
        case NOTIFICATION_CHANNEL.email:
        case NOTIFICATION_CHANNEL.push: {
          const endpointType = endpointTypeForChannel(channel);
          const endpoints = await ctx.db
            .query("notification_endpoints")
            .withIndex("by_org_type", (q) => q.eq("org_id", args.orgId).eq("type", endpointType))
            .collect();

          for (const endpoint of endpoints) {
            if (!endpoint.enabled || !isEventEnabledForEndpoint(endpoint, args.eventType)) {
              continue;
            }

            if (channel === NOTIFICATION_CHANNEL.push && !endpoint.push_subscription) {
              continue;
            }

            const eventId = randomIdFor("nev");
            await ctx.db.insert("notification_events", {
              id: eventId,
              org_id: args.orgId,
              event_type: args.eventType,
              channel,
              title: rendered.title,
              body: rendered.body,
              cta_url: rendered.ctaUrl,
              cta_label: rendered.ctaLabel,
              metadata: metadataJson,
              action_id: args.actionId ?? null,
              endpoint_id: endpoint.id,
              read_at: null,
              status: NOTIFICATION_DELIVERY_STATUS.pending,
              attempts: 0,
              last_error: null,
              created_at: nowIso(),
            });
            createdCount += 1;
            queuedEventIds.push(eventId);
          }
          continue;
        }
        default:
          assertNever(channel, "notification event channel");
      }
    }

    if (queuedEventIds.length > 0) {
      const namespaceFromMetadata = args.metadata?.e2e_namespace;
      await ctx.scheduler.runAfter(0, refs.deliverNotificationEvents, {
        eventIds: queuedEventIds,
        ...(typeof namespaceFromMetadata === "string"
          ? { e2eNamespace: namespaceFromMetadata }
          : {}),
      });
    }

    return {
      created: createdCount,
      queued: queuedEventIds.length,
    };
  },
});

export const markEventSent = internalMutation({
  args: {
    eventId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("notification_events")
      .withIndex("by_custom_id", (q) => q.eq("id", args.eventId))
      .unique();
    if (!event) {
      return null;
    }

    await ctx.db.patch(event._id, {
      status: NOTIFICATION_DELIVERY_STATUS.sent,
      attempts: event.attempts + 1,
      last_error: null,
    });

    return null;
  },
});

export const markEventFailed = internalMutation({
  args: {
    eventId: v.string(),
    error: v.string(),
    retryable: v.optional(v.boolean()),
    deadLetterPayload: v.optional(jsonRecordValidator),
  },
  returns: v.object({
    attempts: v.number(),
    shouldRetry: v.boolean(),
    status: notificationDeliveryStatusValidator,
    retryAfterMs: v.union(v.number(), v.null()),
    maxRetries: v.number(),
  }),
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("notification_events")
      .withIndex("by_custom_id", (q) => q.eq("id", args.eventId))
      .unique();
    if (!event) {
      return {
        attempts: 0,
        shouldRetry: false,
        status: NOTIFICATION_DELIVERY_STATUS.failed,
        retryAfterMs: null,
        maxRetries: NOTIFICATION_DELIVERY_RETRY_POLICY.maxRetries,
      };
    }

    const nextAttempts = event.attempts + 1;
    const shouldRetry =
      (args.retryable ?? true) && nextAttempts < NOTIFICATION_DELIVERY_RETRY_POLICY.maxRetries;
    const status: NotificationDeliveryStatus = shouldRetry
      ? NOTIFICATION_DELIVERY_STATUS.pending
      : NOTIFICATION_DELIVERY_STATUS.failed;
    const retryAfterMs = shouldRetry
      ? computeRetryDelayMs({
          policy: NOTIFICATION_DELIVERY_RETRY_POLICY,
          attemptNumber: nextAttempts,
          seed: `${event.id}:${nextAttempts}`,
        })
      : null;

    await ctx.db.patch(event._id, {
      attempts: nextAttempts,
      status,
      last_error: args.error,
    });

    if (!shouldRetry) {
      const now = nowIso();
      const sourceTable = DEAD_LETTER_SOURCE.notificationEvents;
      const sourceId = event.id;
      const payload = {
        eventId: event.id,
        eventType: event.event_type,
        channel: event.channel,
        orgId: event.org_id,
        ...(event.endpoint_id ? { endpointId: event.endpoint_id } : {}),
        ...args.deadLetterPayload,
      };
      const existingBySource = await ctx.db
        .query("dead_letter_queue")
        .withIndex("by_source", (q) => q.eq("source_table", sourceTable).eq("source_id", sourceId))
        .take(20);
      const existingPending =
        existingBySource.find((row) => row.status === DEAD_LETTER_STATUS.pending) ?? null;

      if (existingPending) {
        await ctx.db.patch(existingPending._id, {
          failure_reason: args.error,
          error_code: classifyErrorCode(args.error),
          payload,
          retry_count: Math.max(existingPending.retry_count + 1, nextAttempts),
          max_retries: Math.max(
            existingPending.max_retries,
            NOTIFICATION_DELIVERY_RETRY_POLICY.maxRetries,
          ),
          last_attempt_at: now,
          updated_at: now,
        });
      } else {
        await ctx.db.insert("dead_letter_queue", {
          id: randomIdFor("dlq"),
          source_table: sourceTable,
          source_id: sourceId,
          failure_reason: args.error,
          error_code: classifyErrorCode(args.error),
          payload,
          retry_count: nextAttempts,
          max_retries: NOTIFICATION_DELIVERY_RETRY_POLICY.maxRetries,
          last_attempt_at: now,
          status: DEAD_LETTER_STATUS.pending,
          created_at: now,
          updated_at: now,
        });
      }
    }

    return {
      attempts: nextAttempts,
      shouldRetry,
      status,
      retryAfterMs,
      maxRetries: NOTIFICATION_DELIVERY_RETRY_POLICY.maxRetries,
    };
  },
});

export const getPendingDeliveries = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(eventValidator),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
    const rows = await ctx.db
      .query("notification_events")
      .withIndex("by_status_created", (q) => q.eq("status", NOTIFICATION_DELIVERY_STATUS.pending))
      .take(limit * 2);

    return rows
      .filter(
        (row) =>
          row.channel === NOTIFICATION_CHANNEL.email || row.channel === NOTIFICATION_CHANNEL.push,
      )
      .slice(0, limit)
      .map((row) => toEventView(row));
  },
});

export const getDeliveryEvent = internalQuery({
  args: {
    eventId: v.string(),
  },
  returns: v.union(
    v.object({
      event: eventValidator,
      endpoint: v.union(endpointValidator, v.null()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const event = await ctx.db
      .query("notification_events")
      .withIndex("by_custom_id", (q) => q.eq("id", args.eventId))
      .unique();
    if (!event) {
      return null;
    }

    const endpoint =
      event.endpoint_id === null
        ? null
        : await ctx.db
            .query("notification_endpoints")
            .withIndex("by_custom_id", (q) => q.eq("id", event.endpoint_id ?? ""))
            .unique();

    return {
      event: toEventView(event),
      endpoint: endpoint ? toEndpointView(endpoint) : null,
    };
  },
});

export const disableEndpoint = internalMutation({
  args: {
    endpointId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const endpoint = await ctx.db
      .query("notification_endpoints")
      .withIndex("by_custom_id", (q) => q.eq("id", args.endpointId))
      .unique();
    if (!endpoint) {
      return null;
    }
    await ctx.db.patch(endpoint._id, {
      enabled: false,
    });
    return null;
  },
});
