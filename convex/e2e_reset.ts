import type { GenericId } from "convex/values";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { ACTION_STATUS } from "./domain_constants";
import { jsonRecordValidator } from "./validators";
import {
  buildResetState,
  deleteAuthResetRow,
  e2eResetAuthModels,
  e2eResetTables,
  type E2EResetTable,
  queryAuthResetPage,
  queryResetPage,
  requireE2EIdentity,
  rowContainsNamespace,
  storageIdsForResetRow,
} from "./e2e_shared";

export const reset = mutation({
  args: {
    tableIndex: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    done: v.boolean(),
    tableIndex: v.number(),
    cursor: v.union(v.string(), v.null()),
    deleted: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
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

export const resetNamespace = mutation({
  args: {
    namespace: v.string(),
    tableIndex: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({
    namespace: v.string(),
    done: v.boolean(),
    tableIndex: v.number(),
    cursor: v.union(v.string(), v.null()),
    deleted: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const tableIndex = args.tableIndex ?? 0;
    const cursor = args.cursor ?? null;
    if (tableIndex >= e2eResetTables.length) {
      const authModelIndex = tableIndex - e2eResetTables.length;
      if (authModelIndex >= e2eResetAuthModels.length) {
        return {
          namespace: args.namespace,
          done: true,
          tableIndex,
          cursor: null,
          deleted: 0,
        };
      }
      const authModel = e2eResetAuthModels[authModelIndex]!;
      const queryResult = await queryAuthResetPage(ctx, authModel, cursor);
      let deleted = 0;
      for (const row of queryResult.page) {
        if (rowContainsNamespace(row, args.namespace)) {
          await deleteAuthResetRow(ctx, authModel, row._id);
          deleted += 1;
        }
      }
      if (!queryResult.isDone) {
        return {
          namespace: args.namespace,
          done: false,
          tableIndex,
          cursor: queryResult.continueCursor,
          deleted,
        };
      }
      return {
        namespace: args.namespace,
        done: authModelIndex + 1 >= e2eResetAuthModels.length,
        tableIndex: e2eResetTables.length + authModelIndex + 1,
        cursor: null,
        deleted,
      };
    }
    let deleted = 0;
    const table = e2eResetTables[tableIndex] as E2EResetTable;
    const queryResult = await queryResetPage(ctx, table, cursor);
    for (const row of queryResult.page) {
      if (rowContainsNamespace(row, args.namespace)) {
        for (const storageId of storageIdsForResetRow(table, row)) {
          await ctx.storage.delete(storageId);
        }
        await (ctx.db.delete as (id: GenericId<string>) => Promise<void>)(row._id);
        deleted += 1;
      }
    }
    if (!queryResult.isDone) {
      return {
        namespace: args.namespace,
        done: false,
        tableIndex,
        cursor: queryResult.continueCursor,
        deleted,
      };
    }

    if (tableIndex + 1 >= e2eResetTables.length) {
      return {
        namespace: args.namespace,
        done: false,
        tableIndex: e2eResetTables.length,
        cursor: null,
        deleted,
      };
    }

    return {
      namespace: args.namespace,
      done: false,
      tableIndex: tableIndex + 1,
      cursor: null,
      deleted,
    };
  },
});

export const listPendingActionsByNamespace = query({
  args: {
    namespace: v.string(),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      status: v.string(),
      action_type: v.string(),
      payload_preview: jsonRecordValidator,
    }),
  ),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    const rows = await ctx.db
      .query("actions")
      .withIndex("by_status", (q) => q.eq("status", ACTION_STATUS.pending))
      .collect();
    return rows
      .filter((row) => rowContainsNamespace(row, args.namespace))
      .map((row) => ({
        id: row.id,
        status: row.status,
        action_type: row.action_type,
        payload_preview: row.payload_preview,
      }));
  },
});

export const countNamespaceRecords = query({
  args: {
    namespace: v.string(),
  },
  returns: v.object({
    namespace: v.string(),
    count: v.number(),
  }),
  handler: async (ctx, args) => {
    await requireE2EIdentity(ctx);
    let count = 0;
    for (const table of [
      "audit_events",
      "abuse_flags",
      "org_suspensions",
      "credential_auth_failures",
      "credential_usage_observations",
      "policy_decisions",
      "policies",
      "tool_auto_approvals",
      "cel_rule_matches",
      "cel_rules",
      "approvals",
      "actions",
      "tool_calls",
      "automation_runs",
      "integration_credentials",
      "integration_accounts",
      "integrations",
      "workspace_integrations",
      "invites",
      "code_mode_tool_index",
      "feature_flags",
      "dogfood_orgs",
      "workspace_credentials",
      "workspaces",
      "sensitive_blobs",
      "notification_events",
      "notification_endpoints",
      "poll_trackers",
      "retention_policies",
      "usage_meters",
      "subscriptions",
    ] as const) {
      const rows = await ctx.db.query(table).collect();
      count += rows.filter((row) => rowContainsNamespace(row, args.namespace)).length;
    }
    return {
      namespace: args.namespace,
      count,
    };
  },
});
