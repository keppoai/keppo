import { beforeEach, describe, expect, it } from "vitest";
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
});
