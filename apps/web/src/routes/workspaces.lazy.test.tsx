import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MANAGED_OAUTH_PROVIDER_IDS } from "@keppo/shared/providers/boundaries/common";
import { WorkspacesPage } from "./workspaces.lazy";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { createAuthState, createWorkspaceState, renderDashboard } from "@/test/render-dashboard";

describe("WorkspacesPage", () => {
  it("lets managers switch the selected workspace from the workspace grid", async () => {
    const setSelectedWorkspaceId = vi.fn();
    const connectedProvider = MANAGED_OAUTH_PROVIDER_IDS[0]!;
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "integrations:listForCurrentOrg": () => [
          {
            id: "integration_1",
            org_id: "org_1",
            provider: connectedProvider,
            display_name: "Connected Provider",
            status: "connected",
            connected: true,
            enabled: true,
            external_account_id: "acct_1",
            scopes: [],
            credential_expires_at: null,
            created_at: "2026-03-08T00:00:00.000Z",
            updated_at: "2026-03-08T00:00:00.000Z",
          },
        ],
        "integrations:providerCatalog": () => [],
        "custom_mcp:listWorkspaceServers": () => [],
      },
      convexQueryHandlers: {
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [],
      },
    });

    renderDashboard(<WorkspacesPage />, {
      route: "/acme/settings/workspaces",
      auth: createAuthState({
        isAuthenticated: true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
        canManage: () => true,
      }),
      workspace: createWorkspaceState({
        workspaces: [
          {
            id: "ws_1",
            org_id: "org_1",
            name: "Workspace One",
            slug: "workspace-1",
            status: "active",
            policy_mode: "manual_only",
            default_action_behavior: "require_approval",
            code_mode_enabled: false,
            created_at: "2026-03-08T00:00:00.000Z",
          },
          {
            id: "ws_2",
            org_id: "org_1",
            name: "Workspace Two",
            slug: "workspace-2",
            status: "active",
            policy_mode: "rules_first",
            default_action_behavior: "require_approval",
            code_mode_enabled: false,
            created_at: "2026-03-08T00:00:00.000Z",
          },
        ],
        selectedWorkspaceId: "ws_1",
        selectedWorkspace: {
          id: "ws_1",
          org_id: "org_1",
          name: "Workspace One",
          slug: "workspace-1",
          status: "active",
          policy_mode: "manual_only",
          default_action_behavior: "require_approval",
          code_mode_enabled: false,
          created_at: "2026-03-08T00:00:00.000Z",
        },
        setSelectedWorkspaceId,
      }),
      runtime,
    });

    expect(await screen.findByRole("heading", { name: "Workspaces" })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByText("Workspace Two"));
    expect(setSelectedWorkspaceId).toHaveBeenCalledWith("ws_2");
    expect(screen.getByTestId("workspace-policy-mode")).toBeInTheDocument();
  });

  it("holds a loading state for custom servers instead of showing a false empty message", async () => {
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [],
        "custom_mcp:listWorkspaceServers": () => undefined,
      },
      convexQueryHandlers: {
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [],
      },
    });

    renderDashboard(<WorkspacesPage />, {
      route: "/acme/settings/workspaces",
      auth: createAuthState({
        isAuthenticated: true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
        canManage: () => true,
      }),
      workspace: createWorkspaceState({
        selectedWorkspaceId: "ws_1",
        selectedWorkspace: {
          id: "ws_1",
          org_id: "org_1",
          name: "Workspace One",
          slug: "workspace-1",
          status: "active",
          policy_mode: "manual_only",
          default_action_behavior: "require_approval",
          code_mode_enabled: false,
          created_at: "2026-03-08T00:00:00.000Z",
        },
        selectedWorkspaceMatchesUrl: true,
      }),
      runtime,
    });

    expect(await screen.findByText("Custom MCP Servers")).toBeInTheDocument();
    expect(
      screen.queryByText("No custom MCP servers registered. Go to Custom Servers to add one."),
    ).not.toBeInTheDocument();
  });

  it("keeps workspace controls visible when integration lookups fail", async () => {
    renderDashboard(<WorkspacesPage />, {
      route: "/acme/settings/workspaces",
      auth: createAuthState({
        isAuthenticated: true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
        canManage: () => true,
      }),
      workspace: createWorkspaceState({
        selectedWorkspaceId: "ws_1",
        selectedWorkspace: {
          id: "ws_1",
          org_id: "org_1",
          name: "Workspace One",
          slug: "workspace-1",
          status: "active",
          policy_mode: "manual_only",
          default_action_behavior: "require_approval",
          code_mode_enabled: false,
          created_at: "2026-03-08T00:00:00.000Z",
        },
      }),
      runtime: createFakeDashboardRuntime({
        queryHandlers: {
          "integrations:listForCurrentOrg": () => {
            throw new Error("integration timeout");
          },
          "custom_mcp:listWorkspaceServers": () => [],
        },
      }),
    });

    expect(await screen.findByRole("heading", { name: "Workspaces" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Code Mode" })).toBeInTheDocument();
    expect(
      screen.getByText(/Integration availability is temporarily unavailable\./),
    ).toBeInTheDocument();
  });

  it("confirms workspace deletion before calling the delete action", async () => {
    const deleteSelectedWorkspace = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderDashboard(<WorkspacesPage />, {
      route: "/acme/settings/workspaces",
      auth: createAuthState({
        isAuthenticated: true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
        canManage: () => true,
      }),
      workspace: createWorkspaceState({
        workspaces: [
          {
            id: "ws_1",
            org_id: "org_1",
            name: "Workspace One",
            slug: "workspace-1",
            status: "active",
            policy_mode: "manual_only",
            default_action_behavior: "require_approval",
            code_mode_enabled: false,
            created_at: "2026-03-08T00:00:00.000Z",
          },
          {
            id: "ws_2",
            org_id: "org_1",
            name: "Workspace Two",
            slug: "workspace-2",
            status: "active",
            policy_mode: "manual_only",
            default_action_behavior: "require_approval",
            code_mode_enabled: false,
            created_at: "2026-03-08T00:00:00.000Z",
          },
        ],
        selectedWorkspaceId: "ws_2",
        selectedWorkspace: {
          id: "ws_2",
          org_id: "org_1",
          name: "Workspace Two",
          slug: "workspace-2",
          status: "active",
          policy_mode: "manual_only",
          default_action_behavior: "require_approval",
          code_mode_enabled: false,
          created_at: "2026-03-08T00:00:00.000Z",
        },
        deleteSelectedWorkspace,
      }),
      runtime: createFakeDashboardRuntime({
        queryHandlers: {
          "integrations:listForCurrentOrg": () => [],
          "integrations:providerCatalog": () => [],
          "custom_mcp:listWorkspaceServers": () => [],
        },
        convexQueryHandlers: {
          "integrations:listForCurrentOrg": () => [],
          "integrations:providerCatalog": () => [],
        },
      }),
    });

    expect(await screen.findByRole("heading", { name: "Workspaces" })).toBeInTheDocument();

    await user.click(screen.getByTestId("delete-workspace-trigger"));
    expect(screen.getByRole("alertdialog", { name: "Delete Workspace Two?" })).toBeInTheDocument();

    await user.click(screen.getByTestId("confirm-delete-workspace"));
    expect(deleteSelectedWorkspace).toHaveBeenCalledTimes(1);
  });
});
