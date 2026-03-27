import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginPage } from "./login";
import { createAuthState, createWorkspaceState, renderDashboard } from "@/test/render-dashboard";

describe("LoginPage", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute("data-has-session");
  });

  it("redirects authenticated users to their workspace home when no explicit return path is set", async () => {
    window.history.replaceState({}, "", "/login");

    const { router } = renderDashboard(<LoginPage />, {
      route: "/login",
      auth: createAuthState({
        isAuthenticated: true,
        getOrgSlug: () => "acme",
      }),
      workspace: createWorkspaceState({
        workspacesLoaded: true,
        workspaces: [
          {
            id: "ws_1",
            org_id: "org_1",
            name: "Workspace 1",
            slug: "workspace-1",
            status: "active",
            policy_mode: "manual_only",
            default_action_behavior: "require_approval",
            code_mode_enabled: false,
            created_at: "2026-03-08T00:00:00.000Z",
          },
        ],
      }),
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/acme/workspace-1");
    });
  });

  it("preserves explicit dashboard return paths after auth bootstrap", async () => {
    window.history.replaceState({}, "", "/login?returnTo=/settings/workspaces");

    const { router } = renderDashboard(<LoginPage />, {
      route: "/login?returnTo=/settings/workspaces",
      auth: createAuthState({
        isAuthenticated: true,
        getOrgSlug: () => "acme",
      }),
      workspace: createWorkspaceState({
        workspacesLoaded: true,
        workspaces: [
          {
            id: "ws_1",
            org_id: "org_1",
            name: "Workspace 1",
            slug: "workspace-1",
            status: "active",
            policy_mode: "manual_only",
            default_action_behavior: "require_approval",
            code_mode_enabled: false,
            created_at: "2026-03-08T00:00:00.000Z",
          },
        ],
      }),
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/settings/workspaces");
    });
  });

  it("shows a session-restore screen when SSR already hinted an auth cookie", async () => {
    document.documentElement.setAttribute("data-has-session", "");
    window.history.replaceState({}, "", "/login");

    renderDashboard(<LoginPage />, {
      route: "/login",
      auth: createAuthState({
        isAuthenticated: false,
        isLoading: true,
      }),
    });

    expect(await screen.findByText("Signing you in...")).toBeInTheDocument();
    expect(
      screen.getByText("Keppo found an existing session and is restoring your workspace."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Sign in or create an account")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in manually" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send magic link" })).not.toBeInTheDocument();
  });

  it("lets the user dismiss session restore and avoids re-triggering it while auth is still loading", async () => {
    document.documentElement.setAttribute("data-has-session", "");
    window.history.replaceState({}, "", "/login");
    const auth = createAuthState({
      isAuthenticated: false,
      isLoading: true,
    });

    const view = renderDashboard(<LoginPage />, {
      route: "/login",
      auth,
    });

    expect(await screen.findByText("Signing you in...")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sign in manually" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Send magic link" })).toBeInTheDocument();
    });
    expect(document.documentElement.hasAttribute("data-has-session")).toBe(false);

    view.rerender(<LoginPage />);

    expect(screen.queryByText("Signing you in...")).not.toBeInTheDocument();
  });
});
