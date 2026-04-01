import { query, type QueryCtx } from "../_generated/server";
import { v } from "convex/values";
import { requireOrgMember } from "../_auth";
import type { IntegrationErrorCategory, IntegrationStatus } from "../domain_constants";
import { assertCanonicalStoredProvider, type ProviderId } from "../provider_ids";
import {
  PROVIDER_CATALOG_CONFIGURATION_STATUS,
  integrationValidator,
  isIntegrationConnected,
  providerCatalogEntries,
  providerCatalogValidator,
  toIntegrationResponse,
} from "./model";

const hasEnvValue = (value: string | undefined): boolean =>
  typeof value === "string" && value.trim().length > 0;

const selectPreferredIntegrationsByProvider = <
  T extends {
    id: string;
    provider: string;
    status: IntegrationStatus;
    created_at: string;
    last_error_category?: IntegrationErrorCategory | null;
  },
>(
  integrations: T[],
): Map<ProviderId, T> => {
  const dedupedByProvider = new Map<ProviderId, T>();
  for (const integration of integrations) {
    const canonical = assertCanonicalStoredProvider(
      integration.provider,
      `integrations:${integration.id}`,
    );
    const existing = dedupedByProvider.get(canonical);
    if (!existing) {
      dedupedByProvider.set(canonical, integration);
      continue;
    }
    if (
      !isIntegrationConnected({
        status: existing.status,
        lastErrorCategory: existing.last_error_category,
        credentialExpiresAt: undefined,
      }) &&
      isIntegrationConnected({
        status: integration.status,
        lastErrorCategory: integration.last_error_category,
        credentialExpiresAt: undefined,
      })
    ) {
      dedupedByProvider.set(canonical, integration);
      continue;
    }
    if (
      existing.status === integration.status &&
      integration.created_at.localeCompare(existing.created_at) > 0
    ) {
      dedupedByProvider.set(canonical, integration);
      continue;
    }
    if (existing.provider !== canonical && integration.provider === canonical) {
      dedupedByProvider.set(canonical, integration);
    }
  }
  return dedupedByProvider;
};

export const listConnectedProviderIdsForOrg = async (
  ctx: QueryCtx,
  orgId: string,
): Promise<ProviderId[]> => {
  const integrations = await ctx.db
    .query("integrations")
    .withIndex("by_org", (q) => q.eq("org_id", orgId))
    .collect();

  return [...selectPreferredIntegrationsByProvider(integrations).entries()]
    .filter(([, integration]) =>
      isIntegrationConnected({
        status: integration.status,
        lastErrorCategory: integration.last_error_category,
        credentialExpiresAt: undefined,
      }),
    )
    .map(([provider]) => provider);
};

const getProviderConfiguration = (provider: (typeof providerCatalogEntries)[number]) => {
  const requirements = provider.configuration_requirements;
  if (!requirements || requirements.length === 0) {
    return undefined;
  }

  const missingRequirements = requirements.filter((envVar) => !hasEnvValue(process.env[envVar]));
  if (missingRequirements.length === 0) {
    return {
      status: PROVIDER_CATALOG_CONFIGURATION_STATUS.configured,
      message: "OAuth env configured.",
    };
  }

  return {
    status: PROVIDER_CATALOG_CONFIGURATION_STATUS.misconfigured,
    message: `Missing ${missingRequirements.join(" or ")}.`,
  };
};

export const providerCatalog = query({
  args: {},
  returns: providerCatalogValidator,
  handler: async (ctx) => {
    await requireOrgMember(ctx);
    return providerCatalogEntries.map((provider) => {
      const configuration = getProviderConfiguration(provider);
      return {
        provider: provider.provider,
        supported_tools: provider.supported_tools.map((tool) => ({
          name: tool.name,
          capability: tool.capability,
          risk_level: tool.risk_level,
          requires_approval: tool.requires_approval,
        })),
        ...(configuration ? { configuration } : {}),
        ...(provider.deprecation
          ? {
              deprecation: {
                status: provider.deprecation.status,
                message: provider.deprecation.message,
                ...(provider.deprecation.sunset_at
                  ? { sunset_at: provider.deprecation.sunset_at }
                  : {}),
                ...(provider.deprecation.replacement_provider
                  ? {
                      replacement_provider: provider.deprecation.replacement_provider,
                    }
                  : {}),
              },
            }
          : {}),
      };
    });
  },
});

export const listForCurrentOrg = query({
  args: {},
  returns: v.array(integrationValidator),
  handler: async (ctx) => {
    const auth = await requireOrgMember(ctx);

    const integrations = await ctx.db
      .query("integrations")
      .withIndex("by_org", (q) => q.eq("org_id", auth.orgId))
      .collect();

    const selectedIntegrations = [...selectPreferredIntegrationsByProvider(integrations).values()];
    const accounts = (
      await Promise.all(
        selectedIntegrations.map((integration) =>
          ctx.db
            .query("integration_accounts")
            .withIndex("by_integration", (q) => q.eq("integration_id", integration.id))
            .collect(),
        ),
      )
    ).flat();
    const accountByIntegration = new Map(
      accounts.map((account) => [account.integration_id, account]),
    );

    const credentialRows = await Promise.all(
      accounts.map(async (account) => ({
        accountId: account.id,
        credential: await ctx.db
          .query("integration_credentials")
          .withIndex("by_integration_account", (q) => q.eq("integration_account_id", account.id))
          .first(),
      })),
    );
    const credentialByAccount = new Map<string, (typeof credentialRows)[number]["credential"]>();
    for (const entry of credentialRows) {
      if (entry.credential) {
        credentialByAccount.set(entry.accountId, entry.credential);
      }
    }

    return selectedIntegrations.map((integration) => {
      const account = accountByIntegration.get(integration.id);
      const credential = account ? credentialByAccount.get(account.id) : undefined;
      return toIntegrationResponse({
        integration,
        ...(account ? { account } : {}),
        ...(credential ? { credential } : {}),
      });
    });
  },
});
