import { test, expect } from "../../fixtures/golden.fixture";
import type { Locator, Page } from "@playwright/test";
import { resolveScopedDashboardPath } from "../../helpers/dashboard-paths";
import { startMockMcpServer } from "../../helpers/mock-mcp-server";

const clickElement = async (locator: Locator): Promise<void> => {
  await expect(locator).toBeVisible();
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
};

const setControlValue = async (locator: Locator, value: string): Promise<void> => {
  await locator.evaluate((element, nextValue) => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await locator.blur();
};

const openAddServerForm = async (page: Page): Promise<void> => {
  await expect(page.getByRole("heading", { name: "Custom Servers" })).toBeVisible();
  const addServerButton = page.getByRole("button", { name: "Add Server" });
  await expect(addServerButton).toBeEnabled();
  await clickElement(addServerButton);
  await expect(page.getByText("Add Custom MCP Server", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByLabel("Display Name")).toBeVisible();
};

const registerServerFromDashboard = async (params: {
  page: Page;
  displayName: string;
  slug: string;
  url: string;
  bearerToken: string;
}): Promise<void> => {
  await openAddServerForm(params.page);

  await setControlValue(params.page.getByLabel("Display Name"), params.displayName);
  await setControlValue(params.page.getByLabel("Slug"), params.slug);
  await setControlValue(params.page.getByLabel("Server URL"), params.url);
  await setControlValue(params.page.getByLabel("Bearer Token"), params.bearerToken);
  await clickElement(params.page.getByRole("button", { name: "Register" }));
};

test("custom-mcp-server-registration", async ({ page, pages, auth, app }) => {
  test.slow();
  const mock = await startMockMcpServer();
  const serverName = "Support Internal Tools";
  const duplicateName = "Support Internal Tools Duplicate";

  try {
    await pages.login.login();
    await auth.seedWorkspace("custom-mcp-registration", {
      preferSelectedWorkspace: true,
    });

    await page.goto(
      new URL(
        await resolveScopedDashboardPath(page, "/custom-servers"),
        app.dashboardBaseUrl,
      ).toString(),
    );
    await registerServerFromDashboard({
      page,
      displayName: serverName,
      slug: "support-tools",
      url: mock.url,
      bearerToken: mock.bearerToken ?? "",
    });

    const card = page.locator('[data-slot="card"]').filter({ hasText: serverName });
    await expect(card).toBeVisible();
    await expect
      .poll(
        async () => {
          return (await card.textContent()) ?? "";
        },
        { timeout: 12_000 },
      )
      .toContain("connected");

    await registerServerFromDashboard({
      page,
      displayName: duplicateName,
      slug: "support-tools",
      url: mock.url,
      bearerToken: mock.bearerToken ?? "",
    });

    const duplicateError = page.getByRole("alert").filter({ hasText: "Custom MCP server issue" });
    await expect(duplicateError).toBeVisible();
    await expect(
      duplicateError.getByText("Check the server URL, auth settings, and discovery state."),
    ).toBeVisible();
    await clickElement(duplicateError.getByRole("button", { name: "Technical details" }));
    await expect(duplicateError.getByText(/code: custom_mcp\.slug_conflict/i)).toBeVisible();

    await expect
      .poll(async () => {
        return await page
          .locator('[data-slot="card"]')
          .filter({ hasText: "Support Internal Tools" })
          .count();
      })
      .toBe(1);

    await clickElement(card.getByRole("link", { name: "Manage" }));
    await expect(page).toHaveURL(/\/servers\/.+/);

    await clickElement(page.getByRole("button", { name: "Delete Server" }));
    const dialog = page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await clickElement(dialog.getByRole("button", { name: "Delete Server" }));

    await expect(page).toHaveURL(/\/servers$/);
    await expect(page.getByText(serverName)).toHaveCount(0);

    await pages.workspaces.open();
    await expect(
      page.getByText("No custom MCP servers registered. Go to Custom Servers to add one."),
    ).toBeVisible();
  } finally {
    await mock.close();
  }
});
