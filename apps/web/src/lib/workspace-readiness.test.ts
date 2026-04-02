import { describe, expect, it } from "vitest";
import { buildWorkspaceReadinessSteps } from "./workspace-readiness";

describe("buildWorkspaceReadinessSteps", () => {
  it("collapses readiness into four user-facing steps", () => {
    const steps = buildWorkspaceReadinessSteps({
      has_connected_integration: true,
      has_enabled_workspace_integration: false,
      has_ai_key: false,
      has_automation: false,
      has_first_action: false,
    });

    expect(steps).toHaveLength(4);
    expect(steps.map((step) => step.id)).toEqual([
      "connect-provider",
      "configure-ai-key",
      "create-automation",
      "run-first-automation",
    ]);
    expect(steps[0]).toMatchObject({
      label: "Connect a provider",
      completed: false,
      href: "/integrations",
    });
  });

  it("requires both connect and enable milestones before provider setup is complete", () => {
    expect(
      buildWorkspaceReadinessSteps({
        has_connected_integration: true,
        has_enabled_workspace_integration: false,
        has_ai_key: false,
        has_automation: false,
        has_first_action: false,
      })[0]?.completed,
    ).toBe(false);

    expect(
      buildWorkspaceReadinessSteps({
        has_connected_integration: true,
        has_enabled_workspace_integration: true,
        has_ai_key: false,
        has_automation: false,
        has_first_action: false,
      })[0]?.completed,
    ).toBe(true);
  });

  it("tailors the AI access copy to hosted bundled runtime", () => {
    expect(
      buildWorkspaceReadinessSteps({
        has_connected_integration: true,
        has_enabled_workspace_integration: true,
        has_ai_key: false,
        ai_access_mode: "bundled",
        has_automation: false,
        has_first_action: false,
      })[1],
    ).toMatchObject({
      label: "Confirm AI access",
      description:
        "Generated automations stay blocked until the organization has available bundled AI credits.",
    });
  });

  it("keeps self-managed AI access copy focused on active provider keys", () => {
    expect(
      buildWorkspaceReadinessSteps({
        has_connected_integration: true,
        has_enabled_workspace_integration: true,
        has_ai_key: false,
        ai_access_mode: "self_managed",
        has_automation: false,
        has_first_action: false,
      })[1],
    ).toMatchObject({
      label: "Confirm AI access",
      description:
        "Generated automations stay blocked until the organization has an active self-managed AI key.",
    });
  });
});
