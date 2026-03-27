import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import {
  classifyErrorCode,
  isKeppoErrorCode,
  isRetryableError,
} from "../packages/shared/src/execution-errors.js";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { nowIso, randomIdFor } from "./_auth";
import {
  DEAD_LETTER_SOURCE,
  DEAD_LETTER_STATUS,
  type DeadLetterErrorCode,
  type DeadLetterSource,
  type DeadLetterStatus,
  assertNever,
} from "./domain_constants";
import {
  deadLetterErrorCodeValidator,
  deadLetterSourceTableValidator,
  deadLetterStatusValidator,
  jsonRecordValidator,
} from "./validators";
import { computeRetryDelayMs, DLQ_AUTO_RETRY_POLICY } from "./retry_policies";

const refs = {
  runMaintenanceTick: makeFunctionReference<"action">("mcp_node:runMaintenanceTick"),
  deliverNotificationEvents: makeFunctionReference<"action">(
    "notifications_node:deliverNotificationEvents",
  ),
  replayInternal: makeFunctionReference<"mutation">("dead_letter:replayInternal"),
};

const deadLetterViewValidator = v.object({
  id: v.string(),
  sourceTable: deadLetterSourceTableValidator,
  sourceId: v.string(),
  failureReason: v.string(),
  errorCode: v.union(deadLetterErrorCodeValidator, v.null()),
  payload: jsonRecordValidator,
  retryCount: v.number(),
  maxRetries: v.number(),
  lastAttemptAt: v.string(),
  status: deadLetterStatusValidator,
  createdAt: v.string(),
  updatedAt: v.string(),
});

const toDeadLetterView = (row: {
  id: string;
  source_table: DeadLetterSource;
  source_id: string;
  failure_reason: string;
  error_code?: DeadLetterErrorCode | null;
  payload: Record<string, unknown>;
  retry_count: number;
  max_retries: number;
  last_attempt_at: string;
  status: DeadLetterStatus;
  created_at: string;
  updated_at: string;
}) => ({
  id: row.id,
  sourceTable: row.source_table,
  sourceId: row.source_id,
  failureReason: row.failure_reason,
  errorCode: row.error_code ?? null,
  payload: row.payload,
  retryCount: row.retry_count,
  maxRetries: row.max_retries,
  lastAttemptAt: row.last_attempt_at,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const parseRetryCount = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value ?? fallback)) : fallback;

const resolveReplayNamespace = (payload: Record<string, unknown>): string | undefined => {
  const camel = payload.e2eNamespace;
  if (typeof camel === "string" && camel.trim().length > 0) {
    return camel.trim();
  }
  const snake = payload.e2e_namespace;
  if (typeof snake === "string" && snake.trim().length > 0) {
    return snake.trim();
  }
  return undefined;
};

const replayEntry = async (
  ctx: MutationCtx,
  row: Pick<
    Doc<"dead_letter_queue">,
    "_id" | "id" | "source_table" | "source_id" | "payload" | "retry_count" | "status"
  >,
) => {
  switch (row.source_table) {
    case DEAD_LETTER_SOURCE.notificationEvents: {
      const e2eNamespace = resolveReplayNamespace(row.payload);
      await ctx.scheduler.runAfter(0, refs.deliverNotificationEvents, {
        eventIds: [row.source_id],
        ...(e2eNamespace ? { e2eNamespace } : {}),
      });
      break;
    }
    case DEAD_LETTER_SOURCE.maintenanceTask: {
      await ctx.scheduler.runAfter(0, refs.runMaintenanceTick, {});
      break;
    }
    case DEAD_LETTER_SOURCE.fireAndForget: {
      await ctx.scheduler.runAfter(0, refs.runMaintenanceTick, {});
      break;
    }
    default: {
      return assertNever(row.source_table, "dead-letter source table");
    }
  }

  const now = nowIso();
  await ctx.db.patch(row._id as never, {
    status: DEAD_LETTER_STATUS.replayed,
    retry_count: row.retry_count + 1,
    last_attempt_at: now,
    updated_at: now,
  });

  return {
    replayed: true,
    status: DEAD_LETTER_STATUS.replayed,
  } as const;
};

export const enqueue = internalMutation({
  args: {
    sourceTable: deadLetterSourceTableValidator,
    sourceId: v.string(),
    failureReason: v.string(),
    errorCode: v.optional(deadLetterErrorCodeValidator),
    payload: v.optional(jsonRecordValidator),
    retryCount: v.optional(v.number()),
    maxRetries: v.optional(v.number()),
    lastAttemptAt: v.optional(v.string()),
  },
  returns: deadLetterViewValidator,
  handler: async (ctx, args) => {
    const now = nowIso();
    const existingBySource = await ctx.db
      .query("dead_letter_queue")
      .withIndex("by_source", (q) =>
        q.eq("source_table", args.sourceTable).eq("source_id", args.sourceId),
      )
      .take(20);
    const existingPending =
      existingBySource.find((row) => row.status === DEAD_LETTER_STATUS.pending) ?? null;
    const nextRetryCount = parseRetryCount(
      args.retryCount,
      existingPending ? existingPending.retry_count + 1 : 0,
    );
    const nextMaxRetries = Math.max(parseRetryCount(args.maxRetries, 3), nextRetryCount);
    const nextErrorCode = args.errorCode ?? classifyErrorCode(args.failureReason);

    if (existingPending) {
      await ctx.db.patch(existingPending._id, {
        failure_reason: args.failureReason,
        error_code: nextErrorCode,
        payload: args.payload ?? existingPending.payload,
        retry_count: nextRetryCount,
        max_retries: nextMaxRetries,
        last_attempt_at: args.lastAttemptAt ?? now,
        updated_at: now,
      });
      const refreshed = await ctx.db.get(existingPending._id);
      if (!refreshed) {
        throw new Error("Dead-letter record disappeared while updating.");
      }
      return toDeadLetterView(refreshed);
    }

    const id = randomIdFor("dlq");
    await ctx.db.insert("dead_letter_queue", {
      id,
      source_table: args.sourceTable,
      source_id: args.sourceId,
      failure_reason: args.failureReason,
      error_code: nextErrorCode,
      payload: args.payload ?? {},
      retry_count: nextRetryCount,
      max_retries: nextMaxRetries,
      last_attempt_at: args.lastAttemptAt ?? now,
      status: DEAD_LETTER_STATUS.pending,
      created_at: now,
      updated_at: now,
    });
    const created = await ctx.db
      .query("dead_letter_queue")
      .withIndex("by_custom_id", (q) => q.eq("id", id))
      .unique();
    if (!created) {
      throw new Error("Failed to create dead-letter record.");
    }
    return toDeadLetterView(created);
  },
});

export const listPending = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.array(deadLetterViewValidator),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 50)));
    const rows = await ctx.db
      .query("dead_letter_queue")
      .withIndex("by_status_created", (q) => q.eq("status", DEAD_LETTER_STATUS.pending))
      .take(limit);
    return rows.map((row) => toDeadLetterView(row));
  },
});

export const replay = internalMutation({
  args: {
    dlqId: v.string(),
  },
  returns: v.object({
    replayed: v.boolean(),
    status: deadLetterStatusValidator,
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("dead_letter_queue")
      .withIndex("by_custom_id", (q) => q.eq("id", args.dlqId))
      .unique();
    if (!row) {
      throw new Error("Dead-letter record not found.");
    }
    if (row.status !== DEAD_LETTER_STATUS.pending) {
      return {
        replayed: false,
        status: row.status,
      };
    }

    return replayEntry(ctx, row);
  },
});

export const replayInternal = internalMutation({
  args: {
    dlqId: v.string(),
  },
  returns: v.object({
    replayed: v.boolean(),
    status: deadLetterStatusValidator,
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("dead_letter_queue")
      .withIndex("by_custom_id", (q) => q.eq("id", args.dlqId))
      .unique();
    if (!row) {
      throw new Error("Dead-letter record not found.");
    }
    if (row.status !== DEAD_LETTER_STATUS.pending && row.status !== DEAD_LETTER_STATUS.retrying) {
      return {
        replayed: false,
        status: row.status,
      };
    }
    return replayEntry(ctx, row);
  },
});

export const autoRetryTransientEntries = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.object({
    scanned: v.number(),
    scheduled: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(20, Math.floor(args.limit ?? 20)));
    const rows = await ctx.db
      .query("dead_letter_queue")
      .withIndex("by_status_created", (q) => q.eq("status", DEAD_LETTER_STATUS.pending))
      .take(limit);

    let scheduled = 0;
    let skipped = 0;

    for (const row of rows) {
      if (row.retry_count >= row.max_retries) {
        skipped += 1;
        continue;
      }

      const errorCode = isKeppoErrorCode(row.error_code)
        ? row.error_code
        : classifyErrorCode(row.failure_reason);
      if (!isRetryableError(errorCode)) {
        skipped += 1;
        continue;
      }

      const delayMs = computeRetryDelayMs({
        policy: DLQ_AUTO_RETRY_POLICY,
        attemptNumber: row.retry_count + 1,
        seed: row.id,
      });
      const now = nowIso();

      await ctx.db.patch(row._id, {
        status: DEAD_LETTER_STATUS.retrying,
        error_code: errorCode,
        last_attempt_at: now,
        updated_at: now,
      });
      await ctx.scheduler.runAfter(delayMs, refs.replayInternal, {
        dlqId: row.id,
      });
      scheduled += 1;
    }

    return {
      scanned: rows.length,
      scheduled,
      skipped,
    };
  },
});

export const abandon = internalMutation({
  args: {
    dlqId: v.string(),
  },
  returns: v.object({
    abandoned: v.boolean(),
    status: deadLetterStatusValidator,
  }),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("dead_letter_queue")
      .withIndex("by_custom_id", (q) => q.eq("id", args.dlqId))
      .unique();
    if (!row) {
      throw new Error("Dead-letter record not found.");
    }
    if (row.status === DEAD_LETTER_STATUS.abandoned) {
      return {
        abandoned: false,
        status: row.status,
      };
    }

    const now = nowIso();
    await ctx.db.patch(row._id, {
      status: DEAD_LETTER_STATUS.abandoned,
      updated_at: now,
    });
    return {
      abandoned: true,
      status: DEAD_LETTER_STATUS.abandoned,
    };
  },
});
