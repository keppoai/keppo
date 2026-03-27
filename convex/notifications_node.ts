"use node";

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalAction, type ActionCtx } from "./_generated/server";

const NOTIFICATION_DELIVERY_PATH = "/internal/notifications/deliver";
const DEFAULT_E2E_PORT_BASE = 9900;
const DEFAULT_E2E_PORT_BLOCK_SIZE = 20;
const DEFAULT_E2E_API_PORT_OFFSET = 2;
const DEFAULT_RETRY_DELAY_MS = 10_000;
const MIN_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

const refs = {
  markEventFailed: makeFunctionReference<"mutation">("notifications:markEventFailed"),
  deliverNotificationEvents: makeFunctionReference<"action">(
    "notifications_node:deliverNotificationEvents",
  ),
};

const resolveNamespaceApiBase = (namespace?: string): string | null => {
  if (!namespace) {
    return null;
  }
  const segments = namespace.split(".");
  if (segments.length < 4) {
    return null;
  }
  const workerIndex = Number(segments[1]);
  if (!Number.isInteger(workerIndex) || workerIndex < 0) {
    return null;
  }
  const basePort = Number.parseInt(process.env.KEPPO_E2E_PORT_BASE ?? "", 10);
  const blockSize = Number.parseInt(process.env.KEPPO_E2E_PORT_BLOCK_SIZE ?? "", 10);
  const safeBase =
    Number.isInteger(basePort) && basePort >= 1024 ? basePort : DEFAULT_E2E_PORT_BASE;
  const safeBlockSize =
    Number.isInteger(blockSize) && blockSize >= 5 ? blockSize : DEFAULT_E2E_PORT_BLOCK_SIZE;
  const apiPort = safeBase + workerIndex * safeBlockSize + DEFAULT_E2E_API_PORT_OFFSET;
  return `http://127.0.0.1:${apiPort}`;
};

const resolveDeliveryUrl = (namespace?: string): string | null => {
  const explicitUrl = process.env.KEPPO_NOTIFICATIONS_DELIVERY_URL?.trim();
  if (explicitUrl) {
    return explicitUrl;
  }
  const explicitBase = process.env.KEPPO_API_INTERNAL_BASE_URL?.trim();
  if (explicitBase) {
    return `${explicitBase.replace(/\/+$/, "")}${NOTIFICATION_DELIVERY_PATH}`;
  }
  const namespaceBase = resolveNamespaceApiBase(namespace);
  if (namespaceBase) {
    return `${namespaceBase}${NOTIFICATION_DELIVERY_PATH}`;
  }
  return null;
};

const resolveInternalAuthHeader = (): string | null => {
  const secret =
    process.env.KEPPO_CRON_SECRET ??
    process.env.KEPPO_QUEUE_SECRET ??
    process.env.VERCEL_CRON_SECRET;
  if (!secret) {
    return null;
  }
  const trimmed = secret.trim();
  return trimmed.length > 0 ? `Bearer ${trimmed}` : null;
};

const clampRetryDelayMs = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_RETRY_DELAY_MS;
  }
  return Math.max(MIN_RETRY_DELAY_MS, Math.min(MAX_RETRY_DELAY_MS, Math.floor(value)));
};

type RetryJob = {
  eventId: string;
  retryAfterMs: number;
};

const parseRetryJobs = (payload: unknown): RetryJob[] => {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return [];
  }

  const retryJobs = (payload as { retryJobs?: unknown }).retryJobs;
  if (Array.isArray(retryJobs)) {
    const parsedJobs: RetryJob[] = [];
    for (const item of retryJobs) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const eventId = (item as { eventId?: unknown }).eventId;
      if (typeof eventId !== "string" || eventId.trim().length === 0) {
        continue;
      }
      parsedJobs.push({
        eventId,
        retryAfterMs: clampRetryDelayMs((item as { retryAfterMs?: unknown }).retryAfterMs),
      });
    }
    if (parsedJobs.length > 0) {
      return parsedJobs;
    }
  }

  const retryEventIds = (payload as { retryEventIds?: unknown }).retryEventIds;
  if (!Array.isArray(retryEventIds)) {
    return [];
  }
  return retryEventIds
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((eventId) => ({
      eventId,
      retryAfterMs: DEFAULT_RETRY_DELAY_MS,
    }));
};

const groupRetryJobsByDelay = (jobs: RetryJob[]): Map<number, string[]> => {
  const grouped = new Map<number, string[]>();
  for (const job of jobs) {
    const existing = grouped.get(job.retryAfterMs);
    if (existing) {
      if (!existing.includes(job.eventId)) {
        existing.push(job.eventId);
      }
      continue;
    }
    grouped.set(job.retryAfterMs, [job.eventId]);
  }
  return grouped;
};

const markBatchFailed = async (
  ctx: ActionCtx,
  eventIds: string[],
  error: string,
  e2eNamespace?: string,
) => {
  for (const eventId of eventIds) {
    await ctx.runMutation(refs.markEventFailed, {
      eventId,
      error,
      retryable: true,
      ...(e2eNamespace ? { deadLetterPayload: { e2eNamespace } } : {}),
    });
  }
};

export const deliverNotificationEvents = internalAction({
  args: {
    eventIds: v.array(v.string()),
    e2eNamespace: v.optional(v.string()),
  },
  returns: v.object({
    attempted: v.number(),
    queuedForRetry: v.number(),
    skipped: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (args.eventIds.length === 0) {
      return {
        attempted: 0,
        queuedForRetry: 0,
        skipped: true,
      };
    }

    const deliveryUrl = resolveDeliveryUrl(args.e2eNamespace);
    if (!deliveryUrl) {
      await markBatchFailed(
        ctx,
        args.eventIds,
        "Notification delivery URL is not configured",
        args.e2eNamespace,
      );
      return {
        attempted: args.eventIds.length,
        queuedForRetry: 0,
        skipped: true,
      };
    }

    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    const authHeader = resolveInternalAuthHeader();
    if (authHeader) {
      headers.authorization = authHeader;
    }
    if (args.e2eNamespace) {
      headers["x-keppo-e2e-namespace"] = args.e2eNamespace;
    }

    let response: Response;
    try {
      response = await fetch(deliveryUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({ eventIds: args.eventIds }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await markBatchFailed(
        ctx,
        args.eventIds,
        `Notification delivery request failed: ${message}`,
        args.e2eNamespace,
      );
      return {
        attempted: args.eventIds.length,
        queuedForRetry: 0,
        skipped: false,
      };
    }

    if (!response.ok) {
      const body = await response.text();
      await markBatchFailed(
        ctx,
        args.eventIds,
        `Notification delivery endpoint failed (${response.status}): ${body.slice(0, 500)}`,
        args.e2eNamespace,
      );
      return {
        attempted: args.eventIds.length,
        queuedForRetry: 0,
        skipped: false,
      };
    }

    let queuedForRetry = 0;
    try {
      const retryJobs = parseRetryJobs(await response.json());
      if (retryJobs.length > 0) {
        const retryGroups = groupRetryJobsByDelay(retryJobs);
        for (const [retryAfterMs, eventIds] of retryGroups.entries()) {
          queuedForRetry += eventIds.length;
          await ctx.scheduler.runAfter(retryAfterMs, refs.deliverNotificationEvents, {
            eventIds,
            ...(args.e2eNamespace ? { e2eNamespace: args.e2eNamespace } : {}),
          });
        }
      }
    } catch {
      // Best effort; retry scheduling is optional when API response is malformed.
    }

    return {
      attempted: args.eventIds.length,
      queuedForRetry,
      skipped: false,
    };
  },
});
