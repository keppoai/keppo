import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InviteAcceptPage } from "./invites.accept";
import { createAuthState, renderDashboard } from "@/test/render-dashboard";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";

const acceptInviteMock = vi.fn();

vi.mock("@/lib/server-functions/internal-api", () => ({
  acceptInvite: (...args: unknown[]) => acceptInviteMock(...args),
}));

describe("InviteAcceptPage", () => {
  beforeEach(() => {
    acceptInviteMock.mockReset();
  });

  it("accepts an invite as soon as the Better Auth session is ready, even before Convex auth hydrates", async () => {
    acceptInviteMock.mockResolvedValueOnce({ orgName: "Acme" });
    const runtime = createFakeDashboardRuntime({
      sessionState: {
        data: {
          session: {
            id: "session_1",
            createdAt: new Date("2026-03-18T00:00:00.000Z"),
            updatedAt: new Date("2026-03-18T00:00:00.000Z"),
            userId: "usr_invitee",
            expiresAt: new Date("2026-03-19T00:00:00.000Z"),
            token: "token_1",
          },
          user: {
            id: "usr_invitee",
            createdAt: new Date("2026-03-18T00:00:00.000Z"),
            updatedAt: new Date("2026-03-18T00:00:00.000Z"),
            email: "invitee@example.com",
            emailVerified: true,
            name: "Invitee User",
          },
        },
        error: null,
        isPending: false,
        isRefetching: false,
        refetch: async () => undefined,
      },
      convexAuthState: {
        isAuthenticated: false,
        isLoading: false,
      },
    });
    window.history.replaceState({}, "", "/invites/accept?token=inv_tok_test");

    renderDashboard(<InviteAcceptPage />, {
      route: "/invites/accept?token=inv_tok_test",
      auth: createAuthState({
        isAuthenticated: false,
        isLoading: false,
      }),
      runtime,
    });

    await waitFor(() => {
      expect(acceptInviteMock).toHaveBeenCalledWith({
        token: "inv_tok_test",
        userId: "usr_invitee",
        betterAuthCookie: undefined,
      });
    });
    expect(await screen.findByText("Invitation accepted", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("You've joined Acme.")).toBeInTheDocument();
  });

  it("reuses an in-flight invite acceptance attempt across remounts", async () => {
    let resolveAccept: ((value: { orgName: string }) => void) | null = null;
    acceptInviteMock.mockImplementationOnce(
      () =>
        new Promise((resolve: (value: { orgName: string }) => void) => {
          resolveAccept = resolve;
        }),
    );

    const runtime = createFakeDashboardRuntime({
      sessionState: {
        data: {
          session: {
            id: "session_1",
            createdAt: new Date("2026-03-18T00:00:00.000Z"),
            updatedAt: new Date("2026-03-18T00:00:00.000Z"),
            userId: "usr_invitee",
            expiresAt: new Date("2026-03-19T00:00:00.000Z"),
            token: "token_1",
          },
          user: {
            id: "usr_invitee",
            createdAt: new Date("2026-03-18T00:00:00.000Z"),
            updatedAt: new Date("2026-03-18T00:00:00.000Z"),
            email: "invitee@example.com",
            emailVerified: true,
            name: "Invitee User",
          },
        },
        error: null,
        isPending: false,
        isRefetching: false,
        refetch: async () => undefined,
      },
      convexAuthState: {
        isAuthenticated: false,
        isLoading: false,
      },
    });
    window.history.replaceState({}, "", "/invites/accept?token=inv_tok_test");

    const firstRender = renderDashboard(<InviteAcceptPage />, {
      route: "/invites/accept?token=inv_tok_test",
      auth: createAuthState({
        isAuthenticated: false,
        isLoading: false,
      }),
      runtime,
    });

    await waitFor(() => {
      expect(acceptInviteMock).toHaveBeenCalledTimes(1);
    });
    firstRender.unmount();

    renderDashboard(<InviteAcceptPage />, {
      route: "/invites/accept?token=inv_tok_test",
      auth: createAuthState({
        isAuthenticated: false,
        isLoading: false,
      }),
      runtime,
    });

    await waitFor(() => {
      expect(screen.getByText("Accepting invitation...", { exact: true })).toBeInTheDocument();
    });
    await act(async () => {
      resolveAccept?.({ orgName: "Acme" });
    });

    expect(await screen.findByText("Invitation accepted", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("You've joined Acme.")).toBeInTheDocument();
    expect(acceptInviteMock).toHaveBeenCalledTimes(1);
  });
});
