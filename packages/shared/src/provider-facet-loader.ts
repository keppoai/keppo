import type { CanonicalProviderId } from "./provider-ids.js";
import {
  getProviderModuleV2,
  MANAGED_OAUTH_PROVIDER_IDS,
  WEBHOOK_PROVIDER_IDS,
} from "./providers/modules/index.js";
import type { ProviderModuleV2 } from "./providers/registry/types.js";
import type { ManagedOAuthProvider } from "./providers/boundaries/common.js";

export type WebhookProvider = CanonicalProviderId;

type ManagedOAuthFacetSlice = {
  metadata: ProviderModuleV2["metadata"];
  facets: Pick<ProviderModuleV2["facets"], "auth">;
};

type WebhookFacetSlice = {
  facets: {
    webhooks: NonNullable<ProviderModuleV2["facets"]["webhooks"]>;
  };
};

type ManagedOAuthFacetLoader = () => Promise<ManagedOAuthFacetSlice>;
type WebhookFacetLoader = () => Promise<WebhookFacetSlice>;

const managedOAuthProviderIdSet = new Set<string>(MANAGED_OAUTH_PROVIDER_IDS);
const webhookProviderIdSet = new Set<string>(WEBHOOK_PROVIDER_IDS);

const managedOAuthFacetLoaderFor = (provider: ManagedOAuthProvider): ManagedOAuthFacetLoader => {
  return async () => {
    const module = getProviderModuleV2(provider);
    if (!module.metadata.auth.managed) {
      throw new Error(`Provider "${provider}" does not support managed OAuth.`);
    }
    return {
      metadata: module.metadata,
      facets: { auth: module.facets.auth },
    };
  };
};

const webhookFacetLoaderFor = (provider: WebhookProvider): WebhookFacetLoader => {
  return async () => {
    const module = getProviderModuleV2(provider);
    if (!module.facets.webhooks) {
      throw new Error(`Provider "${provider}" does not support webhooks.`);
    }
    return {
      facets: {
        webhooks: module.facets.webhooks,
      },
    };
  };
};

const managedOAuthFacetPromises = new Map<ManagedOAuthProvider, Promise<ManagedOAuthFacetSlice>>();
const webhookFacetPromises = new Map<WebhookProvider, Promise<WebhookFacetSlice>>();

export const isWebhookProviderId = (provider: string): provider is WebhookProvider => {
  return webhookProviderIdSet.has(provider);
};

export const getManagedOAuthProviderFacets = async (
  provider: ManagedOAuthProvider,
): Promise<ManagedOAuthFacetSlice> => {
  let promise = managedOAuthFacetPromises.get(provider);
  if (!promise) {
    if (!managedOAuthProviderIdSet.has(provider)) {
      throw new Error(`Provider "${provider}" does not support managed OAuth.`);
    }
    promise = managedOAuthFacetLoaderFor(provider)();
    managedOAuthFacetPromises.set(provider, promise);
  }
  return await promise;
};

export const getWebhookProviderFacets = async (
  provider: WebhookProvider,
): Promise<WebhookFacetSlice> => {
  let promise = webhookFacetPromises.get(provider);
  if (!promise) {
    if (!webhookProviderIdSet.has(provider)) {
      throw new Error(`Provider "${provider}" does not support webhooks.`);
    }
    promise = webhookFacetLoaderFor(provider)();
    webhookFacetPromises.set(provider, promise);
  }
  return await promise;
};
