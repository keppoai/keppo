import { useEffect, useRef, type ReactNode } from "react";
import { makeFunctionReference } from "convex/server";
import { useLocation } from "@tanstack/react-router";

import { LoginScreen } from "@/components/auth/login-screen";
import { ErrorBoundary } from "@/components/error-boundary";
import { OperatorCommandPalette } from "@/components/layout/operator-command-palette";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { BreadcrumbHeader } from "@/components/layout/breadcrumb-header";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { AuthContext, useAuth, useAuthState } from "@/hooks/use-auth";
import { useApprovalAlerts } from "@/hooks/use-approval-alerts";
import { useRouteParams } from "@/hooks/use-route-params";
import { WorkspaceContext, useWorkspace, useWorkspaceState } from "@/hooks/use-workspace-context";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";

const ensureDefaultEmailEndpointRef = makeFunctionReference<"mutation">(
  "notifications:ensureDefaultEmailEndpoint",
);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuthState();
  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const state = useWorkspaceState();
  return <WorkspaceContext.Provider value={state}>{children}</WorkspaceContext.Provider>;
}

function AuthenticatedShell({
  children,
  isLoading,
  isFullWidthRoute,
  isStandaloneRoute,
  notificationsEnabled,
}: {
  children: ReactNode;
  isLoading: boolean;
  isFullWidthRoute: boolean;
  isStandaloneRoute: boolean;
  notificationsEnabled: boolean;
}) {
  const { selectedWorkspaceId, selectedWorkspaceMatchesUrl } = useWorkspace();
  useApprovalAlerts();

  if (isStandaloneRoute) {
    return (
      <div className="min-h-svh bg-background">
        {children}
        <Toaster />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <BreadcrumbHeader notificationsEnabled={notificationsEnabled} />
        <div className="flex-1 p-4 sm:p-6 lg:p-8">
          {isFullWidthRoute ? (
            isLoading ? (
              <ShellTransitionState
                title="Loading your workspace"
                detail="Setting up your workspace. This should only take a moment."
              />
            ) : (
              children
            )
          ) : (
            <div className="mx-auto max-w-[1200px]">
              {isLoading ? (
                <ShellTransitionState
                  title="Loading your workspace"
                  detail="Setting up your workspace. This should only take a moment."
                />
              ) : (
                children
              )}
            </div>
          )}
        </div>
      </SidebarInset>
      <Toaster />
      {selectedWorkspaceId && selectedWorkspaceMatchesUrl ? (
        <OperatorCommandPalette workspaceId={selectedWorkspaceId} />
      ) : null}
    </SidebarProvider>
  );
}

function NotificationBootstrap({
  notificationsEnabled,
  isAuthenticated,
  orgId,
  sessionEmail,
}: {
  notificationsEnabled: boolean;
  isAuthenticated: boolean;
  orgId: string | null;
  sessionEmail: string | null;
}) {
  const runtime = useDashboardRuntime();
  const bootstrappedOrgRef = useRef<string | null>(null);
  const ensureDefaultEmailEndpoint = runtime.useMutation(ensureDefaultEmailEndpointRef);

  useEffect(() => {
    if (!notificationsEnabled || !isAuthenticated || !orgId || !sessionEmail) {
      return;
    }
    if (bootstrappedOrgRef.current === orgId) {
      return;
    }
    let cancelled = false;
    let idleHandle: number | null = null;
    let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | null = null;

    const bootstrap = () => {
      if (cancelled || bootstrappedOrgRef.current === orgId) {
        return;
      }
      bootstrappedOrgRef.current = orgId;
      void ensureDefaultEmailEndpoint({
        orgId,
        email: sessionEmail,
      }).catch(() => {
        if (!cancelled) {
          bootstrappedOrgRef.current = null;
        }
      });
    };

    if (typeof globalThis.requestIdleCallback === "function") {
      idleHandle = globalThis.requestIdleCallback(
        () => {
          bootstrap();
        },
        { timeout: 1_500 },
      );
    } else {
      timeoutHandle = globalThis.setTimeout(() => {
        bootstrap();
      }, 250);
    }

    return () => {
      cancelled = true;
      if (idleHandle !== null && typeof globalThis.cancelIdleCallback === "function") {
        globalThis.cancelIdleCallback(idleHandle);
      }
      if (timeoutHandle !== null) {
        globalThis.clearTimeout(timeoutHandle);
      }
    };
  }, [ensureDefaultEmailEndpoint, isAuthenticated, notificationsEnabled, orgId, sessionEmail]);

  return null;
}

export function AppLayout({ children }: { children: ReactNode }) {
  const runtime = useDashboardRuntime();
  const {
    authError,
    isAuthenticated,
    isLoading,
    loginWithGitHub,
    loginWithGoogle,
    loginWithEmailPassword,
    loginWithMagicLink,
    magicLinkSent,
    showEmailPassword,
    getOrgId,
    session,
  } = useAuth();
  const { pathname } = useLocation();
  const { relativePath } = useRouteParams();
  const orgId = getOrgId();
  const sessionEmail = session?.user?.email ?? null;
  const isDocsRoute = pathname === "/docs" || pathname.startsWith("/docs/");
  const allowPublicRoute =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/invites/accept" ||
    pathname === "/terms" ||
    pathname === "/privacy" ||
    isDocsRoute;
  const isStandaloneRoute = pathname === "/admin" || pathname.startsWith("/admin/");
  const isLandingPage = pathname === "/";
  const isLoginPage = pathname === "/login";
  const isFullWidthRoute = relativePath === "/approvals" || relativePath === "/settings/audit";
  const notificationsEnabled = !allowPublicRoute && !isStandaloneRoute;

  return (
    <WorkspaceProvider>
      {!isLoading && !isAuthenticated && !allowPublicRoute ? (
        <LoginScreen
          error={authError}
          magicLinkSent={magicLinkSent}
          onMagicLink={(email) => {
            void loginWithMagicLink(email);
          }}
          onEmailPassword={(email, password) => {
            void loginWithEmailPassword(email, password);
          }}
          showEmailPassword={showEmailPassword}
          onGoogle={() => {
            void loginWithGoogle();
          }}
          onGitHub={() => {
            void loginWithGitHub();
          }}
        />
      ) : isDocsRoute ? (
        <>{children}</>
      ) : allowPublicRoute ? (
        <div
          className={`min-h-svh bg-background${isLandingPage || isLoginPage ? "" : " p-6 lg:p-8"}`}
        >
          {children}
          <Toaster />
        </div>
      ) : (
        <>
          <ErrorBoundary boundary="layout" fallback={null}>
            <NotificationBootstrap
              notificationsEnabled={notificationsEnabled}
              isAuthenticated={isAuthenticated}
              orgId={orgId}
              sessionEmail={sessionEmail}
            />
          </ErrorBoundary>
          <AuthenticatedShell
            isLoading={isLoading}
            isFullWidthRoute={isFullWidthRoute}
            isStandaloneRoute={isStandaloneRoute}
            notificationsEnabled={notificationsEnabled}
          >
            {children}
          </AuthenticatedShell>
        </>
      )}
    </WorkspaceProvider>
  );
}
