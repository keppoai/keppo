import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntegrationsPage } from "./integrations.lazy";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { createAuthState, renderDashboard } from "@/test/render-dashboard";

const searchNavigateSpy = vi.fn();
let searchState: {
  integration_connected?: string;
  oauth_error?: string;
  oauth_provider?: string;
} = {};

vi.mock("./integrations", () => ({
  integrationsRoute: {
    id: "/integrations",
    useSearch: () => searchState,
    useNavigate: () => searchNavigateSpy,
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

describe("IntegrationsPage", () => {
  beforeEach(() => {
    searchNavigateSpy.mockReset();
    searchState = {};
    window.history.replaceState({}, "", "/acme/workspace-1/integrations");
  });

  it("renders a success banner for completed OAuth redirects and auto-clears it", async () => {
    searchState = { integration_connected: "google" };
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");

    renderDashboard(<IntegrationsPage />, {
      route: "/acme/workspace-1/integrations?integration_connected=google",
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

    const timeoutCallback = setTimeoutSpy.mock.calls.find(([, delay]) => delay === 8_000)?.[0];
    expect(typeof timeoutCallback).toBe("function");

    await act(async () => {
      await (timeoutCallback as () => void)();
    });

    expect(searchNavigateSpy).toHaveBeenCalledWith({
      replace: true,
      search: expect.any(Function),
    });
    const searchUpdater = searchNavigateSpy.mock.calls[0]?.[0]?.search as
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
      oauth_error: "forbidden",
      oauth_provider: "google",
    });

    setTimeoutSpy.mockRestore();
  });

  it("renders callback auth failures with actionable guidance and clears feedback on dismiss", async () => {
    const user = userEvent.setup();
    searchState = { oauth_error: "forbidden", oauth_provider: "google" };

    renderDashboard(<IntegrationsPage />, {
      route: "/acme/workspace-1/integrations?oauth_error=forbidden&oauth_provider=google",
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

    expect(searchNavigateSpy).toHaveBeenCalledWith({
      replace: true,
      search: expect.any(Function),
    });
    const searchUpdater = searchNavigateSpy.mock.calls[0]?.[0]?.search as
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

  it("offers a sign-in action for unauthorized callback errors", async () => {
    const user = userEvent.setup();
    searchState = { oauth_error: "unauthorized", oauth_provider: "google" };
    window.history.replaceState(
      {},
      "",
      "/acme/workspace-1/integrations?oauth_error=unauthorized&oauth_provider=google",
    );

    const view = renderDashboard(<IntegrationsPage />, {
      route: "/acme/workspace-1/integrations?oauth_error=unauthorized&oauth_provider=google",
      auth: createAuthState({
        isAuthenticated: true,
        canManage: () => true,
      }),
      runtime: createFakeDashboardRuntime(),
    });

    expect(await screen.findByText("Sign in again")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(view.router.state.location.pathname).toBe("/login");
    expect(view.router.state.location.search).toEqual({
      returnTo: "/acme/workspace-1/integrations?oauth_error=unauthorized&oauth_provider=google",
    });
  });
});
