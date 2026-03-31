import { mkdirSync } from "node:fs";
import { expect, test } from "../../fixtures/golden.fixture";

test.slow();

test("workspace switching keeps shell mounted", async ({ app, auth, page, pages }) => {
  await pages.login.login();

  const first = await auth.seedWorkspace("shell-nav-primary");
  const second = await auth.seedWorkspace("shell-nav-secondary");

  mkdirSync("ux-artifacts", { recursive: true });

  await page.goto(
    new URL(
      `/${first.orgSlug}/${first.workspaceSlug}/automations`,
      app.dashboardBaseUrl,
    ).toString(),
  );
  await expect(page.getByRole("button", { name: /Notifications/i })).toBeVisible();
  await expect(page.getByRole("navigation", { name: /breadcrumb/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Automations", exact: true })).toBeVisible({
    timeout: 20_000,
  });

  await pages.dashboard.useWorkspace(second.workspaceName);
  await expect(page).toHaveURL(
    new RegExp(`/${first.orgSlug}/${second.workspaceSlug}/automations$`),
  );
  await expect(page.getByRole("button", { name: /Notifications/i })).toBeVisible();
  await expect(page.getByRole("navigation", { name: /breadcrumb/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Automations", exact: true })).toBeVisible({
    timeout: 20_000,
  });

  await page.screenshot({
    path: "ux-artifacts/usability-shell-navigation.png",
    fullPage: true,
  });
});
