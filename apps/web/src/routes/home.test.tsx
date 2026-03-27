import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/landing/landing-page", () => ({
  LandingPage: () => <div>Landing page</div>,
}));

import { HomeRedirectPage } from "./home";
import { createAuthState, renderDashboard } from "@/test/render-dashboard";

describe("HomeRedirectPage", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-has-session");
  });

  it("redirects stale hinted sessions to login instead of falling back to the landing page", async () => {
    document.documentElement.setAttribute("data-has-session", "");
    window.history.replaceState({}, "", "/");

    const { router } = renderDashboard(<HomeRedirectPage />, {
      route: "/",
      auth: createAuthState({
        isAuthenticated: false,
        isLoading: false,
      }),
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/login");
      expect(router.state.location.search.returnTo).toBe("/");
    });
    expect(screen.queryByText("Loading dashboard")).not.toBeInTheDocument();
    expect(document.documentElement.hasAttribute("data-has-session")).toBe(false);
  });
});
