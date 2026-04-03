import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshCredentials = vi.fn();

vi.mock("../../convex/mcp_node_shared.ts", async () => {
  const actual = await vi.importActual<typeof import("../../convex/mcp_node_shared")>(
    "../../convex/mcp_node_shared.ts",
  );
  return {
    ...actual,
    getProviderModuleV2: vi.fn(() => ({
      metadata: {
        capabilities: {
          read: true,
          write: true,
          refreshCredentials: true,
        },
      },
      facets: {
        refresh: {
          refreshCredentials,
        },
      },
    })),
  };
});

import { createRefreshConnectorContextAccessToken } from "../../convex/mcp_node/provider_runtime";

describe("createRefreshConnectorContextAccessToken", () => {
  beforeEach(() => {
    refreshCredentials.mockReset();
  });

  it("does not persist tokens before the success mutation completes", async () => {
    refreshCredentials.mockResolvedValue({
      accessToken: "refreshed_access_token",
      refreshToken: "refreshed_refresh_token",
      expiresAt: "2099-01-01T00:00:00.000Z",
      scopes: [],
      externalAccountId: null,
    });

    const markCredentialRefreshResult = vi
      .fn()
      .mockRejectedValue(new Error("mark refresh result failed"));
    const updateIntegrationCredential = vi.fn();
    const refreshAccessToken = createRefreshConnectorContextAccessToken({
      markCredentialRefreshResult,
      updateIntegrationCredential,
    } as never);
    const actionCtx = {} as never;

    await expect(
      refreshAccessToken(actionCtx, {
        provider: "google",
        context: {
          workspaceId: "workspace_1",
          orgId: "org_1",
          scopes: ["gmail.readonly"],
          access_token: "expired_access_token",
          refresh_token: "refresh_token",
          access_token_expires_at: "2000-01-01T00:00:00.000Z",
        },
      }),
    ).rejects.toThrow("mark refresh result failed");

    expect(updateIntegrationCredential).not.toHaveBeenCalled();
    expect(markCredentialRefreshResult).toHaveBeenNthCalledWith(1, actionCtx, {
      orgId: "org_1",
      provider: "google",
      success: true,
      accessToken: "refreshed_access_token",
      refreshToken: "refreshed_refresh_token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(markCredentialRefreshResult).toHaveBeenCalledTimes(2);
  });
});
