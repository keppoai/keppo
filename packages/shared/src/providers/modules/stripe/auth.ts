import { getProviderDefaultScopes } from "../../../provider-default-scopes.js";
import { createManagedOAuthAuthFacet, type ManagedOAuthConfig } from "../oauth.js";

export const stripeManagedOAuthConfig: ManagedOAuthConfig = {
  authUrlEnvKey: "STRIPE_OAUTH_AUTH_URL",
  authPath: "/stripe/oauth/authorize",
  tokenUrlEnvKey: "STRIPE_OAUTH_TOKEN_URL",
  tokenPath: "/stripe/oauth/token",
  apiBaseUrlEnvKey: "STRIPE_API_BASE_URL",
  apiPath: "/stripe/v1",
  clientIdEnvKey: "STRIPE_CLIENT_ID",
  clientSecretEnvKey: "STRIPE_SECRET_KEY",
  defaultClientId: "fake-stripe-client-id",
  defaultClientSecret: "fake-stripe-secret-key",
  defaultScopes: getProviderDefaultScopes("stripe"),
  profilePaths: ["/profile"],
  resolveExternalAccountId: (profile) => {
    const accountId = profile.id;
    return typeof accountId === "string" && accountId.trim() ? accountId : null;
  },
};

export const auth = createManagedOAuthAuthFacet("stripe", stripeManagedOAuthConfig);
