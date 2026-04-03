import { mkdirSync } from "node:fs";
import { createConvexAdmin } from "../../helpers/convex-admin";
import { test, expect } from "../../fixtures/golden.fixture";

test.slow();

test("grouped approvals stay actionable by automation run", async ({ pages, auth, app, page }) => {
  await auth.login();
  const seeded = await auth.seedWorkspaceWithProvider("group-approvals", "google", undefined, {
    preferSelectedWorkspace: true,
  });
  await auth.setToolAutoApproval(seeded.workspaceId, "gmail.sendEmail", false);
  const convexAdmin = createConvexAdmin(app);

  const approveRun = await convexAdmin.createGroupedPendingActions({
    workspaceId: seeded.workspaceId,
    toolName: "gmail.sendEmail",
    payloadPreviews: [
      {
        to: ["alpha@example.com"],
        subject: "Approve group one",
        body: "Queued in the first grouped approval run.",
      },
      {
        to: ["beta@example.com"],
        subject: "Approve group two",
        body: "Queued in the first grouped approval run.",
      },
      {
        to: ["gamma@example.com"],
        subject: "Approve group three",
        body: "Queued in the first grouped approval run.",
      },
    ],
  });
  const rejectRun = await convexAdmin.createGroupedPendingActions({
    workspaceId: seeded.workspaceId,
    toolName: "gmail.sendEmail",
    payloadPreviews: [
      {
        to: ["reject-a@example.com"],
        subject: "Reject group one",
        body: "Queued in the second grouped approval run.",
      },
      {
        to: ["reject-b@example.com"],
        subject: "Reject group two",
        body: "Queued in the second grouped approval run.",
      },
    ],
  });
  const singleActionRun = await convexAdmin.createGroupedPendingActions({
    workspaceId: seeded.workspaceId,
    toolName: "gmail.sendEmail",
    payloadPreviews: [
      {
        to: ["single-a@example.com"],
        subject: "Single action approve",
        body: "Queued in the third grouped approval run.",
      },
      {
        to: ["single-b@example.com"],
        subject: "Single action reject",
        body: "Queued in the third grouped approval run.",
      },
    ],
  });

  await pages.actions.open();
  await pages.actions.expectGroupVisible(approveRun.runId);
  await pages.actions.expectGroupVisible(rejectRun.runId);
  await pages.actions.expectGroupVisible(singleActionRun.runId);
  await expect(
    page
      .locator(`[data-testid="approval-group-row"][data-run-id="${approveRun.runId}"]`)
      .getByTestId("approval-group-approve"),
  ).toBeVisible();

  mkdirSync("ux-artifacts", { recursive: true });
  await page.screenshot({
    path: "ux-artifacts/grouped-approvals.png",
    fullPage: true,
    timeout: 20_000,
  });

  await pages.actions.approveGroup(approveRun.runId, 3);
  await expect(
    page.locator(`[data-testid="approval-group-row"][data-run-id="${approveRun.runId}"]`),
  ).toHaveCount(0);

  await pages.actions.rejectGroup(rejectRun.runId, 2, "Wrong scope");
  await expect(
    page.locator(`[data-testid="approval-group-row"][data-run-id="${rejectRun.runId}"]`),
  ).toHaveCount(0);

  await pages.actions.approveSingleActionInRun(singleActionRun.runId);
  await pages.actions.expectPendingCountForRun(singleActionRun.runId, 1);
  await pages.actions.rejectSingleActionInRun(singleActionRun.runId, "Needs manual verification");
  await pages.actions.expectNoPending();
});
