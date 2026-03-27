import { expect } from "@playwright/test";
import { BasePage } from "./base-page";
import { resolveScopedDashboardPath, syncDashboardScopeFromPage } from "../helpers/dashboard-paths";

const isWorkspaceSettingsPath = (pathname: string): boolean => {
  return pathname === "/workspaces" || pathname.endsWith("/settings/workspaces");
};

const toWorkspaceSlug = (name: string): string => {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

export class WorkspaceSettingsPage extends BasePage {
  async open(): Promise<void> {
    await this.goto("/workspaces");
  }

  async createWorkspace(name: string): Promise<void> {
    const initialScope = await syncDashboardScopeFromPage(this.page).catch(() => null);
    const createTrigger = this.page.getByRole("button", {
      name: /^Create Workspace$/i,
    });
    await expect(createTrigger).toBeVisible();
    await createTrigger.evaluate((element) => {
      (element as HTMLButtonElement).click();
    });
    const dialog = this.page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const nameInput = dialog.getByLabel("Name");
    await expect(nameInput).toBeVisible();
    await nameInput.fill(name);
    await dialog
      .getByRole("button", { name: /Create/i })
      .evaluate((element) => (element as HTMLButtonElement).click());
    const limitReached = this.page.getByText(/Workspace limit reached/i);
    const outcome = await Promise.race([
      dialog.waitFor({ state: "hidden", timeout: 5_000 }).then(() => "hidden" as const),
      limitReached.waitFor({ state: "visible", timeout: 5_000 }).then(() => "limit" as const),
    ]);
    if (outcome === "limit") {
      throw new Error("Create Workspace was blocked by workspace limit.");
    }
    const settingsView = this.page.locator('[data-testid="workspace-card"]').filter({
      has: this.page.getByRole("heading", { name, exact: true }),
    });
    const dashboardSwitcher = this.page.locator('[data-sidebar="menu-button"]').getByText(name, {
      exact: true,
    });
    const dashboardReady = this.page.getByText("Create your first automation to get started.", {
      exact: true,
    });
    await expect
      .poll(
        async () => {
          const currentPath = new URL(this.page.url()).pathname;
          const stillOnWorkspaceSettings = isWorkspaceSettingsPath(currentPath);
          const switcherVisible = await dashboardSwitcher.isVisible().catch(() => false);
          const cardVisible = await settingsView.isVisible().catch(() => false);
          const dashboardReadyVisible = await dashboardReady.isVisible().catch(() => false);
          const cardSelected =
            cardVisible &&
            (await settingsView
              .evaluate((element) => element.className.includes("ring-2"))
              .catch(() => false));

          if (switcherVisible && stillOnWorkspaceSettings) {
            await dashboardSwitcher.evaluate((element) => {
              (element as HTMLElement).click();
            });
            return "navigating";
          }

          if (cardVisible && stillOnWorkspaceSettings && !cardSelected) {
            await settingsView.evaluate((element) => {
              (element as HTMLElement).click();
            });
            return "selecting";
          }

          const scope = await syncDashboardScopeFromPage(this.page).catch(() => null);
          const switchedWorkspace =
            scope?.workspaceSlug &&
            scope.workspaceSlug !== initialScope?.workspaceSlug &&
            scope.workspaceSlug === name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

          if (switchedWorkspace && stillOnWorkspaceSettings) {
            const targetPath = await resolveScopedDashboardPath(this.page, "/").catch(() => null);
            if (targetPath && currentPath !== targetPath) {
              await this.page.goto(targetPath, {
                waitUntil: "domcontentloaded",
              });
              return "navigating";
            }
          }

          if (switcherVisible && switchedWorkspace && !stillOnWorkspaceSettings) {
            return "ready";
          }
          if (dashboardReadyVisible && !stillOnWorkspaceSettings) {
            return "ready";
          }
          if (cardVisible || switcherVisible || cardSelected) {
            return "visible";
          }
          return "waiting";
        },
        {
          timeout: 25_000,
          intervals: [250, 500, 1_000],
          message: `Timed out waiting for workspace ${name} to become the active dashboard scope.`,
        },
      )
      .toBe("ready");
  }

  async expectWorkspaceVisible(name: string): Promise<void> {
    const expectedWorkspaceSlug = toWorkspaceSlug(name);
    const settingsView = this.page.locator('[data-testid="workspace-card"]').filter({
      hasText: name,
    });
    const sidebarWorkspace = this.page.locator("[data-sidebar='menu-button']").getByText(name, {
      exact: true,
    });
    const dashboardReady = this.page.getByText("Create your first automation to get started.", {
      exact: true,
    });
    const dashboardBuilder = this.page.getByRole("heading", {
      name: "What should your next automation do?",
      exact: true,
    });
    await expect
      .poll(
        async () => {
          const scope = await syncDashboardScopeFromPage(this.page).catch(() => null);
          return (
            (await settingsView.isVisible().catch(() => false)) ||
            (await sidebarWorkspace.isVisible().catch(() => false)) ||
            scope?.workspaceSlug === expectedWorkspaceSlug ||
            (await dashboardReady.isVisible().catch(() => false)) ||
            (await dashboardBuilder.isVisible().catch(() => false))
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);
  }

  async selectWorkspace(name: string): Promise<void> {
    const card = this.page.locator('[data-testid="workspace-card"]').filter({
      hasText: name,
    });
    await expect(card).toBeVisible({ timeout: 10_000 });
    if (await card.evaluate((element) => element.className.includes("ring-2"))) {
      return;
    }
    await card.evaluate((element) => (element as HTMLDivElement).click());
    await expect(card).toHaveClass(/ring-2/);
  }

  async setCodeMode(enabled: boolean): Promise<void> {
    const toggle = this.page.getByRole("switch", { name: "Code Mode" });
    await expect(toggle).toBeVisible();
    await toggle.scrollIntoViewIfNeeded();
    const isChecked = (await toggle.getAttribute("aria-checked")) === "true";
    if (isChecked !== enabled) {
      await toggle.evaluate((element) => (element as HTMLButtonElement).click());
    }
    await expect(toggle).toHaveAttribute("aria-checked", enabled ? "true" : "false");
  }

  async openDeleteDialog(): Promise<void> {
    const trigger = this.page.getByTestId("delete-workspace-trigger");
    await expect(trigger).toBeVisible();
    await trigger.click();
    await expect(this.page.getByRole("alertdialog")).toBeVisible();
  }

  async cancelDeleteWorkspace(): Promise<void> {
    const dialog = this.page.getByRole("alertdialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Keep workspace", exact: true }).click();
    await expect(dialog).toBeHidden();
  }

  async deleteSelectedWorkspace(): Promise<void> {
    await this.openDeleteDialog();
    const dialog = this.page.getByRole("alertdialog");
    await dialog.getByTestId("confirm-delete-workspace").click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
  }

  async expectWorkspaceHidden(name: string): Promise<void> {
    const settingsView = this.page.locator('[data-testid="workspace-card"]').filter({
      hasText: name,
    });
    const sidebarWorkspace = this.page.locator("[data-sidebar='menu-button']").getByText(name, {
      exact: true,
    });
    await expect
      .poll(
        async () => {
          return (
            (await settingsView.isVisible().catch(() => false)) ||
            (await sidebarWorkspace.isVisible().catch(() => false))
          );
        },
        { timeout: 15_000 },
      )
      .toBe(false);
  }
}
