import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { components } from "../../convex/_generated/api";
import {
  AUTOMATION_RUN_STATUS,
  DEFAULT_ACTION_BEHAVIOR,
  POLICY_MODE,
  RUN_STATUS,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TIER,
  WORKSPACE_STATUS,
} from "../../convex/domain_constants";
import { getTierConfig, getDefaultBillingPeriod } from "../../packages/shared/src/subscriptions.js";
import { MCP_CREDENTIAL_AUTH_STATUS } from "../../packages/shared/src/mcp-auth.js";
import { getAutomationRunTopupBalanceForOrg } from "../../convex/automation_run_topups";
import { createConvexTestHarness, seedAutomationFixture } from "./harness";

const refs = {
  addPurchasedAutomationRuns: makeFunctionReference<"mutation">(
    "automation_run_topups:addPurchasedAutomationRuns",
  ),
  authenticateCredential: makeFunctionReference<"mutation">("mcp:authenticateCredential"),
  createAutomation: makeFunctionReference<"mutation">("automations:createAutomation"),
  createAutomationRun: makeFunctionReference<"mutation">("automation_runs:createAutomationRun"),
  issueAutomationWorkspaceCredential: makeFunctionReference<"mutation">(
    "workspaces:issueAutomationWorkspaceCredential",
  ),
  recordAutomationRunOutcome: makeFunctionReference<"mutation">(
    "automation_runs:recordAutomationRunOutcome",
  ),
  recordAutomationRunTrace: makeFunctionReference<"mutation">(
    "automation_runs:recordAutomationRunTrace",
  ),
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  upsertSubscriptionForOrg: makeFunctionReference<"mutation">(
    "billing/subscriptions:upsertSubscriptionForOrg",
  ),
  updateAutomationRunStatus: makeFunctionReference<"mutation">(
    "automation_runs:updateAutomationRunStatus",
  ),
  updateAutomationStatus: makeFunctionReference<"mutation">("automations:updateAutomationStatus"),
  reapStaleRuns: makeFunctionReference<"mutation">("automation_scheduler:reapStaleRuns"),
};

const createAuthenticatedAutomationHarness = async (label: string) => {
  const t = createConvexTestHarness();
  const userId = `usr_${label}`;
  const email = `${label}@example.com`;
  const orgId = await t.mutation(refs.seedUserOrg, {
    userId,
    email,
    name: `Test ${label}`,
  });
  const authUserId = await t.run(async (ctx) => {
    const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "email", value: email }],
    })) as { _id?: string } | null;
    return user?._id ?? null;
  });
  expect(authUserId).toBeTruthy();

  const authT = t.withIdentity({
    subject: authUserId!,
    email,
    name: `Test ${label}`,
    activeOrganizationId: orgId,
  });
  const workspaceId = `workspace_${label}`;
  const now = new Date().toISOString();

  await t.run(async (ctx) => {
    await ctx.db.insert("subscriptions", {
      id: `sub_${label}`,
      org_id: orgId,
      tier: SUBSCRIPTION_TIER.free,
      status: SUBSCRIPTION_STATUS.active,
      stripe_customer_id: null,
      stripe_subscription_id: null,
      workspace_count: 0,
      current_period_start: now,
      current_period_end: new Date(Date.now() + 60_000).toISOString(),
      created_at: now,
      updated_at: now,
    });

    await ctx.db.insert("workspaces", {
      id: workspaceId,
      org_id: orgId,
      slug: `workspace-${label}`,
      name: `Workspace ${label}`,
      status: WORKSPACE_STATUS.active,
      policy_mode: POLICY_MODE.manualOnly,
      default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
      code_mode_enabled: true,
      created_at: now,
      automation_count: 0,
    });

    await ctx.db.insert("org_ai_keys", {
      id: `oaik_${label}`,
      org_id: orgId,
      provider: "openai",
      key_mode: "byok",
      encrypted_key: "keppo-v1.fakeiv.fakecipher",
      credential_kind: "secret",
      key_hint: "...test",
      key_version: 1,
      is_active: true,
      subject_email: null,
      account_id: null,
      token_expires_at: null,
      last_refreshed_at: null,
      last_validated_at: now,
      created_by: userId,
      created_at: now,
      updated_at: now,
    });
  });

  const created = await authT.mutation(refs.createAutomation, {
    workspace_id: workspaceId,
    name: `Automation ${label}`,
    description: "Regression fixture",
    trigger_type: "manual",
    runner_type: "chatgpt_codex",
    ai_model_provider: "openai",
    ai_model_name: "gpt-5",
    prompt: "Regression fixture prompt",
    network_access: "mcp_only",
  });

  return {
    t,
    authT,
    automationId: created.automation.id,
    configVersionId: created.automation.current_config_version_id,
  };
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

  it("pauses an automation by cancelling every active run beyond the first scan batch", async () => {
    const { t, authT, automationId, configVersionId } = await createAuthenticatedAutomationHarness(
      "automation_pause_cancels_all_active_runs",
    );
    const activeRunCount = 250;
    const seededAt = new Date("2026-04-08T00:00:00.000Z");

    await t.run(async (ctx) => {
      const automation = await ctx.db
        .query("automations")
        .withIndex("by_custom_id", (q) => q.eq("id", automationId))
        .unique();
      if (!automation) {
        throw new Error("AutomationNotFound");
      }

      for (let index = 0; index < activeRunCount; index += 1) {
        const createdAt = new Date(seededAt.getTime() + index * 1_000).toISOString();
        await ctx.db.insert("automation_runs", {
          id: `arun_pause_${String(index).padStart(4, "0")}`,
          automation_id: automationId,
          org_id: automation.org_id,
          workspace_id: automation.workspace_id,
          config_version_id: configVersionId,
          trigger_type: "manual",
          error_message: null,
          sandbox_id: null,
          outcome_success: null,
          outcome_summary: null,
          outcome_source: null,
          outcome_recorded_at: null,
          log_storage_id: null,
          session_trace_storage_id: null,
          session_trace_relative_path: null,
          trace_id: null,
          trace_group_id: null,
          trace_workflow_name: null,
          trace_last_response_id: null,
          trace_export_status: null,
          trace_error_message: null,
          trace_recorded_at: null,
          created_at: createdAt,
          mcp_session_id: null,
          client_type: "other",
          metadata: {
            automation_run_status: AUTOMATION_RUN_STATUS.running,
            automation_name: automation.name,
            log_bytes: 0,
            log_eviction_noted: false,
          },
          started_at: createdAt,
          ended_at: null,
          status: RUN_STATUS.active,
        });
      }
    });

    const paused = await authT.mutation(refs.updateAutomationStatus, {
      automation_id: automationId,
      status: "paused",
    });

    expect(paused.status).toBe("paused");

    const runs = await t.run(async (ctx) => {
      return await ctx.db
        .query("automation_runs")
        .withIndex("by_automation", (q) => q.eq("automation_id", automationId))
        .collect();
    });

    expect(runs).toHaveLength(activeRunCount);
    expect(runs.every((run) => run.status === RUN_STATUS.ended)).toBe(true);
    expect(runs.every((run) => run.ended_at !== null)).toBe(true);
    expect(
      runs.every((run) => run.error_message === "Run cancelled because automation was paused"),
    ).toBe(true);
  });

  it("records an OpenAI trace reference once and logs the trace status", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_automation_trace";
    const fixture = await seedAutomationFixture(t, orgId);

    const createdRun = await t.mutation(refs.createAutomationRun, {
      automation_id: fixture.automationId,
      trigger_type: "manual",
    });

    const firstStore = await t.mutation(refs.recordAutomationRunTrace, {
      automation_run_id: createdRun.id,
      export_status: "exported",
      trace_id: "trace_test_1",
      group_id: "automation:automation_test",
      workflow_name: "Keppo automation",
      last_response_id: "resp_test_1",
    });
    const secondStore = await t.mutation(refs.recordAutomationRunTrace, {
      automation_run_id: createdRun.id,
      export_status: "failed",
      error_message: "should not overwrite",
    });

    expect(firstStore).toEqual({ recorded: true });
    expect(secondStore).toEqual({ recorded: false });

    const storedState = await t.run(async (ctx) => {
      const run = await ctx.db
        .query("automation_runs")
        .withIndex("by_custom_id", (q) => q.eq("id", createdRun.id))
        .unique();
      const logs = await ctx.db
        .query("automation_run_logs")
        .withIndex("by_run_seq", (q) => q.eq("automation_run_id", createdRun.id))
        .collect();
      return {
        run,
        logs,
      };
    });

    expect(storedState.run?.trace_id).toBe("trace_test_1");
    expect(storedState.run?.trace_group_id).toBe("automation:automation_test");
    expect(storedState.run?.trace_workflow_name).toBe("Keppo automation");
    expect(storedState.run?.trace_last_response_id).toBe("resp_test_1");
    expect(storedState.run?.trace_export_status).toBe("exported");
    expect(
      storedState.logs.filter((line) => line.content.includes("Recorded OpenAI trace reference")),
    ).toHaveLength(1);
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

  it("keeps purchased run capacity available across multiple overage runs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-03T12:00:00.000Z"));
    const t = createConvexTestHarness();
    const orgId = "org_convex_automation_topup_limit";
    const fixture = await seedAutomationFixture(t, orgId);
    const period = getDefaultBillingPeriod(new Date());
    const starterBaseLimit = getTierConfig(SUBSCRIPTION_TIER.starter).automation_limits
      .max_runs_per_period;

    await t.mutation(refs.upsertSubscriptionForOrg, {
      orgId,
      tier: SUBSCRIPTION_TIER.starter,
      status: SUBSCRIPTION_STATUS.active,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      currentPeriodStart: period.periodStart,
      currentPeriodEnd: period.periodEnd,
    });
    await t.mutation(refs.addPurchasedAutomationRuns, {
      orgId,
      tier: SUBSCRIPTION_TIER.starter,
      multiplier: "x1",
      runs: 2,
      toolCalls: 0,
      toolCallTimeMs: 0,
      priceCents: 1500,
      stripePaymentIntentId: null,
    });

    await t.run(async (ctx) => {
      for (let index = 0; index < starterBaseLimit; index += 1) {
        await ctx.db.insert("automation_runs", {
          id: `arun_${orgId}_${index}`,
          automation_id: fixture.automationId,
          org_id: orgId,
          workspace_id: fixture.workspaceId,
          config_version_id: fixture.configVersionId,
          trigger_type: "manual",
          error_message: null,
          sandbox_id: null,
          outcome_success: true,
          outcome_summary: "Seeded completed run",
          outcome_source: "agent_recorded",
          outcome_recorded_at: period.periodStart,
          log_storage_id: null,
          session_trace_storage_id: null,
          session_trace_relative_path: null,
          created_at: period.periodStart,
          mcp_session_id: null,
          client_type: "other",
          metadata: {
            automation_run_status: AUTOMATION_RUN_STATUS.succeeded,
            log_bytes: 0,
            log_eviction_noted: false,
          },
          started_at: period.periodStart,
          ended_at: period.periodStart,
          status: RUN_STATUS.ended,
        });
      }
    });

    const firstPurchasedRun = await t.mutation(refs.createAutomationRun, {
      automation_id: fixture.automationId,
      trigger_type: "manual",
    });
    expect(firstPurchasedRun.status).toBe(AUTOMATION_RUN_STATUS.pending);
    await expect(
      t.run((ctx) => getAutomationRunTopupBalanceForOrg(ctx, orgId)),
    ).resolves.toMatchObject({
      purchased_runs_balance: 1,
    });

    const secondPurchasedRun = await t.mutation(refs.createAutomationRun, {
      automation_id: fixture.automationId,
      trigger_type: "manual",
    });
    expect(secondPurchasedRun.status).toBe(AUTOMATION_RUN_STATUS.pending);
    await expect(
      t.run((ctx) => getAutomationRunTopupBalanceForOrg(ctx, orgId)),
    ).resolves.toMatchObject({
      purchased_runs_balance: 0,
    });

    await expect(
      t.mutation(refs.createAutomationRun, {
        automation_id: fixture.automationId,
        trigger_type: "manual",
      }),
    ).rejects.toThrow("AUTOMATION_RUN_LIMIT_REACHED");
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
