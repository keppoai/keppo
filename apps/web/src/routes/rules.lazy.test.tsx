import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { RulesPage } from "./rules.lazy";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { createAuthState, createWorkspaceState, renderDashboard } from "@/test/render-dashboard";

describe("RulesPage", () => {
  it("opens the rule builder from the empty state for managers", async () => {
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "admin:orgFeatureAccess": () => true,
        "rules:getWorkspaceRules": () => ({
          workspace: {
            id: "ws_1",
            org_id: "org_1",
            slug: "workspace-1",
            name: "Workspace 1",
            status: "active",
            policy_mode: "manual_only",
            default_action_behavior: "require_approval",
            code_mode_enabled: false,
            created_at: "2026-03-08T00:00:00.000Z",
          },
          rules: [],
          policies: [],
          auto_approvals: [],
          matches: [],
          decisions: [],
        }),
      },
    });

    renderDashboard(<RulesPage />, {
      route: "/acme/workspace-1/rules",
      auth: createAuthState({
        isAuthenticated: true,
        canManage: () => true,
      }),
      workspace: createWorkspaceState({
        selectedWorkspaceId: "ws_1",
        selectedWorkspaceMatchesUrl: true,
      }),
      runtime,
    });

    expect(await screen.findByText("No rules configured")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Create the first rule" }));
    expect(
      await screen.findByText("How should this workspace handle actions by default?"),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "CEL Rules" })).toBeInTheDocument();
  });

  it("shows a loading shell instead of the empty state while workspace rules are still loading", async () => {
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "admin:orgFeatureAccess": () => true,
        "rules:getWorkspaceRules": () => undefined,
      },
    });

    renderDashboard(<RulesPage />, {
      route: "/acme/workspace-1/rules",
      auth: createAuthState({
        isAuthenticated: true,
        canManage: () => true,
      }),
      workspace: createWorkspaceState({
        selectedWorkspaceId: "ws_1",
        selectedWorkspaceMatchesUrl: true,
      }),
      runtime,
    });

    expect(await screen.findByText("Policy Mode")).toBeInTheDocument();
    expect(screen.queryByText("No rules configured")).not.toBeInTheDocument();
  });
});
