import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { components } from "../../convex/_generated/api";
import {
  DEAD_LETTER_STATUS,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
} from "../../convex/domain_constants";
import { createConvexTestHarness } from "./harness";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  autoRetryTransientEntries: makeFunctionReference<"mutation">(
    "dead_letter:autoRetryTransientEntries",
  ),
  createNotificationEvent: makeFunctionReference<"mutation">(
    "notifications:createNotificationEvent",
  ),
  dismissApprovalNotificationsForAction: makeFunctionReference<"mutation">(
    "notifications:dismissApprovalNotificationsForAction",
  ),
  registerEndpoint: makeFunctionReference<"mutation">("notifications/endpoints:registerEndpoint"),
  listEndpoints: makeFunctionReference<"query">("notifications/endpoints:listEndpoints"),
  toggleEndpoint: makeFunctionReference<"mutation">("notifications/endpoints:toggleEndpoint"),
  setEndpointPreferences: makeFunctionReference<"mutation">(
    "notifications/endpoints:setEndpointPreferences",
  ),
  removeEndpoint: makeFunctionReference<"mutation">("notifications/endpoints:removeEndpoint"),
  markEventSent: makeFunctionReference<"mutation">("notifications:markEventSent"),
  markEventFailed: makeFunctionReference<"mutation">("notifications:markEventFailed"),
};

describe("convex notification delivery functions", () => {
  it("registers, updates, and removes owned notification endpoints", async () => {
    const t = createConvexTestHarness();
    const userId = "usr_notification_endpoints";
    const email = "notification-endpoints@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId,
      email,
      name: "Notification Endpoints",
    });
    const authUserId = await t.run(async (ctx) => {
      const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: email }],
      })) as { _id?: string } | null;
      return user?._id ?? null;
    });
    expect(authUserId).toBeTruthy();

    const authT = t.withIdentity({
      subject: authUserId!,
      email,
      name: "Notification Endpoints",
      activeOrganizationId: orgId,
    });

    const created = await authT.mutation(refs.registerEndpoint, {
      orgId,
      type: "push",
      destination: "https://push.example.test/subscription",
      pushSubscription: JSON.stringify({
        endpoint: "https://push.example.test/subscription",
        expirationTime: null,
        keys: {
          p256dh: "fake-p256dh",
          auth: "fake-auth",
        },
      }),
      preferences: {
        approval_needed: true,
      },
    });
    expect(created.type).toBe("push");
    expect(created.enabled).toBe(true);
    expect(created.destination).toBe("https://push.example.test/subscription");

    const listed = await authT.query(refs.listEndpoints, { orgId });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    const disabled = await authT.mutation(refs.toggleEndpoint, {
      endpointId: created.id,
      enabled: false,
    });
    expect(disabled.enabled).toBe(false);

    const updatedPreferences = await authT.mutation(refs.setEndpointPreferences, {
      endpointId: created.id,
      preferences: {
        approval_needed: false,
        tool_call_limit_warning: true,
      },
    });
    expect(JSON.parse(updatedPreferences.notification_preferences ?? "{}")).toMatchObject({
      approval_needed: false,
      tool_call_limit_warning: true,
    });

    await authT.mutation(refs.removeEndpoint, {
      endpointId: created.id,
    });
    await expect(authT.query(refs.listEndpoints, { orgId })).resolves.toEqual([]);
  });

  it("surfaces repeated endpoint delivery failures in the endpoint view", async () => {
    const t = createConvexTestHarness();
    const userId = "usr_notification_warning";
    const email = "notification-warning@example.com";
    const orgId = await t.mutation(refs.seedUserOrg, {
      userId,
      email,
      name: "Notification Warning",
    });
    const authUserId = await t.run(async (ctx) => {
      const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: email }],
      })) as { _id?: string } | null;
      return user?._id ?? null;
    });
    expect(authUserId).toBeTruthy();

    const authT = t.withIdentity({
      subject: authUserId!,
      email,
      name: "Notification Warning",
      activeOrganizationId: orgId,
    });

    const endpoint = await authT.mutation(refs.registerEndpoint, {
      orgId,
      type: "email",
      destination: email,
    });

    const firstEvent = await t.mutation(refs.createNotificationEvent, {
      orgId,
      eventType: "approval_needed",
      channel: NOTIFICATION_CHANNEL.email,
      title: "Approval required",
      body: "Attempt one",
      ctaUrl: "https://dashboard.example.test/actions",
      ctaLabel: "Review",
      endpointId: endpoint.id,
    });
    await t.mutation(refs.markEventFailed, {
      eventId: firstEvent.id,
      error: "smtp mailbox rejected recipient",
      retryable: false,
    });

    const secondEvent = await t.mutation(refs.createNotificationEvent, {
      orgId,
      eventType: "approval_needed",
      channel: NOTIFICATION_CHANNEL.email,
      title: "Approval required",
      body: "Attempt two",
      ctaUrl: "https://dashboard.example.test/actions",
      ctaLabel: "Review",
      endpointId: endpoint.id,
    });
    await t.mutation(refs.markEventFailed, {
      eventId: secondEvent.id,
      error: "smtp mailbox rejected recipient",
      retryable: false,
    });

    const listed = await authT.query(refs.listEndpoints, { orgId });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.delivery_warning).toMatchObject({
      recent_failure_count: 2,
      consecutive_failure_count: 2,
      last_error: "smtp mailbox rejected recipient",
    });
  });

  it("creates events and transitions through sent and failed lifecycle states", async () => {
    const t = createConvexTestHarness();

    const created = await t.mutation(refs.createNotificationEvent, {
      orgId: "org_convex_notifications",
      eventType: "approval_needed",
      channel: NOTIFICATION_CHANNEL.email,
      title: "Approval required",
      body: "A pending action requires approval.",
      ctaUrl: "https://dashboard.example.test/actions",
      ctaLabel: "Review",
      metadata: JSON.stringify({ source: "convex-test" }),
      actionId: "action_convex_notifications",
      endpointId: "endpoint_convex_notifications",
    });

    expect(created.status).toBe(NOTIFICATION_DELIVERY_STATUS.pending);

    await t.mutation(refs.markEventSent, { eventId: created.id });

    const sent = await t.run((ctx) => {
      return ctx.db
        .query("notification_events")
        .withIndex("by_custom_id", (q) => q.eq("id", created.id))
        .unique();
    });
    expect(sent?.status).toBe(NOTIFICATION_DELIVERY_STATUS.sent);
    expect(sent?.attempts).toBe(1);

    const failed = await t.mutation(refs.markEventFailed, {
      eventId: created.id,
      error: "smtp unavailable",
      retryable: false,
      deadLetterPayload: {
        source: "convex-test",
      },
    });

    expect(failed.shouldRetry).toBe(false);
    expect(failed.status).toBe(NOTIFICATION_DELIVERY_STATUS.failed);

    const deadLetterRows = await t.run((ctx) => {
      return ctx.db
        .query("dead_letter_queue")
        .withIndex("by_source", (q) =>
          q.eq("source_table", "notification_events").eq("source_id", created.id),
        )
        .collect();
    });
    expect(deadLetterRows).toHaveLength(1);
    expect(deadLetterRows[0]?.status).toBe("pending");
  });

  it("dismisses only unread in-app approval notifications for the action", async () => {
    const t = createConvexTestHarness();

    await t.run(async (ctx) => {
      const rows = [
        {
          id: "notif_inapp_approval_unread",
          event_type: "approval_needed" as const,
          channel: NOTIFICATION_CHANNEL.inApp,
          action_id: "act_dismiss_target",
          read_at: null,
        },
        {
          id: "notif_inapp_approval_other_action",
          event_type: "approval_needed" as const,
          channel: NOTIFICATION_CHANNEL.inApp,
          action_id: "act_other",
          read_at: null,
        },
        {
          id: "notif_email_approval_target",
          event_type: "approval_needed" as const,
          channel: NOTIFICATION_CHANNEL.email,
          action_id: "act_dismiss_target",
          read_at: null,
        },
        {
          id: "notif_inapp_usage_target",
          event_type: "tool_call_limit_warning" as const,
          channel: NOTIFICATION_CHANNEL.inApp,
          action_id: "act_dismiss_target",
          read_at: null,
        },
        {
          id: "notif_inapp_approval_read",
          event_type: "approval_needed" as const,
          channel: NOTIFICATION_CHANNEL.inApp,
          action_id: "act_dismiss_target",
          read_at: "2026-04-01T00:00:00.000Z",
        },
      ];

      for (const row of rows) {
        await ctx.db.insert("notification_events", {
          id: row.id,
          org_id: "org_convex_notifications_dismissal",
          event_type: row.event_type,
          channel: row.channel,
          title: row.id,
          body: "Notification body",
          cta_url: "/approvals",
          cta_label: "Review",
          metadata: JSON.stringify({ source: "convex-test" }),
          action_id: row.action_id,
          endpoint_id: row.channel === NOTIFICATION_CHANNEL.email ? "endpoint_email" : null,
          read_at: row.read_at,
          status:
            row.channel === NOTIFICATION_CHANNEL.inApp
              ? NOTIFICATION_DELIVERY_STATUS.sent
              : NOTIFICATION_DELIVERY_STATUS.pending,
          attempts: 0,
          last_error: null,
          created_at: "2026-04-01T00:00:00.000Z",
        });
      }
    });

    await expect(
      t.mutation(refs.dismissApprovalNotificationsForAction, {
        actionId: "act_dismiss_target",
      }),
    ).resolves.toBe(1);

    const events = await t.run((ctx) =>
      ctx.db
        .query("notification_events")
        .withIndex("by_action", (q) => q.eq("action_id", "act_dismiss_target"))
        .collect(),
    );

    const byId = Object.fromEntries(events.map((event) => [event.id, event]));
    expect(byId["notif_inapp_approval_unread"]?.read_at).toBeTruthy();
    expect(byId["notif_email_approval_target"]?.read_at).toBeNull();
    expect(byId["notif_inapp_usage_target"]?.read_at).toBeNull();
    expect(byId["notif_inapp_approval_read"]?.read_at).toBe("2026-04-01T00:00:00.000Z");

    const otherAction = await t.run((ctx) =>
      ctx.db
        .query("notification_events")
        .withIndex("by_custom_id", (q) => q.eq("id", "notif_inapp_approval_other_action"))
        .unique(),
    );
    expect(otherAction?.read_at).toBeNull();
  });

  it("auto-retries transient dead-letter entries and replays them", async () => {
    vi.useFakeTimers();
    try {
      const t = createConvexTestHarness();

      const created = await t.mutation(refs.createNotificationEvent, {
        orgId: "org_convex_notifications_retry",
        eventType: "approval_needed",
        channel: NOTIFICATION_CHANNEL.email,
        title: "Approval required",
        body: "Retry me.",
        ctaUrl: "https://dashboard.example.test/actions",
        ctaLabel: "Review",
        metadata: JSON.stringify({
          source: "convex-test",
          e2e_namespace: "convex-retry",
        }),
        actionId: "action_convex_notifications_retry",
        endpointId: "endpoint_convex_notifications_retry",
      });

      await t.mutation(refs.markEventFailed, {
        eventId: created.id,
        error: "503 upstream unavailable",
        retryable: false,
        deadLetterPayload: {
          source: "convex-test",
          e2e_namespace: "convex-retry",
        },
      });

      const result = await t.mutation(refs.autoRetryTransientEntries, {
        limit: 20,
      });
      expect(result).toEqual({ scanned: 1, scheduled: 1, skipped: 0 });

      const retryingRow = await t.run((ctx) =>
        ctx.db
          .query("dead_letter_queue")
          .withIndex("by_source", (q) =>
            q.eq("source_table", "notification_events").eq("source_id", created.id),
          )
          .unique(),
      );
      expect(retryingRow?.status).toBe(DEAD_LETTER_STATUS.retrying);

      await t.finishAllScheduledFunctions(() => {
        vi.runAllTimers();
      });

      const replayedRow = await t.run((ctx) =>
        ctx.db
          .query("dead_letter_queue")
          .withIndex("by_source", (q) =>
            q.eq("source_table", "notification_events").eq("source_id", created.id),
          )
          .unique(),
      );
      expect(replayedRow?.status).toBe(DEAD_LETTER_STATUS.replayed);
      expect(replayedRow?.retry_count).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves non-retryable dead-letter entries pending", async () => {
    const t = createConvexTestHarness();

    const created = await t.mutation(refs.createNotificationEvent, {
      orgId: "org_convex_notifications_auth",
      eventType: "approval_needed",
      channel: NOTIFICATION_CHANNEL.email,
      title: "Approval required",
      body: "Do not retry me.",
      ctaUrl: "https://dashboard.example.test/actions",
      ctaLabel: "Review",
      metadata: JSON.stringify({ source: "convex-test" }),
      actionId: "action_convex_notifications_auth",
      endpointId: "endpoint_convex_notifications_auth",
    });

    await t.mutation(refs.markEventFailed, {
      eventId: created.id,
      error: "credential revoked by provider admin",
      retryable: false,
      deadLetterPayload: {
        source: "convex-test",
      },
    });

    const result = await t.mutation(refs.autoRetryTransientEntries, {
      limit: 20,
    });
    expect(result).toEqual({ scanned: 1, scheduled: 0, skipped: 1 });

    const pendingRow = await t.run((ctx) =>
      ctx.db
        .query("dead_letter_queue")
        .withIndex("by_source", (q) =>
          q.eq("source_table", "notification_events").eq("source_id", created.id),
        )
        .unique(),
    );
    expect(pendingRow?.status).toBe(DEAD_LETTER_STATUS.pending);
    expect(pendingRow?.retry_count).toBe(1);
  });
});
