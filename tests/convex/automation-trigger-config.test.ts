import { describe, expect, it } from "vitest";
import { toAutomationConfigVersionView } from "../../convex/automations_shared";
import {
  getProviderAutomationTriggerDefinition,
  listPollingAutomationTriggers,
} from "../../packages/shared/src/providers/automation-trigger-registry";

describe("automation trigger config compatibility", () => {
  it("synthesizes provider-trigger metadata for legacy event rows on read", () => {
    const view = toAutomationConfigVersionView({
      id: "acv_legacy",
      automation_id: "automation_legacy",
      version_number: 3,
      trigger_type: "event",
      schedule_cron: null,
      provider_trigger: null,
      provider_trigger_migration_state: null,
      event_provider: "github",
      event_type: "issues.opened",
      event_predicate: "payload.action == 'opened'",
      runner_type: "chatgpt_codex",
      ai_model_provider: "openai",
      ai_model_name: "gpt-5.4",
      prompt: "Process inbound issues",
      network_access: "mcp_only",
      created_by: "usr_test",
      created_at: "2026-03-15T00:00:00.000Z",
      change_summary: null,
    } as never);

    expect(view.provider_trigger).toEqual({
      provider_id: "github",
      trigger_key: "issues.opened",
      schema_version: 1,
      filter: {
        predicate: "payload.action == 'opened'",
      },
      delivery: {
        preferred_mode: "webhook",
        supported_modes: ["webhook", "polling"],
        fallback_mode: "polling",
      },
      subscription_state: {
        status: "inactive",
        active_mode: null,
        last_error: null,
        updated_at: null,
      },
    });
    expect(view.provider_trigger_migration_state).toMatchObject({
      status: "legacy_passthrough",
      legacy_event_provider: "github",
      legacy_event_type: "issues.opened",
      legacy_event_predicate: "payload.action == 'opened'",
    });
  });

  it("derives polling automation triggers from provider modules", () => {
    expect(getProviderAutomationTriggerDefinition("google", "incoming_email")?.eventType).toBe(
      "google.gmail.incoming_email",
    );
    expect(getProviderAutomationTriggerDefinition("reddit", "mentions")?.eventType).toBe(
      "reddit.inbox.mention",
    );
    expect(
      getProviderAutomationTriggerDefinition("reddit", "unread_inbox_message")?.eventType,
    ).toBe("reddit.inbox.unread_message");
    expect(getProviderAutomationTriggerDefinition("x", "mentions")?.eventType).toBe(
      "x.mentions.post",
    );

    expect(
      listPollingAutomationTriggers().map(({ providerId, trigger }) => [
        providerId,
        trigger.key,
        trigger.scheduler.maxCandidatesPerReconcile,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["google", "incoming_email", 100],
        ["reddit", "mentions", 100],
        ["reddit", "unread_inbox_message", 100],
        ["x", "mentions", 100],
      ]),
    );
  });
});
