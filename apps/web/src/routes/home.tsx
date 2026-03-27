import { useEffect, useRef, useState } from "react";
import { createRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { rootRoute } from "./__root";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { ShellTransitionState } from "@/components/layout/shell-transition-state";
import { LandingPage } from "@/components/landing/landing-page";
import { hasSessionHint } from "@/lib/better-auth-cookie";
import { clearDocumentSessionHint } from "@/lib/ssr-session-hint";
import { lastWorkspaceStorageKey, resolveHomeRedirectPath } from "@/lib/route-redirection";

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomeRedirectPage,
});

function HomeRedirectPage() {
  const { isAuthenticated, isLoading, getOrgSlug } = useAuth();
  const { createWorkspace, workspaces, workspacesLoaded } = useWorkspace();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const bootstrapWorkspaceRef = useRef(false);
  const redirectTargetRef = useRef<string | null>(null);
  const [hasPendingSessionHint, setHasPendingSessionHint] = useState(() => hasSessionHint());
  const shouldHoldShell = isAuthenticated || (isLoading && hasPendingSessionHint);

  useEffect(() => {
    if (isLoading || isAuthenticated || !hasPendingSessionHint) {
      return;
    }

    clearDocumentSessionHint();
    setHasPendingSessionHint(false);
    void navigate({
      replace: true,
      to: "/login",
      search: {
        returnTo: "/",
      },
    });
  }, [hasPendingSessionHint, isAuthenticated, isLoading, navigate]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const orgSlug = getOrgSlug();
    if (!orgSlug || !workspacesLoaded) {
      return;
    }

    if (workspaces.length === 0) {
      if (bootstrapWorkspaceRef.current) {
        return;
      }
      bootstrapWorkspaceRef.current = true;
      void createWorkspace({
        name: "Default Workspace",
        policy_mode: "manual_only",
        default_action_behavior: "require_approval",
      }).catch(() => {
        bootstrapWorkspaceRef.current = false;
      });
      return;
    }

    const targetPath = resolveHomeRedirectPath({
      orgSlug,
      workspaces,
      storedWorkspaceSlug: localStorage.getItem(lastWorkspaceStorageKey(orgSlug)),
    });
    if (!targetPath) {
      return;
    }
    if (pathname === targetPath || redirectTargetRef.current === targetPath) {
      return;
    }
    redirectTargetRef.current = targetPath;

    void navigate({
      replace: true,
      to: targetPath,
    }).catch(() => {
      redirectTargetRef.current = null;
    });
  }, [
    createWorkspace,
    getOrgSlug,
    isAuthenticated,
    navigate,
    pathname,
    workspaces,
    workspacesLoaded,
  ]);

  // Public visitors keep the marketing page; hinted sessions hold the dashboard shell instead.
  if (!shouldHoldShell) {
    return <LandingPage />;
  }

  return (
    <ShellTransitionState
      title="Loading dashboard"
      detail={
        workspacesLoaded && workspaces.length === 0
          ? "Keppo is creating your default workspace and keeping the shell ready."
          : "Keppo is restoring your last workspace and keeping the shell ready."
      }
    />
  );
}

export { HomeRedirectPage };
