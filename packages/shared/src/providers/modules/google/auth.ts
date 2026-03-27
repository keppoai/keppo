import { getProviderDefaultScopes } from "../../../provider-default-scopes.js";
import { createManagedOAuthAuthFacet, type ManagedOAuthConfig } from "../oauth.js";

const GOOGLE_SCOPE_MAP: Record<string, string> = {
  "gmail.readonly": "https://www.googleapis.com/auth/gmail.readonly",
  "gmail.send": "https://www.googleapis.com/auth/gmail.send",
  "gmail.modify": "https://www.googleapis.com/auth/gmail.modify",
  "gmail.compose": "https://www.googleapis.com/auth/gmail.compose",
  "gmail.settings.basic": "https://www.googleapis.com/auth/gmail.settings.basic",
  "gmail.labels": "https://www.googleapis.com/auth/gmail.labels",
};

export const googleManagedOAuthConfig: ManagedOAuthConfig = {
  authUrlEnvKey: "GOOGLE_OAUTH_AUTH_URL",
  authPath: "/gmail/oauth/authorize",
  tokenUrlEnvKey: "GOOGLE_OAUTH_TOKEN_URL",
  tokenPath: "/gmail/oauth/token",
  apiBaseUrlEnvKey: "GMAIL_API_BASE_URL",
  apiPath: "/gmail/v1",
  clientIdEnvKey: "GOOGLE_CLIENT_ID",
  clientSecretEnvKey: "GOOGLE_CLIENT_SECRET",
  defaultClientId: "fake-google-client-id",
  defaultClientSecret: "fake-google-client-secret",
  defaultScopes: getProviderDefaultScopes("google"),
  scopeMap: GOOGLE_SCOPE_MAP,
  authUrlParams: {
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
  },
  profilePaths: ["/users/me/profile", "/profile"],
  resolveExternalAccountId: (profile) => {
    const emailAddress = profile.emailAddress;
    return typeof emailAddress === "string" && emailAddress.trim() ? emailAddress : null;
  },
};

export const auth = createManagedOAuthAuthFacet("google", googleManagedOAuthConfig);
