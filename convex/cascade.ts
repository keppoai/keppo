import type { Id, TableNames } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const CASCADE_BATCH_SIZE = 64;

type CascadeDoc = {
  _id: Id<TableNames>;
};

const deleteRowsInBatches = async <TRow extends CascadeDoc>(
  ctx: MutationCtx,
  loadBatch: (limit: number) => Promise<ReadonlyArray<TRow>>,
): Promise<number> => {
  let deleted = 0;
  for (;;) {
    const batch = await loadBatch(CASCADE_BATCH_SIZE);
    if (batch.length === 0) {
      break;
    }
    for (const row of batch) {
      await ctx.db.delete(row._id);
      deleted += 1;
    }
    if (batch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }
  return deleted;
};

export const cascadeDeleteAutomationDescendants = async (
  ctx: MutationCtx,
  automationId: string,
): Promise<void> => {
  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("automation_trigger_events")
      .withIndex("by_automation", (q) => q.eq("automation_id", automationId))
      .take(limit),
  );

  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("automation_config_versions")
      .withIndex("by_automation", (q) => q.eq("automation_id", automationId))
      .take(limit),
  );

  for (;;) {
    const runBatch = await ctx.db
      .query("automation_runs")
      .withIndex("by_automation", (q) => q.eq("automation_id", automationId))
      .take(CASCADE_BATCH_SIZE);
    if (runBatch.length === 0) {
      break;
    }

    for (const run of runBatch) {
      await deleteRowsInBatches(ctx, (limit) =>
        ctx.db
          .query("automation_run_logs")
          .withIndex("by_run_seq", (q) => q.eq("automation_run_id", run.id))
          .take(limit),
      );

      for (;;) {
        const actionBatch = await ctx.db
          .query("actions")
          .withIndex("by_automation_run", (q) => q.eq("automation_run_id", run.id))
          .take(CASCADE_BATCH_SIZE);
        if (actionBatch.length === 0) {
          break;
        }
        for (const action of actionBatch) {
          await deleteRowsInBatches(ctx, (limit) =>
            ctx.db
              .query("approvals")
              .withIndex("by_action", (q) => q.eq("action_id", action.id))
              .take(limit),
          );
          await deleteRowsInBatches(ctx, (limit) =>
            ctx.db
              .query("policy_decisions")
              .withIndex("by_action", (q) => q.eq("action_id", action.id))
              .take(limit),
          );
          await deleteRowsInBatches(ctx, (limit) =>
            ctx.db
              .query("cel_rule_matches")
              .withIndex("by_action", (q) => q.eq("action_id", action.id))
              .take(limit),
          );
          await ctx.db.delete(action._id);
        }
        if (actionBatch.length < CASCADE_BATCH_SIZE) {
          break;
        }
      }

      await deleteRowsInBatches(ctx, (limit) =>
        ctx.db
          .query("tool_calls")
          .withIndex("by_automation_run", (q) => q.eq("automation_run_id", run.id))
          .take(limit),
      );

      await deleteRowsInBatches(ctx, (limit) =>
        ctx.db
          .query("sensitive_blobs")
          .withIndex("by_ref_table_ref_id", (q) =>
            q.eq("ref_table", "automation_runs").eq("ref_id", run.id),
          )
          .take(limit),
      );

      await ctx.db.delete(run._id);
    }

    if (runBatch.length < CASCADE_BATCH_SIZE) {
      break;
    }
  }
};

export const cascadeDeleteCelRuleDescendants = async (
  ctx: MutationCtx,
  ruleId: string,
): Promise<void> => {
  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("cel_rule_matches")
      .withIndex("by_cel_rule", (q) => q.eq("cel_rule_id", ruleId))
      .take(limit),
  );
};

export const cascadeDeleteNotificationEndpointDescendants = async (
  ctx: MutationCtx,
  endpointId: string,
): Promise<void> => {
  await deleteRowsInBatches(ctx, (limit) =>
    ctx.db
      .query("notification_events")
      .withIndex("by_endpoint", (q) => q.eq("endpoint_id", endpointId))
      .take(limit),
  );
};
