import { test, expect } from "../../fixtures/golden.fixture";

test("code mode toggle controls tools/list catalog", async ({ pages, auth, provider }) => {
  await pages.login.login();
  const seeded = await auth.seedWorkspace("code-mode-toggle");

  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);
  await mcp.initialize();

  const codeModeTools = await mcp.listTools();
  expect(codeModeTools.map((tool) => tool.name).sort()).toEqual(["execute_code", "search_tools"]);

  await pages.workspaces.open();
  await pages.workspaces.selectWorkspace(seeded.workspaceName);
  await pages.workspaces.setCodeMode(false);

  await expect
    .poll(async () => {
      const individualTools = await mcp.listTools();
      return {
        hasGmailSearch: individualTools.some((tool) => tool.name === "gmail.searchThreads"),
        hasSearchTools: individualTools.some((tool) => tool.name === "search_tools"),
      };
    })
    .toEqual({
      hasGmailSearch: true,
      hasSearchTools: false,
    });

  await pages.workspaces.setCodeMode(true);

  await expect
    .poll(async () => {
      const reenabledTools = await mcp.listTools();
      return reenabledTools.map((tool) => tool.name).sort();
    })
    .toEqual(["execute_code", "search_tools"]);
});
