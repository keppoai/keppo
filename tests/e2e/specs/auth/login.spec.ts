import { test, expect } from "../../fixtures/golden.fixture";

test.use({ storageState: { cookies: [], origins: [] } });

const clearBrowserAuthState = async (page: import("@playwright/test").Page): Promise<void> => {
  await page.context().clearCookies();
  await page.goto("about:blank");
  await page.goto("data:text/html,<html></html>");
};

test("login", async ({ pages, page }) => {
  await pages.login.login();
  await pages.dashboard.open();
  await pages.dashboard.expectLoaded();
  await expect(page).not.toHaveURL(/\/login$/);
});

test("login shows public-safe guidance for invalid credentials", async ({ app, page }) => {
  await clearBrowserAuthState(page);
  await page.route("**/api/auth/sign-in/email", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          message: "Invalid email or password",
        },
      }),
    });
  });

  await page.goto(`${app.dashboardBaseUrl}/login`);
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto(`${app.dashboardBaseUrl}/login`);
  await page.getByPlaceholder("Enter your email").fill("wrong@example.com");
  const useTestCredentialsButton = page.getByRole("button", { name: /Use test credentials/i });
  if (await useTestCredentialsButton.isVisible()) {
    await useTestCredentialsButton.click();
  }
  await page.getByPlaceholder("Password").fill("wrong-password");
  await page.getByRole("button", { name: /Sign in with email and password/i }).click();

  const alert = page.getByRole("alert").filter({ hasText: "Authentication failed. Try again." });
  await expect(alert).toBeVisible();
  await expect(alert.getByRole("button", { name: "Technical details" })).toBeVisible();
  await expect(alert.getByText("Invalid email or password")).toHaveCount(0);
  await alert.getByRole("button", { name: "Technical details" }).click();
  await expect(alert.getByText("code: internal_error")).toBeVisible();
});
