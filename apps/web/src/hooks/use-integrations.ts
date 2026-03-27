import { useCallback, useMemo, useState } from "react";
import { makeFunctionReference } from "convex/server";
import type { CanonicalProviderId } from "@keppo/shared/provider-ids";
import { MANAGED_OAUTH_PROVIDER_IDS } from "@keppo/shared/providers/boundaries/common";
import { parseProviderId } from "@keppo/shared/providers/boundaries/error-boundary";
import { parseIntegrationsPayload, parseProviderCatalogPayload } from "@/lib/boundary-contracts";
import { useDashboardRuntime } from "@/lib/dashboard-runtime";
import { requestOAuthProviderConnect } from "@/lib/server-functions/internal-api";
import { getRuntimeBetterAuthCookieHeader } from "@/lib/better-auth-cookie";
import type { IntegrationDetail, ProviderCatalogEntry } from "@/lib/types";
import { useAuth } from "./use-auth";
import { buildWorkspacePath, useRouteParams } from "./use-route-params";

const OAUTH_PROVIDER_SET = new Set<CanonicalProviderId>(MANAGED_OAUTH_PROVIDER_IDS);
const LIST_INTEGRATIONS_REF = makeFunctionReference<"query">("integrations:listForCurrentOrg");
const PROVIDER_CATALOG_REF = makeFunctionReference<"query">("integrations:providerCatalog");
const CONNECT_PROVIDER_MUTATION = makeFunctionReference<"mutation">("integrations:connectProvider");
const DISCONNECT_PROVIDER_MUTATION = makeFunctionReference<"mutation">(
  "integrations:disconnectProvider",
);
const TEST_PROVIDER_MUTATION = makeFunctionReference<"mutation">("integrations:testProvider");
const REGISTER_CUSTOM_INTEGRATION_MUTATION = makeFunctionReference<"mutation">(
  "integrations:registerCustomIntegration",
);

const normalizeProviderValue = (provider: string): string => provider.trim().toLowerCase();

const toCanonicalProvider = (provider: string): CanonicalProviderId | null => {
  try {
    return parseProviderId(provider);
  } catch {
    return null;
  }
};

const normalizeSupportedProvider = (
  provider: string,
  supportedProviders: Set<CanonicalProviderId>,
): CanonicalProviderId | null => {
  const normalized = normalizeProviderValue(provider);
  if (!normalized) {
    return null;
  }
  const canonicalProvider = toCanonicalProvider(normalized);
  if (!canonicalProvider) {
    return null;
  }
  if (supportedProviders.size === 0) {
    return canonicalProvider;
  }
  return supportedProviders.has(canonicalProvider) ? canonicalProvider : null;
};

export function useIntegrations() {
  const runtime = useDashboardRuntime();
  const { getOrgId, getOrgSlug, isAuthenticated, canManage } = useAuth();
  const { workspaceSlug } = useRouteParams();
  const [fallbackIntegrations, setFallbackIntegrations] = useState<IntegrationDetail[]>([]);
  const [fallbackProviderCatalog, setFallbackProviderCatalog] = useState<ProviderCatalogEntry[]>(
    [],
  );
  const convex = runtime.useConvex();
  const integrationsData = runtime.useQuery(LIST_INTEGRATIONS_REF, isAuthenticated ? {} : "skip");
  const connectProviderMutation = runtime.useMutation(CONNECT_PROVIDER_MUTATION);
  const disconnectProviderMutation = runtime.useMutation(DISCONNECT_PROVIDER_MUTATION);
  const testProviderMutation = runtime.useMutation(TEST_PROVIDER_MUTATION);
  const registerCustomIntegrationMutation = runtime.useMutation(
    REGISTER_CUSTOM_INTEGRATION_MUTATION,
  );
  const providerCatalogRaw = runtime.useQuery(PROVIDER_CATALOG_REF, isAuthenticated ? {} : "skip");
  const providerCatalog = useMemo<ProviderCatalogEntry[]>(() => {
    return parseProviderCatalogPayload(
      isAuthenticated ? (providerCatalogRaw ?? fallbackProviderCatalog) : [],
    );
  }, [fallbackProviderCatalog, isAuthenticated, providerCatalogRaw]);
  const supportedProviders = useMemo(
    () => new Set(providerCatalog.map((entry) => entry.provider)),
    [providerCatalog],
  );

  const refreshIntegrations = useCallback(async (): Promise<void> => {
    if (!isAuthenticated) {
      setFallbackIntegrations([]);
      setFallbackProviderCatalog([]);
      return;
    }

    const [nextIntegrations, nextCatalog] = await Promise.all([
      convex.query(LIST_INTEGRATIONS_REF, {}),
      convex.query(PROVIDER_CATALOG_REF, {}),
    ]);
    setFallbackIntegrations(parseIntegrationsPayload(nextIntegrations));
    setFallbackProviderCatalog(parseProviderCatalogPayload(nextCatalog));
  }, [convex, isAuthenticated]);

  const connectProvider = useCallback(
    async (provider: CanonicalProviderId): Promise<void> => {
      if (!canManage()) return;
      const canonicalProvider = normalizeSupportedProvider(provider, supportedProviders);
      if (!canonicalProvider) {
        return;
      }

      const isLocalDevHost =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      const currentIntegrations = parseIntegrationsPayload(
        integrationsData ?? fallbackIntegrations,
      );
      const hasExistingIntegration = currentIntegrations.some((integration) => {
        return (
          normalizeSupportedProvider(integration.provider, supportedProviders) === canonicalProvider
        );
      });

      if (isLocalDevHost && !hasExistingIntegration && !OAUTH_PROVIDER_SET.has(canonicalProvider)) {
        const directConnectResult = await connectProviderMutation({
          provider: canonicalProvider,
          display_name: canonicalProvider,
        });
        if (directConnectResult.oauth_start_url) {
          window.location.assign(directConnectResult.oauth_start_url);
        }
        return;
      }

      if (OAUTH_PROVIDER_SET.has(canonicalProvider)) {
        const orgId = getOrgId();
        const orgSlug = getOrgSlug();
        const returnTo =
          orgSlug && workspaceSlug
            ? buildWorkspacePath(orgSlug, workspaceSlug, "/integrations")
            : "/integrations";
        if (orgId) {
          try {
            const result = await requestOAuthProviderConnect({
              provider: canonicalProvider,
              org_id: orgId,
              return_to: returnTo,
              betterAuthCookie: getRuntimeBetterAuthCookieHeader(),
            });

            if (result.status === "requires_oauth" && typeof result.oauth_start_url === "string") {
              try {
                const oauthStartUrl = new URL(result.oauth_start_url, window.location.origin);
                if (!oauthStartUrl.searchParams.get("return_to")) {
                  oauthStartUrl.searchParams.set("return_to", returnTo);
                }
                window.location.assign(oauthStartUrl.toString());
              } catch {
                window.location.assign(result.oauth_start_url);
              }
              return;
            }
          } catch {
            // Fallback for local dev environments where OAuth modules may be intentionally unconfigured.
          }
        }
      }

      const result = await connectProviderMutation({
        provider: canonicalProvider,
        display_name: canonicalProvider,
      });

      if (result.oauth_start_url) {
        window.location.assign(result.oauth_start_url);
      }
    },
    [
      canManage,
      connectProviderMutation,
      fallbackIntegrations,
      getOrgId,
      getOrgSlug,
      integrationsData,
      runtime,
      workspaceSlug,
      supportedProviders,
    ],
  );

  const disconnectProvider = useCallback(
    async (provider: CanonicalProviderId): Promise<void> => {
      if (!canManage()) return;
      const canonicalProvider = normalizeSupportedProvider(provider, supportedProviders);
      if (!canonicalProvider) {
        return;
      }
      await disconnectProviderMutation({
        provider: canonicalProvider,
      });
    },
    [canManage, disconnectProviderMutation, supportedProviders],
  );

  const testConnection = useCallback(
    async (provider: CanonicalProviderId): Promise<{ ok: boolean; detail: string }> => {
      const canonicalProvider = normalizeSupportedProvider(provider, supportedProviders);
      if (!canonicalProvider) {
        return { ok: false, detail: "Unsupported provider" };
      }
      return await testProviderMutation({
        provider: canonicalProvider,
      });
    },
    [supportedProviders, testProviderMutation],
  );

  const registerCustomIntegration = useCallback(
    async (input: {
      base_url: string;
      display_name?: string;
      auth_method?: "bearer_token" | "oauth" | "mtls";
      manifest?: Record<string, unknown>;
    }): Promise<void> => {
      if (!canManage()) return;
      await registerCustomIntegrationMutation({
        base_url: input.base_url,
        ...(input.display_name ? { display_name: input.display_name } : {}),
        ...(input.auth_method ? { auth_method: input.auth_method } : {}),
        ...(input.manifest ? { manifest: input.manifest } : {}),
      });
    },
    [canManage, registerCustomIntegrationMutation],
  );

  const rawIntegrations = useMemo<IntegrationDetail[]>(() => {
    const source = isAuthenticated ? (integrationsData ?? fallbackIntegrations) : [];
    return parseIntegrationsPayload(source);
  }, [fallbackIntegrations, integrationsData, isAuthenticated]);
  const integrationsByProvider = new Map<CanonicalProviderId, IntegrationDetail>();
  for (const integration of rawIntegrations) {
    const canonicalProvider = normalizeSupportedProvider(integration.provider, supportedProviders);
    if (!canonicalProvider) {
      continue;
    }
    const candidate = {
      ...integration,
      provider: canonicalProvider,
    };
    const existing = integrationsByProvider.get(canonicalProvider);
    if (!existing) {
      integrationsByProvider.set(canonicalProvider, candidate);
      continue;
    }

    const candidateCreated = Date.parse(candidate.created_at);
    const existingCreated = Date.parse(existing.created_at);
    const candidateIsNewer =
      Number.isFinite(candidateCreated) &&
      (!Number.isFinite(existingCreated) || candidateCreated > existingCreated);

    if (
      (!existing.connected && candidate.connected) ||
      (existing.connected === candidate.connected && candidateIsNewer)
    ) {
      integrationsByProvider.set(canonicalProvider, candidate);
    }
  }
  const integrations = [...integrationsByProvider.values()];
  const providers = [...new Set(providerCatalog.map((entry) => entry.provider))];
  const isLoading =
    isAuthenticated && (integrationsData === undefined || providerCatalogRaw === undefined);

  return {
    isLoading,
    providers,
    providerCatalog,
    integrations,
    refreshIntegrations,
    connectProvider,
    disconnectProvider,
    testConnection,
    registerCustomIntegration,
  };
}
