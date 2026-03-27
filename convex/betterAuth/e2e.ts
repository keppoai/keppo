import { mutationGeneric } from "convex/server";
import { v, type GenericId } from "convex/values";

const e2eAuthTables = [
  "session",
  "account",
  "verification",
  "member",
  "invitation",
  "organization",
  "user",
  "jwks",
  "rateLimit",
  "ratelimit",
] as const;

type E2EAuthTable = (typeof e2eAuthTables)[number];

const E2E_RESET_PAGE_SIZE = 250;
type ResetPageResult = {
  page: Array<{ _id: GenericId<string> }>;
  continueCursor: string;
  isDone: boolean;
};

type BetterAuthMutationCtx = {
  db: {
    query: (table: E2EAuthTable) => {
      paginate: (options: { numItems: number; cursor: string | null }) => Promise<ResetPageResult>;
    };
  };
};

const rowContainsNamespace = (value: unknown, namespace: string): boolean => {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.includes(namespace);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => rowContainsNamespace(entry, namespace));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      rowContainsNamespace(entry, namespace),
    );
  }
  return false;
};

const queryResetPage = async (
  ctx: BetterAuthMutationCtx,
  table: E2EAuthTable,
  cursor: string | null,
) => {
  return ctx.db.query(table).paginate({
    numItems: E2E_RESET_PAGE_SIZE,
    cursor,
  });
};

export const resetAll = mutationGeneric({
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
    const tableIndex = args.tableIndex ?? 0;
    const cursor = args.cursor ?? null;
    if (tableIndex >= e2eAuthTables.length) {
      return { done: true, tableIndex, cursor: null, deleted: 0 };
    }

    const table = e2eAuthTables[tableIndex] as E2EAuthTable;
    const queryResult = await queryResetPage(ctx, table, cursor);
    let deleted = 0;

    for (const row of queryResult.page) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }

    if (!queryResult.isDone) {
      return {
        done: false,
        tableIndex,
        cursor: queryResult.continueCursor,
        deleted,
      };
    }

    if (tableIndex + 1 >= e2eAuthTables.length) {
      return { done: true, tableIndex: e2eAuthTables.length, cursor: null, deleted };
    }

    return { done: false, tableIndex: tableIndex + 1, cursor: null, deleted };
  },
});

export const resetNamespace = mutationGeneric({
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
    const tableIndex = args.tableIndex ?? 0;
    const cursor = args.cursor ?? null;
    if (tableIndex >= e2eAuthTables.length) {
      return { namespace: args.namespace, done: true, tableIndex, cursor: null, deleted: 0 };
    }

    const table = e2eAuthTables[tableIndex] as E2EAuthTable;
    const queryResult = await queryResetPage(ctx, table, cursor);
    let deleted = 0;

    for (const row of queryResult.page) {
      if (rowContainsNamespace(row, args.namespace)) {
        await ctx.db.delete(row._id);
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

    if (tableIndex + 1 >= e2eAuthTables.length) {
      return {
        namespace: args.namespace,
        done: true,
        tableIndex: e2eAuthTables.length,
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
