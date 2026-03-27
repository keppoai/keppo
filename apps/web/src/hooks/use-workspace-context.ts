import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { makeFunctionReference } from "convex/server";
import { useLocation, useNavigate } from "@tanstack/react-router";
import type { CanonicalProviderId } from "@keppo/shared/provider-ids";
import { parseProviderId } from "@keppo/shared/providers/boundaries/error-boundary";
import {
  parseWorkspaceListPayload,
  parseWorkspaceIntegrationsPayload,
} from "@/lib/boundary-contracts";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import type { Workspace, WorkspaceIntegration } from "@/lib/types";
import { useAuth } from "./use-auth";
import { buildWorkspacePath, stripScopedPrefix, useRouteParams } from "./use-route-params";
import { lastWorkspaceStorageKey, resolveWorkspaceRedirectPath } from "@/lib/route-redirection";

export type WorkspaceContextState = {
  workspaces: Workspace[];
  workspacesLoaded: boolean;
  selectedWorkspace: Workspace | null;
  selectedWorkspaceMatchesUrl: boolean;
  selectedWorkspaceId: string;
  selectedWorkspaceCredentialSecret: string | null;
  selectedWorkspaceIntegrations: WorkspaceIntegration[];
  setSelectedWorkspaceId: (id: string) => void;
  refreshWorkspaces: () => Promise<void>;
  createWorkspace: (input: {
    name: string;
    policy_mode: Workspace["policy_mode"];
    default_action_behavior: Workspace["default_action_behavior"];
  }) => Promise<void>;
  deleteSelectedWorkspace: () => Promise<void>;
  rotateSelectedWorkspaceCredential: () => Promise<void>;
  setSelectedWorkspacePolicyMode: (mode: Workspace["policy_mode"]) => Promise<void>;
  setSelectedWorkspaceCodeMode: (enabled: boolean) => Promise<void>;
  setSelectedWorkspaceIntegrations: (providers: string[]) => Promise<void>;
};

export const WorkspaceContext = createContext<WorkspaceContextState | null>(null);

export function useWorkspace(): WorkspaceContextState {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}

export function useWorkspaceState(): WorkspaceContextState {
  const runtime = useDashboardRuntime();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, getOrgId, getOrgSlug } = useAuth();
  const { currentPathScope, orgSlug, workspaceSlug } = useRouteParams();
  const [orgScopedWorkspaceSlug, setOrgScopedWorkspaceSlug] = useState<string | null>(null);
  const [fallbackWorkspaces, setFallbackWorkspaces] = useState<Workspace[]>([]);
  const [fallbackWorkspaceIntegrations, setFallbackWorkspaceIntegrations] = useState<
    WorkspaceIntegration[]
  >([]);
  const [selectedWorkspaceCredentialSecret, setSelectedWorkspaceCredentialSecret] = useState<
    string | null
  >(null);
  const convex = runtime.useConvex();

  const listWorkspacesRef = makeFunctionReference<"query">("workspaces:listForCurrentOrg");
  const orgId = getOrgId();
  const workspacesData = runtime.useQuery(
    listWorkspacesRef,
    isAuthenticated && orgId ? {} : "skip",
  );

  const createWorkspaceMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("workspaces:createWorkspace"),
  );
  const deleteWorkspaceMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("workspaces:deleteWorkspace"),
  );
  const rotateCredentialMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("workspaces:rotateWorkspaceCredential"),
  );
  const setPolicyModeMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("workspaces:setWorkspacePolicyMode"),
  );
  const setCodeModeMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("workspaces:setWorkspaceCodeMode"),
  );
  const setWorkspaceIntegrationsMutation = runtime.useMutation(
    makeFunctionReference<"mutation">("workspaces:setWorkspaceIntegrations"),
  );

  const toCanonicalProvider = useCallback((provider: string): CanonicalProviderId | null => {
    try {
      return parseProviderId(provider);
    } catch {
      return null;
    }
  }, []);
  const getStoredWorkspaceSlug = useCallback(
    (nextOrgSlug: string | null | undefined): string | null => {
      if (!nextOrgSlug || typeof window === "undefined") {
        return null;
      }
      return window.localStorage.getItem(lastWorkspaceStorageKey(nextOrgSlug));
    },
    [],
  );

  const workspaces = useMemo<Workspace[]>(() => {
    return parseWorkspaceListPayload(workspacesData ?? fallbackWorkspaces);
  }, [fallbackWorkspaces, workspacesData]);
  const workspacesLoaded = workspacesData !== undefined || fallbackWorkspaces.length > 0;
  const urlSelectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.slug === workspaceSlug) ?? null,
    [workspaceSlug, workspaces],
  );
  const effectiveOrgSlug = orgSlug ?? getOrgSlug();
  const selectedWorkspace = useMemo(() => {
    if (urlSelectedWorkspace) {
      return urlSelectedWorkspace;
    }
    const fallbackSlug = orgScopedWorkspaceSlug ?? getStoredWorkspaceSlug(effectiveOrgSlug);
    if (fallbackSlug) {
      return (
        workspaces.find((workspace) => workspace.slug === fallbackSlug) ?? workspaces[0] ?? null
      );
    }
    return workspaces[0] ?? null;
  }, [effectiveOrgSlug, orgScopedWorkspaceSlug, urlSelectedWorkspace, workspaces]);
  const selectedWorkspaceMatchesUrl = workspaceSlug ? urlSelectedWorkspace !== null : false;
  const selectedWorkspaceIdForContext = selectedWorkspace?.id ?? "";
  const listWorkspaceIntegrationsRef = makeFunctionReference<"query">(
    "workspaces:listWorkspaceIntegrations",
  );
  const workspaceIntegrationsData = runtime.useQuery(
    listWorkspaceIntegrationsRef,
    isAuthenticated &&
      selectedWorkspaceIdForContext &&
      (!workspaceSlug || selectedWorkspaceMatchesUrl)
      ? { workspaceId: selectedWorkspaceIdForContext }
      : "skip",
  );
  const selectedWorkspaceIntegrations = useMemo<WorkspaceIntegration[]>(() => {
    return parseWorkspaceIntegrationsPayload(
      workspaceIntegrationsData ?? fallbackWorkspaceIntegrations,
    );
  }, [fallbackWorkspaceIntegrations, workspaceIntegrationsData]);

  const setSelectedWorkspaceId = useCallback(
    (id: string) => {
      const nextWorkspace = workspaces.find((workspace) => workspace.id === id);
      if (!nextWorkspace || !effectiveOrgSlug) {
        return;
      }
      localStorage.setItem(lastWorkspaceStorageKey(effectiveOrgSlug), nextWorkspace.slug);
      if (currentPathScope !== "workspace") {
        setOrgScopedWorkspaceSlug(nextWorkspace.slug);
        return;
      }
      const relativePath = stripScopedPrefix(pathname, orgSlug, workspaceSlug);
      void navigate({
        to: buildWorkspacePath(
          effectiveOrgSlug,
          nextWorkspace.slug,
          relativePath === "/" ? "" : relativePath,
        ),
      });
    },
    [currentPathScope, effectiveOrgSlug, navigate, orgSlug, pathname, workspaceSlug, workspaces],
  );

  useEffect(() => {
    if (!isAuthenticated) {
      setOrgScopedWorkspaceSlug(null);
      setSelectedWorkspaceCredentialSecret(null);
      return;
    }

    if (!workspacesLoaded || !effectiveOrgSlug) {
      return;
    }

    if (!workspaceSlug) {
      const fallbackSlug = getStoredWorkspaceSlug(effectiveOrgSlug) ?? workspaces[0]?.slug ?? null;
      setOrgScopedWorkspaceSlug((current) => {
        if (current && workspaces.some((workspace) => workspace.slug === current)) {
          return current;
        }
        return fallbackSlug;
      });
    } else {
      setOrgScopedWorkspaceSlug(null);
    }

    if (workspaceSlug && workspaces.length > 0 && !urlSelectedWorkspace) {
      const redirectPath = resolveWorkspaceRedirectPath({
        pathname,
        orgSlug: effectiveOrgSlug,
        requestedWorkspaceSlug: workspaceSlug,
        workspaces,
        storedWorkspaceSlug: getStoredWorkspaceSlug(effectiveOrgSlug),
      });
      if (redirectPath) {
        void navigate({
          replace: true,
          to: redirectPath,
        });
      }
      return;
    }

    if (selectedWorkspace?.slug) {
      localStorage.setItem(lastWorkspaceStorageKey(effectiveOrgSlug), selectedWorkspace.slug);
    }
  }, [
    getOrgSlug,
    isAuthenticated,
    navigate,
    orgSlug,
    pathname,
    selectedWorkspace?.slug,
    workspaceSlug,
    workspaces,
    workspacesLoaded,
    urlSelectedWorkspace,
    getStoredWorkspaceSlug,
  ]);

  const refreshWorkspaces = useCallback(async (): Promise<void> => {
    if (!isAuthenticated || !orgId) {
      setFallbackWorkspaces([]);
      setFallbackWorkspaceIntegrations([]);
      return;
    }

    const nextWorkspaces = parseWorkspaceListPayload(await convex.query(listWorkspacesRef, {}));
    setFallbackWorkspaces(nextWorkspaces);

    const activeWorkspaceId =
      nextWorkspaces.find((workspace) => workspace.slug === workspaceSlug)?.id ??
      nextWorkspaces[0]?.id ??
      "";
    if (!activeWorkspaceId) {
      setFallbackWorkspaceIntegrations([]);
      return;
    }

    setFallbackWorkspaceIntegrations(
      parseWorkspaceIntegrationsPayload(
        await convex.query(listWorkspaceIntegrationsRef, {
          workspaceId: activeWorkspaceId,
        }),
      ),
    );
  }, [
    convex,
    isAuthenticated,
    listWorkspaceIntegrationsRef,
    listWorkspacesRef,
    orgId,
    workspaceSlug,
  ]);

  const createWorkspace = useCallback(
    async (input: {
      name: string;
      policy_mode: Workspace["policy_mode"];
      default_action_behavior: Workspace["default_action_behavior"];
    }): Promise<void> => {
      const result = await createWorkspaceMutation({
        name: input.name.trim() || "new-workspace",
        policy_mode: input.policy_mode,
        default_action_behavior: input.default_action_behavior,
      });
      setSelectedWorkspaceCredentialSecret(result.credential_secret);
      setFallbackWorkspaces((current) => {
        const next = current.filter((workspace) => workspace.id !== result.workspace.id);
        next.push(result.workspace);
        return next;
      });
      const effectiveOrgSlug = getOrgSlug();
      if (effectiveOrgSlug) {
        localStorage.setItem(lastWorkspaceStorageKey(effectiveOrgSlug), result.workspace.slug);
      }
      setOrgScopedWorkspaceSlug(result.workspace.slug);
      setFallbackWorkspaceIntegrations([]);
      if (effectiveOrgSlug) {
        void navigate({
          to: buildWorkspacePath(effectiveOrgSlug, result.workspace.slug),
        });
      }
      void (async () => {
        for (let attempt = 0; attempt < 20; attempt += 1) {
          try {
            const integrations = await convex.query(listWorkspaceIntegrationsRef, {
              workspaceId: result.workspace.id,
            });
            setFallbackWorkspaceIntegrations(parseWorkspaceIntegrationsPayload(integrations));
            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (attempt === 19 || !/forbidden/i.test(message)) {
              return;
            }
            await new Promise((resolve) => window.setTimeout(resolve, 250));
          }
        }
      })();
    },
    [convex, createWorkspaceMutation, getOrgSlug, listWorkspaceIntegrationsRef, navigate],
  );

  const rotateSelectedWorkspaceCredential = useCallback(async (): Promise<void> => {
    if (!selectedWorkspaceIdForContext) {
      return;
    }

    const result = await rotateCredentialMutation({
      workspaceId: selectedWorkspaceIdForContext,
    });
    setSelectedWorkspaceCredentialSecret(result.credential_secret);
  }, [rotateCredentialMutation, selectedWorkspaceIdForContext]);

  const deleteSelectedWorkspace = useCallback(async (): Promise<void> => {
    if (!selectedWorkspaceIdForContext) {
      return;
    }

    const deletedWorkspaceId = selectedWorkspaceIdForContext;
    const result = await deleteWorkspaceMutation({
      workspaceId: deletedWorkspaceId,
    });

    setSelectedWorkspaceCredentialSecret(null);
    setFallbackWorkspaceIntegrations([]);

    const effectiveOrgSlug = getOrgSlug();
    const nextWorkspaces = parseWorkspaceListPayload(await convex.query(listWorkspacesRef, {}));
    setFallbackWorkspaces(nextWorkspaces);

    const nextWorkspaceSlug = result.nextWorkspaceSlug ?? nextWorkspaces[0]?.slug ?? null;
    if (!effectiveOrgSlug || !nextWorkspaceSlug) {
      setOrgScopedWorkspaceSlug(null);
      return;
    }

    localStorage.setItem(lastWorkspaceStorageKey(effectiveOrgSlug), nextWorkspaceSlug);
    setOrgScopedWorkspaceSlug(nextWorkspaceSlug);
    void navigate({
      to: buildWorkspacePath(effectiveOrgSlug, nextWorkspaceSlug),
    });
  }, [
    convex,
    deleteWorkspaceMutation,
    getOrgSlug,
    listWorkspacesRef,
    navigate,
    selectedWorkspaceIdForContext,
  ]);

  const setSelectedWorkspacePolicyMode = useCallback(
    async (mode: Workspace["policy_mode"]): Promise<void> => {
      if (!selectedWorkspaceIdForContext) {
        return;
      }

      await setPolicyModeMutation({
        workspaceId: selectedWorkspaceIdForContext,
        policy_mode: mode,
      });
    },
    [selectedWorkspaceIdForContext, setPolicyModeMutation],
  );

  const setSelectedWorkspaceCodeMode = useCallback(
    async (enabled: boolean): Promise<void> => {
      if (!selectedWorkspaceIdForContext) {
        return;
      }

      await setCodeModeMutation({
        workspaceId: selectedWorkspaceIdForContext,
        code_mode_enabled: enabled,
      });
    },
    [selectedWorkspaceIdForContext, setCodeModeMutation],
  );

  const setSelectedWorkspaceIntegrations = useCallback(
    async (providers: string[]): Promise<void> => {
      if (!selectedWorkspaceIdForContext) {
        return;
      }

      const normalizedProviders = [...new Set(providers)]
        .map((provider) => toCanonicalProvider(provider.trim().toLowerCase()))
        .filter((provider): provider is CanonicalProviderId => provider !== null);

      await setWorkspaceIntegrationsMutation({
        workspaceId: selectedWorkspaceIdForContext,
        providers: normalizedProviders,
      });
    },
    [selectedWorkspaceIdForContext, setWorkspaceIntegrationsMutation, toCanonicalProvider],
  );

  return {
    workspaces,
    workspacesLoaded,
    selectedWorkspace,
    selectedWorkspaceMatchesUrl,
    selectedWorkspaceId: selectedWorkspaceIdForContext,
    selectedWorkspaceCredentialSecret,
    selectedWorkspaceIntegrations,
    setSelectedWorkspaceId,
    refreshWorkspaces,
    createWorkspace,
    deleteSelectedWorkspace,
    rotateSelectedWorkspaceCredential,
    setSelectedWorkspacePolicyMode,
    setSelectedWorkspaceCodeMode,
    setSelectedWorkspaceIntegrations,
  };
}
