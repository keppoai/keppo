import { test, expect } from "../../fixtures/golden.fixture";

test.slow();

test("pending-to-rejected", async ({ pages, auth, provider, page }) => {
  await pages.login.login();
  const seeded = await auth.seedWorkspaceWithProvider("reject", "google", undefined, {
    preferSelectedWorkspace: true,
  });
  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);

  try {
    await mcp.initialize();
    const created = await mcp.callTool("gmail.sendEmail", {
      to: ["blocked@example.com"],
      subject: "Do not send",
      body: "This should be rejected.",
    });
    const actionId = String(created.action_id ?? "");
    expect(created.status).toBe("approval_required");

    await pages.actions.open();
    await pages.actions.rejectFirstPending("Policy violation");

    const resolved = await mcp.waitForAction(actionId);
    expect(resolved.status).toBe("rejected");
    await expect(page.getByTestId("approval-panel-feedback")).toContainText("Action rejected");
    await expect(page.getByTestId("approval-panel-selection-preserved")).toContainText(
      "keeping the detail panel open",
    );

    const events = await provider.events("google");
    expect(
      events.some((event) => String(event.path ?? "") === "/gmail/v1/users/me/messages/send"),
    ).toBe(false);
  } finally {
    await mcp.close();
  }
});
