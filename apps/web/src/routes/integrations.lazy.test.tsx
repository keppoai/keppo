import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationsPage } from "./integrations.lazy";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { createAuthState, renderDashboard } from "@/test/render-dashboard";

const navigateSpy = vi.fn();
let searchState: {
  integration_connected?: string;
  oauth_error?: string;
  oauth_provider?: string;
} = {};

vi.mock("./integrations", () => ({
  integrationsRoute: {
    id: "/integrations",
    useSearch: () => searchState,
    useNavigate: () => navigateSpy,
  },
}));

vi.mock("@/hooks/use-integrations", () => ({
  useIntegrations: () => ({
    isLoading: false,
    providers: ["google"],
    providerCatalog: [{ provider: "google", supported_tools: [] }],
    integrations: [],
    connectProvider: vi.fn(),
    disconnectProvider: vi.fn(),
    testConnection: vi.fn(),
  }),
}));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => navigateSpy,
    createLazyRoute: () => (_config: unknown) => _config,
  };
});

describe("IntegrationsPage", () => {
  beforeEach(() => {
    navigateSpy.mockReset();
    searchState = {};
  });

  it("renders a success banner for completed OAuth redirects", async () => {
    searchState = { integration_connected: "google" };

    renderDashboard(<IntegrationsPage />, {
      auth: createAuthState({
        isAuthenticated: true,
        canManage: () => true,
      }),
      runtime: createFakeDashboardRuntime(),
    });

    expect(await screen.findByText("Google connected")).toBeInTheDocument();
    expect(
      screen.getByText("Keppo can now use this integration in the current workspace."),
    ).toBeInTheDocument();
  });

  it("renders callback auth failures with actionable guidance and clears feedback on dismiss", async () => {
    const user = userEvent.setup();
    searchState = { oauth_error: "forbidden", oauth_provider: "google" };

    renderDashboard(<IntegrationsPage />, {
      auth: createAuthState({
        isAuthenticated: true,
        canManage: () => true,
      }),
      runtime: createFakeDashboardRuntime(),
    });

    expect(await screen.findByText("Access blocked")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Google can only be connected by the same owner or admin who started the flow.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(navigateSpy).toHaveBeenCalledWith({
      replace: true,
      search: expect.any(Function),
    });
    const searchUpdater = navigateSpy.mock.calls[0]?.[0]?.search as
      | ((prev: typeof searchState) => typeof searchState)
      | undefined;
    expect(
      searchUpdater?.({
        integration_connected: "google",
        oauth_error: "forbidden",
        oauth_provider: "google",
      }),
    ).toEqual({
      integration_connected: undefined,
      oauth_error: undefined,
      oauth_provider: undefined,
    });
  });
});
