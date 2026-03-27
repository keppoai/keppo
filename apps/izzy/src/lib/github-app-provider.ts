import type { OAuthConfig, OAuthUserConfig } from "next-auth/providers/oauth";

export interface GitHubAppProfile extends Record<string, unknown> {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

export const GitHubAppProvider = (
  options: OAuthUserConfig<GitHubAppProfile> & {
    repositoryId: string;
  },
): OAuthConfig<GitHubAppProfile> => {
  const { repositoryId, ...providerOptions } = options;

  return {
    id: "github",
    name: "GitHub",
    type: "oauth",
    checks: ["pkce", "state"],
    authorization: {
      url: "https://github.com/login/oauth/authorize",
      params: {
        allow_signup: "false",
      },
    },
    token: {
      url: "https://github.com/login/oauth/access_token",
      params: {
        repository_id: repositoryId,
      },
    },
    userinfo: "https://api.github.com/user",
    client: {
      token_endpoint_auth_method: "client_secret_post",
    },
    profile(profile) {
      return {
        id: String(profile.id),
        name: profile.name ?? profile.login,
        email: profile.email,
        image: profile.avatar_url,
      };
    },
    options: providerOptions,
  };
};
