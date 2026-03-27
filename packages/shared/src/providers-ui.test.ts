import { describe, expect, it } from "vitest";
import { CANONICAL_PROVIDER_IDS } from "./provider-catalog.js";
import {
  getDefaultTestActionProviderId,
  getProviderAutoApprovalPresets,
  getProviderColorClass,
  getProviderDetailUi,
  getProviderIdsWithTestActionTemplates,
  getProviderMetadataEditorDefaults,
  getProviderTestActionTemplates,
  getProviderUiDefaults,
  getProviderWriteToolDefaultInput,
  PROVIDER_UI_PROVIDER_IDS,
} from "./providers-ui.js";

const emptyContext = {
  externalAccountId: null,
  signedInUserEmail: null,
  integrationMetadata: {},
} as const;

describe("provider UI contracts", () => {
  it("defines a detail UI config for every canonical provider", () => {
    for (const providerId of CANONICAL_PROVIDER_IDS) {
      const config = getProviderDetailUi(providerId);
      expect(config.panelTitle.length).toBeGreaterThan(0);
      expect(config.fields.length).toBeGreaterThan(0);
      expect(Array.isArray(config.metadataEditors)).toBe(true);
    }
  });

  it("exports provider UI ids aligned with canonical provider ids", () => {
    expect(PROVIDER_UI_PROVIDER_IDS).toEqual(CANONICAL_PROVIDER_IDS);
  });

  it("hydrates google defaults from the signed-in user email before the connected account", () => {
    const defaults = getProviderUiDefaults("google", {
      externalAccountId: "automation@example.com",
      signedInUserEmail: "owner@example.com",
      integrationMetadata: {},
    });

    expect(defaults.to).toBe("owner@example.com");

    const request = getProviderDetailUi("google").buildActionRequest(defaults, {
      selectedWriteTool: null,
      availableWriteTools: ["gmail.sendEmail"],
    });

    expect(request.toolName).toBe("gmail.sendEmail");
    expect(request.input).toMatchObject({
      to: ["owner@example.com"],
      subject: "Integration test from Google",
    });
  });

  it("falls back to the connected account when the signed-in email is unavailable", () => {
    const defaults = getProviderUiDefaults("google", {
      externalAccountId: "automation@example.com",
      signedInUserEmail: null,
      integrationMetadata: {},
    });

    expect(defaults.to).toBe("automation@example.com");
  });

  it("normalizes stripe metadata editor values", () => {
    const stripeEditor = getProviderDetailUi("stripe").metadataEditors[0];
    if (!stripeEditor) {
      throw new Error("Missing stripe metadata editor");
    }

    const hydrated = getProviderMetadataEditorDefaults(stripeEditor, {
      externalAccountId: null,
      signedInUserEmail: null,
      integrationMetadata: {
        allowed_write_modes: ["refund", "cancel_subscription"],
      },
    });

    expect(hydrated.allowed_write_modes).toBe("refund, cancel_subscription");

    const patch = stripeEditor.buildMetadataPatch({
      allowed_write_modes: "REFUND, cancel_subscription, refund",
    });

    expect(patch).toEqual({
      allowed_write_modes: ["refund", "cancel_subscription"],
    });
  });

  it("normalizes github metadata editor values", () => {
    const githubEditor = getProviderDetailUi("github").metadataEditors[0];
    if (!githubEditor) {
      throw new Error("Missing github metadata editor");
    }

    const hydrated = getProviderMetadataEditorDefaults(githubEditor, {
      externalAccountId: null,
      signedInUserEmail: null,
      integrationMetadata: {
        allowed_repositories: ["org/repo", "keppo/support"],
      },
    });

    expect(hydrated.allowed_repositories).toBe("org/repo, keppo/support");
    expect(
      githubEditor.buildMetadataPatch({
        allowed_repositories: "org/repo, keppo/support",
      }),
    ).toEqual({
      allowed_repositories: ["org/repo", "keppo/support"],
    });
  });

  it("parses generic provider write payload JSON", () => {
    const request = getProviderDetailUi("slack").buildActionRequest(
      {
        payload: '{"channel":"#support","text":"hello"}',
      },
      {
        selectedWriteTool: "slack.postMessage",
        availableWriteTools: ["slack.postMessage"],
      },
    );

    expect(request).toEqual({
      toolName: "slack.postMessage",
      input: {
        channel: "#support",
        text: "hello",
      },
    });
  });

  it("returns provider color metadata from shared UI registry", () => {
    expect(getProviderColorClass("google")).toContain("bg-red-50");
    expect(getProviderColorClass("custom")).toContain("bg-blue-50");
  });

  it("returns generic write defaults from shared UI registry", () => {
    expect(getProviderWriteToolDefaultInput("slack.postMessage")).toEqual({
      channel: "#support",
      text: "Test message from integration detail page",
    });
    expect(getProviderWriteToolDefaultInput("unknown.tool")).toEqual({});
  });

  it("returns shared auto-approval presets with tool risk metadata", () => {
    expect(getProviderAutoApprovalPresets()).toEqual([
      { toolName: "gmail.applyLabel", riskLevel: "low" },
      { toolName: "gmail.archive", riskLevel: "low" },
      { toolName: "gmail.sendEmail", riskLevel: "high" },
      { toolName: "stripe.issueRefund", riskLevel: "high" },
      { toolName: "stripe.cancelSubscription", riskLevel: "medium" },
    ]);
  });

  it("exposes shared test action templates and provider defaults", () => {
    expect(getProviderIdsWithTestActionTemplates()).toEqual(["google"]);
    expect(getDefaultTestActionProviderId()).toBe("google");

    const templates = getProviderTestActionTemplates("google");
    expect(templates.map((template) => template.toolName)).toEqual([
      "gmail.sendEmail",
      "gmail.replyToThread",
      "gmail.applyLabel",
      "gmail.archive",
    ]);

    expect(templates[0]?.buildInput(templates[0].defaults)).toEqual({
      to: ["alice@example.com"],
      cc: [],
      bcc: [],
      subject: "Q4 Budget Review",
      body: "Hi Alice,\n\nPlease review the attached Q4 budget report and share feedback by Friday.\n\nThanks,\nBob",
    });
  });

  it("returns no test action templates for providers without shared presets", () => {
    expect(getProviderTestActionTemplates("slack")).toEqual([]);
  });

  it("rejects generic provider requests with no available write tool", () => {
    expect(() =>
      getProviderDetailUi("notion").buildActionRequest(
        {
          payload: {},
        },
        {
          selectedWriteTool: null,
          availableWriteTools: [],
        },
      ),
    ).toThrow(/No write tools/i);
  });

  it("rejects invalid generic JSON payloads", () => {
    expect(() =>
      getProviderDetailUi("reddit").buildActionRequest(
        {
          payload: "{not json}",
        },
        {
          selectedWriteTool: "reddit.createPost",
          availableWriteTools: ["reddit.createPost"],
        },
      ),
    ).toThrow(/valid JSON/i);
  });

  it("still allows defaults for custom provider", () => {
    const defaults = getProviderUiDefaults("custom", emptyContext);
    expect(defaults.payload).toEqual({});
  });
});
