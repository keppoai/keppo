import { getProviderDefaultScopes } from "../../../provider-default-scopes.js";
import { createManagedOAuthAuthFacet, type ManagedOAuthConfig } from "../oauth.js";

export const githubManagedOAuthConfig: ManagedOAuthConfig = {
  authUrlEnvKey: "GITHUB_OAUTH_AUTH_URL",
  authPath: "/github/oauth/authorize",
  tokenUrlEnvKey: "GITHUB_OAUTH_TOKEN_URL",
  tokenPath: "/github/oauth/token",
  apiBaseUrlEnvKey: "GITHUB_API_BASE_URL",
  apiPath: "/github/v1",
  clientIdEnvKey: "GITHUB_CLIENT_ID",
  clientSecretEnvKey: "GITHUB_CLIENT_SECRET",
  defaultClientId: "fake-github-client-id",
  defaultClientSecret: "fake-github-client-secret",
  defaultScopes: getProviderDefaultScopes("github"),
  profilePaths: ["/profile", "/user"],
  resolveExternalAccountId: (profile) => {
    const login = profile.login;
    if (typeof login === "string" && login.trim()) {
      return login;
    }
    const id = profile.id;
    if (typeof id === "string" && id.trim()) {
      return id;
    }
    if (typeof id === "number") {
      return String(id);
    }
    return null;
  },
};

export const auth = createManagedOAuthAuthFacet("github", githubManagedOAuthConfig);
