import { describe, expect, it, vi } from "vitest";
import { NOTIFICATION_CHANNEL } from "../../convex/domain_constants";
import { dismissApprovalNotificationsForAction } from "../../convex/notifications/in_app";

describe("notification in-app boundary ownership", () => {
  it("dismisses only unread in-app approval notifications for the target action", async () => {
    const rows = [
      {
        _id: "db_inapp_approval_unread",
        id: "notif_inapp_approval_unread",
        action_id: "act_target",
        event_type: "approval_needed",
        channel: NOTIFICATION_CHANNEL.inApp,
        read_at: null,
      },
      {
        _id: "db_inapp_approval_read",
        id: "notif_inapp_approval_read",
        action_id: "act_target",
        event_type: "approval_needed",
        channel: NOTIFICATION_CHANNEL.inApp,
        read_at: "2026-04-01T00:00:00.000Z",
      },
      {
        _id: "db_email_approval_unread",
        id: "notif_email_approval_unread",
        action_id: "act_target",
        event_type: "approval_needed",
        channel: NOTIFICATION_CHANNEL.email,
        read_at: null,
      },
      {
        _id: "db_inapp_usage_unread",
        id: "notif_inapp_usage_unread",
        action_id: "act_target",
        event_type: "tool_call_limit_warning",
        channel: NOTIFICATION_CHANNEL.inApp,
        read_at: null,
      },
      {
        _id: "db_other_action",
        id: "notif_inapp_other_action",
        action_id: "act_other",
        event_type: "approval_needed",
        channel: NOTIFICATION_CHANNEL.inApp,
        read_at: null,
      },
    ];
    const collect = vi.fn(async () => rows.filter((row) => row.action_id === "act_target"));
    const withIndex = vi.fn(() => ({
      collect,
    }));
    const query = vi.fn(() => ({
      withIndex,
    }));
    const patch = vi.fn();
    const ctx = {
      db: {
        query,
        patch,
      },
    } as never;

    const dismissedCount = await dismissApprovalNotificationsForAction._handler(ctx, {
      actionId: "act_target",
    });

    expect(query).toHaveBeenCalledWith("notification_events");
    expect(withIndex).toHaveBeenCalledTimes(1);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(dismissedCount).toBe(1);
    expect(patch).toHaveBeenCalledTimes(1);
    expect(patch).toHaveBeenCalledWith(
      "db_inapp_approval_unread",
      expect.objectContaining({
        read_at: expect.any(String),
      }),
    );
  });
});
