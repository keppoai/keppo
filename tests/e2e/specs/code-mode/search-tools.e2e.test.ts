import { test, expect } from "../../fixtures/golden.fixture";
import { waitForToolReady } from "../../helpers/mcp-client";

const waitForSearchResults = async (
  search: () => Promise<Array<Record<string, unknown>>>,
  predicate: (results: Array<Record<string, unknown>>) => boolean,
  timeoutMs = 10_000,
): Promise<Array<Record<string, unknown>>> => {
  const deadline = Date.now() + timeoutMs;
  let latestResults: Array<Record<string, unknown>> = [];
  while (Date.now() < deadline) {
    latestResults = await search();
    if (predicate(latestResults)) {
      return latestResults;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return latestResults;
};

test("search_tools returns relevant and filtered tool results", async ({
  pages,
  auth,
  provider,
}) => {
  test.slow();
  await pages.login.login();
  const seeded = await auth.seedWorkspace("code-mode-search");
  await auth.connectProviderForOrg(seeded.orgId, "google", undefined, seeded.workspaceId, true);
  await auth.connectProviderForOrg(seeded.orgId, "slack", undefined, seeded.workspaceId, false);

  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);
  try {
    await mcp.initialize();
    await waitForToolReady(mcp, {
      toolName: "gmail.listUnread",
      args: { limit: 1 },
      timeoutMs: 12_000,
    });

    const emailResults = await waitForSearchResults(
      () => mcp.searchTools("send email"),
      (results) => results.some((entry) => entry.name === "gmail.sendEmail"),
    );
    expect(emailResults.some((entry) => entry.name === "gmail.sendEmail")).toBe(true);

    const channelsResults = await waitForSearchResults(
      () => mcp.searchTools("list channels"),
      (results) => !results.some((entry) => entry.name === "slack.listChannels"),
    );
    expect(channelsResults.some((entry) => entry.name === "slack.listChannels")).toBe(false);

    const providerFiltered = await waitForSearchResults(
      () => mcp.searchTools("list", { provider: "slack" }),
      (results) => results.length === 0,
    );
    expect(providerFiltered).toHaveLength(0);

    const capabilityFiltered = await waitForSearchResults(
      () => mcp.searchTools("send", { capability: "write" }),
      (results) => results.length > 0,
    );
    expect(capabilityFiltered.every((entry) => entry.capability === "write")).toBe(true);
    expect(capabilityFiltered.every((entry) => entry.provider === "google")).toBe(true);

    const first = emailResults[0] as { input_schema?: unknown } | undefined;
    expect(first?.input_schema).toBeTruthy();
  } finally {
    await mcp.close();
  }
});

test("search_tools accepts the Codex q alias", async ({ pages, auth, provider }) => {
  test.slow();
  await pages.login.login();
  const seeded = await auth.seedWorkspace("code-mode-search-q-alias");
  await auth.connectProviderForOrg(seeded.orgId, "google", undefined, seeded.workspaceId, true);

  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);
  try {
    await mcp.initialize();
    await waitForToolReady(mcp, {
      toolName: "gmail.listUnread",
      args: { limit: 1 },
      timeoutMs: 12_000,
    });

    const codexAliasResults = await waitForSearchResults(
      async () => {
        const result = await mcp.callTool("search_tools", { q: "send email" });
        return Array.isArray(result.results)
          ? (result.results as Array<Record<string, unknown>>)
          : [];
      },
      (results) => results.some((entry) => entry.name === "gmail.sendEmail"),
    );

    expect(codexAliasResults.some((entry) => entry.name === "gmail.sendEmail")).toBe(true);
  } finally {
    await mcp.close();
  }
});
