import { test, expect } from "../../fixtures/golden.fixture";
import { waitForToolReady } from "../../helpers/mcp-client";
import { mkdirSync } from "node:fs";

test.slow();

test("pending-to-approved", async ({ pages, auth, provider, page }) => {
  await pages.login.login();
  const seeded = await auth.seedWorkspaceWithProvider("approve", "google", undefined, {
    preferSelectedWorkspace: true,
  });
  await auth.setToolAutoApproval(seeded.workspaceId, "gmail.sendEmail", false);
  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);

  try {
    await mcp.initialize();
    await waitForToolReady(mcp, {
      toolName: "gmail.listUnread",
      args: { limit: 1 },
    });
    const created = await mcp.callTool("gmail.sendEmail", {
      to: ["customer@example.com"],
      subject: "Order update",
      body: "Your order has shipped.",
    });
    const actionId = String(created.action_id ?? "");
    expect(created.status).toBe("approval_required");
    expect(actionId).not.toEqual("");

    await pages.actions.open();
    mkdirSync("ux-artifacts", { recursive: true });
    await expect(page.getByLabel("Search actions, runs, or payload")).toBeVisible();
    await expect(page.getByText("Ready now", { exact: true })).toBeVisible();
    await expect(page.getByText("Review first", { exact: true })).toBeVisible();
    await expect(page.getByText("After this one", { exact: true })).toBeVisible();
    await page.screenshot({
      path: "ux-artifacts/usability-approvals-and-runs.png",
      fullPage: true,
      timeout: 20_000,
    });
    await pages.actions.approveFirstPending();

    const resolved = await mcp.waitForAction(actionId);
    expect(resolved.status).toBe("succeeded");
    await expect(page.getByTestId("approval-panel-feedback")).toContainText("Approval recorded");
    await expect(page.getByTestId("approval-panel-selection-preserved")).toContainText(
      "keeping the detail panel open",
    );
    await expect(page.getByText("Open next pending", { exact: true })).toHaveCount(0);

    const events = await provider.events("google");
    expect(
      events.some((event) => String(event.path ?? "") === "/gmail/v1/users/me/messages/send"),
    ).toBe(true);
  } finally {
    await mcp.close();
  }
});
