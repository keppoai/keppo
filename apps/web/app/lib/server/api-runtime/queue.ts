import { parseApprovedActionDispatchRequest } from "@keppo/shared/providers/boundaries/error-boundary";
import type { ApprovedActionDispatchRequest } from "@keppo/shared/providers/boundaries/types";
import { logger } from "./logger.js";

export type ApprovedActionEnqueuePayload = ApprovedActionDispatchRequest;

export type QueueHealthResult = {
  ok: boolean;
  mode: "convex";
  detail: Record<string, unknown>;
};

export interface QueueClient {
  enqueueApprovedAction(payload: ApprovedActionEnqueuePayload): Promise<{ messageId: string }>;
  checkHealth(): Promise<QueueHealthResult>;
}

type ConvexQueueDeps = {
  scheduleApprovedAction: (params: {
    actionId: string;
    source?: string;
  }) => Promise<{ dispatched: boolean; reason: string; messageId?: string | undefined }>;
  probeConvexHealth: () => Promise<{ checkedAt: string; featureFlagSampleSize: number }>;
};

const parseEnqueuePayload = (payload: ApprovedActionEnqueuePayload): ApprovedActionEnqueuePayload =>
  parseApprovedActionDispatchRequest(payload);

class ConvexQueueClient implements QueueClient {
  constructor(private readonly convex: ConvexQueueDeps) {}

  async enqueueApprovedAction(
    payload: ApprovedActionEnqueuePayload,
  ): Promise<{ messageId: string }> {
    const parsedPayload = parseEnqueuePayload(payload);
    const scheduled = await this.convex.scheduleApprovedAction({
      actionId: parsedPayload.actionId,
      ...(typeof parsedPayload.metadata?.source === "string" && {
        source: parsedPayload.metadata.source,
      }),
    });
    if (!scheduled.dispatched || !scheduled.messageId) {
      throw new Error(`approved_action_schedule_failed: ${scheduled.reason}`);
    }
    return { messageId: scheduled.messageId };
  }

  async checkHealth(): Promise<QueueHealthResult> {
    try {
      const probe = await this.convex.probeConvexHealth();
      return {
        ok: true,
        mode: "convex",
        detail: {
          checkedAt: probe.checkedAt,
          featureFlagSampleSize: probe.featureFlagSampleSize,
        },
      };
    } catch (error) {
      return {
        ok: false,
        mode: "convex",
        detail: {
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}

export const createQueueClient = (convex: ConvexQueueDeps | null | undefined): QueueClient => {
  if (!convex) {
    logger.warn("queue.convex_client_missing", {});
    return {
      enqueueApprovedAction: async () => {
        throw new Error("approved_action_schedule_failed: convex client unavailable");
      },
      checkHealth: async () => ({
        ok: false,
        mode: "convex",
        detail: {
          error: "convex_client_unavailable",
        },
      }),
    };
  }

  return new ConvexQueueClient(convex);
};
