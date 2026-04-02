import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import {
  evictAutomationRunLogRows,
  MAX_AUTOMATION_RUN_LOG_BATCH_LINES,
} from "../../convex/automation_runs_shared";
import { AUTOMATION_RUN_STATUS, RUN_STATUS } from "../../convex/domain_constants";
import { createConvexTestHarness, seedAutomationFixture } from "./harness";

const refs = {
  appendAutomationRunLogBatch: makeFunctionReference<"mutation">(
    "automation_runs:appendAutomationRunLogBatch",
  ),
};

describe("automation run log helpers", () => {
  it("keeps fetching eviction rows until enough bytes are freed", async () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      seq: index + 1,
      content: "12345678",
    }));
    const deleteRow = vi.fn(async () => undefined);
    const loadRows = vi.fn(async (afterSeqExclusive: number | null, take: number) =>
      rows
        .filter((row) => (afterSeqExclusive === null ? true : row.seq > afterSeqExclusive))
        .slice(0, take),
    );

    const result = await evictAutomationRunLogRows({
      bytesToFree: 800,
      loadRows,
      deleteRow,
    });

    expect(loadRows).toHaveBeenCalledTimes(2);
    expect(loadRows).toHaveBeenNthCalledWith(1, null, 50);
    expect(loadRows).toHaveBeenNthCalledWith(2, 50, 50);
    expect(deleteRow).toHaveBeenCalledTimes(100);
    expect(result).toEqual({
      deletedRowCount: 100,
      freedBytes: 800,
      remainingBytesToFree: 0,
    });
  });

  it("rejects oversized log batches at the mutation boundary", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_automation_log_batch_limit";
    const fixture = await seedAutomationFixture(t, orgId);
    const createdAt = "2026-04-02T00:00:00.000Z";
    const automationRunId = `arun_${orgId}`;

    await t.run(async (ctx) => {
      await ctx.db.insert("automation_runs", {
        id: automationRunId,
        automation_id: fixture.automationId,
        org_id: orgId,
        workspace_id: fixture.workspaceId,
        config_version_id: fixture.configVersionId,
        trigger_type: "manual",
        error_message: null,
        sandbox_id: null,
        log_storage_id: null,
        created_at: createdAt,
        mcp_session_id: null,
        client_type: "other",
        metadata: {
          automation_run_status: AUTOMATION_RUN_STATUS.running,
          log_bytes: 0,
          log_eviction_noted: false,
        },
        started_at: createdAt,
        ended_at: null,
        status: RUN_STATUS.active,
      });
    });

    await expect(
      t.mutation(refs.appendAutomationRunLogBatch, {
        automation_run_id: automationRunId,
        lines: Array.from({ length: MAX_AUTOMATION_RUN_LOG_BATCH_LINES + 1 }, () => ({
          level: "stdout" as const,
          content: "line",
        })),
      }),
    ).rejects.toThrow("AutomationRunLogBatchTooLarge");
  });
});
