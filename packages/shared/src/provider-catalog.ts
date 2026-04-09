import { allTools, type ToolDefinition } from "./tool-definitions.js";
import { resolveProviderSelection } from "./provider-runtime-config.js";
import { CANONICAL_PROVIDER_IDS, type CanonicalProviderId } from "./provider-ids.js";
import type { ProviderCatalogConfigurationStatus, ProviderDeprecationStatus } from "./domain.js";
import { providerModulesV2 } from "./providers/modules/index.js";

export { CANONICAL_PROVIDER_IDS, PROVIDER_ALIASES, resolveProvider } from "./provider-ids.js";
export type {
  CanonicalProviderId,
  ProviderResolution,
  ResolveProviderOptions,
} from "./provider-ids.js";

const CANONICAL_PROVIDER_SET = new Set<string>(CANONICAL_PROVIDER_IDS);

export type ProviderCatalogEntry = {
  provider: CanonicalProviderId;
  supported_tools: Array<{
    name: string;
    capability: "read" | "write";
    risk_level: "low" | "medium" | "high" | "critical";
    requires_approval: boolean;
  }>;
  configuration?: {
    status: ProviderCatalogConfigurationStatus;
    message: string;
  };
  configuration_requirements?: string[];
  deprecation?: {
    status: ProviderDeprecationStatus;
    message: string;
    sunset_at?: string;
    replacement_provider?: CanonicalProviderId;
  };
};

const toCatalogTool = (tool: ToolDefinition) => ({
  name: tool.name,
  capability: tool.capability,
  risk_level: tool.risk_level,
  requires_approval: tool.requires_approval,
});

const toCanonicalProvider = (provider: string): CanonicalProviderId | null => {
  if (CANONICAL_PROVIDER_SET.has(provider)) {
    return provider as CanonicalProviderId;
  }
  return null;
};

const providerToolOwnership = (() => {
  const grouped = new Map<CanonicalProviderId, Array<ReturnType<typeof toCatalogTool>>>();
  for (const provider of CANONICAL_PROVIDER_IDS) {
    grouped.set(provider, []);
  }

  for (const tool of allTools) {
    if (tool.provider === "keppo") {
      continue;
    }
    const provider = toCanonicalProvider(tool.provider);
    if (!provider) {
      continue;
    }
    grouped.get(provider)?.push(toCatalogTool(tool));
  }

  return grouped;
})();

const providerMetadataById = new Map(
  providerModulesV2.map((module) => [module.providerId, module.metadata] as const),
);

export const ENABLED_PROVIDER_IDS = resolveProviderSelection(CANONICAL_PROVIDER_IDS);

export const providerCatalog: Array<ProviderCatalogEntry> = ENABLED_PROVIDER_IDS.map((provider) => {
  const metadata = providerMetadataById.get(provider);
  if (!metadata) {
    throw new Error(`Provider "${provider}" is missing module metadata.`);
  }
  return {
    provider,
    supported_tools: [...(providerToolOwnership.get(provider) ?? [])],
    ...(metadata.envRequirements.length > 0
      ? {
          configuration_requirements: [...metadata.envRequirements],
        }
      : {}),
    ...(metadata.deprecation
      ? {
          deprecation: {
            status: metadata.deprecation.status,
            message: metadata.deprecation.message,
            ...(metadata.deprecation.sunsetAt ? { sunset_at: metadata.deprecation.sunsetAt } : {}),
            ...(metadata.deprecation.replacementProviderId
              ? { replacement_provider: metadata.deprecation.replacementProviderId }
              : {}),
          },
        }
      : {}),
  };
});
