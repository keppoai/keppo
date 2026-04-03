import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MANAGED_OAUTH_PROVIDER_IDS } from "@keppo/shared/providers/boundaries/common";
import { describe, expect, it, vi } from "vitest";
import { IntegrationDetailPage } from "./integrations.$provider.lazy";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { createAuthState, createWorkspaceState, renderDashboard } from "@/test/render-dashboard";

describe("IntegrationDetailPage", () => {
  it("runs a provider test action and shows the resulting execution state", async () => {
    const providerId = MANAGED_OAUTH_PROVIDER_IDS[0]!;
    const createTestAction = vi.fn(async () => ({ action_id: "action_1" }));
    const approveAction = vi.fn(async () => undefined);
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "integrations:listForCurrentOrg": () => [
          {
            id: "integration_1",
            org_id: "org_1",
            provider: providerId,
            display_name: "Google",
            status: "connected",
            connected: true,
            enabled: true,
            external_account_id: "automation@example.com",
            scopes: ["gmail.send"],
            credential_expires_at: null,
            created_at: "2026-03-08T00:00:00.000Z",
            updated_at: "2026-03-08T00:00:00.000Z",
            metadata: {},
            last_health_check_at: "2026-03-08T00:05:00.000Z",
            last_successful_health_check_at: "2026-03-08T00:05:00.000Z",
            last_webhook_at: null,
            last_error_code: null,
            last_error_category: null,
            degraded_reason: null,
          },
        ],
        "integrations:providerCatalog": () => [
          {
            provider: providerId,
            supported_tools: [
              {
                name: "gmail.sendEmail",
                capability: "write",
                risk_level: "high",
                requires_approval: true,
              },
            ],
          },
        ],
        "actions:getActionDetail": (args) =>
          args === "skip" || !args || (args as { actionId?: string }).actionId !== "action_1"
            ? null
            : {
                action: {
                  id: "action_1",
                  workspace_id: "ws_1",
                  action_type: "gmail.sendEmail",
                  risk_level: "high",
                  status: "succeeded",
                  payload_preview: {
                    to: ["automation@example.com"],
                    subject: "Integration test from Google",
                  },
                  result_redacted: {
                    accepted: true,
                  },
                  idempotency_key: "idem_1",
                  created_at: "2026-03-08T00:00:00.000Z",
                  resolved_at: "2026-03-08T00:01:00.000Z",
                },
                approval: null,
                auditEvents: [],
              },
      },
      convexQueryHandlers: {
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [],
      },
      mutationHandlers: {
        "actions:createTestAction": createTestAction,
        "actions:approveAction": approveAction,
      },
    });

    renderDashboard(<IntegrationDetailPage />, {
      route: `/acme/workspace-1/integrations/${providerId}`,
      auth: createAuthState({
        isAuthenticated: true,
        session: {
          authenticated: true,
          user: {
            email: "owner@example.com",
          },
        },
        canManage: () => true,
        canApprove: () => true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
      }),
      workspace: createWorkspaceState({
        selectedWorkspaceId: "ws_1",
        selectedWorkspaceIntegrations: [
          {
            id: "wsi_1",
            workspace_id: "ws_1",
            provider: providerId,
            enabled: true,
            created_by: "user_1",
            created_at: "2026-03-08T00:00:00.000Z",
          },
        ],
      }),
      runtime,
    });

    expect(await screen.findByRole("heading", { name: "Google Integration" })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("button", { name: "Run test action" }));

    await waitFor(() => {
      expect(createTestAction).toHaveBeenCalledWith({
        workspaceId: "ws_1",
        tool_name: "gmail.sendEmail",
        input: expect.objectContaining({
          to: ["owner@example.com"],
          subject: "Integration test from Google",
        }),
      });
    });
    expect(approveAction).toHaveBeenCalledWith({
      actionId: "action_1",
      reason: "Manual test action from Google integration page",
    });
    expect(await screen.findByText("Google action succeeded.")).toBeInTheDocument();
    expect(screen.getByText("Latest action")).toBeInTheDocument();
    expect(screen.getByText(/Action ID: action_1/)).toBeInTheDocument();
  });

  it("shows workspace enablement guidance before test actions are allowed", async () => {
    const providerId = MANAGED_OAUTH_PROVIDER_IDS[0]!;
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "integrations:listForCurrentOrg": () => [
          {
            id: "integration_1",
            org_id: "org_1",
            provider: providerId,
            display_name: "Google",
            status: "connected",
            connected: true,
            enabled: true,
            external_account_id: "automation@example.com",
            scopes: ["gmail.send"],
            credential_expires_at: null,
            created_at: "2026-03-08T00:00:00.000Z",
            updated_at: "2026-03-08T00:00:00.000Z",
            metadata: {},
          },
        ],
        "integrations:providerCatalog": () => [
          {
            provider: providerId,
            supported_tools: [
              {
                name: "gmail.sendEmail",
                capability: "write",
                risk_level: "high",
                requires_approval: true,
              },
            ],
          },
        ],
      },
      convexQueryHandlers: {
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [],
      },
    });

    renderDashboard(<IntegrationDetailPage />, {
      route: `/acme/workspace-1/integrations/${providerId}`,
      auth: createAuthState({
        isAuthenticated: true,
        canManage: () => true,
        canApprove: () => true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
      }),
      workspace: createWorkspaceState({
        selectedWorkspaceId: "ws_1",
        selectedWorkspaceIntegrations: [
          {
            id: "wsi_1",
            workspace_id: "ws_1",
            provider: providerId,
            enabled: false,
            created_by: "user_1",
            created_at: "2026-03-08T00:00:00.000Z",
          },
        ],
      }),
      runtime,
    });

    expect(await screen.findByText("Google is not enabled for this workspace")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open workspace settings" })).toBeInTheDocument();
    expect(
      screen.getByText(
        /Turn on Google in workspace settings before using provider-specific test actions/i,
      ),
    ).toBeInTheDocument();
  });

  it("seeds the gmail To field with the signed-in user email", async () => {
    const providerId = MANAGED_OAUTH_PROVIDER_IDS[0]!;
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "integrations:listForCurrentOrg": () => [
          {
            id: "integration_1",
            org_id: "org_1",
            provider: providerId,
            display_name: "Google",
            status: "connected",
            connected: true,
            enabled: true,
            external_account_id: "automation@example.com",
            scopes: ["gmail.send"],
            credential_expires_at: null,
            created_at: "2026-03-08T00:00:00.000Z",
            updated_at: "2026-03-08T00:00:00.000Z",
            metadata: {},
          },
        ],
        "integrations:providerCatalog": () => [
          {
            provider: providerId,
            supported_tools: [
              {
                name: "gmail.sendEmail",
                capability: "write",
                risk_level: "high",
                requires_approval: true,
              },
            ],
          },
        ],
      },
      convexQueryHandlers: {
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [],
      },
    });

    renderDashboard(<IntegrationDetailPage />, {
      route: `/acme/workspace-1/integrations/${providerId}`,
      auth: createAuthState({
        isAuthenticated: true,
        session: {
          authenticated: true,
          user: {
            email: "owner@example.com",
          },
        },
        canManage: () => true,
        canApprove: () => true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
      }),
      workspace: createWorkspaceState({
        selectedWorkspaceId: "ws_1",
        selectedWorkspaceIntegrations: [
          {
            id: "wsi_1",
            workspace_id: "ws_1",
            provider: providerId,
            enabled: true,
            created_by: "user_1",
            created_at: "2026-03-08T00:00:00.000Z",
          },
        ],
      }),
      runtime,
    });

    expect(await screen.findByLabelText("To")).toHaveValue("owner@example.com");
  });

  it("shows Gmail trigger delivery health from persisted lifecycle metadata", async () => {
    const providerId = MANAGED_OAUTH_PROVIDER_IDS[0]!;
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "integrations:listForCurrentOrg": () => [
          {
            id: "integration_1",
            org_id: "org_1",
            provider: providerId,
            display_name: "Google",
            status: "connected",
            connected: true,
            enabled: true,
            external_account_id: "automation@example.com",
            scopes: ["gmail.readonly"],
            credential_expires_at: null,
            created_at: "2026-03-08T00:00:00.000Z",
            updated_at: "2026-03-08T00:00:00.000Z",
            metadata: {
              automation_trigger_lifecycle: {
                google: {
                  incoming_email: {
                    active_mode: "webhook",
                    watch_topic_name: "projects/demo/topics/gmail",
                    watch_expiration: "2026-03-08T01:00:00.000Z",
                    history_cursor: "12345",
                    last_sync_at: "2026-03-08T00:55:00.000Z",
                    last_poll_at: "2026-03-08T00:40:00.000Z",
                    last_error: null,
                  },
                },
              },
            },
            last_health_check_at: "2026-03-08T00:55:00.000Z",
            last_successful_health_check_at: "2026-03-08T00:55:00.000Z",
            last_webhook_at: "2026-03-08T00:54:00.000Z",
            last_error_code: null,
            last_error_category: null,
            degraded_reason: null,
          },
        ],
        "integrations:providerCatalog": () => [
          {
            provider: providerId,
            supported_tools: [
              {
                name: "gmail.sendEmail",
                capability: "write",
                risk_level: "high",
                requires_approval: true,
              },
            ],
          },
        ],
      },
      convexQueryHandlers: {
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [],
      },
    });

    renderDashboard(<IntegrationDetailPage />, {
      route: `/acme/workspace-1/integrations/${providerId}`,
      auth: createAuthState({
        isAuthenticated: true,
        canManage: () => true,
        canApprove: () => true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
      }),
      workspace: createWorkspaceState({
        selectedWorkspaceId: "ws_1",
        selectedWorkspaceIntegrations: [
          {
            id: "wsi_1",
            workspace_id: "ws_1",
            provider: providerId,
            enabled: true,
            created_by: "user_1",
            created_at: "2026-03-08T00:00:00.000Z",
          },
        ],
      }),
      runtime,
    });

    expect(await screen.findByText("Gmail Event Delivery")).toBeInTheDocument();
    expect(screen.getByText("Push watch active")).toBeInTheDocument();
    expect(screen.getByText("12345")).toBeInTheDocument();
    expect(screen.getByText(/Watch expires/i)).toBeInTheDocument();
  });

  it("shows the unhealthy reason and diagnostic for degraded integrations", async () => {
    const providerId = MANAGED_OAUTH_PROVIDER_IDS[0]!;
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "integrations:listForCurrentOrg": () => [
          {
            id: "integration_1",
            org_id: "org_1",
            provider: providerId,
            display_name: "Google",
            status: "degraded",
            connected: true,
            enabled: true,
            external_account_id: "automation@example.com",
            scopes: ["gmail.send"],
            credential_expires_at: null,
            created_at: "2026-03-08T00:00:00.000Z",
            updated_at: "2026-03-08T00:00:00.000Z",
            metadata: {},
            last_health_check_at: "2026-03-08T00:08:00.000Z",
            last_successful_health_check_at: "2026-03-08T00:05:00.000Z",
            last_webhook_at: null,
            last_error_code: "missing_scopes",
            last_error_category: "auth",
            degraded_reason: null,
          },
        ],
        "integrations:providerCatalog": () => [
          {
            provider: providerId,
            supported_tools: [],
          },
        ],
      },
      convexQueryHandlers: {
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [],
      },
    });

    renderDashboard(<IntegrationDetailPage />, {
      route: `/acme/workspace-1/integrations/${providerId}`,
      auth: createAuthState({
        isAuthenticated: true,
        canManage: () => true,
        canApprove: () => true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
      }),
      workspace: createWorkspaceState({
        selectedWorkspaceId: "ws_1",
        selectedWorkspaceIntegrations: [
          {
            id: "wsi_1",
            workspace_id: "ws_1",
            provider: providerId,
            enabled: true,
            created_by: "user_1",
            created_at: "2026-03-08T00:00:00.000Z",
          },
        ],
      }),
      runtime,
    });

    expect(await screen.findByText("Why unhealthy:")).toBeInTheDocument();
    expect(
      screen.getAllByText("Missing required provider scopes. Reconnect with required permissions.")
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Auth / Missing scopes")).toBeInTheDocument();
  });

  it("shows connected status for transient degraded integrations", async () => {
    const providerId = MANAGED_OAUTH_PROVIDER_IDS[0]!;
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "integrations:listForCurrentOrg": () => [
          {
            id: "integration_1",
            org_id: "org_1",
            provider: providerId,
            display_name: "Google",
            status: "degraded",
            connected: true,
            enabled: true,
            external_account_id: "automation@example.com",
            scopes: ["gmail.send"],
            credential_expires_at: null,
            created_at: "2026-03-08T00:00:00.000Z",
            updated_at: "2026-03-08T00:00:00.000Z",
            metadata: {},
            last_health_check_at: "2026-03-08T00:08:00.000Z",
            last_successful_health_check_at: "2026-03-08T00:05:00.000Z",
            last_webhook_at: null,
            last_error_code: "rate_limited",
            last_error_category: "provider_api",
            degraded_reason: null,
          },
        ],
        "integrations:providerCatalog": () => [
          {
            provider: providerId,
            supported_tools: [],
          },
        ],
      },
      convexQueryHandlers: {
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [],
      },
    });

    renderDashboard(<IntegrationDetailPage />, {
      route: `/acme/workspace-1/integrations/${providerId}`,
      auth: createAuthState({
        isAuthenticated: true,
        canManage: () => true,
        canApprove: () => true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
      }),
      workspace: createWorkspaceState({
        selectedWorkspaceId: "ws_1",
        selectedWorkspaceIntegrations: [
          {
            id: "wsi_1",
            workspace_id: "ws_1",
            provider: providerId,
            enabled: true,
            created_by: "user_1",
            created_at: "2026-03-08T00:00:00.000Z",
          },
        ],
      }),
      runtime,
    });

    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Provider API / Rate limited")).toBeInTheDocument();
    expect(screen.queryByText("Needs reconnect")).not.toBeInTheDocument();
  });
});
