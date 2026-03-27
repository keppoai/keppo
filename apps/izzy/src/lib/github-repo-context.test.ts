import { afterEach, describe, expect, it, vi } from "vitest";
import { getRepoContextForPrompt } from "./github-repo-context";

describe("github repo context", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ranked repo context snippets", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        return new Response(`contents for ${url}`, { status: 200 });
      }),
    );

    const snippets = await getRepoContextForPrompt("oauth labels and plan issue");
    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets[0]?.path).toBeTruthy();
    expect(snippets[0]?.snippet.length).toBeGreaterThan(0);
  });

  it("loads context from the local workspace before falling back to GitHub raw", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch should not be used when the local file exists");
    });
    vi.stubGlobal("fetch", fetchMock);

    const snippets = await getRepoContextForPrompt("ux forms loading errors mobile");
    const uxSnippet = snippets.find((snippet) => snippet.path === "docs/rules/ux.md");

    expect(uxSnippet?.snippet).toContain("Async actions need pending");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
