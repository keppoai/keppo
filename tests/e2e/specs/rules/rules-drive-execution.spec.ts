import { test, expect } from "../../fixtures/golden.fixture";
import { createConvexAdmin } from "../../helpers/convex-admin";
import { waitForTerminalActionResult, waitForToolReady } from "../../helpers/mcp-client";

test("rules UI auto-approval changes gmail write outcomes", async ({
  app,
  pages,
  auth,
  provider,
}) => {
  test.slow();
  await pages.login.login();
  const seeded = await auth.seedWorkspaceWithProvider("rules-auto-approve", "google");
  await auth.setToolAutoApproval(seeded.workspaceId, "gmail.sendEmail", false);
  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);

  try {
    await pages.rules.open();
    await pages.rules.setPolicyMode("rules_plus_agent");
    await pages.rules.setAutoApproval("gmail.sendEmail", true);

    await mcp.initialize();
    await waitForToolReady(mcp, { toolName: "gmail.listUnread", args: { limit: 1 } });
    const created = await mcp.callTool("gmail.sendEmail", {
      to: ["customer@example.com"],
      subject: `Auto approval ${app.namespace}`,
      body: "This should bypass the queue.",
    });
    const settled = await waitForTerminalActionResult(mcp, {
      scope: "rules UI auto-approved gmail.sendEmail",
      response: created,
      timeoutMs: 12_000,
    });

    expect(settled.status).toBe("succeeded");
    expect(String(settled.action_id ?? created.action_id ?? "")).toMatch(/^act_/);

    await pages.actions.open();
    await pages.actions.expectNoPending();
  } finally {
    await mcp.close();
  }
});

test("rules UI CEL deny rules block matching gmail writes and log the decision", async ({
  app,
  pages,
  auth,
  provider,
}) => {
  test.slow();
  const admin = createConvexAdmin(app);

  await pages.login.login();
  const seeded = await auth.seedWorkspaceWithProvider("rules-cel-deny", "google");
  await auth.setToolAutoApproval(seeded.workspaceId, "gmail.sendEmail", false);
  await admin.setOrgFeatureAccess(seeded.orgId, "cel_rules", true);

  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);

  try {
    await pages.rules.open();
    await pages.rules.createCelRule({
      name: `Block Gmail ${app.namespace}`,
      expression: 'tool.name == "gmail.sendEmail"',
      effect: "deny",
      testContextJson:
        '{"tool":{"name":"gmail.sendEmail"},"action":{"preview":{"to":["blocked@example.com"]}}}',
    });
    await pages.rules.expectAlertText(/rule created/i);
    await pages.rules.expectRuleVisible(`Block Gmail ${app.namespace}`);

    await mcp.initialize();
    await waitForToolReady(mcp, { toolName: "gmail.listUnread", args: { limit: 1 } });
    const created = await mcp.callTool("gmail.sendEmail", {
      to: ["blocked@example.com"],
      subject: `Blocked ${app.namespace}`,
      body: "This should be denied by the CEL rule.",
    });

    expect(created.status).toBe("rejected");
    expect(String(created.reason ?? "")).toMatch(/(matched|rejected by) cel deny rule/i);

    await pages.actions.open();
    await pages.actions.expectNoPending();

    await pages.rules.open();
    await pages.rules.expectCelMatchVisible(/gmail\.sendEmail/);
  } finally {
    await mcp.close();
  }
});
