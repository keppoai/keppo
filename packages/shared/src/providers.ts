import type { Connector, ConnectorContext, PreparedWrite } from "./connectors/base.js";
import {
  CANONICAL_PROVIDER_IDS,
  PROVIDER_ALIASES,
  resolveProvider,
  type CanonicalProviderId,
  type ProviderResolution,
  type ResolveProviderOptions,
} from "./provider-catalog.js";
import { resolveProviderSelection } from "./provider-runtime-config.js";
import { toolMap, type ToolDefinition } from "./tool-definitions.js";
import type { ProviderModuleV2 } from "./providers/registry/types.js";
import type { ProviderRuntimeContext } from "./provider-runtime-context.js";
import { providerModulesV2 } from "./providers/modules/index.js";
import { PROVIDER_MODULE_SCHEMA_VERSION as MODULE_SCHEMA_VERSION } from "./providers/modules/shared.js";
import type { ProviderRolloutFeatureFlag } from "./feature-flags.js";
import type { ProviderDeprecationStatus, WebhookVerificationReason } from "./domain.js";
import { PROVIDER_AUTH_MODES, PROVIDER_AUTH_MODE, type ProviderAuthMode } from "./provider-auth.js";

const CANONICAL_PROVIDER_SET = new Set<string>(CANONICAL_PROVIDER_IDS);

export const PROVIDER_MODULE_SCHEMA_VERSION = MODULE_SCHEMA_VERSION;
export type ProviderCapability =
  | "read"
  | "write"
  | "refresh_credentials"
  | "webhook"
  | "automation_triggers";
export type ProviderRiskClass = "low" | "medium" | "high";

export {
  CANONICAL_PROVIDER_IDS,
  PROVIDER_AUTH_MODES,
  PROVIDER_AUTH_MODE,
  PROVIDER_ALIASES,
  resolveProvider,
};
export type { CanonicalProviderId, ProviderResolution, ResolveProviderOptions };
export type { ConnectorContext, PreparedWrite } from "./connectors/base.js";
export type { ProviderRuntimeContext } from "./provider-runtime-context.js";

export type ProviderAuthRequest = {
  redirectUri: string;
  state: string;
  scopes: Array<string>;
  namespace?: string;
  /** OAuth 2.0 PKCE (required for X user access tokens). */
  pkceCodeVerifier?: string;
};

export type ProviderAuthExchangeRequest = {
  code: string;
  redirectUri: string;
  scopes?: Array<string>;
  namespace?: string;
  /** PKCE code_verifier for token exchange (must match authorize-step challenge). */
  pkceCodeVerifier?: string;
};

export type ProviderCredentialBundle = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scopes: Array<string>;
  externalAccountId: string | null;
};

export type ProviderWebhookVerificationRequest = {
  rawBody: string;
  headers: Record<string, string | undefined>;
};

export type ProviderWebhookVerificationResult =
  | {
      verified: true;
    }
  | {
      verified: false;
      reason: WebhookVerificationReason;
    };

export type ProviderWebhookEvent = {
  deliveryId: string;
  eventType: string;
  externalAccountId: string | null;
};

export type ProviderToolMode = "read" | "prepare_write" | "execute_write";

export type ProviderExecuteToolRequest = {
  toolName: string;
  input: Record<string, unknown>;
  context: ConnectorContext;
  mode: ProviderToolMode;
};

export interface ProviderRuntimeHooks {
  buildAuthRequest: (
    request: ProviderAuthRequest,
    runtime: ProviderRuntimeContext,
  ) => Promise<Record<string, unknown>>;
  exchangeCredentials: (
    request: ProviderAuthExchangeRequest,
    runtime: ProviderRuntimeContext,
  ) => Promise<ProviderCredentialBundle>;
  refreshCredentials?: (
    refreshToken: string,
    runtime: ProviderRuntimeContext,
  ) => Promise<ProviderCredentialBundle>;
  executeTool: (
    request: ProviderExecuteToolRequest,
    runtime: ProviderRuntimeContext,
  ) => Promise<Record<string, unknown> | PreparedWrite>;
  verifyWebhook?: (
    request: ProviderWebhookVerificationRequest,
    runtime: ProviderRuntimeContext,
  ) => Promise<ProviderWebhookVerificationResult>;
  extractWebhookEvent?: (
    payload: Record<string, unknown>,
    request: ProviderWebhookVerificationRequest,
    runtime: ProviderRuntimeContext,
  ) => ProviderWebhookEvent;
  healthcheck: (
    context: ConnectorContext,
    runtime: ProviderRuntimeContext,
  ) => Promise<{ ok: boolean; detail: string }>;
}

export interface ProviderModuleMetadata {
  providerId: CanonicalProviderId;
  auth: {
    mode: ProviderAuthMode;
    managed: boolean;
  };
  capabilities: {
    read: boolean;
    write: boolean;
    refreshCredentials: boolean;
    webhook: boolean;
    automationTriggers: boolean;
  };
  featureGate: ProviderRolloutFeatureFlag;
  riskClass: ProviderRiskClass;
  envRequirements: Array<string>;
  display: {
    label: string;
    description: string;
    icon: string;
  };
  oauth?: {
    defaultScopes: Array<string>;
    requiresPkce?: boolean;
  };
  deprecation?: {
    status: ProviderDeprecationStatus;
    message: string;
    sunsetAt?: string;
    replacementProviderId?: CanonicalProviderId;
  };
  toolOwnership: Array<string>;
  legacyAliases: Array<string>;
}

export interface ProviderModule {
  schemaVersion: typeof PROVIDER_MODULE_SCHEMA_VERSION;
  metadata: ProviderModuleMetadata;
  hooks: ProviderRuntimeHooks;
  connector: Connector;
}

export type ListProviderFilter = {
  capability?: ProviderCapability;
};

const cloneMetadata = (metadata: ProviderModuleMetadata): ProviderModuleMetadata => {
  return {
    ...metadata,
    auth: {
      ...metadata.auth,
    },
    capabilities: {
      ...metadata.capabilities,
    },
    envRequirements: [...metadata.envRequirements],
    display: {
      ...metadata.display,
    },
    ...(metadata.oauth
      ? {
          oauth: {
            defaultScopes: [...metadata.oauth.defaultScopes],
            ...(metadata.oauth.requiresPkce ? { requiresPkce: true } : {}),
          },
        }
      : {}),
    ...(metadata.deprecation
      ? {
          deprecation: {
            ...metadata.deprecation,
          },
        }
      : {}),
    toolOwnership: [...metadata.toolOwnership],
    legacyAliases: [...metadata.legacyAliases],
  };
};

const toLegacyProviderModule = (module: ProviderModuleV2): ProviderModule => {
  const hooks: ProviderRuntimeHooks = {
    buildAuthRequest: module.facets.auth.buildAuthRequest,
    exchangeCredentials: module.facets.auth.exchangeCredentials,
    executeTool: module.facets.tools.executeTool,
    healthcheck: module.facets.tools.healthcheck,
    ...(module.facets.refresh
      ? { refreshCredentials: module.facets.refresh.refreshCredentials }
      : {}),
    ...(module.facets.webhooks
      ? {
          verifyWebhook: module.facets.webhooks.verifyWebhook,
          extractWebhookEvent: module.facets.webhooks.extractWebhookEvent,
        }
      : {}),
  };

  return {
    schemaVersion: module.schemaVersion as typeof PROVIDER_MODULE_SCHEMA_VERSION,
    metadata: cloneMetadata(module.metadata),
    hooks,
    connector: module.connector,
  };
};

export class ProviderRegistry {
  private readonly modulesByProvider: Map<CanonicalProviderId, ProviderModule>;
  private readonly toolsByProvider: Map<CanonicalProviderId, Array<ToolDefinition>>;
  private readonly providerByTool: Map<string, CanonicalProviderId>;

  constructor(modules: Array<ProviderModule>) {
    this.modulesByProvider = new Map();
    this.toolsByProvider = new Map();
    this.providerByTool = new Map();

    for (const module of modules) {
      this.assertModule(module);

      if (this.modulesByProvider.has(module.metadata.providerId)) {
        throw new Error(`Duplicate provider module "${module.metadata.providerId}".`);
      }

      const tools = module.metadata.toolOwnership.map((toolName) => {
        const tool = toolMap.get(toolName);
        if (!tool) {
          throw new Error(
            `Provider "${module.metadata.providerId}" owns unknown tool "${toolName}".`,
          );
        }
        if (this.providerByTool.has(toolName)) {
          const owner = this.providerByTool.get(toolName);
          throw new Error(
            `Tool "${toolName}" is owned by both "${String(owner)}" and "${module.metadata.providerId}".`,
          );
        }
        this.providerByTool.set(toolName, module.metadata.providerId);
        return tool;
      });

      this.modulesByProvider.set(module.metadata.providerId, module);
      this.toolsByProvider.set(module.metadata.providerId, tools);
    }
  }

  resolveProvider(input: string, options: ResolveProviderOptions = {}): ProviderResolution {
    return resolveProvider(input, options);
  }

  getProviderModule(providerId: string): ProviderModule {
    const resolved = this.resolveProvider(providerId, { allowAliases: false });
    const module = this.modulesByProvider.get(resolved.providerId);
    if (!module) {
      throw new Error(`Provider module "${providerId}" is not registered.`);
    }
    return module;
  }

  getProviderTools(providerId: string): Array<ToolDefinition> {
    const resolved = this.resolveProvider(providerId, { allowAliases: false });
    return [...(this.toolsByProvider.get(resolved.providerId) ?? [])];
  }

  getToolOwner(toolName: string): CanonicalProviderId {
    const providerId = this.providerByTool.get(toolName);
    if (!providerId) {
      throw new Error(`No provider module owns tool "${toolName}".`);
    }
    return providerId;
  }

  assertProviderSupports(providerId: string, capability: ProviderCapability): ProviderModule {
    const module = this.getProviderModule(providerId);
    if (capability === "read" && !module.metadata.capabilities.read) {
      throw new Error(`Provider "${providerId}" does not support read capability.`);
    }
    if (capability === "write" && !module.metadata.capabilities.write) {
      throw new Error(`Provider "${providerId}" does not support write capability.`);
    }
    if (capability === "refresh_credentials" && !module.metadata.capabilities.refreshCredentials) {
      throw new Error(`Provider "${providerId}" does not support credential refresh.`);
    }
    if (capability === "webhook" && !module.metadata.capabilities.webhook) {
      throw new Error(`Provider "${providerId}" does not support webhook verification.`);
    }
    if (capability === "automation_triggers" && !module.metadata.capabilities.automationTriggers) {
      throw new Error(`Provider "${providerId}" does not support automation triggers.`);
    }
    return module;
  }

  listProviders(filter: ListProviderFilter = {}): Array<ProviderModule> {
    const modules = [...this.modulesByProvider.values()];
    if (!filter.capability) {
      return modules;
    }

    return modules.filter((module) => {
      if (filter.capability === "read") {
        return module.metadata.capabilities.read;
      }
      if (filter.capability === "write") {
        return module.metadata.capabilities.write;
      }
      if (filter.capability === "refresh_credentials") {
        return module.metadata.capabilities.refreshCredentials;
      }
      if (filter.capability === "webhook") {
        return module.metadata.capabilities.webhook;
      }
      return module.metadata.capabilities.automationTriggers;
    });
  }

  private assertModule(module: ProviderModule): void {
    if (module.schemaVersion !== PROVIDER_MODULE_SCHEMA_VERSION) {
      throw new Error(
        `Provider "${module.metadata.providerId}" has unsupported schema version ${String(module.schemaVersion)}.`,
      );
    }

    if (!CANONICAL_PROVIDER_SET.has(module.metadata.providerId)) {
      throw new Error(`Provider "${module.metadata.providerId}" is not a canonical provider id.`);
    }

    const hasRead = module.metadata.toolOwnership.some((toolName) => {
      return toolMap.get(toolName)?.capability === "read";
    });
    const hasWrite = module.metadata.toolOwnership.some((toolName) => {
      return toolMap.get(toolName)?.capability === "write";
    });
    if (module.metadata.capabilities.read !== hasRead) {
      throw new Error(
        `Provider "${module.metadata.providerId}" read capability does not match owned tools.`,
      );
    }
    if (module.metadata.capabilities.write !== hasWrite) {
      throw new Error(
        `Provider "${module.metadata.providerId}" write capability does not match owned tools.`,
      );
    }

    if (module.metadata.capabilities.refreshCredentials && !module.hooks.refreshCredentials) {
      throw new Error(
        `Provider "${module.metadata.providerId}" must implement refreshCredentials hook.`,
      );
    }
    if (!module.metadata.capabilities.refreshCredentials && module.hooks.refreshCredentials) {
      throw new Error(
        `Provider "${module.metadata.providerId}" cannot define refreshCredentials without capability.`,
      );
    }

    if (module.metadata.capabilities.webhook && !module.hooks.verifyWebhook) {
      throw new Error(
        `Provider "${module.metadata.providerId}" must implement verifyWebhook hook.`,
      );
    }
    if (module.metadata.capabilities.webhook && !module.hooks.extractWebhookEvent) {
      throw new Error(
        `Provider "${module.metadata.providerId}" must implement extractWebhookEvent hook.`,
      );
    }
    if (!module.metadata.capabilities.webhook && module.hooks.verifyWebhook) {
      throw new Error(
        `Provider "${module.metadata.providerId}" cannot define verifyWebhook without capability.`,
      );
    }
    if (!module.metadata.capabilities.webhook && module.hooks.extractWebhookEvent) {
      throw new Error(
        `Provider "${module.metadata.providerId}" cannot define extractWebhookEvent without capability.`,
      );
    }
  }
}

export const allProviderModules: Array<ProviderModule> =
  providerModulesV2.map(toLegacyProviderModule);

const allProviderModulesById = new Map(
  allProviderModules.map((module) => [module.metadata.providerId, module] as const),
);
const enabledProviderIds = resolveProviderSelection(CANONICAL_PROVIDER_IDS);

export const providerModules: Array<ProviderModule> = enabledProviderIds.map((providerId) => {
  const module = allProviderModulesById.get(providerId);
  if (!module) {
    throw new Error(`Provider module "${providerId}" is not implemented.`);
  }
  return module;
});

if (providerModules.length === 0) {
  throw new Error("Provider registry cannot start with zero modules.");
}

export const providerRegistry = new ProviderRegistry(providerModules);

export const getProviderModule = (providerId: string): ProviderModule => {
  return providerRegistry.getProviderModule(providerId);
};

export const getProviderTools = (providerId: string): Array<ToolDefinition> => {
  return providerRegistry.getProviderTools(providerId);
};

export const assertProviderSupports = (
  providerId: string,
  capability: ProviderCapability,
): ProviderModule => {
  return providerRegistry.assertProviderSupports(providerId, capability);
};

export const listProviders = (filter: ListProviderFilter = {}): Array<ProviderModule> => {
  return providerRegistry.listProviders(filter);
};

const providerCatalogFromRegistry = providerRegistry.listProviders().map((module) => ({
  provider: module.metadata.providerId,
  supported_tools: providerRegistry.getProviderTools(module.metadata.providerId).map((tool) => ({
    name: tool.name,
    capability: tool.capability,
    risk_level: tool.risk_level,
    requires_approval: tool.requires_approval,
  })),
  ...(module.metadata.deprecation
    ? {
        deprecation: {
          status: module.metadata.deprecation.status,
          message: module.metadata.deprecation.message,
          ...(module.metadata.deprecation.sunsetAt
            ? { sunset_at: module.metadata.deprecation.sunsetAt }
            : {}),
          ...(module.metadata.deprecation.replacementProviderId
            ? {
                replacement_provider: module.metadata.deprecation.replacementProviderId,
              }
            : {}),
        },
      }
    : {}),
}));

export const providerRegistryCatalog = providerCatalogFromRegistry;

export const getConnectorLookupEntries = (): Array<[string, Connector]> => {
  const entries = new Map<string, Connector>();
  for (const module of providerRegistry.listProviders()) {
    entries.set(module.metadata.providerId, module.connector);
  }
  return [...entries.entries()];
};
