import { makeFunctionReference } from "convex/server";
import { GITHUB_PROVIDER_ID, GOOGLE_PROVIDER_ID } from "@keppo/shared/provider-ids";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { toUserFacingError, type UserFacingError } from "@/lib/user-facing-errors";
import type { AuthSession, Role } from "@/lib/types";

export type AuthState = {
  session: AuthSession | null;
  isLoading: boolean;
  isAuthenticating: boolean;
  isAuthenticated: boolean;
  loginWithMagicLink: (email: string) => Promise<void>;
  loginWithEmailPassword: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  loginWithGitHub: () => Promise<void>;
  logout: () => Promise<void>;
  getOrgId: () => string | null;
  getOrgSlug: () => string | null;
  getRole: () => Role;
  canManage: () => boolean;
  canApprove: () => boolean;
  authError: UserFacingError | null;
  magicLinkSent: boolean;
  showEmailPassword: boolean;
};

export const AuthContext = createContext<AuthState | null>(null);

const SHOW_EMAIL_PASSWORD = import.meta.env.VITE_ENABLE_EMAIL_PASSWORD === "true";
const IS_PREVIEW_BUILD = import.meta.env.VITE_KEPPO_ENVIRONMENT === "preview";
const IS_DEV_BUILD = import.meta.env.DEV;

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

const normalizeRole = (role: unknown): Role => {
  if (role === "owner" || role === "admin" || role === "approver" || role === "viewer") {
    return role;
  }
  return "owner";
};

const parseAuthError = (error: unknown): UserFacingError => {
  return toUserFacingError(error, {
    fallback: "Authentication failed. Try again.",
    audience: "public",
  });
};

const parseAuthResultError = (result: unknown): UserFacingError | null => {
  if (!result || typeof result !== "object") {
    return null;
  }
  const error = (result as { error?: unknown }).error;
  if (!error) {
    return null;
  }
  if (typeof error === "string" && error.length > 0) {
    return toUserFacingError(error, {
      fallback: "Authentication failed. Try again.",
      audience: "public",
    });
  }
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return toUserFacingError(message, {
        fallback: "Authentication failed. Try again.",
        audience: "public",
      });
    }
  }
  return toUserFacingError(new Error("Authentication failed."), {
    fallback: "Authentication failed. Try again.",
    audience: "public",
  });
};

const shouldAttemptEmailPasswordAutoSignup = (error: UserFacingError | null): boolean => {
  if (!error) {
    return false;
  }

  const source = `${error.rawMessage ?? ""}\n${error.sourceMessage}\n${error.technicalDetails ?? ""}`;
  return (
    /user(?:\s+account)?\s+(?:not found|does not exist)|no account/i.test(source) ||
    ((IS_PREVIEW_BUILD || IS_DEV_BUILD) && /invalid email or password/i.test(source))
  );
};

const shouldAttemptEmailPasswordAutoSignupForUnknownError = (error: unknown): boolean => {
  return shouldAttemptEmailPasswordAutoSignup(parseAuthError(error));
};

const unwrapAuthResultData = <T>(result: unknown): T | null => {
  if (result && typeof result === "object" && "data" in result) {
    return (result as { data: T }).data;
  }
  if (result === null || result === undefined) {
    return null;
  }
  return result as T;
};

const slugifyOrganizationName = (value: string): string => {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base.length > 0 ? base : "keppo";
};

export function useAuthState(): AuthState {
  const runtime = useDashboardRuntime();
  const convexAuth = runtime.useConvexAuth();
  const currentViewerRef = makeFunctionReference<"query">("workspaces:currentViewer");
  const viewer = runtime.useQuery(currentViewerRef, convexAuth.isAuthenticated ? {} : "skip");
  const sessionState = runtime.authClient.useSession();
  const [fallbackOrgId, setFallbackOrgId] = useState<string | null>(null);
  const [fallbackOrgSlug, setFallbackOrgSlug] = useState<string | null>(null);
  const [authError, setAuthError] = useState<UserFacingError | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [isBootstrappingOrganization, setIsBootstrappingOrganization] = useState(false);
  const bootstrapInFlightRef = useRef(false);
  const authInFlightRef = useRef(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const session = useMemo<AuthSession | null>(() => {
    const sessionUser = sessionState.data?.user;
    if (!viewer && !sessionUser) {
      return null;
    }

    const fallbackEmail = sessionUser?.email ?? (viewer ? `${viewer.user_id}@unknown.example` : "");
    const fallbackName = sessionUser?.name ?? viewer?.name ?? "Keppo User";

    if (!viewer) {
      return {
        authenticated: true,
        user: {
          id: sessionUser?.id ?? "unknown-user",
          email: fallbackEmail,
          name: fallbackName,
        },
        role: "owner",
        organizationId: fallbackOrgId ?? undefined,
        orgSlug: fallbackOrgSlug ?? undefined,
        organization_id: fallbackOrgId ?? undefined,
      };
    }

    return {
      authenticated: true,
      user: {
        id: viewer.user_id,
        email: viewer.email || fallbackEmail,
        name: fallbackName,
      },
      role: normalizeRole(viewer.role),
      organizationId: viewer.org_id || fallbackOrgId || undefined,
      orgSlug: viewer.org_slug || fallbackOrgSlug || undefined,
      organization_id: viewer.org_id || fallbackOrgId || undefined,
    };
  }, [fallbackOrgId, fallbackOrgSlug, viewer, sessionState.data?.user]);

  const isLoading =
    convexAuth.isLoading ||
    isBootstrappingOrganization ||
    (convexAuth.isAuthenticated && (viewer === undefined || sessionState.isPending));

  const startAuthAction = useCallback((): boolean => {
    if (authInFlightRef.current) {
      return false;
    }
    authInFlightRef.current = true;
    setIsAuthenticating(true);
    setAuthError(null);
    return true;
  }, []);

  const finishAuthAction = useCallback((): void => {
    authInFlightRef.current = false;
    setIsAuthenticating(false);
  }, []);

  const ensureOrganizationForSession = useCallback(async (): Promise<void> => {
    const user = sessionState.data?.user;
    if (!user || bootstrapInFlightRef.current) {
      return;
    }

    bootstrapInFlightRef.current = true;
    setIsBootstrappingOrganization(true);
    try {
      const listResult = await runtime.authClient.organization.list();
      const listError = parseAuthResultError(listResult);
      if (listError) {
        setAuthError(listError);
        return;
      }
      const organizations = unwrapAuthResultData<unknown[]>(listResult);
      if (Array.isArray(organizations) && organizations.length > 0) {
        return;
      }

      const emailLocalPart = (user.email.split("@")[0] ?? "keppo").trim();
      const organizationBase = slugifyOrganizationName(emailLocalPart);
      const organizationSlug = `${organizationBase}-${crypto.randomUUID().slice(0, 8)}`;
      const organizationName = `${emailLocalPart || "Keppo"} Workspace`;

      const createResult = await runtime.authClient.organization.create({
        name: organizationName,
        slug: organizationSlug,
      });
      const createError = parseAuthResultError(createResult);
      if (createError) {
        setAuthError(createError);
      }
    } catch (error) {
      setAuthError(parseAuthError(error));
    } finally {
      setIsBootstrappingOrganization(false);
      bootstrapInFlightRef.current = false;
    }
  }, [runtime, sessionState.data?.user]);

  useEffect(() => {
    const hasSessionUser = Boolean(sessionState.data?.user);
    if (!hasSessionUser || sessionState.isPending || viewer === undefined || viewer !== null) {
      return;
    }
    void ensureOrganizationForSession();
  }, [ensureOrganizationForSession, sessionState.data?.user, sessionState.isPending, viewer]);

  useEffect(() => {
    if (!convexAuth.isAuthenticated || sessionState.isPending || viewer?.org_slug) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await runtime.authClient.organization.list();
      const error = parseAuthResultError(result);
      if (error || cancelled) {
        return;
      }
      const organizations = unwrapAuthResultData<Array<{ id?: unknown; slug?: unknown }>>(result);
      const firstOrganization = Array.isArray(organizations) ? organizations[0] : null;
      if (!firstOrganization || cancelled) {
        return;
      }
      const nextOrgId =
        typeof firstOrganization.id === "string" && firstOrganization.id.length > 0
          ? firstOrganization.id
          : null;
      const nextOrgSlug =
        typeof firstOrganization.slug === "string" && firstOrganization.slug.length > 0
          ? firstOrganization.slug
          : null;
      if (!viewer?.org_id && nextOrgId) {
        await runtime.authClient.organization
          .setActive({ organizationId: nextOrgId })
          .catch(() => null);
      }
      setFallbackOrgId(nextOrgId);
      setFallbackOrgSlug(nextOrgSlug);
    })();
    return () => {
      cancelled = true;
    };
  }, [convexAuth.isAuthenticated, runtime, sessionState.isPending, viewer?.org_slug]);

  const loginWithMagicLink = useCallback(
    async (email: string): Promise<void> => {
      if (!startAuthAction()) {
        return;
      }
      setMagicLinkSent(false);
      const callbackURL = window.location.href;

      try {
        const result = await runtime.authClient.signIn.magicLink({
          email,
          callbackURL,
        });
        const resultError = parseAuthResultError(result);
        if (resultError) {
          setAuthError(resultError);
          setMagicLinkSent(false);
          return;
        }
        setMagicLinkSent(true);
      } catch (error) {
        setAuthError(parseAuthError(error));
        setMagicLinkSent(false);
      } finally {
        finishAuthAction();
      }
    },
    [finishAuthAction, runtime, startAuthAction],
  );

  const loginWithEmailPassword = useCallback(
    async (email: string, password: string): Promise<void> => {
      if (!startAuthAction()) {
        return;
      }
      const callbackURL = window.location.href;
      const tryAutoSignup = async (): Promise<void> => {
        const signUpResult = await runtime.authClient.signUp.email({
          email,
          password,
          name: email.split("@")[0] ?? "Keppo User",
          callbackURL,
        });
        const signUpError = parseAuthResultError(signUpResult);
        if (signUpError) {
          setAuthError(signUpError);
          throw new Error(signUpError.sourceMessage);
        }
      };
      try {
        const signInResult = await runtime.authClient.signIn.email({
          email,
          password,
          callbackURL,
        });
        const signInError = parseAuthResultError(signInResult);
        if (!signInError) {
          return;
        }
        if (!shouldAttemptEmailPasswordAutoSignup(signInError)) {
          setAuthError(signInError);
          return;
        }
        await tryAutoSignup();
      } catch (error) {
        if (shouldAttemptEmailPasswordAutoSignupForUnknownError(error)) {
          try {
            await tryAutoSignup();
            return;
          } catch (signupError) {
            setAuthError(parseAuthError(signupError));
            return;
          }
        }
        setAuthError(parseAuthError(error));
      } finally {
        finishAuthAction();
      }
    },
    [finishAuthAction, runtime, startAuthAction],
  );

  const loginWithGoogle = useCallback(async (): Promise<void> => {
    if (!startAuthAction()) {
      return;
    }
    const callbackURL = window.location.href;
    try {
      const result = await runtime.authClient.signIn.social({
        provider: GOOGLE_PROVIDER_ID,
        callbackURL,
      });
      const resultError = parseAuthResultError(result);
      if (resultError) {
        setAuthError(resultError);
      }
    } catch (error) {
      setAuthError(parseAuthError(error));
    } finally {
      finishAuthAction();
    }
  }, [finishAuthAction, runtime, startAuthAction]);

  const loginWithGitHub = useCallback(async (): Promise<void> => {
    if (!startAuthAction()) {
      return;
    }
    const callbackURL = window.location.href;
    try {
      const result = await runtime.authClient.signIn.social({
        provider: GITHUB_PROVIDER_ID,
        callbackURL,
      });
      const resultError = parseAuthResultError(result);
      if (resultError) {
        setAuthError(resultError);
      }
    } catch (error) {
      setAuthError(parseAuthError(error));
    } finally {
      finishAuthAction();
    }
  }, [finishAuthAction, runtime, startAuthAction]);

  const logout = useCallback(async (): Promise<void> => {
    setAuthError(null);
    setFallbackOrgId(null);
    setFallbackOrgSlug(null);
    await runtime.authClient.signOut();
    window.location.replace("/login");
  }, [runtime]);

  const getOrgId = useCallback((): string | null => {
    return session?.organizationId ?? session?.organization_id ?? fallbackOrgId ?? null;
  }, [fallbackOrgId, session]);

  const getOrgSlug = useCallback((): string | null => {
    if (typeof session?.orgSlug === "string" && session.orgSlug.length > 0) {
      return session.orgSlug;
    }
    return fallbackOrgSlug;
  }, [fallbackOrgSlug, session]);

  const getRole = useCallback((): Role => {
    return normalizeRole(session?.role);
  }, [session?.role]);

  const canManage = useCallback((): boolean => {
    const role = getRole();
    return role === "owner" || role === "admin";
  }, [getRole]);

  const canApprove = useCallback((): boolean => {
    const role = getRole();
    return role === "owner" || role === "admin" || role === "approver";
  }, [getRole]);

  return useMemo(
    () => ({
      session,
      isLoading,
      isAuthenticating,
      isAuthenticated: Boolean(session?.authenticated),
      loginWithMagicLink,
      loginWithEmailPassword,
      loginWithGoogle,
      loginWithGitHub,
      logout,
      getOrgId,
      getOrgSlug,
      getRole,
      canManage,
      canApprove,
      authError,
      magicLinkSent,
      showEmailPassword: SHOW_EMAIL_PASSWORD,
    }),
    [
      session,
      isLoading,
      isAuthenticating,
      loginWithMagicLink,
      loginWithEmailPassword,
      loginWithGoogle,
      loginWithGitHub,
      logout,
      getOrgId,
      getOrgSlug,
      getRole,
      canManage,
      canApprove,
      authError,
      magicLinkSent,
    ],
  );
}
