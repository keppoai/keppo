import { beforeAll, describe, expect, it } from "vitest";
import { source } from "./source.test-fixture";

let createDocsSearchServer: typeof import("../../../app/lib/server/search-api").createDocsSearchServer;
let searchDocsWithServer: typeof import("../../../app/lib/server/search-api").searchDocsWithServer;

beforeAll(async () => {
  ({ createDocsSearchServer, searchDocsWithServer } =
    await import("../../../app/lib/server/search-api"));
});

describe("docs search", () => {
  it("indexes and returns public docs pages", async () => {
    const searchServer = createDocsSearchServer(source);
    const results = await searchServer.search("automation");
    const resultUrls = results.map((result) => result.url);

    expect(resultUrls).toContain("/docs/user-guide/automations/building-automations");
  });

  it("falls back to per-term matching for multi-word queries", async () => {
    const results = await searchDocsWithServer(
      "building automations",
      createDocsSearchServer(source),
    );
    const resultUrls = results.map((result) => result.url);

    expect(resultUrls).toContain("/docs/user-guide/automations/building-automations");
  });
});
