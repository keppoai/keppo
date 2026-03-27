import { mkdirSync } from "node:fs";
import { expect, test } from "../../fixtures/golden.fixture";

test.slow();

test("capture admin panel routes", async ({ app, auth, page, pages }) => {
  mkdirSync("ux-artifacts", { recursive: true });

  const seeded = await auth.seedWorkspace("admin-panel", {
    subscriptionTier: "starter",
  });

  await page.setViewportSize({ width: 1440, height: 1024 });
  await pages.login.login();
  await pages.dashboard.setSelectedWorkspaceSlug(seeded.workspaceSlug);

  await pages.login.goto("/admin");
  const overviewHeading = page.getByRole("heading", { name: "Overview" });
  const restrictedHeading = page.getByRole("heading", { name: "Platform admin access required" });
  await expect
    .poll(
      async () => {
        if (await restrictedHeading.isVisible().catch(() => false)) {
          return "restricted";
        }
        if (await overviewHeading.isVisible().catch(() => false)) {
          return "overview";
        }
        return "loading";
      },
      { timeout: 15_000 },
    )
    .not.toBe("loading");

  if (await restrictedHeading.isVisible().catch(() => false)) {
    await expect(restrictedHeading).toBeVisible();
    await page.screenshot({ path: "ux-artifacts/admin-access-denied.png", fullPage: true });
    return;
  }

  await expect(overviewHeading).toBeVisible();
  await page.screenshot({ path: "ux-artifacts/admin-overview.png", fullPage: true });

  await pages.login.goto("/admin/flags");
  await expect(page.getByRole("heading", { name: "Feature Flags" })).toBeVisible();
  await page.screenshot({ path: "ux-artifacts/admin-flags.png", fullPage: true });

  await pages.login.goto("/admin/health");
  await expect(page.getByRole("heading", { name: "System Health" })).toBeVisible();
  await page.screenshot({ path: "ux-artifacts/admin-health.png", fullPage: true });

  await pages.login.goto("/admin/usage");
  await expect(page.getByRole("heading", { name: "Usage" })).toBeVisible();
  await page.screenshot({ path: "ux-artifacts/admin-usage.png", fullPage: true });

  await pages.login.goto("/admin/abuse");
  await expect(page.getByRole("heading", { name: "Abuse" })).toBeVisible();
  await page.screenshot({ path: "ux-artifacts/admin-abuse.png", fullPage: true });

  const authUserEmail = process.env.KEPPO_E2E_AUTH_EMAIL ?? `e2e+${app.namespace}@example.com`;
  const userLookup = page.getByLabel("User email or ID");
  await userLookup.fill(authUserEmail);
  await userLookup.press("Enter");
  await expect(page.getByText("organization memberships will be reviewed")).toBeVisible();
  await page.screenshot({
    path: "ux-artifacts/admin-abuse-user-delete-preview.png",
    fullPage: true,
  });
});
