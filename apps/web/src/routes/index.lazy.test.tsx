import { screen } from "@testing-library/react";
import { MANAGED_OAUTH_PROVIDER_IDS } from "@keppo/shared/providers/boundaries/common";
import { describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./index.lazy";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { createAuthState, createWorkspaceState, renderDashboard } from "@/test/render-dashboard";

vi.mock("@/components/automations/automation-prompt-box", () => ({
  AutomationPromptBox: ({ variant }: { variant?: string }) => (
    <div data-testid={`automation-prompt-box-${variant ?? "hero"}`}>Automation prompt box</div>
  ),
}));

const onboardingReadiness = {
  has_connected_integration: false,
  has_enabled_workspace_integration: false,
  has_ai_key: false,
  has_automation: false,
  has_first_action: false,
};
const GOOGLE_PROVIDER_ID = MANAGED_OAUTH_PROVIDER_IDS[0]!;
const GITHUB_PROVIDER_ID = MANAGED_OAUTH_PROVIDER_IDS[2]!;

describe("DashboardPage", () => {
  it("shows a focused first-time view when the workspace has no automations", async () => {
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "actions:listPendingByWorkspace": () => [],
        "actions:getActionDetail": () => null,
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [],
        "onboarding:getReadiness": () => onboardingReadiness,
        "automations:listAutomations": () => ({
          page: [],
          isDone: true,
          continueCursor: "",
        }),
      },
      convexQueryHandlers: {
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [],
      },
    });

    renderDashboard(<DashboardPage />, {
      route: "/acme/workspace-1/",
      auth: createAuthState({
        isAuthenticated: true,
        session: {
          authenticated: true,
          user: { email: "operator@example.com", name: "Jamie Operator" },
        },
      }),
      workspace: createWorkspaceState({
        selectedWorkspaceId: "ws_1",
        selectedWorkspaceMatchesUrl: true,
      }),
      runtime,
    });

    expect(
      await screen.findByText("Create your first automation to get started."),
    ).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 4: Connect a provider")).toBeInTheDocument();
    expect(screen.queryByText("Recent Pending Actions")).not.toBeInTheDocument();
    expect(screen.queryByText("Automation summary")).not.toBeInTheDocument();
  });

  it("shows the returning-user summary and ignores refreshable credential expiry", async () => {
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "actions:listPendingByWorkspace": () => [],
        "actions:getActionDetail": () => null,
        "integrations:listForCurrentOrg": () => [
          {
            id: "int_google",
            org_id: "org_1",
            provider: GOOGLE_PROVIDER_ID,
            display_name: "Google",
            status: "connected",
            connected: true,
            scopes: ["gmail.readonly"],
            external_account_id: "automation@example.com",
            credential_expires_at: "2026-03-10T00:00:00.000Z",
            has_refresh_token: true,
            created_at: "2026-03-08T00:00:00.000Z",
            metadata: {},
          },
          {
            id: "int_github",
            org_id: "org_1",
            provider: GITHUB_PROVIDER_ID,
            display_name: "GitHub",
            status: "connected",
            connected: true,
            scopes: ["repo"],
            external_account_id: "octocat",
            credential_expires_at: "2026-03-10T00:00:00.000Z",
            has_refresh_token: false,
            created_at: "2026-03-08T01:00:00.000Z",
            metadata: {},
          },
        ],
        "integrations:providerCatalog": () => [],
        "onboarding:getReadiness": () => ({
          has_connected_integration: true,
          has_enabled_workspace_integration: true,
          has_ai_key: true,
          has_automation: true,
          has_first_action: false,
        }),
        "automations:listAutomations": () => ({
          page: [
            {
              automation: {
                id: "automation_1",
                org_id: "org_1",
                workspace_id: "ws_1",
                slug: "daily-digest",
                name: "Daily Digest",
                description: "Summarize inbox and issues",
                status: "active",
                current_config_version_id: "acv_1",
                created_by: "user_1",
                created_at: "2026-03-08T00:00:00.000Z",
                updated_at: "2026-03-08T00:00:00.000Z",
              },
              current_config_version: {
                id: "acv_1",
                version_number: 1,
                trigger_type: "schedule",
                runner_type: "chatgpt_codex",
                ai_model_provider: "openai",
                ai_model_name: "gpt-5.4",
                network_access: "mcp_only",
                created_at: "2026-03-08T00:00:00.000Z",
              },
              latest_run: {
                id: "run_1",
                automation_id: "automation_1",
                org_id: "org_1",
                workspace_id: "ws_1",
                config_version_id: "acv_1",
                trigger_type: "schedule",
                status: "succeeded",
                started_at: "2026-03-08T01:00:00.000Z",
                ended_at: "2026-03-08T01:01:00.000Z",
                error_message: null,
                sandbox_id: null,
                mcp_session_id: null,
                created_at: "2026-03-08T01:00:00.000Z",
              },
            },
          ],
          isDone: true,
          continueCursor: "",
        }),
      },
      convexQueryHandlers: {
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [],
      },
    });

    renderDashboard(<DashboardPage />, {
      route: "/acme/workspace-1/",
      auth: createAuthState({
        isAuthenticated: true,
        session: {
          authenticated: true,
          user: { email: "operator@example.com", name: "Jamie Operator" },
        },
      }),
      workspace: createWorkspaceState({
        selectedWorkspaceId: "ws_1",
        selectedWorkspaceMatchesUrl: true,
        selectedWorkspaceIntegrations: [
          {
            id: "wsi_google",
            workspace_id: "ws_1",
            provider: GOOGLE_PROVIDER_ID,
            enabled: true,
            created_by: "user_1",
            created_at: "2026-03-08T00:00:00.000Z",
          },
          {
            id: "wsi_github",
            workspace_id: "ws_1",
            provider: GITHUB_PROVIDER_ID,
            enabled: true,
            created_by: "user_1",
            created_at: "2026-03-08T00:00:00.000Z",
          },
        ],
      }),
      runtime,
    });

    expect(await screen.findByText("Automation summary")).toBeInTheDocument();
    expect(screen.getByText("Expand coverage")).toBeInTheDocument();
    expect(screen.getByText("Health and readiness")).toBeInTheDocument();
    expect(screen.getAllByText("1 credential expiring soon")).toHaveLength(2);
    expect(screen.queryByText("2 credentials expiring soon")).not.toBeInTheDocument();
    expect(screen.queryByText("Workspace status")).not.toBeInTheDocument();
    expect(screen.queryByText("Workspace readiness")).not.toBeInTheDocument();
  });

  it("keeps reconnect-required integrations out of the degraded attention count", async () => {
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "actions:listPendingByWorkspace": () => [],
        "actions:getActionDetail": () => null,
        "integrations:listForCurrentOrg": () => [
          {
            id: "int_google",
            org_id: "org_1",
            provider: GOOGLE_PROVIDER_ID,
            display_name: "Google",
            status: "degraded",
            connected: true,
            scopes: ["gmail.readonly"],
            external_account_id: "automation@example.com",
            credential_expires_at: null,
            has_refresh_token: true,
            created_at: "2026-03-08T00:00:00.000Z",
            last_health_check_at: "2026-03-08T00:05:00.000Z",
            last_successful_health_check_at: "2026-03-08T00:00:00.000Z",
            last_error_code: "missing_scopes",
            last_error_category: "auth",
            degraded_reason: null,
            metadata: {},
          },
          {
            id: "int_github",
            org_id: "org_1",
            provider: GITHUB_PROVIDER_ID,
            display_name: "GitHub",
            status: "degraded",
            connected: true,
            scopes: ["repo"],
            external_account_id: "octocat",
            credential_expires_at: null,
            has_refresh_token: true,
            created_at: "2026-03-08T01:00:00.000Z",
            last_health_check_at: "2026-03-08T01:05:00.000Z",
            last_successful_health_check_at: "2026-03-08T01:00:00.000Z",
            last_error_code: "rate_limited",
            last_error_category: "provider_api",
            degraded_reason: null,
            metadata: {},
          },
        ],
        "integrations:providerCatalog": () => [],
        "onboarding:getReadiness": () => ({
          has_connected_integration: true,
          has_enabled_workspace_integration: true,
          has_ai_key: true,
          has_automation: true,
          has_first_action: false,
        }),
        "automations:listAutomations": () => ({
          page: [
            {
              automation: {
                id: "automation_1",
                org_id: "org_1",
                workspace_id: "ws_1",
                slug: "daily-digest",
                name: "Daily Digest",
                description: "Summarize inbox and issues",
                status: "active",
                current_config_version_id: "acv_1",
                created_by: "user_1",
                created_at: "2026-03-08T00:00:00.000Z",
                updated_at: "2026-03-08T00:00:00.000Z",
              },
              current_config_version: {
                id: "acv_1",
                version_number: 1,
                trigger_type: "schedule",
                runner_type: "chatgpt_codex",
                ai_model_provider: "openai",
                ai_model_name: "gpt-5.4",
                network_access: "mcp_only",
                created_at: "2026-03-08T00:00:00.000Z",
              },
              latest_run: {
                id: "run_1",
                automation_id: "automation_1",
                org_id: "org_1",
                workspace_id: "ws_1",
                config_version_id: "acv_1",
                trigger_type: "schedule",
                status: "succeeded",
                started_at: "2026-03-08T01:00:00.000Z",
                ended_at: "2026-03-08T01:01:00.000Z",
                error_message: null,
                sandbox_id: null,
                mcp_session_id: null,
                created_at: "2026-03-08T01:00:00.000Z",
              },
            },
          ],
          isDone: true,
          continueCursor: "",
        }),
      },
      convexQueryHandlers: {
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [],
      },
    });

    renderDashboard(<DashboardPage />, {
      route: "/acme/workspace-1/",
      auth: createAuthState({
        isAuthenticated: true,
        session: {
          authenticated: true,
          user: { email: "operator@example.com", name: "Jamie Operator" },
        },
      }),
      workspace: createWorkspaceState({
        selectedWorkspaceId: "ws_1",
        selectedWorkspaceMatchesUrl: true,
        selectedWorkspaceIntegrations: [
          {
            id: "wsi_google",
            workspace_id: "ws_1",
            provider: GOOGLE_PROVIDER_ID,
            enabled: true,
            created_by: "user_1",
            created_at: "2026-03-08T00:00:00.000Z",
          },
          {
            id: "wsi_github",
            workspace_id: "ws_1",
            provider: GITHUB_PROVIDER_ID,
            enabled: true,
            created_by: "user_1",
            created_at: "2026-03-08T00:00:00.000Z",
          },
        ],
      }),
      runtime,
    });

    expect((await screen.findAllByText("1 integration needs reconnect")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 integration degraded").length).toBeGreaterThan(0);
    expect(screen.queryByText("2 integrations degraded")).not.toBeInTheDocument();
  });
});
