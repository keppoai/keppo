import type { ProviderModuleV2 } from "./providers/registry/types.js";

export type ManagedOAuthProvider = "google" | "stripe" | "github" | "reddit";
export type WebhookProvider = "stripe" | "github";

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

const managedOAuthFacetLoaders: Record<ManagedOAuthProvider, ManagedOAuthFacetLoader> = {
  google: async () => {
    const [{ metadata }, { auth }] = await Promise.all([
      import("./providers/modules/google/metadata.js"),
      import("./providers/modules/google/auth.js"),
    ]);
    return {
      metadata,
      facets: { auth },
    };
  },
  stripe: async () => {
    const [{ metadata }, { auth }] = await Promise.all([
      import("./providers/modules/stripe/metadata.js"),
      import("./providers/modules/stripe/auth.js"),
    ]);
    return {
      metadata,
      facets: { auth },
    };
  },
  github: async () => {
    const [{ metadata }, { auth }] = await Promise.all([
      import("./providers/modules/github/metadata.js"),
      import("./providers/modules/github/auth.js"),
    ]);
    return {
      metadata,
      facets: { auth },
    };
  },
  reddit: async () => {
    const [{ metadata }, { auth }] = await Promise.all([
      import("./providers/modules/reddit/metadata.js"),
      import("./providers/modules/reddit/auth.js"),
    ]);
    return {
      metadata,
      facets: { auth },
    };
  },
};

const webhookFacetLoaders: Record<WebhookProvider, WebhookFacetLoader> = {
  stripe: async () => ({
    facets: {
      webhooks: (await import("./providers/modules/stripe/webhooks.js")).webhooks,
    },
  }),
  github: async () => ({
    facets: {
      webhooks: (await import("./providers/modules/github/webhooks.js")).webhooks,
    },
  }),
};

const managedOAuthFacetPromises = new Map<ManagedOAuthProvider, Promise<ManagedOAuthFacetSlice>>();
const webhookFacetPromises = new Map<WebhookProvider, Promise<WebhookFacetSlice>>();

export const WEBHOOK_PROVIDER_IDS = ["stripe", "github"] as const;

const webhookProviderIdSet = new Set<WebhookProvider>(WEBHOOK_PROVIDER_IDS);

export const isWebhookProviderId = (provider: string): provider is WebhookProvider => {
  return webhookProviderIdSet.has(provider as WebhookProvider);
};

export const getManagedOAuthProviderFacets = async (
  provider: ManagedOAuthProvider,
): Promise<ManagedOAuthFacetSlice> => {
  let promise = managedOAuthFacetPromises.get(provider);
  if (!promise) {
    promise = managedOAuthFacetLoaders[provider]();
    managedOAuthFacetPromises.set(provider, promise);
  }
  return await promise;
};

export const getWebhookProviderFacets = async (
  provider: WebhookProvider,
): Promise<WebhookFacetSlice> => {
  let promise = webhookFacetPromises.get(provider);
  if (!promise) {
    promise = webhookFacetLoaders[provider]();
    webhookFacetPromises.set(provider, promise);
  }
  return await promise;
};
