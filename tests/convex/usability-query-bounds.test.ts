import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { components } from "../../convex/_generated/api";
import {
  ACTION_STATUS,
  AUTOMATION_STATUS,
  DEFAULT_ACTION_BEHAVIOR,
  NOTIFICATION_CHANNEL,
  NOTIFICATION_DELIVERY_STATUS,
  POLICY_MODE,
  RUN_STATUS,
  SUBSCRIPTION_STATUS,
  SUBSCRIPTION_TIER,
  TOOL_CALL_STATUS,
  WORKSPACE_STATUS,
} from "../../convex/domain_constants";
import { createConvexTestHarness } from "./harness";

const refs = {
  seedUserOrg: makeFunctionReference<"mutation">("mcp:seedUserOrg"),
  listInAppNotifications: makeFunctionReference<"query">("notifications:listInAppNotifications"),
  countUnreadNotifications: makeFunctionReference<"query">("notifications:countUnread"),
  markAllNotificationsRead: makeFunctionReference<"mutation">("notifications:markAllRead"),
  listAuditForCurrentOrg: makeFunctionReference<"query">("audit:listForCurrentOrg"),
  getActionDetail: makeFunctionReference<"query">("actions:getActionDetail"),
  listActionsByWorkspace: makeFunctionReference<"query">("actions:listByWorkspace"),
  listPendingActionsByWorkspace: makeFunctionReference<"query">("actions:listPendingByWorkspace"),
  countPendingActionsByWorkspace: makeFunctionReference<"query">("actions:countPendingByWorkspace"),
  listPendingMcpActionsByWorkspace: makeFunctionReference<"query">(
    "mcp:listPendingActionsForWorkspace",
  ),
  listWorkspaceCustomTools: makeFunctionReference<"query">("custom_mcp:listToolsForWorkspace"),
};

const createAuthenticatedHarness = async () => {
  const t = createConvexTestHarness();
  const userId = `usr_${crypto.randomUUID().replace(/-/g, "")}`;
  const email = `${userId}@example.com`;
  const orgId = await t.mutation(refs.seedUserOrg, {
    userId,
    email,
    name: "Usability Query Bounds",
  });
  const authUserId = await t.run(async (ctx) => {
    const user = (await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "email", value: email }],
    })) as { _id?: string } | null;
    return user?._id ?? null;
  });

  if (!authUserId) {
    throw new Error("Failed to resolve auth user.");
  }

  return {
    t,
    orgId,
    authT: t.withIdentity({
      subject: authUserId,
      email,
      name: "Usability Query Bounds",
      activeOrganizationId: orgId,
    }),
  };
};

describe("usability query bounds", () => {
  it("keeps in-app notifications scoped, ordered, and mark-all limited to in-app events", async () => {
    const { t, orgId, authT } = await createAuthenticatedHarness();

    await t.run(async (ctx) => {
      const timestamps = [
        "2026-03-08T09:00:00.000Z",
        "2026-03-08T09:01:00.000Z",
        "2026-03-08T09:02:00.000Z",
        "2026-03-08T09:03:00.000Z",
      ];
      const events = [
        {
          id: "notif_inapp_unread_old",
          channel: NOTIFICATION_CHANNEL.inApp,
          read_at: null,
          created_at: timestamps[0]!,
        },
        {
          id: "notif_email_unread",
          channel: NOTIFICATION_CHANNEL.email,
          read_at: null,
          created_at: timestamps[1]!,
        },
        {
          id: "notif_inapp_read_newest",
          channel: NOTIFICATION_CHANNEL.inApp,
          read_at: "2026-03-08T09:03:30.000Z",
          created_at: timestamps[2]!,
        },
        {
          id: "notif_inapp_unread_newest",
          channel: NOTIFICATION_CHANNEL.inApp,
          read_at: null,
          created_at: timestamps[3]!,
        },
      ];

      for (const event of events) {
        await ctx.db.insert("notification_events", {
          id: event.id,
          org_id: orgId,
          event_type: "approval_needed",
          channel: event.channel,
          title: event.id,
          body: "Notification body",
          cta_url: "/approvals",
          cta_label: "Review",
          metadata: JSON.stringify({ source: "test" }),
          action_id: null,
          endpoint_id: null,
          read_at: event.read_at,
          status: NOTIFICATION_DELIVERY_STATUS.sent,
          attempts: 1,
          last_error: null,
          created_at: event.created_at,
        });
      }
    });

    await expect(
      authT.query(refs.countUnreadNotifications, {
        orgId,
      }),
    ).resolves.toBe(2);

    const notifications = await authT.query(refs.listInAppNotifications, {
      orgId,
      limit: 3,
    });
    expect(notifications.map((event) => event.id)).toEqual([
      "notif_inapp_unread_newest",
      "notif_inapp_unread_old",
      "notif_inapp_read_newest",
    ]);

    await expect(
      authT.mutation(refs.markAllNotificationsRead, {
        orgId,
      }),
    ).resolves.toBe(2);

    await expect(
      authT.query(refs.countUnreadNotifications, {
        orgId,
      }),
    ).resolves.toBe(0);

    const emailEvent = await t.run((ctx) =>
      ctx.db
        .query("notification_events")
        .withIndex("by_custom_id", (q) => q.eq("id", "notif_email_unread"))
        .unique(),
    );
    expect(emailEvent?.read_at).toBeNull();
  });

  it("caps notification unread counts to the display budget", async () => {
    const { t, orgId, authT } = await createAuthenticatedHarness();

    await t.run(async (ctx) => {
      for (let index = 0; index < 140; index += 1) {
        await ctx.db.insert("notification_events", {
          id: `notif_unread_cap_${index}`,
          org_id: orgId,
          event_type: "approval_needed",
          channel: NOTIFICATION_CHANNEL.inApp,
          title: `Unread ${index}`,
          body: "Notification body",
          cta_url: "/approvals",
          cta_label: "Review",
          metadata: JSON.stringify({ source: "test" }),
          action_id: null,
          endpoint_id: null,
          read_at: null,
          status: NOTIFICATION_DELIVERY_STATUS.sent,
          attempts: 1,
          last_error: null,
          created_at: `2026-03-08T12:${String(index % 60).padStart(2, "0")}:00.000Z`,
        });
      }
    });

    await expect(
      authT.query(refs.countUnreadNotifications, {
        orgId,
      }),
    ).resolves.toBe(100);
  });

  it("bounds the pending approval badge count to the display cap", async () => {
    const { t, orgId, authT } = await createAuthenticatedHarness();
    const workspaceId = "ws_pending_bounds";

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaces", {
        id: workspaceId,
        org_id: orgId,
        name: "Pending Bounds",
        slug: "pending-bounds",
        created_at: "2026-03-08T08:00:00.000Z",
        status: WORKSPACE_STATUS.active,
        policy_mode: POLICY_MODE.manualOnly,
        default_action_behavior: DEFAULT_ACTION_BEHAVIOR.requireApproval,
        code_mode_enabled: true,
      });

      for (let index = 0; index < 140; index += 1) {
        await ctx.db.insert("actions", {
          id: `action_pending_${index}`,
          workspace_id: workspaceId,
          automation_run_id: `run_pending_${index}`,
          tool_call_id: `tool_call_pending_${index}`,
          action_type: "github.createIssue",
          risk_level: "medium",
          normalized_payload_enc: `enc_pending_${index}`,
          payload_preview: { index },
          payload_purged_at: null,
          status: ACTION_STATUS.pending,
          idempotency_key: `idem_pending_${index}`,
          created_at: `2026-03-08T08:${String(index % 60).padStart(2, "0")}:00.000Z`,
          resolved_at: null,
          result_redacted: null,
        });
      }
    });

    await expect(
      authT.query(refs.countPendingActionsByWorkspace, {
        workspaceId,
      }),
    ).resolves.toBe(100);
  });

  it("returns the newest filtered audit rows in descending order", async () => {
    const { t, orgId, authT } = await createAuthenticatedHarness();

    await t.run(async (ctx) => {
      for (let index = 0; index < 140; index += 1) {
        const hour = String(8 + Math.floor(index / 60)).padStart(2, "0");
        const minute = String(index % 60).padStart(2, "0");
        await ctx.db.insert("audit_events", {
          id: `audit_noise_${index}`,
          org_id: orgId,
          action_id: `act_noise_${index}`,
          actor_type: "system",
          actor_id: `noise_${index}`,
          event_type: "rule.created",
          payload: {
            provider: "slack",
            action_id: `act_noise_${index}`,
          },
          created_at: `2026-03-08T${hour}:${minute}:00.000Z`,
        });
      }

      const matchingRows = [
        "2026-03-08T11:00:00.000Z",
        "2026-03-08T11:01:00.000Z",
        "2026-03-08T11:02:00.000Z",
      ];

      for (const [index, createdAt] of matchingRows.entries()) {
        await ctx.db.insert("audit_events", {
          id: `audit_match_${index}`,
          org_id: orgId,
          action_id: "act_focus",
          actor_type: "user",
          actor_id: "usr_focus_operator",
          event_type: "integration.connected",
          payload: {
            provider: "google",
            action_id: "act_focus",
            marker: `match_${index}`,
          },
          created_at: createdAt,
        });
      }
    });

    const rows = await authT.query(refs.listAuditForCurrentOrg, {
      filters: {
        actor: "focus_operator",
        eventType: "integration.connected",
        provider: "google",
        actionId: "act_focus",
      },
    });

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.id)).toEqual(["audit_match_2", "audit_match_1", "audit_match_0"]);
  });

  it("caps action timeline results to the newest matching events", async () => {
    const { t, orgId, authT } = await createAuthenticatedHarness();
    const workspaceId = "workspace_query_bounds";
    const automationId = "automation_query_bounds";
    const configVersionId = "acv_query_bounds";
    const runId = "arun_query_bounds";
    const toolCallId = "tcall_query_bounds";
    const actionId = "act_query_bounds";

    await t.run(async (ctx) => {
      await ctx.db.insert("subscriptions", {
        id: "sub_query_bounds",
        org_id: orgId,
        tier: SUBSCRIPTION_TIER.pro,
        status: SUBSCRIPTION_STATUS.active,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        workspace_count: 1,
        current_period_start: "2026-03-01T00:00:00.000Z",
        current_period_end: "2026-04-01T00:00:00.000Z",
        created_at: "2026-03-01T00:00:00.000Z",
        updated_at: "2026-03-01T00:00:00.000Z",
      });

      await ctx.db.insert("workspaces", {
        id: workspaceId,
        org_id: orgId,
        slug: "query-bounds",
        name: "Query Bounds",
        status: WORKSPACE_STATUS.active,
        policy_mode: "manual_only",
        default_action_behavior: "require_approval",
        code_mode_enabled: true,
        automation_count: 1,
        created_at: "2026-03-02T00:00:00.000Z",
      });

      await ctx.db.insert("automation_config_versions", {
        id: configVersionId,
        automation_id: automationId,
        version_number: 1,
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
        prompt: "Prompt",
        network_access: "mcp_only",
        created_by: "usr_focus_operator",
        created_at: "2026-03-02T00:00:00.000Z",
        change_summary: null,
      });

      await ctx.db.insert("automations", {
        id: automationId,
        org_id: orgId,
        workspace_id: workspaceId,
        slug: "query-bounds-automation",
        name: "Query Bounds Automation",
        description: "Tests bounded action detail queries",
        status: AUTOMATION_STATUS.active,
        current_config_version_id: configVersionId,
        created_by: "usr_focus_operator",
        created_at: "2026-03-02T00:00:00.000Z",
        updated_at: "2026-03-02T00:00:00.000Z",
        next_config_version_number: 2,
      });

      await ctx.db.insert("automation_runs", {
        id: runId,
        automation_id: automationId,
        workspace_id: workspaceId,
        org_id: orgId,
        config_version_id: configVersionId,
        error_message: null,
        sandbox_id: null,
        log_storage_id: null,
        mcp_session_id: null,
        client_type: "other",
        metadata: {
          automation_run_status: "running",
          log_bytes: 0,
          log_eviction_noted: false,
        },
        status: RUN_STATUS.active,
        trigger_type: "manual",
        started_at: "2026-03-03T00:00:00.000Z",
        ended_at: null,
        created_at: "2026-03-03T00:00:00.000Z",
      });

      await ctx.db.insert("tool_calls", {
        id: toolCallId,
        automation_run_id: runId,
        tool_name: "gmail.sendEmail",
        input_redacted: {},
        output_redacted: null,
        status: TOOL_CALL_STATUS.approvalRequired,
        raw_input_blob_id: null,
        raw_output_blob_id: null,
        latency_ms: 0,
        created_at: "2026-03-03T00:00:01.000Z",
      });

      await ctx.db.insert("actions", {
        id: actionId,
        workspace_id: workspaceId,
        automation_run_id: runId,
        tool_call_id: toolCallId,
        action_type: "send_email",
        risk_level: "medium",
        normalized_payload_enc: "invalid",
        payload_preview: { to: "customer@example.com" },
        payload_purged_at: null,
        status: ACTION_STATUS.pending,
        idempotency_key: "idem_query_bounds",
        created_at: "2026-03-03T00:00:02.000Z",
        resolved_at: null,
        result_redacted: null,
      });

      for (let index = 0; index < 60; index += 1) {
        const hour = String(12 + Math.floor(index / 60)).padStart(2, "0");
        const minute = String(index % 60).padStart(2, "0");
        await ctx.db.insert("audit_events", {
          id: `audit_action_match_${index}`,
          org_id: orgId,
          action_id: actionId,
          actor_type: "user",
          actor_id: "usr_focus_operator",
          event_type: "action.created",
          payload: {
            action_id: actionId,
            sequence: index,
          },
          created_at: `2026-03-08T${hour}:${minute}:00.000Z`,
        });
      }

      for (let index = 0; index < 180; index += 1) {
        const minute = String(index % 60).padStart(2, "0");
        const hour = String(13 + Math.floor(index / 60)).padStart(2, "0");
        await ctx.db.insert("audit_events", {
          id: `audit_action_noise_${index}`,
          org_id: orgId,
          action_id: `act_noise_${index}`,
          actor_type: "system",
          actor_id: "noise",
          event_type: "rule.created",
          payload: {
            action_id: `act_noise_${index}`,
          },
          created_at: `2026-03-08T${hour}:${minute}:30.000Z`,
        });
      }
    });

    const detail = await authT.query(refs.getActionDetail, { actionId });
    expect(detail).not.toBeNull();
    expect(detail?.timeline).toHaveLength(50);
    expect(detail?.timeline[0]?.id).toBe("audit_action_match_59");
    expect(detail?.timeline.at(-1)?.id).toBe("audit_action_match_10");
    expect(detail?.timeline.every((entry) => entry.payload.action_id === actionId)).toBe(true);
  });

  it("returns workspace action queues from the newest indexed rows", async () => {
    const { t, orgId, authT } = await createAuthenticatedHarness();
    const workspaceId = "workspace_action_list";
    const automationId = "automation_action_list";
    const configVersionId = "acv_action_list";
    const runId = "arun_action_list";

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaces", {
        id: workspaceId,
        org_id: orgId,
        slug: "action-list",
        name: "Action List",
        status: WORKSPACE_STATUS.active,
        policy_mode: "manual_only",
        default_action_behavior: "require_approval",
        code_mode_enabled: true,
        automation_count: 1,
        created_at: "2026-03-02T00:00:00.000Z",
      });

      await ctx.db.insert("automation_config_versions", {
        id: configVersionId,
        automation_id: automationId,
        version_number: 1,
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
        prompt: "Prompt",
        network_access: "mcp_only",
        created_by: "usr_focus_operator",
        created_at: "2026-03-02T00:00:00.000Z",
        change_summary: null,
      });

      await ctx.db.insert("automations", {
        id: automationId,
        org_id: orgId,
        workspace_id: workspaceId,
        slug: "action-list-automation",
        name: "Action List Automation",
        description: "Tests indexed workspace action queries",
        status: AUTOMATION_STATUS.active,
        current_config_version_id: configVersionId,
        created_by: "usr_focus_operator",
        created_at: "2026-03-02T00:00:00.000Z",
        updated_at: "2026-03-02T00:00:00.000Z",
        next_config_version_number: 2,
      });

      await ctx.db.insert("automation_runs", {
        id: runId,
        automation_id: automationId,
        workspace_id: workspaceId,
        org_id: orgId,
        config_version_id: configVersionId,
        error_message: null,
        sandbox_id: null,
        log_storage_id: null,
        mcp_session_id: null,
        client_type: "other",
        metadata: {
          automation_run_status: "running",
          log_bytes: 0,
          log_eviction_noted: false,
        },
        status: RUN_STATUS.active,
        trigger_type: "manual",
        started_at: "2026-03-03T00:00:00.000Z",
        ended_at: null,
        created_at: "2026-03-03T00:00:00.000Z",
      });

      for (let index = 0; index < 220; index += 1) {
        const hour = String(12 + Math.floor(index / 3600)).padStart(2, "0");
        const minute = String(Math.floor((index % 3600) / 60)).padStart(2, "0");
        const second = String(index % 60).padStart(2, "0");
        await ctx.db.insert("actions", {
          id: `act_list_${index}`,
          workspace_id: workspaceId,
          automation_run_id: runId,
          tool_call_id: `tcall_list_${index}`,
          action_type: "send_email",
          risk_level: "medium",
          normalized_payload_enc: `enc_${index}`,
          payload_preview: { marker: index },
          payload_purged_at: null,
          status: index % 3 === 0 ? ACTION_STATUS.pending : ACTION_STATUS.approved,
          idempotency_key: `idem_list_${index}`,
          created_at: `2026-03-08T${hour}:${minute}:${second}.000Z`,
          resolved_at: index % 3 === 0 ? null : `2026-03-08T${hour}:${minute}:${second}.500Z`,
          result_redacted: null,
        });
      }

      await ctx.db.insert("actions", {
        id: "act_legacy_pending",
        automation_run_id: runId,
        tool_call_id: "tcall_legacy_pending",
        action_type: "send_email",
        risk_level: "medium",
        normalized_payload_enc: "enc_legacy_pending",
        payload_preview: { marker: "legacy-pending" },
        payload_purged_at: null,
        status: ACTION_STATUS.pending,
        idempotency_key: "idem_legacy_pending",
        created_at: "2026-03-08T23:59:59.000Z",
        resolved_at: null,
        result_redacted: null,
      });

      await ctx.db.insert("actions", {
        id: "act_legacy_approved",
        automation_run_id: runId,
        tool_call_id: "tcall_legacy_approved",
        action_type: "send_email",
        risk_level: "medium",
        normalized_payload_enc: "enc_legacy_approved",
        payload_preview: { marker: "legacy-approved" },
        payload_purged_at: null,
        status: ACTION_STATUS.approved,
        idempotency_key: "idem_legacy_approved",
        created_at: "2026-03-08T23:59:58.000Z",
        resolved_at: "2026-03-08T23:59:58.500Z",
        result_redacted: null,
      });
    });

    const allRows = await authT.query(refs.listActionsByWorkspace, {
      workspaceId,
    });
    expect(allRows).toHaveLength(200);
    expect(allRows[0]?.id).toBe("act_list_219");
    expect(allRows[199]?.id).toBe("act_list_20");
    expect(allRows.map((row) => row.id)).not.toContain("act_legacy_pending");
    expect(allRows.map((row) => row.id)).not.toContain("act_legacy_approved");

    const pendingRows = await authT.query(refs.listPendingActionsByWorkspace, {
      workspaceId,
    });
    expect(pendingRows[0]?.id).toBe("act_list_219");
    expect(pendingRows.every((row) => row.status === ACTION_STATUS.pending)).toBe(true);
    expect(pendingRows.map((row) => row.id)).not.toContain("act_legacy_pending");

    const pendingMcpRows = await t.query(refs.listPendingMcpActionsByWorkspace, {
      workspaceId,
    });
    expect(pendingMcpRows[0]?.id).toBe("act_list_219");
    expect(pendingMcpRows.every((row) => row.status === ACTION_STATUS.pending)).toBe(true);
    expect(pendingMcpRows.map((row) => row.id)).not.toContain("act_legacy_pending");
  });

  it("lists custom MCP workspace tools from one org-scoped tool read", async () => {
    const { t, orgId } = await createAuthenticatedHarness();
    const workspaceId = "workspace_custom_mcp_tools";

    await t.run(async (ctx) => {
      await ctx.db.insert("workspaces", {
        id: workspaceId,
        org_id: orgId,
        slug: "custom-mcp-tools",
        name: "Custom MCP Tools",
        status: WORKSPACE_STATUS.active,
        policy_mode: "manual_only",
        default_action_behavior: "require_approval",
        code_mode_enabled: true,
        automation_count: 0,
        created_at: "2026-03-02T00:00:00.000Z",
      });

      await ctx.db.insert("custom_mcp_servers", {
        id: "server_enabled_default",
        org_id: orgId,
        slug: "enabled-default",
        display_name: "Enabled Default",
        url: "https://enabled-default.example.com/mcp",
        bearer_token_enc: null,
        key_version: "convex_first_v1",
        status: "connected",
        last_discovery_at: null,
        last_discovery_error: null,
        tool_count: 2,
        created_by: "usr_test",
        created_at: "2026-03-02T00:00:00.000Z",
        updated_at: "2026-03-02T00:00:00.000Z",
      });

      await ctx.db.insert("custom_mcp_servers", {
        id: "server_disabled_workspace",
        org_id: orgId,
        slug: "disabled-workspace",
        display_name: "Disabled Workspace",
        url: "https://disabled-workspace.example.com/mcp",
        bearer_token_enc: null,
        key_version: "convex_first_v1",
        status: "connected",
        last_discovery_at: null,
        last_discovery_error: null,
        tool_count: 1,
        created_by: "usr_test",
        created_at: "2026-03-02T00:00:00.000Z",
        updated_at: "2026-03-02T00:00:00.000Z",
      });

      await ctx.db.insert("workspace_custom_servers", {
        id: "wcs_disabled_workspace",
        workspace_id: workspaceId,
        server_id: "server_disabled_workspace",
        enabled: false,
        created_by: "usr_test",
        created_at: "2026-03-02T00:00:00.000Z",
      });

      await ctx.db.insert("custom_mcp_tools", {
        id: "tool_alpha",
        server_id: "server_enabled_default",
        org_id: orgId,
        tool_name: "alpha.lookup",
        remote_tool_name: "alpha.lookup",
        description: "Alpha lookup",
        input_schema_json: '{"type":"object"}',
        risk_level: "low",
        requires_approval: false,
        enabled: true,
        discovered_at: "2026-03-02T00:00:00.000Z",
      });

      await ctx.db.insert("custom_mcp_tools", {
        id: "tool_beta_disabled",
        server_id: "server_enabled_default",
        org_id: orgId,
        tool_name: "beta.disabled",
        remote_tool_name: "beta.disabled",
        description: "Disabled beta tool",
        input_schema_json: '{"type":"object"}',
        risk_level: "low",
        requires_approval: false,
        enabled: false,
        discovered_at: "2026-03-02T00:00:00.000Z",
      });

      await ctx.db.insert("custom_mcp_tools", {
        id: "tool_gamma_blocked",
        server_id: "server_disabled_workspace",
        org_id: orgId,
        tool_name: "gamma.blocked",
        remote_tool_name: "gamma.blocked",
        description: "Blocked gamma tool",
        input_schema_json: '{"type":"object"}',
        risk_level: "medium",
        requires_approval: true,
        enabled: true,
        discovered_at: "2026-03-02T00:00:00.000Z",
      });
    });

    await expect(
      t.query(refs.listWorkspaceCustomTools, {
        workspaceId,
      }),
    ).resolves.toEqual([
      {
        name: "alpha.lookup",
        description: "Alpha lookup",
        input_schema_json: '{"type":"object"}',
      },
    ]);
  });
});
