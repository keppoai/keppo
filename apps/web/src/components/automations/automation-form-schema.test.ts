import { describe, expect, it } from "vitest";
import {
  automationFormSchema,
  buildAutomationConfigInput,
  getDefaultAutomationFormValues,
  getProviderTriggerFormDefaults,
} from "./automation-form-schema";

describe("automation form schema", () => {
  it("maps Gmail trigger defaults from the canonical provider event type", () => {
    expect(
      getProviderTriggerFormDefaults({
        providerId: "google",
        triggerKey: "google.gmail.incoming_email",
      }),
    ).toEqual({
      provider_trigger_provider_id: "google",
      provider_trigger_key: "incoming_email",
      provider_trigger_filter: {
        from: "",
        to: "",
        subject_contains: "",
        has_any_labels: "",
        unread_only: false,
      },
    });
  });

  it("builds a native Gmail provider trigger payload from structured form fields", () => {
    const values = {
      ...getDefaultAutomationFormValues(),
      name: "Inbox triage",
      trigger_type: "event" as const,
      provider_trigger_provider_id: "google",
      provider_trigger_key: "incoming_email",
      provider_trigger_filter: {
        from: "alerts@example.com",
        to: "ops@example.com",
        subject_contains: "incident",
        has_any_labels: "IMPORTANT, Label_123",
        unread_only: true,
      },
      prompt: "Summarize new incidents",
    };

    expect(
      buildAutomationConfigInput(values, {
        triggerCelEnabled: false,
      }),
    ).toMatchObject({
      trigger_type: "event",
      provider_trigger: {
        provider_id: "google",
        trigger_key: "incoming_email",
        filter: {
          from: "alerts@example.com",
          to: "ops@example.com",
          subject_contains: "incident",
          has_any_labels: ["IMPORTANT", "Label_123"],
          unread_only: true,
        },
      },
    });
  });

  it("maps Reddit and X trigger defaults from canonical registry definitions", () => {
    expect(
      getProviderTriggerFormDefaults({
        providerId: "reddit",
        triggerKey: "reddit.inbox.mention",
      }),
    ).toEqual({
      provider_trigger_provider_id: "reddit",
      provider_trigger_key: "mentions",
      provider_trigger_filter: {
        from: "",
        subject_contains: "",
        body_contains: "",
      },
    });

    expect(
      getProviderTriggerFormDefaults({
        providerId: "x",
        triggerKey: "x.mentions.post",
      }),
    ).toEqual({
      provider_trigger_provider_id: "x",
      provider_trigger_key: "mentions",
      provider_trigger_filter: {
        text_contains: "",
        author_id: "",
      },
    });
  });

  it("builds polling-native Reddit and X trigger payloads from structured form fields", () => {
    const redditValues = {
      ...getDefaultAutomationFormValues(),
      name: "Reddit mention triage",
      trigger_type: "event" as const,
      provider_trigger_provider_id: "reddit",
      provider_trigger_key: "mentions",
      provider_trigger_filter: {
        from: "support_mod",
        subject_contains: "incident",
        body_contains: "urgent",
      },
      prompt: "Triage Reddit mentions",
    };
    const xValues = {
      ...getDefaultAutomationFormValues(),
      name: "X mention triage",
      trigger_type: "event" as const,
      provider_trigger_provider_id: "x",
      provider_trigger_key: "mentions",
      provider_trigger_filter: {
        text_contains: "keppo",
        author_id: "u_101",
      },
      prompt: "Triage X mentions",
    };

    expect(buildAutomationConfigInput(redditValues, { triggerCelEnabled: false })).toMatchObject({
      trigger_type: "event",
      provider_trigger: {
        provider_id: "reddit",
        trigger_key: "mentions",
        delivery: {
          preferred_mode: "polling",
          supported_modes: ["polling"],
          fallback_mode: null,
        },
        filter: {
          from: "support_mod",
          subject_contains: "incident",
          body_contains: "urgent",
        },
      },
    });

    expect(buildAutomationConfigInput(xValues, { triggerCelEnabled: false })).toMatchObject({
      trigger_type: "event",
      provider_trigger: {
        provider_id: "x",
        trigger_key: "mentions",
        delivery: {
          preferred_mode: "polling",
          supported_modes: ["polling"],
          fallback_mode: null,
        },
        filter: {
          text_contains: "keppo",
          author_id: "u_101",
        },
      },
    });
  });

  it("falls back to legacy event fields when no native trigger definition exists", () => {
    const values = {
      ...getDefaultAutomationFormValues(),
      name: "Issue opened",
      trigger_type: "event" as const,
      provider_trigger_provider_id: "github",
      provider_trigger_key: "issues.opened",
      prompt: "Summarize new issues",
    };

    expect(
      buildAutomationConfigInput(values, {
        triggerCelEnabled: false,
      }),
    ).toMatchObject({
      trigger_type: "event",
      event_provider: "github",
      event_type: "issues.opened",
    });
  });

  it("requires a provider-backed trigger when event mode is selected", () => {
    const result = automationFormSchema.safeParse({
      ...getDefaultAutomationFormValues(),
      name: "Inbox triage",
      trigger_type: "event",
      prompt: "Summarize new incidents",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain(
      "provider_trigger_provider_id",
    );
  });
});
