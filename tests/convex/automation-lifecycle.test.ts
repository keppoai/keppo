import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { AUTOMATION_RUN_STATUS, RUN_STATUS } from "../../convex/domain_constants";
import { createConvexTestHarness, seedAutomationFixture } from "./harness";

const refs = {
  createAutomationRun: makeFunctionReference<"mutation">("automation_runs:createAutomationRun"),
  recordAutomationRunOutcome: makeFunctionReference<"mutation">(
    "automation_runs:recordAutomationRunOutcome",
  ),
  updateAutomationRunStatus: makeFunctionReference<"mutation">(
    "automation_runs:updateAutomationRunStatus",
  ),
  reapStaleRuns: makeFunctionReference<"mutation">("automation_scheduler:reapStaleRuns"),
};

describe("convex automation lifecycle functions", () => {
  it("creates and updates automation run lifecycle transitions", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_automation_lifecycle";
    const fixture = await seedAutomationFixture(t, orgId);

    const createdRun = await t.mutation(refs.createAutomationRun, {
      automation_id: fixture.automationId,
      trigger_type: "manual",
    });
    expect(createdRun.status).toBe(AUTOMATION_RUN_STATUS.pending);

    const runningRun = await t.mutation(refs.updateAutomationRunStatus, {
      automation_run_id: createdRun.id,
      status: AUTOMATION_RUN_STATUS.running,
    });
    expect(runningRun.status).toBe(AUTOMATION_RUN_STATUS.running);

    const completedRun = await t.mutation(refs.updateAutomationRunStatus, {
      automation_run_id: createdRun.id,
      status: AUTOMATION_RUN_STATUS.succeeded,
    });
    expect(completedRun.status).toBe(AUTOMATION_RUN_STATUS.succeeded);
    expect(completedRun.ended_at).not.toBeNull();
    expect(completedRun.outcome).toMatchObject({
      success: true,
      source: "fallback_missing",
    });
  });

  it("records an automation outcome exactly once", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_automation_outcome";
    const fixture = await seedAutomationFixture(t, orgId);

    const createdRun = await t.mutation(refs.createAutomationRun, {
      automation_id: fixture.automationId,
      trigger_type: "manual",
    });

    const recorded = await t.mutation(refs.recordAutomationRunOutcome, {
      automation_run_id: createdRun.id,
      success: true,
      summary: "Reviewed the inbox and drafted a response.",
    });
    expect(recorded).toMatchObject({
      success: true,
      summary: "Reviewed the inbox and drafted a response.",
      source: "agent_recorded",
    });

    await expect(
      t.mutation(refs.recordAutomationRunOutcome, {
        automation_run_id: createdRun.id,
        success: true,
        summary: "Second attempt",
      }),
    ).rejects.toThrow("AutomationRunOutcomeAlreadyRecorded");
  });

  it("replaces a stale success outcome when the run later fails", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_automation_outcome_override";
    const fixture = await seedAutomationFixture(t, orgId);

    const createdRun = await t.mutation(refs.createAutomationRun, {
      automation_id: fixture.automationId,
      trigger_type: "manual",
    });

    await t.mutation(refs.updateAutomationRunStatus, {
      automation_run_id: createdRun.id,
      status: AUTOMATION_RUN_STATUS.running,
    });

    await t.mutation(refs.recordAutomationRunOutcome, {
      automation_run_id: createdRun.id,
      workspace_id: fixture.workspaceId,
      success: true,
      summary: "Finished the requested work and handed off for approval.",
    });

    const failedRun = await t.mutation(refs.updateAutomationRunStatus, {
      automation_run_id: createdRun.id,
      status: AUTOMATION_RUN_STATUS.timedOut,
    });

    expect(failedRun.outcome).toMatchObject({
      success: false,
      source: "fallback_missing",
      summary: "The run timed out before the automation recorded a final outcome.",
    });
  });

  it("reaps stale running runs into timed out status", async () => {
    vi.useFakeTimers();
    const t = createConvexTestHarness();
    const orgId = "org_convex_automation_reap";
    const fixture = await seedAutomationFixture(t, orgId);
    const startedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    try {
      await t.run(async (ctx) => {
        await ctx.db.insert("automation_runs", {
          id: `arun_${orgId}`,
          automation_id: fixture.automationId,
          org_id: orgId,
          workspace_id: fixture.workspaceId,
          config_version_id: fixture.configVersionId,
          trigger_type: "manual",
          error_message: null,
          sandbox_id: null,
          log_storage_id: null,
          created_at: startedAt,
          mcp_session_id: null,
          client_type: "other",
          metadata: {
            automation_run_status: AUTOMATION_RUN_STATUS.running,
            log_bytes: 0,
            log_eviction_noted: false,
          },
          started_at: startedAt,
          ended_at: null,
          status: RUN_STATUS.active,
        });
      });

      const result = await t.mutation(refs.reapStaleRuns, {
        limit: 10,
      });
      expect(result.timed_out_count).toBe(1);

      await t.finishAllScheduledFunctions(() => {
        vi.runAllTimers();
      });

      const reapedRun = await t.run((ctx) => {
        return ctx.db
          .query("automation_runs")
          .withIndex("by_custom_id", (q) => q.eq("id", `arun_${orgId}`))
          .unique();
      });

      expect(reapedRun?.status).toBe(RUN_STATUS.timedOut);
      expect(reapedRun?.metadata?.automation_run_status).toBe(AUTOMATION_RUN_STATUS.timedOut);
      expect(reapedRun?.ended_at).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("includes the forbidden lifecycle transition in the status update error", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_automation_invalid_transition";
    const fixture = await seedAutomationFixture(t, orgId);

    const createdRun = await t.mutation(refs.createAutomationRun, {
      automation_id: fixture.automationId,
      trigger_type: "manual",
    });

    await expect(
      t.mutation(refs.updateAutomationRunStatus, {
        automation_run_id: createdRun.id,
        status: AUTOMATION_RUN_STATUS.succeeded,
      }),
    ).rejects.toThrow("InvalidAutomationRunStatusTransition: pending -> succeeded");
  });
});
