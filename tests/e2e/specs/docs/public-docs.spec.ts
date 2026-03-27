import { mkdirSync } from "node:fs";
import { expect, test } from "../../fixtures/golden.fixture";

const openDocsSearch = async (page: import("@playwright/test").Page): Promise<void> => {
  const searchDialog = page.locator('[role="dialog"]');
  if (await searchDialog.isVisible().catch(() => false)) {
    return;
  }

  await page.keyboard.press("Meta+K").catch(() => null);
  if (await searchDialog.isVisible().catch(() => false)) {
    return;
  }

  await page.keyboard.press("Control+K");
};

test("public docs home, search, and article route stay navigable", async ({ app, page }) => {
  mkdirSync("ux-artifacts", { recursive: true });

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${app.dashboardBaseUrl}/docs`);

  await expect(
    page.getByRole("heading", {
      name: "Public docs for operators, self-hosters, and contributors.",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Start with the user guide/i })).toBeVisible();

  await page.screenshot({
    path: "ux-artifacts/docs-home-desktop.png",
    fullPage: true,
  });

  await openDocsSearch(page);

  const searchInput = page.locator('input[role="combobox"], input[placeholder*="Search" i]');
  await expect(searchInput).toBeVisible();
  await searchInput.fill("building automations");

  const automationsResult = page.getByRole("option", {
    name: /Keppo Docs \/ User Guide \/ Automations Building Automations/i,
  });
  await expect(automationsResult).toBeVisible();
  await automationsResult.click();

  await expect(page).toHaveURL(/\/docs\/user-guide\/automations\/building-automations$/);
  const article = page.getByTestId("docs-article-shell");
  await expect(article.locator("h1")).toHaveText("Building Automations");
  await expect(article).toContainText("How to move from a plain-English goal");
  await expect(article.getByRole("link", { name: /View source/i })).toBeVisible();
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(0);

  await page.screenshot({
    path: "ux-artifacts/docs-building-automations-desktop.png",
  });
});
