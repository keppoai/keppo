import { describe, expect, it } from "vitest";
import {
  ACTION_STATUS,
  APPROVAL_DECIDER_TYPE,
  APPROVAL_DECISION,
  AUTOMATION_TRIGGER_EVENT_MATCH_STATUS,
  AUTOMATION_TRIGGER_EVENT_STATUS,
  RUN_STATUS,
  TOOL_CALL_STATUS,
} from "../../convex/domain_constants";
import {
  cascadeDeleteAutomationDescendants,
  cascadeDeleteCelRuleDescendants,
  cascadeDeleteNotificationEndpointDescendants,
} from "../../convex/cascade";
import { createConvexTestHarness, seedAutomationFixture } from "./harness";

describe("convex cascade deletion helpers", () => {
  it("removes an automation's descendants across all related tables", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_cascade_full";
    const fixture = await seedAutomationFixture(t, orgId);
    const now = "2026-03-22T12:00:00.000Z";
    const runId = "run_cascade_full";
    const actionId = "act_cascade_full";

    await t.run(async (ctx) => {
      await ctx.db.insert("automation_trigger_events", {
        id: "ate_cascade_full",
        automation_id: fixture.automationId,
        org_id: orgId,
        config_version_id: fixture.configVersionId,
        trigger_id: "trigger_full",
        trigger_key: "event.created",
        delivery_mode: "webhook",
        match_status: AUTOMATION_TRIGGER_EVENT_MATCH_STATUS.matched,
        failure_reason: null,
        event_provider: "github",
        event_type: "repo.created",
        event_id: "evt_cascade_full",
        event_payload_ref: null,
        status: AUTOMATION_TRIGGER_EVENT_STATUS.pending,
        automation_run_id: runId,
        created_at: now,
      });

      await ctx.db.insert("automation_config_versions", {
        id: "acv_cascade_extra",
        automation_id: fixture.automationId,
        version_number: 2,
        trigger_type: "manual",
        schedule_cron: null,
        provider_trigger: null,
        provider_trigger_migration_state: null,
        event_provider: null,
        event_type: null,
        event_predicate: null,
        runner_type: "chatgpt_codex",
        ai_model_provider: "openai",
        ai_model_name: "gpt-5",
        prompt: "Second config",
        network_access: "mcp_only",
        created_by: "usr_test",
        created_at: now,
        change_summary: null,
      });

      await ctx.db.insert("automation_runs", {
        id: runId,
        automation_id: fixture.automationId,
        org_id: orgId,
        workspace_id: fixture.workspaceId,
        config_version_id: fixture.configVersionId,
        trigger_type: "manual",
        error_message: null,
        sandbox_id: null,
        log_storage_id: null,
        created_at: now,
        mcp_session_id: null,
        client_type: "other",
        metadata: {},
        started_at: now,
        ended_at: null,
        status: RUN_STATUS.active,
      });

      await ctx.db.insert("automation_run_logs", {
        automation_run_id: runId,
        seq: 1,
        level: "system",
        content: "log entry",
        timestamp: now,
      });

      await ctx.db.insert("tool_calls", {
        id: "tool_cascade_full",
        automation_run_id: runId,
        tool_name: "github.createIssue",
        input_redacted: { title: "Issue" },
        output_redacted: null,
        status: TOOL_CALL_STATUS.completed,
        raw_input_blob_id: null,
        raw_output_blob_id: null,
        latency_ms: 123,
        created_at: now,
      });

      await ctx.db.insert("actions", {
        id: actionId,
        workspace_id: fixture.workspaceId,
        automation_run_id: runId,
        tool_call_id: "tool_cascade_full",
        action_type: "github.createIssue",
        risk_level: "medium",
        normalized_payload_enc: "payload",
        payload_preview: { title: "Issue" },
        payload_purged_at: null,
        status: ACTION_STATUS.pending,
        idempotency_key: "cascade-full",
        created_at: now,
        resolved_at: null,
        result_redacted: null,
      });

      await ctx.db.insert("approvals", {
        id: "approval_cascade_full",
        action_id: actionId,
        decider_type: APPROVAL_DECIDER_TYPE.human,
        decision: APPROVAL_DECISION.approve,
        reason: "approved",
        rule_id: null,
        confidence: 1,
        created_at: now,
      });

      await ctx.db.insert("policy_decisions", {
        id: "policy_cascade_full",
        action_id: actionId,
        policies_evaluated: ["policy_1"],
        result: "approve",
        explanation: "allowed",
        confidence: 0.9,
        created_at: now,
      });

      await ctx.db.insert("cel_rule_matches", {
        id: "match_cascade_full",
        action_id: actionId,
        cel_rule_id: "rule_cascade_full",
        effect: "approve",
        expression_snapshot: "true",
        context_snapshot: {},
        created_at: now,
      });

      await ctx.db.insert("sensitive_blobs", {
        id: "blob_cascade_full",
        org_id: orgId,
        ref_table: "automation_runs",
        ref_id: runId,
        ref_field: "input",
        blob_enc: "ciphertext",
        key_version: "1",
        expires_at: null,
        purged_at: null,
        created_at: now,
      });
    });

    await t.run(async (ctx) => {
      await cascadeDeleteAutomationDescendants(ctx, fixture.automationId);
    });

    const counts = await t.run(async (ctx) => {
      const [
        triggerEvents,
        configVersions,
        runs,
        runLogs,
        toolCalls,
        actions,
        approvals,
        policies,
        matches,
        blobs,
      ] = await Promise.all([
        ctx.db
          .query("automation_trigger_events")
          .withIndex("by_automation", (q) => q.eq("automation_id", fixture.automationId))
          .collect(),
        ctx.db
          .query("automation_config_versions")
          .withIndex("by_automation", (q) => q.eq("automation_id", fixture.automationId))
          .collect(),
        ctx.db
          .query("automation_runs")
          .withIndex("by_automation", (q) => q.eq("automation_id", fixture.automationId))
          .collect(),
        ctx.db
          .query("automation_run_logs")
          .withIndex("by_run_seq", (q) => q.eq("automation_run_id", runId))
          .collect(),
        ctx.db
          .query("tool_calls")
          .withIndex("by_automation_run", (q) => q.eq("automation_run_id", runId))
          .collect(),
        ctx.db
          .query("actions")
          .withIndex("by_automation_run", (q) => q.eq("automation_run_id", runId))
          .collect(),
        ctx.db
          .query("approvals")
          .withIndex("by_action", (q) => q.eq("action_id", actionId))
          .collect(),
        ctx.db
          .query("policy_decisions")
          .withIndex("by_action", (q) => q.eq("action_id", actionId))
          .collect(),
        ctx.db
          .query("cel_rule_matches")
          .withIndex("by_action", (q) => q.eq("action_id", actionId))
          .collect(),
        ctx.db
          .query("sensitive_blobs")
          .withIndex("by_ref_table_ref_id", (q) =>
            q.eq("ref_table", "automation_runs").eq("ref_id", runId),
          )
          .collect(),
      ]);

      return {
        triggerEvents: triggerEvents.length,
        configVersions: configVersions.length,
        runs: runs.length,
        runLogs: runLogs.length,
        toolCalls: toolCalls.length,
        actions: actions.length,
        approvals: approvals.length,
        policies: policies.length,
        matches: matches.length,
        blobs: blobs.length,
      };
    });

    expect(counts).toEqual({
      triggerEvents: 0,
      configVersions: 0,
      runs: 0,
      runLogs: 0,
      toolCalls: 0,
      actions: 0,
      approvals: 0,
      policies: 0,
      matches: 0,
      blobs: 0,
    });
  });

  it("succeeds when an automation has no descendants", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_cascade_empty";
    const now = "2026-03-22T12:00:00.000Z";

    await t.run(async (ctx) => {
      await ctx.db.insert("subscriptions", {
        id: "sub_cascade_empty",
        org_id: orgId,
        tier: "free",
        status: "active",
        stripe_customer_id: null,
        stripe_subscription_id: null,
        workspace_count: 1,
        current_period_start: "2026-03-01T00:00:00.000Z",
        current_period_end: "2026-04-01T00:00:00.000Z",
        created_at: now,
        updated_at: now,
      });

      await ctx.db.insert("workspaces", {
        id: "workspace_cascade_empty",
        org_id: orgId,
        slug: "cascade-empty",
        name: "Cascade Empty",
        status: "active",
        policy_mode: "manual_only",
        default_action_behavior: "require_approval",
        automation_count: 1,
        created_at: now,
      });

      await ctx.db.insert("automations", {
        id: "automation_cascade_empty",
        org_id: orgId,
        workspace_id: "workspace_cascade_empty",
        slug: "cascade-empty",
        name: "Cascade Empty",
        description: "No descendants",
        status: "active",
        current_config_version_id: "missing_config",
        created_by: "usr_test",
        created_at: now,
        updated_at: now,
        next_config_version_number: 1,
      });
    });

    await t.run(async (ctx) => {
      await cascadeDeleteAutomationDescendants(ctx, "automation_cascade_empty");
    });

    const counts = await t.run(async (ctx) => {
      const [triggerEvents, runs, configs] = await Promise.all([
        ctx.db
          .query("automation_trigger_events")
          .withIndex("by_automation", (q) => q.eq("automation_id", "automation_cascade_empty"))
          .collect(),
        ctx.db
          .query("automation_runs")
          .withIndex("by_automation", (q) => q.eq("automation_id", "automation_cascade_empty"))
          .collect(),
        ctx.db
          .query("automation_config_versions")
          .withIndex("by_automation", (q) => q.eq("automation_id", "automation_cascade_empty"))
          .collect(),
      ]);
      return {
        triggerEvents: triggerEvents.length,
        runs: runs.length,
        configs: configs.length,
      };
    });

    expect(counts).toEqual({
      triggerEvents: 0,
      runs: 0,
      configs: 0,
    });
  });

  it("continues deleting when a single descendant table exceeds the batch size", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_cascade_batches";
    const fixture = await seedAutomationFixture(t, orgId);
    const now = "2026-03-22T12:00:00.000Z";

    await t.run(async (ctx) => {
      for (let index = 0; index < 65; index += 1) {
        await ctx.db.insert("automation_trigger_events", {
          id: `ate_cascade_batch_${index}`,
          automation_id: fixture.automationId,
          org_id: orgId,
          config_version_id: fixture.configVersionId,
          trigger_id: `trigger_${index}`,
          trigger_key: "event.created",
          delivery_mode: "webhook",
          match_status: AUTOMATION_TRIGGER_EVENT_MATCH_STATUS.matched,
          failure_reason: null,
          event_provider: "github",
          event_type: "repo.created",
          event_id: `evt_batch_${index}`,
          event_payload_ref: null,
          status: AUTOMATION_TRIGGER_EVENT_STATUS.pending,
          automation_run_id: null,
          created_at: now,
        });
      }
    });

    await t.run(async (ctx) => {
      await cascadeDeleteAutomationDescendants(ctx, fixture.automationId);
    });

    const remaining = await t.run((ctx) =>
      ctx.db
        .query("automation_trigger_events")
        .withIndex("by_automation", (q) => q.eq("automation_id", fixture.automationId))
        .collect(),
    );

    expect(remaining).toHaveLength(0);
  });

  it("removes CEL rule descendants", async () => {
    const t = createConvexTestHarness();
    const orgId = "org_convex_cascade_rule";
    const fixture = await seedAutomationFixture(t, orgId);
    const now = "2026-03-22T12:00:00.000Z";

    await t.run(async (ctx) => {
      await ctx.db.insert("cel_rules", {
        id: "rule_cascade_delete",
        workspace_id: fixture.workspaceId,
        name: "Delete matches",
        description: "Test rule",
        expression: "true",
        effect: "approve",
        enabled: true,
        created_by: "usr_test",
        created_at: now,
      });

      await ctx.db.insert("cel_rule_matches", {
        id: "match_cascade_delete_1",
        action_id: "action_rule_delete_1",
        cel_rule_id: "rule_cascade_delete",
        effect: "approve",
        expression_snapshot: "true",
        context_snapshot: {},
        created_at: now,
      });

      await ctx.db.insert("cel_rule_matches", {
        id: "match_cascade_delete_2",
        action_id: "action_rule_delete_2",
        cel_rule_id: "rule_cascade_delete",
        effect: "approve",
        expression_snapshot: "true",
        context_snapshot: {},
        created_at: now,
      });
    });

    await t.run(async (ctx) => {
      await cascadeDeleteCelRuleDescendants(ctx, "rule_cascade_delete");
    });

    const matches = await t.run((ctx) =>
      ctx.db
        .query("cel_rule_matches")
        .withIndex("by_cel_rule", (q) => q.eq("cel_rule_id", "rule_cascade_delete"))
        .collect(),
    );

    expect(matches).toHaveLength(0);
  });

  it("removes notification endpoint descendants", async () => {
    const t = createConvexTestHarness();
    const now = "2026-03-22T12:00:00.000Z";

    await t.run(async (ctx) => {
      await ctx.db.insert("notification_endpoints", {
        id: "endpoint_cascade_delete",
        org_id: "org_convex_notifications",
        user_id: "usr_notifications",
        type: "email",
        destination: "cascade@example.com",
        push_subscription: null,
        enabled: true,
        created_at: now,
      });

      await ctx.db.insert("notification_events", {
        id: "notif_cascade_delete_1",
        org_id: "org_convex_notifications",
        event_type: "approval_needed",
        channel: "email",
        title: "Approval needed",
        body: "Body",
        cta_url: "https://example.com",
        cta_label: "Open",
        action_id: null,
        endpoint_id: "endpoint_cascade_delete",
        read_at: null,
        status: "pending",
        attempts: 0,
        last_error: null,
        created_at: now,
      });

      await ctx.db.insert("notification_events", {
        id: "notif_cascade_delete_2",
        org_id: "org_convex_notifications",
        event_type: "approval_needed",
        channel: "email",
        title: "Approval needed",
        body: "Body",
        cta_url: "https://example.com",
        cta_label: "Open",
        action_id: null,
        endpoint_id: "endpoint_cascade_delete",
        read_at: null,
        status: "pending",
        attempts: 0,
        last_error: null,
        created_at: now,
      });
    });

    await t.run(async (ctx) => {
      await cascadeDeleteNotificationEndpointDescendants(ctx, "endpoint_cascade_delete");
    });

    const events = await t.run((ctx) =>
      ctx.db
        .query("notification_events")
        .withIndex("by_endpoint", (q) => q.eq("endpoint_id", "endpoint_cascade_delete"))
        .collect(),
    );

    expect(events).toHaveLength(0);
  });
});
