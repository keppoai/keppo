import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRepositoryIssue, getRepositoryLabels } from "./github-client";

describe("github client", () => {
  beforeEach(() => {
    process.env.GITHUB_ID = "github-id";
    process.env.GITHUB_SECRET = "github-secret";
    process.env.NEXTAUTH_SECRET = "nextauth-secret";
    process.env.NEXTAUTH_URL = "http://localhost:3201";
    process.env.IZZY_ALLOWED_GITHUB_USERS = "will";
    process.env.IZZY_OPENAI_API_KEY = "openai-key";
    process.env.IZZY_TARGET_REPO_ID = "123456789";
  });

  it("posts the issue payload to GitHub", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ number: 42, html_url: "https://github.com/keppoai/keppo/issues/42" }),
          {
            status: 200,
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await createRepositoryIssue({
      token: "token",
      title: "Issue",
      body: "Body",
      labels: ["?agent:codex"],
    });

    expect(response.number).toBe(42);
    expect(fetchMock).toHaveBeenCalled();
  });

  it("uses the caller token when listing repository labels", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify([{ name: "?agent:codex" }, { name: "/plan-issue" }]), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const labels = await getRepositoryLabels("session-token");

    expect(labels).toEqual(["?agent:codex", "/plan-issue"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit | undefined];
    const requestUrl = firstCall[0];
    const init = firstCall[1];
    expect(String(requestUrl)).toContain("/labels?per_page=100");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer session-token");
  });
});
