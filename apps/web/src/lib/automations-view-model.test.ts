import { describe, expect, it } from "vitest";
import {
  getAiKeyModeMeta,
  getAutomationPathSegment,
  getAutomationTriggerLabel,
  getRunOutcomeBadgeLabel,
  getProviderTriggerSubscriptionSummary,
  getRunStatusSummary,
  getModelProviderForRunner,
  parseAiCreditBalance,
  getRunnerTypeForModelProvider,
  mergeRunLogLines,
  parseAutomationTriggerEvents,
  parsePaginatedAutomations,
  resolveAutomationExecutionState,
  toRunEvents,
  type AutomationConfigVersion,
  type AutomationRunLogLine,
} from "./automations-view-model";

describe("automation runner/provider mapping", () => {
  it("maps runners to their required model providers", () => {
    expect(getModelProviderForRunner("chatgpt_codex")).toBe("openai");
    expect(getModelProviderForRunner("claude_code")).toBe("anthropic");
  });

  it("maps providers back to their compatible runner", () => {
    expect(getRunnerTypeForModelProvider("openai")).toBe("chatgpt_codex");
    expect(getRunnerTypeForModelProvider("anthropic")).toBe("claude_code");
  });

  it("describes bundled key mode and bundled credit eligibility", () => {
    expect(getAiKeyModeMeta("bundled")).toMatchObject({
      label: "Bundled",
    });
    expect(
      parseAiCreditBalance({
        org_id: "org_123",
        period_start: "2026-03-01T00:00:00.000Z",
        period_end: "2026-04-01T00:00:00.000Z",
        allowance_total: 100,
        allowance_used: 10,
        allowance_remaining: 90,
        purchased_remaining: 5,
        total_available: 95,
        bundled_runtime_enabled: true,
      }),
    ).toMatchObject({
      total_available: 95,
      bundled_runtime_enabled: true,
    });
  });

  it("keeps hosted execution in bundled mode even when credits are exhausted", () => {
    expect(
      resolveAutomationExecutionState({
        provider: "openai",
        creditBalance: {
          org_id: "org_123",
          period_start: "2026-03-01T00:00:00.000Z",
          period_end: "2026-04-01T00:00:00.000Z",
          allowance_total: 20,
          allowance_reset_period: "one_time",
          allowance_used: 20,
          allowance_remaining: 0,
          purchased_remaining: 0,
          total_available: 0,
          bundled_runtime_enabled: true,
        },
        orgAiKeys: [],
      }),
    ).toEqual({
      mode: "bundled",
      requires_active_byok_key: false,
      has_active_byok_key: false,
      can_run: false,
    });
  });

  it("requires a self-managed key when bundled runtime is unavailable", () => {
    expect(
      resolveAutomationExecutionState({
        provider: "openai",
        creditBalance: {
          org_id: "org_123",
          period_start: "2026-03-01T00:00:00.000Z",
          period_end: "2026-04-01T00:00:00.000Z",
          allowance_total: 20,
          allowance_reset_period: "one_time",
          allowance_used: 5,
          allowance_remaining: 15,
          purchased_remaining: 0,
          total_available: 15,
          bundled_runtime_enabled: false,
        },
        orgAiKeys: [],
      }),
    ).toEqual({
      mode: "byok",
      requires_active_byok_key: true,
      has_active_byok_key: false,
      can_run: false,
    });
  });

  it("falls back to the automation id for reserved route slugs", () => {
    expect(getAutomationPathSegment({ id: "automation_123", slug: "build" })).toBe(
      "automation_123",
    );
    expect(getAutomationPathSegment({ id: "automation_456", slug: "create" })).toBe(
      "automation_456",
    );
    expect(getAutomationPathSegment({ id: "automation_789", slug: "daily-digest" })).toBe(
      "daily-digest",
    );
  });
});

describe("run log view model", () => {
  it("parses automation list items with embedded latest-run summaries", () => {
    const parsed = parsePaginatedAutomations({
      page: [
        {
          automation: {
            id: "automation_123",
            org_id: "org_123",
            workspace_id: "workspace_123",
            slug: "daily-digest",
            name: "Daily Digest",
            description: "Summarize the latest activity",
            status: "active",
            current_config_version_id: "acv_123",
            created_by: "user_123",
            created_at: "2026-03-07T00:00:00.000Z",
            updated_at: "2026-03-07T00:00:00.000Z",
          },
          current_config_version: {
            id: "acv_123",
            version_number: 2,
            trigger_type: "schedule",
            model_class: "auto",
            runner_type: "chatgpt_codex",
            ai_model_provider: "openai",
            ai_model_name: "gpt-5.4",
            network_access: "mcp_only",
            created_at: "2026-03-07T00:00:00.000Z",
          },
          latest_run: {
            id: "arun_123",
            automation_id: "automation_123",
            org_id: "org_123",
            workspace_id: "workspace_123",
            config_version_id: "acv_123",
            trigger_type: "schedule",
            status: "failed",
            started_at: "2026-03-07T01:00:00.000Z",
            ended_at: "2026-03-07T01:03:00.000Z",
            error_message: "Inbox provider timed out",
            sandbox_id: null,
            mcp_session_id: null,
            created_at: "2026-03-07T01:00:00.000Z",
          },
        },
      ],
      isDone: true,
      continueCursor: "",
    });

    expect(parsed.page[0]?.latest_run).toMatchObject({
      id: "arun_123",
      status: "failed",
      error_message: "Inbox provider timed out",
    });
    expect(getRunStatusSummary(parsed.page[0]!.latest_run!)).toBe(
      "Keppo could not reach the server. Try again.",
    );
  });

  it("prefers recorded automation outcomes over generic status copy", () => {
    const parsed = parsePaginatedAutomations({
      page: [
        {
          automation: {
            id: "automation_456",
            org_id: "org_123",
            workspace_id: "workspace_123",
            slug: "review-bot",
            name: "Review Bot",
            description: "Review pull requests",
            status: "active",
            current_config_version_id: "acv_456",
            created_by: "user_123",
            created_at: "2026-03-07T00:00:00.000Z",
            updated_at: "2026-03-07T00:00:00.000Z",
          },
          current_config_version: null,
          latest_run: {
            id: "arun_456",
            automation_id: "automation_456",
            org_id: "org_123",
            workspace_id: "workspace_123",
            config_version_id: "acv_456",
            trigger_type: "manual",
            status: "succeeded",
            started_at: "2026-03-07T01:00:00.000Z",
            ended_at: "2026-03-07T01:03:00.000Z",
            error_message: null,
            sandbox_id: null,
            mcp_session_id: null,
            outcome: {
              success: true,
              summary: "Reviewed 3 open issues and requested approval to merge the PR.",
              source: "agent_recorded",
              recorded_at: "2026-03-07T01:02:59.000Z",
            },
            created_at: "2026-03-07T01:00:00.000Z",
          },
        },
      ],
      isDone: true,
      continueCursor: "",
    });

    expect(parsed.page[0]?.latest_run?.outcome).toMatchObject({
      success: true,
      source: "agent_recorded",
    });
    expect(getRunStatusSummary(parsed.page[0]!.latest_run!)).toBe(
      "Reviewed 3 open issues and requested approval to merge the PR.",
    );
  });

  it("labels synthesized success outcomes as success instead of failure", () => {
    const parsed = parsePaginatedAutomations({
      page: [
        {
          automation: {
            id: "automation_789",
            org_id: "org_123",
            workspace_id: "workspace_123",
            slug: "ops-sync",
            name: "Ops Sync",
            description: "Sync status dashboards",
            status: "active",
            current_config_version_id: "acv_789",
            created_by: "user_123",
            created_at: "2026-03-07T00:00:00.000Z",
            updated_at: "2026-03-07T00:00:00.000Z",
          },
          current_config_version: null,
          latest_run: {
            id: "arun_789",
            automation_id: "automation_789",
            org_id: "org_123",
            workspace_id: "workspace_123",
            config_version_id: "acv_789",
            trigger_type: "manual",
            status: "succeeded",
            started_at: "2026-03-07T01:00:00.000Z",
            ended_at: "2026-03-07T01:03:00.000Z",
            error_message: null,
            sandbox_id: null,
            mcp_session_id: null,
            outcome: {
              success: true,
              summary: "The run completed, but the automation did not record a final outcome.",
              source: "fallback_missing",
              recorded_at: "2026-03-07T01:02:59.000Z",
            },
            created_at: "2026-03-07T01:00:00.000Z",
          },
        },
      ],
      isDone: true,
      continueCursor: "",
    });

    const run = parsed.page[0]!.latest_run!;
    expect(getRunStatusSummary(run)).toBe(
      "The run completed, but the automation did not record a final outcome.",
    );
    expect(getRunOutcomeBadgeLabel(run)).toBe("Fallback success");
  });

  it("groups adjacent thinking, config, and output fragments", () => {
    const events = toRunEvents([
      {
        seq: 1,
        level: "stderr",
        content: "Plan the first step.",
        timestamp: "2026-03-07T00:00:00.000Z",
        event_type: "thinking",
        event_data: { text: "Plan the first step." },
      },
      {
        seq: 2,
        level: "stderr",
        content: "Then verify the result.",
        timestamp: "2026-03-07T00:00:01.000Z",
        event_type: "thinking",
        event_data: { text: "Then verify the result." },
      },
      {
        seq: 3,
        level: "stderr",
        content: "model: gpt-5.2",
        timestamp: "2026-03-07T00:00:02.000Z",
        event_type: "automation_config",
        event_data: { key: "model", value: "gpt-5.2" },
      },
      {
        seq: 4,
        level: "stderr",
        content: "sandbox: workspace-write",
        timestamp: "2026-03-07T00:00:03.000Z",
        event_type: "automation_config",
        event_data: { key: "sandbox", value: "workspace-write" },
      },
      {
        seq: 5,
        level: "stdout",
        content: "First line",
        timestamp: "2026-03-07T00:00:04.000Z",
        event_type: "output",
        event_data: { text: "First line", format: "text" },
      },
      {
        seq: 6,
        level: "stdout",
        content: "Second line",
        timestamp: "2026-03-07T00:00:05.000Z",
        event_type: "output",
        event_data: { text: "Second line", format: "text" },
      },
    ]);

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      type: "thinking",
      text: "Plan the first step.\nThen verify the result.",
      lastSeq: 2,
    });
    expect(events[1]).toMatchObject({
      type: "automation_config",
      entries: [
        { key: "model", valueText: "gpt-5.2" },
        { key: "sandbox", valueText: "workspace-write" },
      ],
      lastSeq: 4,
    });
    expect(events[2]).toMatchObject({
      type: "output",
      text: "First line\nSecond line",
      chunks: ["First line", "Second line"],
      lastSeq: 6,
    });
  });

  it("attaches structured output to the preceding tool result", () => {
    const events = toRunEvents([
      {
        seq: 1,
        level: "stderr",
        content: 'tool keppo.search_tools({"q":"run logs"})',
        timestamp: "2026-03-07T00:00:00.000Z",
        event_type: "tool_call",
        event_data: {
          tool_name: "keppo.search_tools",
          args: { q: "run logs" },
        },
      },
      {
        seq: 2,
        level: "stderr",
        content: "keppo.search_tools(...) success in 45ms:",
        timestamp: "2026-03-07T00:00:01.000Z",
        event_type: "tool_call",
        event_data: {
          tool_name: "keppo.search_tools",
          status: "success",
          duration_ms: 45,
          is_result: true,
        },
      },
      {
        seq: 3,
        level: "stdout",
        content: '{"items":[{"title":"Run logs UX"}]}',
        timestamp: "2026-03-07T00:00:02.000Z",
        event_type: "output",
        event_data: {
          text: '{"items":[{"title":"Run logs UX"}]}',
          format: "json",
          parsed: { items: [{ title: "Run logs UX" }] },
        },
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool_call",
      toolName: "keppo.search_tools",
      status: "success",
      durationMs: 45,
      result: { items: [{ title: "Run logs UX" }] },
      resultFormat: "json",
      lastSeq: 3,
    });
  });

  it("merges automation-source tool payloads with Codex mcp lifecycle lines", () => {
    const events = toRunEvents([
      {
        seq: 1,
        level: "system",
        content: "search_tools query: unread gmail",
        timestamp: "2026-03-07T00:00:00.000Z",
        event_type: "tool_call",
        event_data: {
          tool_name: "search_tools",
          args: { query: "unread gmail" },
          source: "mcp_route",
        },
      },
      {
        seq: 2,
        level: "stderr",
        content: "mcp: keppo/search_tools started",
        timestamp: "2026-03-07T00:00:01.000Z",
        event_type: "tool_call",
        event_data: {
          tool_name: "search_tools",
          source: "mcp_lifecycle",
        },
      },
      {
        seq: 3,
        level: "system",
        content: "search_tools returned 1 match",
        timestamp: "2026-03-07T00:00:02.000Z",
        event_type: "tool_call",
        event_data: {
          tool_name: "search_tools",
          status: "success",
          is_result: true,
          result: {
            count: 1,
            results: [
              {
                name: "gmail.listUnread",
                provider: "google",
                capability: "read",
                description: "List unread Gmail threads.",
              },
            ],
          },
          source: "mcp_route",
        },
      },
      {
        seq: 4,
        level: "stderr",
        content: "mcp: keppo/search_tools (completed)",
        timestamp: "2026-03-07T00:00:03.000Z",
        event_type: "tool_call",
        event_data: {
          tool_name: "search_tools",
          status: "success",
          is_result: true,
          source: "mcp_lifecycle",
        },
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool_call",
      toolName: "search_tools",
      args: { query: "unread gmail" },
      status: "success",
      result: {
        count: 1,
        results: [
          {
            name: "gmail.listUnread",
            provider: "google",
            capability: "read",
            description: "List unread Gmail threads.",
          },
        ],
      },
      lastSeq: 4,
    });
    expect(events[0]?.debugLines).toHaveLength(4);
  });

  it("parses execute_code result text emitted from automation-source logs", () => {
    const events = toRunEvents([
      {
        seq: 1,
        level: "system",
        content: "Read unread Gmail threads and summarize them.",
        timestamp: "2026-03-07T00:00:00.000Z",
        event_type: "tool_call",
        event_data: {
          tool_name: "execute_code",
          args: {
            description: "Read unread Gmail threads and summarize them.",
            code: "console.log('hi')",
          },
          source: "mcp_route",
        },
      },
      {
        seq: 2,
        level: "system",
        content: "Read unread Gmail threads and summarize them.",
        timestamp: "2026-03-07T00:00:01.000Z",
        event_type: "tool_call",
        event_data: {
          tool_name: "execute_code",
          status: "success",
          is_result: true,
          result_text: '{"unreadCount":3,"subjects":["Ops","Design"]}',
          source: "mcp_route",
        },
      },
      {
        seq: 3,
        level: "stderr",
        content: "mcp: keppo/execute_code (completed)",
        timestamp: "2026-03-07T00:00:02.000Z",
        event_type: "tool_call",
        event_data: {
          tool_name: "execute_code",
          status: "success",
          is_result: true,
          source: "mcp_lifecycle",
        },
      },
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool_call",
      toolName: "execute_code",
      status: "success",
      result: {
        unreadCount: 3,
        subjects: ["Ops", "Design"],
      },
      resultText: '{"unreadCount":3,"subjects":["Ops","Design"]}',
      resultFormat: "json",
      lastSeq: 3,
    });
  });

  it("keeps automation outcome system events separate from generic system notes", () => {
    const events = toRunEvents([
      {
        seq: 1,
        level: "system",
        content: "Dispatched sandbox sandbox_123",
        timestamp: "2026-03-07T00:00:00.000Z",
        event_type: "system",
        event_data: { message: "Dispatched sandbox sandbox_123" },
      },
      {
        seq: 2,
        level: "system",
        content: "Automation outcome (agent recorded): Success. Finished triage.",
        timestamp: "2026-03-07T00:00:10.000Z",
        event_type: "system",
        event_data: {
          message: "Automation outcome (agent recorded): Success. Finished triage.",
          kind: "automation_outcome",
          outcome: {
            success: true,
            summary: "Finished triage.",
            source: "agent_recorded",
          },
        },
      },
    ]);

    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: "system",
      outcome: {
        success: true,
        summary: "Finished triage.",
        source: "agent_recorded",
      },
    });
  });

  it("preserves stable arrays when no new log lines arrive", () => {
    const previous: AutomationRunLogLine[] = [
      {
        seq: 1,
        level: "stdout",
        content: "hello",
        timestamp: "2026-03-07T00:00:00.000Z",
      },
    ];

    expect(mergeRunLogLines(previous, [])).toBe(previous);
    expect(mergeRunLogLines(previous, [previous[0]!])).toBe(previous);
  });

  it("parses automation trigger deliveries and humanizes native trigger state", () => {
    const events = parseAutomationTriggerEvents([
      {
        id: "ate_1",
        automation_id: "automation_123",
        config_version_id: "acv_123",
        trigger_key: "incoming_email",
        event_provider: "google",
        event_type: "google.gmail.incoming_email",
        event_id: "evt_1",
        delivery_mode: "polling",
        match_status: "matched",
        failure_reason: null,
        status: "dispatched",
        automation_run_id: "arun_123",
        automation_run_status: "pending",
        created_at: "2026-03-07T01:00:00.000Z",
      },
    ]);

    expect(events).toEqual([
      expect.objectContaining({
        id: "ate_1",
        delivery_mode: "polling",
        status: "dispatched",
        automation_run_status: "pending",
      }),
    ]);

    const config: AutomationConfigVersion = {
      id: "acv_123",
      automation_id: "automation_123",
      version_number: 1,
      trigger_type: "event",
      schedule_cron: null,
      provider_trigger: {
        provider_id: "google",
        trigger_key: "incoming_email",
        schema_version: 1,
        filter: {
          unread_only: true,
        },
        delivery: {
          preferred_mode: "webhook",
          supported_modes: ["webhook", "polling"],
          fallback_mode: "polling",
        },
        subscription_state: {
          status: "degraded",
          active_mode: "polling",
          last_error: "watch expired",
          updated_at: "2026-03-07T01:00:00.000Z",
        },
      },
      provider_trigger_migration_state: null,
      event_provider: "google",
      event_type: "incoming_email",
      event_predicate: null,
      model_class: "auto",
      runner_type: "chatgpt_codex",
      ai_model_provider: "openai",
      ai_model_name: "gpt-5.4",
      prompt: "Summarize inbox changes",
      network_access: "mcp_only",
      created_by: "user_123",
      created_at: "2026-03-07T00:00:00.000Z",
      change_summary: null,
    };

    expect(getAutomationTriggerLabel(config)).toBe("Incoming email");
    expect(getProviderTriggerSubscriptionSummary(config)).toBe("Degraded: watch expired");
  });
});

describe("provider trigger view model", () => {
  it("resolves multi-provider trigger labels and polling summaries from registry metadata", () => {
    const redditConfig = {
      id: "cfg_reddit",
      automation_id: "automation_reddit",
      version_number: 1,
      trigger_type: "event",
      schedule_cron: null,
      provider_trigger: {
        provider_id: "reddit",
        trigger_key: "mentions",
        schema_version: 1,
        filter: {},
        delivery: {
          preferred_mode: "polling",
          supported_modes: ["polling"],
          fallback_mode: null,
        },
        subscription_state: {
          status: "active",
          active_mode: "polling",
          last_error: null,
          updated_at: "2026-03-20T00:00:00.000Z",
        },
      },
      provider_trigger_migration_state: null,
      event_provider: null,
      event_type: null,
      event_predicate: null,
      model_class: "auto",
      runner_type: "chatgpt_codex",
      ai_model_provider: "openai",
      ai_model_name: "gpt-5.4",
      prompt: "Triage Reddit mentions",
      network_access: "mcp_only",
      created_by: "user_123",
      created_at: "2026-03-20T00:00:00.000Z",
      change_summary: null,
    } satisfies AutomationConfigVersion;

    const xConfig = {
      ...redditConfig,
      id: "cfg_x",
      automation_id: "automation_x",
      provider_trigger: {
        ...redditConfig.provider_trigger,
        provider_id: "x",
        trigger_key: "mentions",
      },
      prompt: "Triage X mentions",
    } satisfies AutomationConfigVersion;

    expect(getAutomationTriggerLabel(redditConfig)).toBe("Mentions");
    expect(getProviderTriggerSubscriptionSummary(redditConfig)).toBe("Active via polling");
    expect(getAutomationTriggerLabel(xConfig)).toBe("Mentions");
    expect(getProviderTriggerSubscriptionSummary(xConfig)).toBe("Active via polling");
  });
});
