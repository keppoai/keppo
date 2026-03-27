import React, { type PropsWithChildren, type ReactElement } from "react";
import { render, type RenderHookOptions, type RenderOptions } from "@testing-library/react";
import type { AnyRouter } from "@tanstack/react-router";
import { ThemeProvider } from "next-themes";
import { RouterProvider } from "@tanstack/react-router";
import { DashboardRuntimeProvider, type DashboardRuntime } from "@/lib/dashboard-runtime";
import { AuthContext, type AuthState } from "@/hooks/use-auth";
import { WorkspaceContext, type WorkspaceContextState } from "@/hooks/use-workspace-context";
import { createFakeDashboardRuntime } from "./fake-dashboard-runtime";
import { createTestRouter } from "./create-test-router";

const noopAsync = async () => undefined;

export function createAuthState(overrides: Partial<AuthState> = {}): AuthState {
  return {
    session: null,
    isLoading: false,
    isAuthenticating: false,
    isAuthenticated: false,
    loginWithMagicLink: noopAsync,
    loginWithEmailPassword: noopAsync,
    loginWithGoogle: noopAsync,
    loginWithGitHub: noopAsync,
    logout: noopAsync,
    getOrgId: () => null,
    getOrgSlug: () => null,
    getRole: () => "owner",
    canManage: () => true,
    canApprove: () => true,
    authError: null,
    magicLinkSent: false,
    showEmailPassword: false,
    ...overrides,
  };
}

export function createWorkspaceState(
  overrides: Partial<WorkspaceContextState> = {},
): WorkspaceContextState {
  return {
    workspaces: [],
    workspacesLoaded: true,
    selectedWorkspace: null,
    selectedWorkspaceMatchesUrl: false,
    selectedWorkspaceId: "",
    selectedWorkspaceCredentialSecret: null,
    selectedWorkspaceIntegrations: [],
    setSelectedWorkspaceId: () => undefined,
    refreshWorkspaces: noopAsync,
    createWorkspace: noopAsync,
    deleteSelectedWorkspace: noopAsync,
    rotateSelectedWorkspaceCredential: noopAsync,
    setSelectedWorkspacePolicyMode: noopAsync,
    setSelectedWorkspaceCodeMode: noopAsync,
    setSelectedWorkspaceIntegrations: noopAsync,
    ...overrides,
  };
}

type DashboardRenderOptions = {
  route?: string;
  auth?: AuthState;
  workspace?: WorkspaceContextState;
  runtime?: DashboardRuntime;
};

function createWrapper(options: DashboardRenderOptions = {}) {
  const auth = options.auth ?? createAuthState();
  const workspace = options.workspace ?? createWorkspaceState();
  const runtime = options.runtime ?? createFakeDashboardRuntime();
  const childRef: { current: React.ReactNode } = { current: null };
  const router = createTestRouter({
    auth,
    initialEntries: [options.route ?? "/login"],
    getChildren: () => childRef.current,
  });

  function DashboardTestWrapper({ children }: PropsWithChildren) {
    childRef.current = children;

    return (
      <ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light">
        <DashboardRuntimeProvider runtime={runtime}>
          <AuthContext.Provider value={auth}>
            <WorkspaceContext.Provider value={workspace}>
              <RouterProvider router={router} context={{ auth }} />
            </WorkspaceContext.Provider>
          </AuthContext.Provider>
        </DashboardRuntimeProvider>
      </ThemeProvider>
    );
  }

  (DashboardTestWrapper as typeof DashboardTestWrapper & { router?: AnyRouter }).router = router;
  return DashboardTestWrapper;
}

export function renderDashboard(
  ui: ReactElement,
  options?: DashboardRenderOptions & RenderOptions,
): ReturnType<typeof render> & { router: AnyRouter } {
  const { route, auth, workspace, runtime, ...renderOptions } = options ?? {};
  const wrapper = createWrapper({
    ...(route !== undefined ? { route } : {}),
    ...(auth !== undefined ? { auth } : {}),
    ...(workspace !== undefined ? { workspace } : {}),
    ...(runtime !== undefined ? { runtime } : {}),
  }) as ReturnType<typeof createWrapper> & { router?: AnyRouter };
  const renderResult = render(ui, {
    wrapper,
    ...renderOptions,
  });
  return {
    ...renderResult,
    router: wrapper.router as AnyRouter,
  };
}

export function renderDashboardHook<Result, Props extends object = Record<string, never>>(
  renderCallback: (initialProps: Props) => Result,
  options?: DashboardRenderOptions & RenderHookOptions<Props>,
) {
  const { route, auth, workspace, runtime, ...renderOptions } = options ?? {};
  let currentResult: Result | null = null;
  const resolvedAuth = auth ?? createAuthState();
  const resolvedWorkspace = workspace ?? createWorkspaceState();
  const resolvedRuntime = runtime ?? createFakeDashboardRuntime();
  const childRef: { current: React.ReactNode } = { current: null };
  const router =
    route !== undefined
      ? createTestRouter({
          auth: resolvedAuth,
          initialEntries: [route],
          getChildren: () => childRef.current,
        })
      : null;

  function HookHarness(props: Props) {
    currentResult = renderCallback(props);
    return null;
  }

  const initialProps = (renderOptions.initialProps ?? {}) as Props;

  function HookProviders({ children }: PropsWithChildren) {
    if (router) {
      childRef.current = children;
    }
    return (
      <ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light">
        <DashboardRuntimeProvider runtime={resolvedRuntime}>
          <AuthContext.Provider value={resolvedAuth}>
            <WorkspaceContext.Provider value={resolvedWorkspace}>
              {router ? (
                <RouterProvider router={router} context={{ auth: resolvedAuth }} />
              ) : (
                children
              )}
            </WorkspaceContext.Provider>
          </AuthContext.Provider>
        </DashboardRuntimeProvider>
      </ThemeProvider>
    );
  }

  const renderResult = render(React.createElement(HookHarness, initialProps), {
    wrapper: HookProviders,
  });

  return {
    result: {
      get current() {
        return currentResult as Result;
      },
    },
    rerender: (nextProps?: Props) => {
      renderResult.rerender(React.createElement(HookHarness, nextProps ?? initialProps));
    },
    unmount: renderResult.unmount,
  };
}
