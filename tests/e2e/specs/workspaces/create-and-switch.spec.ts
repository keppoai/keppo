import { mkdirSync } from "node:fs";
import { expect } from "@playwright/test";
import { test } from "../../fixtures/golden.fixture";

test.slow();

test("create-and-switch", async ({ pages, app, page }) => {
  await pages.login.login();
  await pages.workspaces.open();

  const workspaceName = `workspace-${app.metadata.testId}-${app.namespace}`;
  await pages.workspaces.createWorkspace(workspaceName);
  await pages.workspaces.expectWorkspaceVisible(workspaceName);
  mkdirSync("ux-artifacts", { recursive: true });
  await expect(
    page.getByText("Create your first automation to get started.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Step 1 of 4:/)).toBeVisible();
  await page.screenshot({
    path: "ux-artifacts/dashboard-readiness-overview.png",
    fullPage: true,
  });

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent("keppo:open-command-palette"));
  });
  const palette = page.getByRole("dialog", {
    name: /Operator command palette/i,
  });
  await expect(palette).toBeVisible();
  await expect(palette.getByText("Create automation with guided builder")).toBeVisible();
  await page.screenshot({
    path: "ux-artifacts/operator-command-palette.png",
    fullPage: true,
  });
  await palette.getByRole("option", { name: /Open integrations/i }).click();
  await expect(palette).toBeHidden();
  await expect(page).toHaveURL(/\/integrations$/);

  if (app.metadata.workerIndex === 0 && app.metadata.repeatEachIndex === 0) {
    await expect(page.getByRole("heading", { name: "Integrations", exact: true })).toBeVisible();
    await pages.dashboard.open();
    await expect(
      page.getByText("Create your first automation to get started.", { exact: true }),
    ).toBeVisible();
  }
});
