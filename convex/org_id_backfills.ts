import { v } from "convex/values";
import {
  type MutationCtx,
  type QueryCtx,
  internalMutation,
  internalQuery,
} from "./_generated/server";

const DEFAULT_BATCH_SIZE = 200;
const MAX_SAMPLE_IDS = 20;
const backfillTableValidator = v.union(
  v.literal("automation_runs"),
  v.literal("automation_trigger_events"),
);

const resolveOrgIdForAutomationRun = async (
  ctx: QueryCtx | MutationCtx,
  run: {
    automation_id?: string;
    workspace_id?: string;
  },
): Promise<string | null> => {
  if (typeof run.workspace_id === "string" && run.workspace_id.length > 0) {
    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_custom_id", (q) => q.eq("id", run.workspace_id!))
      .unique();
    if (workspace?.org_id) {
      return workspace.org_id;
    }
  }

  if (typeof run.automation_id === "string" && run.automation_id.length > 0) {
    const automation = await ctx.db
      .query("automations")
      .withIndex("by_custom_id", (q) => q.eq("id", run.automation_id!))
      .unique();
    if (automation?.org_id) {
      return automation.org_id;
    }
  }

  return null;
};

export const previewMissingOrgIds = internalQuery({
  args: {},
  returns: v.object({
    automation_runs_missing: v.number(),
    automation_trigger_events_missing: v.number(),
    unresolved_run_ids: v.array(v.string()),
    unresolved_trigger_event_ids: v.array(v.string()),
  }),
  handler: async (ctx) => {
    let automationRunsMissing = 0;
    let triggerEventsMissing = 0;
    const unresolvedRunIds: string[] = [];
    const unresolvedTriggerEventIds: string[] = [];

    let runCursor: string | null = null;
    while (true) {
      const page = await ctx.db.query("automation_runs").paginate({
        cursor: runCursor,
        numItems: DEFAULT_BATCH_SIZE,
      });
      for (const doc of page.page) {
        const record = doc as Record<string, unknown>;
        if (typeof record.org_id === "string" && record.org_id.trim().length > 0) {
          continue;
        }
        automationRunsMissing += 1;
        if (unresolvedRunIds.length >= MAX_SAMPLE_IDS) {
          continue;
        }
        const resolvedOrgId = await resolveOrgIdForAutomationRun(ctx, {
          automation_id:
            typeof record.automation_id === "string" ? record.automation_id : undefined,
          workspace_id: typeof record.workspace_id === "string" ? record.workspace_id : undefined,
        });
        if (!resolvedOrgId) {
          unresolvedRunIds.push(doc.id);
        }
      }
      if (page.isDone) {
        break;
      }
      runCursor = page.continueCursor;
    }

    let triggerCursor: string | null = null;
    while (true) {
      const page = await ctx.db.query("automation_trigger_events").paginate({
        cursor: triggerCursor,
        numItems: DEFAULT_BATCH_SIZE,
      });
      for (const doc of page.page) {
        const record = doc as Record<string, unknown>;
        if (typeof record.org_id === "string" && record.org_id.trim().length > 0) {
          continue;
        }
        triggerEventsMissing += 1;
        if (unresolvedTriggerEventIds.length >= MAX_SAMPLE_IDS) {
          continue;
        }
        const automation = await ctx.db
          .query("automations")
          .withIndex("by_custom_id", (q) => q.eq("id", doc.automation_id))
          .unique();
        if (!automation?.org_id) {
          unresolvedTriggerEventIds.push(doc.id);
        }
      }
      if (page.isDone) {
        break;
      }
      triggerCursor = page.continueCursor;
    }

    return {
      automation_runs_missing: automationRunsMissing,
      automation_trigger_events_missing: triggerEventsMissing,
      unresolved_run_ids: unresolvedRunIds,
      unresolved_trigger_event_ids: unresolvedTriggerEventIds,
    };
  },
});

export const backfillMissingOrgIds = internalMutation({
  args: {
    table: backfillTableValidator,
    cursor: v.optional(v.string()),
    batchSize: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    table: backfillTableValidator,
    cursor: v.union(v.string(), v.null()),
    done: v.boolean(),
    dry_run: v.boolean(),
    scanned: v.number(),
    patched: v.number(),
    unresolved_ids: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const cursor = args.cursor ?? null;
    const batchSize = Math.max(
      1,
      Math.min(args.batchSize ?? DEFAULT_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    );
    const dryRun = args.dryRun ?? false;
    const unresolvedIds: string[] = [];
    let scanned = 0;
    let patched = 0;

    if (args.table === "automation_runs") {
      const page = await ctx.db.query("automation_runs").paginate({
        cursor,
        numItems: batchSize,
      });

      for (const doc of page.page) {
        scanned += 1;
        const record = doc as Record<string, unknown>;
        if (typeof record.org_id === "string" && record.org_id.trim().length > 0) {
          continue;
        }
        const orgId = await resolveOrgIdForAutomationRun(ctx, {
          automation_id:
            typeof record.automation_id === "string" ? record.automation_id : undefined,
          workspace_id: typeof record.workspace_id === "string" ? record.workspace_id : undefined,
        });
        if (!orgId) {
          unresolvedIds.push(doc.id);
          continue;
        }
        if (!dryRun) {
          await ctx.db.patch(doc._id, { org_id: orgId });
        }
        patched += 1;
      }

      return {
        table: args.table,
        cursor: page.isDone ? null : page.continueCursor,
        done: page.isDone,
        dry_run: dryRun,
        scanned,
        patched,
        unresolved_ids: unresolvedIds,
      };
    }

    const page = await ctx.db.query("automation_trigger_events").paginate({
      cursor,
      numItems: batchSize,
    });

    for (const doc of page.page) {
      scanned += 1;
      const record = doc as Record<string, unknown>;
      if (typeof record.org_id === "string" && record.org_id.trim().length > 0) {
        continue;
      }
      const automation = await ctx.db
        .query("automations")
        .withIndex("by_custom_id", (q) => q.eq("id", doc.automation_id))
        .unique();
      if (!automation?.org_id) {
        unresolvedIds.push(doc.id);
        continue;
      }
      if (!dryRun) {
        await ctx.db.patch(doc._id, { org_id: automation.org_id });
      }
      patched += 1;
    }

    return {
      table: args.table,
      cursor: page.isDone ? null : page.continueCursor,
      done: page.isDone,
      dry_run: dryRun,
      scanned,
      patched,
      unresolved_ids: unresolvedIds,
    };
  },
});
