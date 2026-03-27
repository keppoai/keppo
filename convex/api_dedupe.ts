import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { nowIso, randomIdFor } from "./_auth";
import { API_DEDUPE_STATUS, type ApiDedupeScope, type ApiDedupeStatus } from "./domain_constants";
import {
  apiDedupeScopeValidator,
  apiDedupeStatusValidator,
  jsonRecordValidator,
} from "./validators";

const dedupePayloadValidator = v.union(jsonRecordValidator, v.null());
type DedupeDoc = Doc<"api_dedupe_keys">;

const pickActiveRecord = (rows: DedupeDoc[], nowMs: number): DedupeDoc | null => {
  let active: DedupeDoc | null = null;
  for (const row of rows) {
    if (row.expires_at <= nowMs) {
      continue;
    }
    if (
      !active ||
      row.expires_at > active.expires_at ||
      (row.expires_at === active.expires_at && row._creationTime > active._creationTime)
    ) {
      active = row;
    }
  }
  return active;
};

const readScopeRows = async (
  ctx: QueryCtx | MutationCtx,
  scope: ApiDedupeScope,
  dedupeKey: string,
): Promise<DedupeDoc[]> => {
  return await ctx.db
    .query("api_dedupe_keys")
    .withIndex("by_scope_key", (q) => q.eq("scope", scope).eq("dedupe_key", dedupeKey))
    .collect();
};

const cleanupAndPickActive = async (
  ctx: MutationCtx,
  scope: ApiDedupeScope,
  dedupeKey: string,
  nowMs: number,
): Promise<DedupeDoc | null> => {
  const rows = await readScopeRows(ctx, scope, dedupeKey);
  let active: DedupeDoc | null = null;
  for (const row of rows) {
    if (row.expires_at <= nowMs) {
      await ctx.db.delete(row._id);
      continue;
    }
    if (
      !active ||
      row.expires_at > active.expires_at ||
      (row.expires_at === active.expires_at && row._creationTime > active._creationTime)
    ) {
      if (active) {
        await ctx.db.delete(active._id);
      }
      active = row;
      continue;
    }
    await ctx.db.delete(row._id);
  }
  return active;
};

export const getApiDedupeKey = internalQuery({
  args: {
    scope: apiDedupeScopeValidator,
    dedupeKey: v.string(),
  },
  returns: v.union(
    v.object({
      status: apiDedupeStatusValidator,
      payload: dedupePayloadValidator,
      expiresAtMs: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const active = pickActiveRecord(
      await readScopeRows(ctx, args.scope, args.dedupeKey),
      Date.now(),
    );
    if (!active) {
      return null;
    }
    return {
      status: active.status,
      payload: active.payload,
      expiresAtMs: active.expires_at,
    };
  },
});

export const claimApiDedupeKey = internalMutation({
  args: {
    scope: apiDedupeScopeValidator,
    dedupeKey: v.string(),
    ttlMs: v.number(),
    initialStatus: v.optional(apiDedupeStatusValidator),
  },
  returns: v.object({
    claimed: v.boolean(),
    status: apiDedupeStatusValidator,
    payload: dedupePayloadValidator,
    expiresAtMs: v.number(),
  }),
  handler: async (ctx, args) => {
    const nowMs = Date.now();
    const active = await cleanupAndPickActive(ctx, args.scope, args.dedupeKey, nowMs);
    if (active) {
      return {
        claimed: false,
        status: active.status,
        payload: active.payload,
        expiresAtMs: active.expires_at,
      };
    }

    const ttlMs = Math.max(1, Math.floor(args.ttlMs));
    const status: ApiDedupeStatus = args.initialStatus ?? API_DEDUPE_STATUS.completed;
    const expiresAtMs = nowMs + ttlMs;
    const completedAt = status === API_DEDUPE_STATUS.completed ? nowIso() : null;
    await ctx.db.insert("api_dedupe_keys", {
      id: randomIdFor("dedupe"),
      scope: args.scope,
      dedupe_key: args.dedupeKey,
      status,
      payload: null,
      created_at: nowIso(),
      completed_at: completedAt,
      expires_at: expiresAtMs,
    });
    return {
      claimed: true,
      status,
      payload: null,
      expiresAtMs,
    };
  },
});

export const setApiDedupePayload = internalMutation({
  args: {
    scope: apiDedupeScopeValidator,
    dedupeKey: v.string(),
    payload: jsonRecordValidator,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const active = await cleanupAndPickActive(ctx, args.scope, args.dedupeKey, Date.now());
    if (!active) {
      return false;
    }
    await ctx.db.patch(active._id, {
      payload: args.payload,
    });
    return true;
  },
});

export const completeApiDedupeKey = internalMutation({
  args: {
    scope: apiDedupeScopeValidator,
    dedupeKey: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const active = await cleanupAndPickActive(ctx, args.scope, args.dedupeKey, Date.now());
    if (!active) {
      return false;
    }
    await ctx.db.patch(active._id, {
      status: API_DEDUPE_STATUS.completed,
      payload: null,
      completed_at: nowIso(),
    });
    return true;
  },
});

export const releaseApiDedupeKey = internalMutation({
  args: {
    scope: apiDedupeScopeValidator,
    dedupeKey: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const rows = await readScopeRows(ctx, args.scope, args.dedupeKey);
    if (rows.length === 0) {
      return false;
    }
    for (const row of rows) {
      await ctx.db.delete(row._id);
    }
    return true;
  },
});

export const purgeExpiredApiDedupeKeys = internalMutation({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.object({
    deleted: v.number(),
  }),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(1_000, Math.floor(args.limit ?? 250)));
    const nowMs = Date.now();
    const expired = await ctx.db
      .query("api_dedupe_keys")
      .withIndex("by_expires", (q) => q.lt("expires_at", nowMs + 1))
      .take(limit);
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }
    return { deleted: expired.length };
  },
});
