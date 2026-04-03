import { getProviderDefaultScopes } from "../../../provider-default-scopes.js";
import { createManagedOAuthAuthFacet, type ManagedOAuthConfig } from "../oauth.js";

const STRIPE_PROVIDER_SCOPE_READ_ONLY = "read_only";
const STRIPE_PROVIDER_SCOPE_READ_WRITE = "read_write";

const mapRequestedStripeScopes = (requestedScopes: Array<string>): Array<string> => {
  return requestedScopes.includes("stripe.write")
    ? [STRIPE_PROVIDER_SCOPE_READ_WRITE]
    : [STRIPE_PROVIDER_SCOPE_READ_ONLY];
};

const normalizeGrantedStripeScopes = (
  requestedScopes: Array<string>,
  tokenScope: string | undefined,
): Array<string> => {
  const normalizedTokenScope = tokenScope?.trim();
  if (!normalizedTokenScope) {
    return [...requestedScopes];
  }
  if (normalizedTokenScope === STRIPE_PROVIDER_SCOPE_READ_WRITE) {
    return ["stripe.read", "stripe.write"];
  }
  if (normalizedTokenScope === STRIPE_PROVIDER_SCOPE_READ_ONLY) {
    return ["stripe.read"];
  }
  return [...requestedScopes];
};

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
  mapRequestedScopes: mapRequestedStripeScopes,
  normalizeGrantedScopes: normalizeGrantedStripeScopes,
  profilePaths: [],
  resolveExternalAccountIdFromTokenResponse: (payload) => {
    const accountId = payload.stripe_user_id;
    return typeof accountId === "string" && accountId.trim() ? accountId : null;
  },
  resolveExternalAccountId: (profile) => {
    const accountId = profile.id;
    return typeof accountId === "string" && accountId.trim() ? accountId : null;
  },
};

export const auth = createManagedOAuthAuthFacet("stripe", stripeManagedOAuthConfig);
