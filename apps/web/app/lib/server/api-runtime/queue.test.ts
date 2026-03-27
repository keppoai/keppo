import { describe, expect, it, vi } from "vitest";
import { createQueueClient } from "./queue.js";

describe("createQueueClient", () => {
  it("schedules approved actions through Convex", async () => {
    const scheduleApprovedAction = vi.fn().mockResolvedValue({
      dispatched: true,
      reason: "scheduled",
      messageId: "job_123",
    });
    const queueClient = createQueueClient({
      scheduleApprovedAction,
      probeConvexHealth: vi.fn().mockResolvedValue({
        checkedAt: "2026-03-01T00:00:00.000Z",
        featureFlagSampleSize: 0,
      }),
    });

    const result = await queueClient.enqueueApprovedAction({
      actionId: "act_123",
      workspaceId: "ws_123",
      idempotencyKey: "idem_123",
      requestedAt: "2026-03-01T00:00:00.000Z",
      metadata: {
        source: "cron_sweep",
      },
    });

    expect(result).toEqual({ messageId: "job_123" });
    expect(scheduleApprovedAction).toHaveBeenCalledWith({
      actionId: "act_123",
      source: "cron_sweep",
    });
  });

  it("fails closed when Convex refuses to schedule", async () => {
    const queueClient = createQueueClient({
      scheduleApprovedAction: vi.fn().mockResolvedValue({
        dispatched: false,
        reason: "action_status_failed",
      }),
      probeConvexHealth: vi.fn().mockResolvedValue({
        checkedAt: "2026-03-01T00:00:00.000Z",
        featureFlagSampleSize: 0,
      }),
    });

    await expect(
      queueClient.enqueueApprovedAction({
        actionId: "act_123",
        workspaceId: "ws_123",
        idempotencyKey: "idem_123",
        requestedAt: "2026-03-01T00:00:00.000Z",
      }),
    ).rejects.toThrow("approved_action_schedule_failed: action_status_failed");
  });
});
