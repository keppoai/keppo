import { act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api-errors";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { createAuthState, renderDashboardHook } from "@/test/render-dashboard";
import { useIntegrations } from "./use-integrations";

const { requestOAuthProviderConnectMock, showUserFacingErrorToastMock } = vi.hoisted(() => ({
  requestOAuthProviderConnectMock: vi.fn(),
  showUserFacingErrorToastMock: vi.fn(),
}));

vi.mock("@/lib/server-functions/internal-api", () => ({
  requestOAuthProviderConnect: requestOAuthProviderConnectMock,
}));

vi.mock("@/lib/show-user-facing-error-toast", () => ({
  showUserFacingErrorToast: showUserFacingErrorToastMock,
}));

describe("useIntegrations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestOAuthProviderConnectMock.mockReset();
    showUserFacingErrorToastMock.mockReset();
  });

  it("deduplicates provider state and forwards manager mutations through canonical providers", async () => {
    const disconnectProvider = vi.fn(async () => undefined);
    const testProvider = vi.fn(async () => ({ ok: true, detail: "healthy" }));
    const registerCustomIntegration = vi.fn(async () => undefined);
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "integrations:listForCurrentOrg": () => [
          {
            id: "integration_old",
            org_id: "org_1",
            provider: "google",
            display_name: "Google Old",
            status: "degraded",
            connected: false,
            enabled: true,
            external_account_id: "stale@example.com",
            scopes: ["gmail.readonly"],
            credential_expires_at: null,
            created_at: "2026-03-07T00:00:00.000Z",
            updated_at: "2026-03-07T00:00:00.000Z",
            metadata: {},
          },
          {
            id: "integration_new",
            org_id: "org_1",
            provider: "google",
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
            provider: "google",
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
      mutationHandlers: {
        "integrations:disconnectProvider": disconnectProvider,
        "integrations:testProvider": testProvider,
        "integrations:registerCustomIntegration": registerCustomIntegration,
      },
    });

    const { result } = renderDashboardHook(() => useIntegrations(), {
      runtime,
      route: "/acme/workspace-1/integrations",
      auth: createAuthState({
        isAuthenticated: true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
        canManage: () => true,
      }),
    });

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    expect(result.current.providers).toEqual(["google"]);
    expect(result.current.integrations).toHaveLength(1);
    expect(result.current.integrations[0]).toMatchObject({
      id: "integration_new",
      provider: "google",
      connected: true,
    });
    expect(runtime.convexQuery).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.disconnectProvider("google");
      await expect(result.current.testConnection("google")).resolves.toEqual({
        ok: true,
        detail: "healthy",
      });
      await result.current.registerCustomIntegration({
        base_url: "https://mcp.example.com",
        display_name: "Support MCP",
        auth_method: "bearer_token",
        manifest: { version: "1" },
      });
    });

    expect(disconnectProvider).toHaveBeenCalledWith({ provider: "google" });
    expect(testProvider).toHaveBeenCalledWith({ provider: "google" });
    expect(registerCustomIntegration).toHaveBeenCalledWith({
      base_url: "https://mcp.example.com",
      display_name: "Support MCP",
      auth_method: "bearer_token",
      manifest: { version: "1" },
    });
  });

  it("blocks manager-only integration mutations for viewers and rejects unknown providers", async () => {
    const disconnectProvider = vi.fn(async () => undefined);
    const registerCustomIntegration = vi.fn(async () => undefined);
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [
          {
            provider: "google",
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
      mutationHandlers: {
        "integrations:disconnectProvider": disconnectProvider,
        "integrations:registerCustomIntegration": registerCustomIntegration,
      },
    });

    const { result } = renderDashboardHook(() => useIntegrations(), {
      runtime,
      route: "/acme/workspace-1/integrations",
      auth: createAuthState({
        isAuthenticated: true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
        canManage: () => false,
      }),
    });

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    await act(async () => {
      await result.current.disconnectProvider("google");
      await result.current.registerCustomIntegration({
        base_url: "https://mcp.example.com",
      });
      await expect(result.current.testConnection("slack" as never)).resolves.toEqual({
        ok: false,
        detail: "Unsupported provider",
      });
    });

    expect(disconnectProvider).not.toHaveBeenCalled();
    expect(registerCustomIntegration).not.toHaveBeenCalled();
  });

  it("surfaces auth failures from the Start-owned OAuth connect endpoint without falling back", async () => {
    const connectProviderMutation = vi.fn(async () => ({
      oauth_start_url: null,
    }));
    requestOAuthProviderConnectMock.mockRejectedValue(
      new ApiError("Only owners and admins can manage organization integrations.", 403, {
        envelope: {
          code: "forbidden",
          message: "Only owners and admins can manage organization integrations.",
          status: 403,
        },
      }),
    );

    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [
          {
            provider: "google",
            supported_tools: [],
          },
        ],
      },
      convexQueryHandlers: {
        "integrations:listForCurrentOrg": () => [],
        "integrations:providerCatalog": () => [],
      },
      mutationHandlers: {
        "integrations:connectProvider": connectProviderMutation,
      },
    });

    const { result } = renderDashboardHook(() => useIntegrations(), {
      runtime,
      route: "/acme/workspace-1/integrations",
      auth: createAuthState({
        isAuthenticated: true,
        getOrgId: () => "org_1",
        getOrgSlug: () => "acme",
        canManage: () => true,
      }),
    });

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    await act(async () => {
      await result.current.connectProvider("google");
    });

    expect(requestOAuthProviderConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google",
        org_id: "org_1",
      }),
    );
    expect(showUserFacingErrorToastMock).toHaveBeenCalledTimes(1);
    expect(connectProviderMutation).not.toHaveBeenCalled();
  });
});
