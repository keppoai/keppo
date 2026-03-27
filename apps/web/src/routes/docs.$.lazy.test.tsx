import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/docs/source", async () => {
  return await import("@/lib/docs/source.test-fixture");
});

vi.mock("@/components/docs/docs-article-page", () => {
  return {
    DocsArticlePage: () => null,
  };
});

let resolveDocsArticle: typeof import("@/lib/docs/article.server").resolveDocsArticle;

beforeAll(async () => {
  ({ resolveDocsArticle } = await import("@/lib/docs/article.server"));
});

describe("docs article route loader", () => {
  it("resolves an existing docs article", async () => {
    const result = resolveDocsArticle(["user-guide", "getting-started"]);

    expect(result.page.path).toBe("user-guide/getting-started.mdx");
    expect(result.page.title).toBe("Getting Started");
    expect(result.page.url).toBe("/docs/user-guide/getting-started");
    expect(result.html).toBe("");
  });

  it("resolves an existing nested docs article", async () => {
    const result = resolveDocsArticle(["user-guide", "automations", "building-automations"]);

    expect(result.page.path).toBe("user-guide/automations/building-automations.mdx");
    expect(result.page.title).toBe("Building Automations");
    expect(result.page.url).toBe("/docs/user-guide/automations/building-automations");
    expect(result.html).toBe("");
  });

  it("throws for a missing docs article", async () => {
    expect(() => resolveDocsArticle(["missing-page"])).toThrow();
  });
});
