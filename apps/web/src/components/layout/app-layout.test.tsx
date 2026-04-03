import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { createAuthState, createWorkspaceState, renderDashboard } from "@/test/render-dashboard";
import { AppLayout } from "./app-layout";

describe("AppLayout", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the login screen for unauthenticated workspace routes", async () => {
    renderDashboard(
      <AppLayout>
        <div>Dashboard body</div>
      </AppLayout>,
      {
        route: "/acme/workspace-1",
        auth: createAuthState({
          isAuthenticated: false,
        }),
        runtime: createFakeDashboardRuntime(),
      },
    );

    expect(await screen.findByRole("heading", { name: "Keppo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send magic link" })).toBeInTheDocument();
    expect(screen.queryByText("Dashboard body")).not.toBeInTheDocument();
  });

  it("keeps public routes visible without forcing the login shell", async () => {
    renderDashboard(
      <AppLayout>
        <div>Public invite flow</div>
      </AppLayout>,
      {
        route: "/login",
        auth: createAuthState({
          isAuthenticated: false,
        }),
        runtime: createFakeDashboardRuntime(),
      },
    );

    expect(await screen.findByText("Public invite flow")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send magic link" })).not.toBeInTheDocument();
  });

  it("skips notification bootstrapping on the public invite route", async () => {
    const ensureDefaultEmailEndpoint = vi.fn();
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "notifications:countUnread": (args) => {
          if (args === "skip") {
            return undefined;
          }
          throw new Error("should not query unread count on public invite route");
        },
        "notifications:listInAppNotifications": (args) => {
          if (args === "skip") {
            return undefined;
          }
          throw new Error("should not query notifications on public invite route");
        },
        "notifications:listEndpoints": (args) => {
          if (args === "skip") {
            return undefined;
          }
          throw new Error("should not query endpoints on public invite route");
        },
        "notifications:listEventDefinitions": (args) => {
          if (args === "skip") {
            return undefined;
          }
          throw new Error("should not query event definitions on public invite route");
        },
      },
      mutationHandlers: {
        "notifications:ensureDefaultEmailEndpoint": ensureDefaultEmailEndpoint,
      },
    });

    renderDashboard(
      <AppLayout>
        <div>Authenticated invite flow</div>
      </AppLayout>,
      {
        route: "/invites/accept?token=inv_tok_test",
        auth: createAuthState({
          isAuthenticated: true,
          isLoading: false,
          session: {
            authenticated: true,
            user: {
              id: "user_invite",
              email: "invitee@example.com",
              name: "Invitee User",
            },
            organizationId: "org_invite",
            orgSlug: "invite-org",
            role: "viewer",
          },
          getOrgId: () => "org_invite",
          getOrgSlug: () => "invite-org",
        }),
        runtime,
      },
    );

    expect(await screen.findByText("Authenticated invite flow")).toBeInTheDocument();
    expect(runtime.useQuery).toHaveBeenCalledWith(expect.anything(), "skip");
    expect(ensureDefaultEmailEndpoint).not.toHaveBeenCalled();
  });

  it("keeps authenticated content visible when notification queries fail", async () => {
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "notifications:countUnread": () => {
          throw new Error("count unread timeout");
        },
      },
    });

    renderDashboard(
      <AppLayout>
        <div>Authenticated dashboard body</div>
      </AppLayout>,
      {
        route: "/acme/workspace-1/settings/audit",
        auth: createAuthState({
          isAuthenticated: true,
          isLoading: false,
          session: {
            authenticated: true,
            user: {
              id: "user_123",
              email: "user@example.com",
              name: "Keppo User",
            },
            organizationId: "org_123",
            orgSlug: "acme",
            role: "owner",
          },
          getOrgId: () => "org_123",
          getOrgSlug: () => "acme",
        }),
        workspace: createWorkspaceState({
          selectedWorkspaceId: "workspace_123",
          selectedWorkspaceMatchesUrl: true,
        }),
        runtime,
      },
    );

    expect(await screen.findByText("Authenticated dashboard body")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Something went wrong" })).not.toBeInTheDocument();
  });

  it("does not require provider catalog in the workspace shell", async () => {
    const providerCatalogQuery = vi.fn(() => {
      throw new Error("provider catalog should not load in workspace context");
    });
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "invite_codes:checkInviteRequired": () => false,
        "invite_codes:getOrgInviteStatus": () => ({
          inviteRequired: false,
          hasRedeemedCode: false,
          isGrandfathered: false,
          inviteCodeId: null,
        }),
        "workspaces:listForCurrentOrg": () => [],
        "integrations:providerCatalog": providerCatalogQuery,
      },
    });

    renderDashboard(
      <AppLayout>
        <div>Members settings body</div>
      </AppLayout>,
      {
        route: "/acme/settings/members",
        auth: createAuthState({
          isAuthenticated: true,
          isLoading: false,
          session: {
            authenticated: true,
            user: {
              id: "user_123",
              email: "user@example.com",
              name: "Keppo User",
            },
            organizationId: "org_123",
            orgSlug: "acme",
            role: "owner",
          },
          getOrgId: () => "org_123",
          getOrgSlug: () => "acme",
        }),
        runtime,
      },
    );

    expect(await screen.findByText("Members settings body")).toBeInTheDocument();
    expect(providerCatalogQuery).not.toHaveBeenCalled();
  });

  it("keeps authenticated content visible when billing badge queries fail", async () => {
    const runtime = createFakeDashboardRuntime({
      queryHandlers: {
        "invite_codes:checkInviteRequired": () => false,
        "invite_codes:getOrgInviteStatus": () => ({
          inviteRequired: false,
          hasRedeemedCode: false,
          isGrandfathered: false,
          inviteCodeId: null,
        }),
        "ai_credits:getAiCreditBalance": () => {
          throw new Error("ai credits timeout");
        },
      },
    });

    renderDashboard(
      <AppLayout>
        <div>Authenticated billing-safe body</div>
      </AppLayout>,
      {
        route: "/acme/settings/members",
        auth: createAuthState({
          isAuthenticated: true,
          isLoading: false,
          session: {
            authenticated: true,
            user: {
              id: "user_123",
              email: "user@example.com",
              name: "Keppo User",
            },
            organizationId: "org_123",
            orgSlug: "acme",
            role: "owner",
          },
          getOrgId: () => "org_123",
          getOrgSlug: () => "acme",
        }),
        runtime,
      },
    );

    expect(await screen.findByText("Authenticated billing-safe body")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Billing" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Something went wrong" })).not.toBeInTheDocument();
  });

  it("shows a reload toast when the client build falls behind the current deployment", async () => {
    vi.stubEnv("VITE_KEPPO_CLIENT_BUILD_ID", "dpl_client_old");
    const fetchImpl = vi.fn(async () =>
      Response.json({
        ok: true,
        buildId: "dpl_server_new",
      }),
    );
    const runtime = createFakeDashboardRuntime({
      fetchImpl: fetchImpl as typeof fetch,
    });

    renderDashboard(
      <AppLayout>
        <div>Authenticated dashboard body</div>
      </AppLayout>,
      {
        route: "/acme/workspace-1/settings/audit",
        auth: createAuthState({
          isAuthenticated: true,
          isLoading: false,
          session: {
            authenticated: true,
            user: {
              id: "user_123",
              email: "user@example.com",
              name: "Keppo User",
            },
            organizationId: "org_123",
            orgSlug: "acme",
            role: "owner",
          },
          getOrgId: () => "org_123",
          getOrgSlug: () => "acme",
        }),
        workspace: createWorkspaceState({
          selectedWorkspaceId: "workspace_123",
          selectedWorkspaceMatchesUrl: true,
        }),
        runtime,
      },
    );

    expect(await screen.findByText("Authenticated dashboard body")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledWith(
        "/api/version",
        expect.objectContaining({
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        }),
      );
    });
    expect(await screen.findByText("A newer version of Keppo is available.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });
});
