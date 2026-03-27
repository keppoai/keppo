import { useEffect, useRef, useState } from "react";
import { createRoute, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { rootRoute } from "./__root";
import { LoginScreen } from "@/components/auth/login-screen";
import { useAuth } from "@/hooks/use-auth";
import { useWorkspace } from "@/hooks/use-workspace-context";
import { buildOrgPath, buildWorkspacePath, normalizeDashboardPath } from "@/hooks/use-route-params";
import { hasSessionHint } from "@/lib/better-auth-cookie";
import { clearDocumentSessionHint, hasDocumentSessionHint } from "@/lib/ssr-session-hint";

const SESSION_RESTORE_TIMEOUT_MS = 8_000;

export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const matchRoute = useMatchRoute();
  const {
    isAuthenticated,
    isLoading,
    isAuthenticating,
    authError,
    getOrgSlug,
    magicLinkSent,
    loginWithEmailPassword,
    loginWithGitHub,
    loginWithGoogle,
    loginWithMagicLink,
    showEmailPassword,
  } = useAuth();
  const { workspaces, workspacesLoaded } = useWorkspace();
  const [hasPendingSessionHint, setHasPendingSessionHint] = useState(() => hasSessionHint());
  const [sessionHintDismissed, setSessionHintDismissed] = useState(false);
  const sessionHintDeadlineRef = useRef<number | null>(null);
  const returnTo = (() => {
    const params = new URLSearchParams(window.location.search);
    const value = params.get("returnTo");
    if (!value || !value.startsWith("/") || value.startsWith("//")) {
      return "/";
    }
    return value;
  })();

  const clearPendingSessionHint = () => {
    clearDocumentSessionHint();
    setHasPendingSessionHint(false);
    setSessionHintDismissed(true);
  };

  useEffect(() => {
    if (!hasPendingSessionHint) {
      sessionHintDeadlineRef.current = null;
      return;
    }

    if (!isLoading) {
      clearPendingSessionHint();
      return;
    }

    if (sessionHintDeadlineRef.current === null) {
      sessionHintDeadlineRef.current = Date.now() + SESSION_RESTORE_TIMEOUT_MS;
    }

    const remainingMs = Math.max(sessionHintDeadlineRef.current - Date.now(), 0);
    const timeoutId = window.setTimeout(() => {
      clearPendingSessionHint();
    }, remainingMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hasPendingSessionHint, isLoading]);

  useEffect(() => {
    if (!sessionHintDismissed && !hasPendingSessionHint && isLoading && hasSessionHint()) {
      setHasPendingSessionHint(true);
    }
  }, [hasPendingSessionHint, isLoading, sessionHintDismissed]);

  useEffect(() => {
    if (isAuthenticated) {
      const orgSlug = getOrgSlug();
      const lastWorkspaceSlug = orgSlug
        ? localStorage.getItem(`keppo:lastWorkspaceSlug:${orgSlug}`)
        : null;
      const targetWorkspace =
        workspaces.find((workspace) => workspace.slug === lastWorkspaceSlug) ?? workspaces[0];

      if (returnTo === "/") {
        if (orgSlug && workspacesLoaded && targetWorkspace) {
          void navigate({ replace: true, to: buildWorkspacePath(orgSlug, targetWorkspace.slug) });
          return;
        }
      } else if (orgSlug) {
        const normalizedReturnTo = normalizeDashboardPath(returnTo);
        if (normalizedReturnTo.startsWith(`/${orgSlug}/`) || normalizedReturnTo === `/${orgSlug}`) {
          void navigate({ replace: true, to: normalizedReturnTo });
          return;
        }

        const orgPath = buildOrgPath(orgSlug, normalizedReturnTo);
        if (
          matchRoute({
            to: orgPath,
            fuzzy: false,
            pending: true,
          })
        ) {
          void navigate({ replace: true, to: orgPath });
          return;
        }

        if (!workspacesLoaded || !targetWorkspace) {
          return;
        }

        const workspacePath = buildWorkspacePath(orgSlug, targetWorkspace.slug, normalizedReturnTo);
        if (
          matchRoute({
            to: workspacePath,
            fuzzy: false,
            pending: true,
          })
        ) {
          void navigate({
            replace: true,
            to: workspacePath,
          });
          return;
        }
      }
      void navigate({ replace: true, to: returnTo });
    }
  }, [getOrgSlug, isAuthenticated, matchRoute, navigate, returnTo, workspaces, workspacesLoaded]);

  return (
    <LoginScreen
      error={authError}
      isAuthenticating={isAuthenticating}
      isRestoringSession={!isAuthenticated && isLoading && hasPendingSessionHint}
      magicLinkSent={magicLinkSent}
      onDismissSessionRestore={clearPendingSessionHint}
      showEmailPassword={showEmailPassword}
      onMagicLink={(email) => {
        void loginWithMagicLink(email);
      }}
      onEmailPassword={(email, password) => {
        void loginWithEmailPassword(email, password);
      }}
      onGoogle={() => {
        void loginWithGoogle();
      }}
      onGitHub={() => {
        void loginWithGitHub();
      }}
    />
  );
}

export { LoginPage };
