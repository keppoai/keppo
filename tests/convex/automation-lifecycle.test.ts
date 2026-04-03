import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { AUTOMATION_RUN_STATUS, RUN_STATUS } from "../../convex/domain_constants";
import { MCP_CREDENTIAL_AUTH_STATUS } from "../../packages/shared/src/mcp-auth.js";
import { createConvexTestHarness, seedAutomationFixture } from "./harness";

const refs = {
  authenticateCredential: makeFunctionReference<"mutation">("mcp:authenticateCredential"),
  createAutomationRun: makeFunctionReference<"mutation">("automation_runs:createAutomationRun"),
  issueAutomationWorkspaceCredential: makeFunctionReference<"mutation">(
    "workspaces:issueAutomationWorkspaceCredential",
  ),
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

  it("replaces a fallback outcome when the agent records the real final result later", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_automation_outcome_fallback_upgrade";
    const fixture = await seedAutomationFixture(t, orgId);

    const createdRun = await t.mutation(refs.createAutomationRun, {
      automation_id: fixture.automationId,
      trigger_type: "manual",
    });

    await t.mutation(refs.updateAutomationRunStatus, {
      automation_run_id: createdRun.id,
      status: AUTOMATION_RUN_STATUS.running,
    });

    await t.mutation(refs.updateAutomationRunStatus, {
      automation_run_id: createdRun.id,
      status: AUTOMATION_RUN_STATUS.succeeded,
    });

    const recorded = await t.mutation(refs.recordAutomationRunOutcome, {
      automation_run_id: createdRun.id,
      workspace_id: fixture.workspaceId,
      success: true,
      summary: "Located the Gmail send-email tool and recorded the automation outcome.",
    });

    expect(recorded).toMatchObject({
      success: true,
      source: "agent_recorded",
      summary: "Located the Gmail send-email tool and recorded the automation outcome.",
    });
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

  it("does not let a later success outcome overwrite a timed-out fallback outcome", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_automation_outcome_invalid_success_upgrade";
    const fixture = await seedAutomationFixture(t, orgId);

    const createdRun = await t.mutation(refs.createAutomationRun, {
      automation_id: fixture.automationId,
      trigger_type: "manual",
    });

    await t.mutation(refs.updateAutomationRunStatus, {
      automation_run_id: createdRun.id,
      status: AUTOMATION_RUN_STATUS.running,
    });

    const timedOutRun = await t.mutation(refs.updateAutomationRunStatus, {
      automation_run_id: createdRun.id,
      status: AUTOMATION_RUN_STATUS.timedOut,
    });

    expect(timedOutRun.outcome).toMatchObject({
      success: false,
      source: "fallback_missing",
    });

    await expect(
      t.mutation(refs.recordAutomationRunOutcome, {
        automation_run_id: createdRun.id,
        workspace_id: fixture.workspaceId,
        success: true,
        summary: "Finished successfully despite the timeout.",
      }),
    ).rejects.toThrow("AutomationRunOutcomeAlreadyRecorded");
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

  it("revokes automation-issued workspace credentials when a run reaches a terminal state", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_automation_credential_revoke";
    const fixture = await seedAutomationFixture(t, orgId);

    const createdRun = await t.mutation(refs.createAutomationRun, {
      automation_id: fixture.automationId,
      trigger_type: "manual",
    });
    await t.mutation(refs.issueAutomationWorkspaceCredential, {
      workspaceId: fixture.workspaceId,
      automationRunId: createdRun.id,
    });

    const activeCredential = await t.run((ctx) =>
      ctx.db
        .query("workspace_credentials")
        .withIndex("by_workspace", (q) => q.eq("workspace_id", fixture.workspaceId))
        .collect()
        .then(
          (rows) =>
            rows.find(
              (row) =>
                row.revoked_at === null &&
                typeof row.metadata?.automation_run_id === "string" &&
                row.metadata.automation_run_id === createdRun.id,
            ) ?? null,
        ),
    );
    expect(activeCredential).not.toBeNull();

    await t.mutation(refs.updateAutomationRunStatus, {
      automation_run_id: createdRun.id,
      status: AUTOMATION_RUN_STATUS.cancelled,
      error_message: "Cancelled during credential lifetime regression test",
    });

    const revokedCredential = await t.run((ctx) =>
      ctx.db
        .query("workspace_credentials")
        .withIndex("by_custom_id", (q) => q.eq("id", activeCredential!.id))
        .unique(),
    );
    expect(revokedCredential?.revoked_at).not.toBeNull();
  });

  it("rejects automation-issued credentials after the owning run becomes terminal", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_automation_credential_auth";
    const fixture = await seedAutomationFixture(t, orgId);

    const createdRun = await t.mutation(refs.createAutomationRun, {
      automation_id: fixture.automationId,
      trigger_type: "manual",
    });
    const issued = await t.mutation(refs.issueAutomationWorkspaceCredential, {
      workspaceId: fixture.workspaceId,
      automationRunId: createdRun.id,
    });

    const initialAuth = await t.mutation(refs.authenticateCredential, {
      workspaceId: fixture.workspaceId,
      secret: issued.credential_secret,
    });
    expect(initialAuth).toMatchObject({
      status: MCP_CREDENTIAL_AUTH_STATUS.ok,
      automation_run_id: createdRun.id,
    });

    await t.mutation(refs.updateAutomationRunStatus, {
      automation_run_id: createdRun.id,
      status: AUTOMATION_RUN_STATUS.running,
    });

    await t.mutation(refs.updateAutomationRunStatus, {
      automation_run_id: createdRun.id,
      status: AUTOMATION_RUN_STATUS.succeeded,
    });

    const terminalAuth = await t.mutation(refs.authenticateCredential, {
      workspaceId: fixture.workspaceId,
      secret: issued.credential_secret,
    });
    expect(terminalAuth).toBeNull();
  });
});
