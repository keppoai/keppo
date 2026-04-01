import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({})),
  headers: vi.fn(async () => new Headers()),
}));

import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { requireIzzySession } from "./session";

describe("izzy session", () => {
  beforeEach(() => {
    process.env.GITHUB_ID = "github-app-client-id";
    process.env.GITHUB_SECRET = "github-app-client-secret";
    process.env.NEXTAUTH_SECRET = "nextauth-secret";
    process.env.NEXTAUTH_URL = "http://localhost:3201";
    process.env.IZZY_ALLOWED_GITHUB_USERS = "will";
    process.env.IZZY_OPENAI_API_KEY = "openai-key";
    process.env.IZZY_TARGET_REPO_ID = "123456789";
  });

  it("reads the repo token from the server jwt instead of the session payload", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      expires: new Date(Date.now() + 60_000).toISOString(),
      errorCode: undefined,
      user: {
        githubLogin: "will",
      },
    });
    vi.mocked(getToken).mockResolvedValue({
      accessToken: "repo-token",
      githubLogin: "will",
    });

    await expect(requireIzzySession()).resolves.toEqual({
      accessToken: "repo-token",
      githubLogin: "will",
    });
  });

  it("rejects sessions that have been removed from the github allowlist", async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      expires: new Date(Date.now() + 60_000).toISOString(),
      errorCode: "github_not_allowed",
      user: {
        githubLogin: "removed-user",
      },
    });
    vi.mocked(getToken).mockResolvedValue({
      accessToken: "repo-token",
      githubLogin: "removed-user",
      errorCode: "github_not_allowed",
    });

    await expect(requireIzzySession()).rejects.toThrow("unauthorized_session");
  });
});
