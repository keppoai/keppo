import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const BATCH_SIZE = 200;

export const previewBackfillProviderTriggerFields = internalQuery({
  args: {},
  returns: v.object({
    total_missing: v.number(),
    sample_ids: v.array(v.string()),
  }),
  handler: async (ctx) => {
    let cursor: string | null = null;
    let totalMissing = 0;
    const sampleIds: string[] = [];

    while (true) {
      const page = await ctx.db.query("automation_config_versions").paginate({
        cursor,
        numItems: BATCH_SIZE,
      });

      for (const doc of page.page) {
        const record = doc as Record<string, unknown>;
        if (
          record.provider_trigger === undefined ||
          record.provider_trigger_migration_state === undefined
        ) {
          totalMissing += 1;
          if (sampleIds.length < 20) {
            sampleIds.push(doc.id);
          }
        }
      }

      if (page.isDone) break;
      cursor = page.continueCursor;
    }

    return { total_missing: totalMissing, sample_ids: sampleIds };
  },
});

export const backfillProviderTriggerFields = internalMutation({
  args: {
    dryRun: v.optional(v.boolean()),
  },
  returns: v.object({
    dry_run: v.boolean(),
    patched: v.number(),
    scanned: v.number(),
  }),
  handler: async (ctx, args) => {
    const dryRun = args.dryRun ?? false;
    let cursor: string | null = null;
    let patched = 0;
    let scanned = 0;

    while (true) {
      const page = await ctx.db.query("automation_config_versions").paginate({
        cursor,
        numItems: BATCH_SIZE,
      });

      for (const doc of page.page) {
        scanned += 1;
        const record = doc as Record<string, unknown>;
        const needsProviderTrigger = record.provider_trigger === undefined;
        const needsMigrationState = record.provider_trigger_migration_state === undefined;

        if (needsProviderTrigger || needsMigrationState) {
          if (!dryRun) {
            const patch: Record<string, null> = {};
            if (needsProviderTrigger) {
              patch.provider_trigger = null;
            }
            if (needsMigrationState) {
              patch.provider_trigger_migration_state = null;
            }
            await ctx.db.patch(doc._id, patch);
          }
          patched += 1;
        }
      }

      if (page.isDone) break;
      cursor = page.continueCursor;
    }

    return { dry_run: dryRun, patched, scanned };
  },
});
