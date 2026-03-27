import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeDashboardRuntime } from "@/test/fake-dashboard-runtime";
import { renderDashboardHook } from "@/test/render-dashboard";
import { useAuthState } from "./use-auth";

describe("useAuthState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("activates the fallback organization when session auth is available", async () => {
    const runtime = createFakeDashboardRuntime({
      sessionState: {
        data: {
          session: {
            id: "session_1",
            createdAt: new Date("2026-03-10T00:00:00.000Z"),
            updatedAt: new Date("2026-03-10T00:00:00.000Z"),
            userId: "user_1",
            expiresAt: new Date("2026-03-11T00:00:00.000Z"),
            token: "token_1",
          },
          user: {
            id: "user_1",
            createdAt: new Date("2026-03-10T00:00:00.000Z"),
            updatedAt: new Date("2026-03-10T00:00:00.000Z"),
            email: "e2e@example.com",
            emailVerified: true,
            name: "E2E User",
          },
        },
        error: null,
        isPending: false,
        isRefetching: false,
        refetch: async () => undefined,
      },
      queryHandlers: {
        "workspaces:currentViewer": () => null,
      },
    });

    const listMock = vi.fn(async () => ({
      data: [
        {
          id: "org_1",
          name: "Acme",
          slug: "acme",
          createdAt: new Date("2026-03-10T00:00:00.000Z"),
        },
      ],
    }));
    const setActiveMock = vi.fn(async () => ({ data: null, error: null }));

    runtime.authClient.organization.list =
      listMock as unknown as typeof runtime.authClient.organization.list;
    runtime.authClient.organization.setActive =
      setActiveMock as unknown as typeof runtime.authClient.organization.setActive;

    const { result } = renderDashboardHook(() => useAuthState(), {
      runtime,
    });

    await waitFor(() => {
      expect(result.current.getOrgSlug()).toBe("acme");
    });

    expect(listMock).toHaveBeenCalled();
    expect(setActiveMock).toHaveBeenCalledWith({ organizationId: "org_1" });
  });

  it("passes the current route as the email/password auth callback URL", async () => {
    const runtime = createFakeDashboardRuntime({
      sessionState: {
        data: null,
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

    const signInEmailMock = vi.fn(async () => ({ data: null, error: null }));
    const signUpEmailMock = vi.fn(async () => ({ data: null, error: null }));
    runtime.authClient.signIn.email =
      signInEmailMock as unknown as typeof runtime.authClient.signIn.email;
    runtime.authClient.signUp.email =
      signUpEmailMock as unknown as typeof runtime.authClient.signUp.email;

    const { result } = renderDashboardHook(() => useAuthState(), {
      runtime,
    });

    await result.current.loginWithEmailPassword("invitee@example.com", "KeppoE2E!123");

    expect(signInEmailMock).toHaveBeenCalledWith({
      callbackURL: window.location.href,
      email: "invitee@example.com",
      password: "KeppoE2E!123",
    });
    expect(signUpEmailMock).not.toHaveBeenCalled();
  });

  it("auto-signs up in local dev when sign-in returns invalid credentials", async () => {
    const runtime = createFakeDashboardRuntime({
      sessionState: {
        data: null,
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

    const signInEmailMock = vi.fn(async () => ({
      data: null,
      error: { message: "Invalid email or password" },
    }));
    const signUpEmailMock = vi.fn(async () => ({ data: null, error: null }));
    runtime.authClient.signIn.email =
      signInEmailMock as unknown as typeof runtime.authClient.signIn.email;
    runtime.authClient.signUp.email =
      signUpEmailMock as unknown as typeof runtime.authClient.signUp.email;

    const { result } = renderDashboardHook(() => useAuthState(), {
      runtime,
    });

    await result.current.loginWithEmailPassword("local@example.com", "KeppoE2E!123");

    expect(signInEmailMock).toHaveBeenCalledTimes(1);
    expect(signUpEmailMock).toHaveBeenCalledWith({
      callbackURL: window.location.href,
      email: "local@example.com",
      password: "KeppoE2E!123",
      name: "local",
    });
    expect(result.current.authError).toBeNull();
  });
});
