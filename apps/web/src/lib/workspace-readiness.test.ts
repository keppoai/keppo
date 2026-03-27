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
});
