import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import {
  buildResetState,
  deleteAuthResetRow,
  e2eResetAuthModels,
  e2eResetTables,
  type E2EResetTable,
  queryResetPage,
  queryAuthResetPage,
  storageIdsForResetRow,
} from "./e2e_shared";

const dangerousDropStateValidator = v.object({
  done: v.boolean(),
  tableIndex: v.number(),
  cursor: v.union(v.string(), v.null()),
  deleted: v.number(),
});

type DangerousDropState = {
  done: boolean;
  tableIndex: number;
  cursor: string | null;
  deleted: number;
};

export const dangerouslyDropAllTablesPage = internalMutation({
  args: {
    confirm: v.literal("DELETE_ALL_DATA"),
    tableIndex: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: dangerousDropStateValidator,
  handler: async (ctx, args) => {
    if (process.env.KEPPO_ALLOW_DANGEROUS_DROP_ALL !== "true") {
      throw new Error(
        "DANGEROUS_DROP_DISABLED: Set KEPPO_ALLOW_DANGEROUS_DROP_ALL=true in Convex environment variables.",
      );
    }
    const tableIndex = args.tableIndex ?? 0;
    const cursor = args.cursor ?? null;
    if (tableIndex >= e2eResetTables.length) {
      const authModelIndex = tableIndex - e2eResetTables.length;
      if (authModelIndex >= e2eResetAuthModels.length) {
        return buildResetState({
          done: true,
          tableIndex,
          cursor: null,
          deleted: 0,
        });
      }

      const authModel = e2eResetAuthModels[authModelIndex]!;
      const queryResult = await queryAuthResetPage(ctx, authModel, cursor);
      let deleted = 0;
      for (const row of queryResult.page) {
        await deleteAuthResetRow(ctx, authModel, row._id);
        deleted += 1;
      }
      if (!queryResult.isDone) {
        return buildResetState({
          done: false,
          tableIndex,
          cursor: queryResult.continueCursor,
          deleted,
        });
      }

      return buildResetState({
        done: authModelIndex + 1 >= e2eResetAuthModels.length,
        tableIndex: e2eResetTables.length + authModelIndex + 1,
        cursor: null,
        deleted,
      });
    }

    const table = e2eResetTables[tableIndex] as E2EResetTable;
    const queryResult = await queryResetPage(ctx, table, cursor);
    let deleted = 0;
    for (const row of queryResult.page) {
      for (const storageId of storageIdsForResetRow(table, row)) {
        await ctx.storage.delete(storageId);
      }
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    if (!queryResult.isDone) {
      return buildResetState({
        done: false,
        tableIndex,
        cursor: queryResult.continueCursor,
        deleted,
      });
    }

    if (tableIndex + 1 >= e2eResetTables.length) {
      return buildResetState({
        done: false,
        tableIndex: e2eResetTables.length,
        cursor: null,
        deleted,
      });
    }

    return buildResetState({
      done: false,
      tableIndex: tableIndex + 1,
      cursor: null,
      deleted,
    });
  },
});

/**
 * Deletes every document in all app-schema tables (`e2eResetTables`), then clears
 * Better Auth component tables. Internal-only — run from the Convex dashboard or CLI.
 * This action batches work across multiple mutation transactions to stay under
 * per-function read limits on larger deployments.
 *
 * Requires `confirm: "DELETE_ALL_DATA"`. Opt-in via Convex env
 * `KEPPO_ALLOW_DANGEROUS_DROP_ALL=true`. Purges any Convex file storage referenced
 * by deleted app rows, but does not enumerate unrelated orphaned `_storage` objects.
 */
export const dangerouslyDropAllTables = internalAction({
  args: {
    confirm: v.literal("DELETE_ALL_DATA"),
  },
  returns: v.object({
    deleted: v.number(),
  }),
  handler: async (ctx, args) => {
    if (process.env.KEPPO_ALLOW_DANGEROUS_DROP_ALL !== "true") {
      throw new Error(
        "DANGEROUS_DROP_DISABLED: Set KEPPO_ALLOW_DANGEROUS_DROP_ALL=true in Convex environment variables.",
      );
    }

    let deleted = 0;
    let tableIndex = 0;
    let cursor: string | null = null;
    while (true) {
      const result: DangerousDropState = await ctx.runMutation(
        internal.dangerous_admin.dangerouslyDropAllTablesPage,
        {
          confirm: args.confirm,
          tableIndex,
          cursor,
        },
      );
      deleted += result.deleted;
      if (result.done) {
        break;
      }
      tableIndex = result.tableIndex;
      cursor = result.cursor;
    }

    return { deleted };
  },
});
