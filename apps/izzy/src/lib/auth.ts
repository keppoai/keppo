import type { NextAuthOptions } from "next-auth";
import { getAllowlistedGithubUsers, getServerEnv } from "./env";
import { GitHubAppProvider } from "./github-app-provider";

type JwtToken = {
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  githubLogin?: string | undefined;
  errorCode?: string | undefined;
  accessTokenExpiresAt?: number | undefined;
  refreshTokenExpiresAt?: number | undefined;
};

const isAllowedGithubLogin = (login: string | null | undefined): boolean => {
  if (!login) {
    return false;
  }
  return getAllowlistedGithubUsers().has(login.toLowerCase());
};

const getGithubLogin = (profile: unknown): string | null => {
  if (!profile || typeof profile !== "object") {
    return null;
  }
  const candidate = (profile as Record<string, unknown>).login;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null;
};

export const hasAuthConfiguration = (): boolean =>
  [
    process.env.GITHUB_ID,
    process.env.GITHUB_SECRET,
    process.env.NEXTAUTH_SECRET,
    process.env.NEXTAUTH_URL,
    process.env.IZZY_TARGET_REPO_ID,
  ].every((value) => typeof value === "string" && value.trim().length > 0);

const toExpiryTimestampMs = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Date.now() + value * 1000;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Date.now() + Number(value) * 1000;
  }
  return undefined;
};

const toUnixTimestampMs = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value * 1000;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    return Number(value) * 1000;
  }
  return undefined;
};

const isExpired = (expiresAt: number | undefined): boolean =>
  typeof expiresAt === "number" && Date.now() >= expiresAt - 60_000;

const refreshGitHubAppAccessToken = async (refreshToken: string) => {
  const env = getServerEnv();
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: env.GITHUB_ID,
      client_secret: env.GITHUB_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    cache: "no-store",
  });
  const payload = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    refresh_token_expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(
      `github_app_token_refresh_${response.status}: ${payload.error_description ?? payload.error ?? "unknown_error"}`,
    );
  }
  return {
    accessToken: payload.access_token,
    accessTokenExpiresAt: toExpiryTimestampMs(payload.expires_in),
    refreshToken: payload.refresh_token ?? refreshToken,
    refreshTokenExpiresAt: toExpiryTimestampMs(payload.refresh_token_expires_in),
  };
};

const withRefreshedAccessToken = async (token: JwtToken): Promise<JwtToken> => {
  if (!token.accessToken || !isExpired(token.accessTokenExpiresAt)) {
    return token;
  }
  if (!token.refreshToken || isExpired(token.refreshTokenExpiresAt)) {
    return {
      ...token,
      accessToken: undefined,
      errorCode: "github_session_expired",
    };
  }
  try {
    const refreshed = await refreshGitHubAppAccessToken(token.refreshToken);
    return {
      ...token,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
      refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
      errorCode: undefined,
    };
  } catch {
    return {
      ...token,
      accessToken: undefined,
      errorCode: "github_session_expired",
    };
  }
};

export const getAuthOptions = (): NextAuthOptions => {
  const env = getServerEnv();
  return {
    secret: env.NEXTAUTH_SECRET,
    session: {
      strategy: "jwt",
    },
    pages: {
      error: "/?authError=github_auth_failed",
    },
    providers: [
      GitHubAppProvider({
        clientId: env.GITHUB_ID,
        clientSecret: env.GITHUB_SECRET,
        repositoryId: env.IZZY_TARGET_REPO_ID,
      }),
    ],
    callbacks: {
      async signIn({ profile }) {
        const login = getGithubLogin(profile);
        if (!isAllowedGithubLogin(login)) {
          return "/?authError=github_not_allowed";
        }
        return true;
      },
      async jwt({ token, account, profile }) {
        const nextToken: JwtToken = {
          ...token,
        };
        if (account?.access_token) {
          nextToken.accessToken = account.access_token;
          nextToken.refreshToken =
            typeof account.refresh_token === "string" ? account.refresh_token : undefined;
          nextToken.accessTokenExpiresAt =
            toUnixTimestampMs(account.expires_at) ?? toExpiryTimestampMs(account.expires_in);
          nextToken.refreshTokenExpiresAt = toExpiryTimestampMs(account.refresh_token_expires_in);
        }
        const githubLogin = getGithubLogin(profile);
        if (githubLogin) {
          nextToken.githubLogin = githubLogin;
        }
        if (nextToken.githubLogin && !isAllowedGithubLogin(nextToken.githubLogin)) {
          nextToken.errorCode = "github_not_allowed";
        }
        return await withRefreshedAccessToken(nextToken);
      },
      async session({ session, token }) {
        if (token.accessToken) {
          session.accessToken = token.accessToken;
        }
        if (token.errorCode) {
          session.errorCode = token.errorCode;
        }
        if (session.user && token.githubLogin) {
          session.user.githubLogin = token.githubLogin;
        }
        return session;
      },
    },
  };
};
