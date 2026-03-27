import { expect } from "@playwright/test";
import { BasePage } from "./base-page";
import { syncDashboardScopeFromPage } from "../helpers/dashboard-paths";

const toWorkspaceSlug = (name: string): string => {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

export class DashboardPage extends BasePage {
  async open(): Promise<void> {
    await this.goto("/");
  }

  async expectLoaded(): Promise<void> {
    const greeting = this.page.getByRole("heading", {
      name: /Good morning|Good afternoon|Good evening/i,
    });
    const firstTimeMarker = this.page.getByText("What should your next automation do?", {
      exact: true,
    });
    const returningMarker = this.page.getByText("Automation summary", { exact: true });

    await expect(greeting).toBeVisible({ timeout: 20_000 });
    await expect(firstTimeMarker.or(returningMarker)).toBeVisible({ timeout: 20_000 });
  }

  async useWorkspace(workspaceName: string): Promise<void> {
    const expectedWorkspaceSlug = toWorkspaceSlug(workspaceName);
    const expectedWorkspaceSlugPrefix = expectedWorkspaceSlug.slice(0, 32);
    const menuButton = this.page.locator('[data-sidebar="menu-button"]').first();
    if (!(await menuButton.isVisible().catch(() => false))) {
      await this.page.getByRole("button", { name: "Toggle Sidebar" }).click();
    }
    await menuButton.evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    await this.page.getByRole("menuitem").filter({ hasText: workspaceName }).click();
    await expect
      .poll(
        async () => {
          const scope = await syncDashboardScopeFromPage(this.page).catch(() => null);
          return (
            typeof scope?.workspaceSlug === "string" &&
            scope.workspaceSlug.startsWith(expectedWorkspaceSlugPrefix)
          );
        },
        { timeout: 15_000, intervals: [250, 500, 1_000] },
      )
      .toBe(true);
  }

  async openRules(): Promise<void> {
    await this.goto("/rules");
  }

  async openAudit(): Promise<void> {
    await this.goto("/audit");
  }
}
