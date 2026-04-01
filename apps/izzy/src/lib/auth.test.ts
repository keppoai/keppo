import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAuthOptions, hasAuthConfiguration } from "./auth";
import type { OAuthConfig } from "next-auth/providers/oauth";

describe("izzy auth", () => {
  beforeEach(() => {
    process.env.GITHUB_ID = "github-app-client-id";
    process.env.GITHUB_SECRET = "github-app-client-secret";
    process.env.NEXTAUTH_SECRET = "nextauth-secret";
    process.env.NEXTAUTH_URL = "http://localhost:3201";
    process.env.IZZY_ALLOWED_GITHUB_USERS = "will";
    process.env.IZZY_OPENAI_API_KEY = "openai-key";
    process.env.IZZY_TARGET_REPO_ID = "123456789";
  });

  it("requires the target repository id for auth configuration", () => {
    expect(hasAuthConfiguration()).toBe(true);
    delete process.env.IZZY_TARGET_REPO_ID;
    expect(hasAuthConfiguration()).toBe(false);
  });

  it("configures the GitHub provider to request a repo-restricted app token", () => {
    const authOptions = getAuthOptions();
    const provider = authOptions.providers[0] as OAuthConfig<Record<string, unknown>>;
    const authorization =
      typeof provider.authorization === "string" ? null : provider.authorization;

    expect(provider?.id).toBe("github");
    expect(provider?.type).toBe("oauth");
    expect(authorization?.params).toEqual({
      allow_signup: "false",
    });
    expect(provider?.token).toMatchObject({
      url: "https://github.com/login/oauth/access_token",
      params: {
        repository_id: "123456789",
      },
    });
  });

  it("revokes stored github tokens before a disallowed login can refresh them", async () => {
    const authOptions = getAuthOptions();
    const jwt = authOptions.callbacks?.jwt;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const jwtArgs = {
      account: null,
      token: {
        accessToken: "stale-access-token",
        refreshToken: "refresh-token",
        githubLogin: "removed-user",
        accessTokenExpiresAt: Date.now() - 120_000,
        refreshTokenExpiresAt: Date.now() + 3_600_000,
      },
      user: undefined,
    } as unknown as Parameters<NonNullable<typeof jwt>>[0];

    const result = await jwt?.(jwtArgs);

    expect(result).toMatchObject({
      accessToken: undefined,
      refreshToken: undefined,
      accessTokenExpiresAt: undefined,
      refreshTokenExpiresAt: undefined,
      errorCode: "github_not_allowed",
      githubLogin: "removed-user",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the repo token out of the client-visible session payload", async () => {
    const authOptions = getAuthOptions();
    const sessionCallback = authOptions.callbacks?.session;
    expect(sessionCallback).toBeDefined();
    if (!sessionCallback) {
      throw new Error("missing session callback");
    }
    const sessionArgs = {
      session: {
        expires: new Date(Date.now() + 60_000).toISOString(),
        user: {
          name: null,
          email: null,
          image: null,
        },
      },
      token: {
        accessToken: "repo-token",
        errorCode: "github_session_expired",
        githubLogin: "will",
      },
      user: undefined,
    } as unknown as Parameters<typeof sessionCallback>[0];
    const session = await sessionCallback(sessionArgs);

    expect(session).toBeDefined();

    expect(session).toMatchObject({
      errorCode: "github_session_expired",
      user: {
        githubLogin: "will",
      },
    });
    expect(session).not.toHaveProperty("accessToken");
  });
});
