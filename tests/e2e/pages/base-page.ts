import { expect, type Page } from "@playwright/test";
import type { AppContext } from "../fixtures/app-context.fixture";
import {
  resolveScopedDashboardPath,
  syncDashboardScopeFromPage,
  waitForWorkspaceShellScope,
} from "../helpers/dashboard-paths";

export class BasePage {
  protected readonly page: Page;
  protected readonly app: AppContext;

  constructor(page: Page, app: AppContext) {
    this.page = page;
    this.app = app;
  }

  protected absolute(pathname: string): string {
    return new URL(pathname, this.app.dashboardBaseUrl).toString();
  }

  private async resolveScopedPath(pathname: string): Promise<string> {
    return await resolveScopedDashboardPath(this.page, pathname);
  }

  private async navigateWithinDashboard(pathname: string): Promise<boolean> {
    const targetUrl = this.absolute(pathname);
    const currentUrl = this.page.url();
    if (!currentUrl.startsWith("http")) {
      return false;
    }

    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    if (current.origin !== target.origin) {
      return false;
    }

    const targetLink = this.page.locator(`a[href="${pathname}"]`).first();
    const navigationReady = await expect
      .poll(
        async () => {
          const linkVisible = await targetLink.isVisible().catch(() => false);
          const hasRouter = await this.page
            .evaluate(() => {
              return typeof window.__KEPPO_E2E_ROUTER__?.navigate === "function";
            })
            .catch(() => false);
          return linkVisible || hasRouter;
        },
        { timeout: 5_000, intervals: [100, 250, 500] },
      )
      .toBeTruthy()
      .then(() => true)
      .catch(() => false);

    if (!navigationReady) {
      return false;
    }

    if (await targetLink.isVisible().catch(() => false)) {
      await targetLink.evaluate((element) => {
        (element as HTMLAnchorElement).click();
      });
      await expect
        .poll(async () => new URL(this.page.url()).pathname, { timeout: 15_000 })
        .toBe(target.pathname);
      return true;
    }

    const hasRouter = await this.page
      .evaluate(() => {
        return typeof window.__KEPPO_E2E_ROUTER__?.navigate === "function";
      })
      .catch(() => false);
    if (!hasRouter) {
      return false;
    }

    await this.page.evaluate(async (href) => {
      await window.__KEPPO_E2E_ROUTER__?.navigate({ href });
    }, pathname);
    await expect
      .poll(async () => new URL(this.page.url()).pathname, { timeout: 15_000 })
      .toBe(target.pathname);
    return true;
  }

  async goto(pathname: string): Promise<void> {
    const scopedPath = await this.resolveScopedPath(pathname);
    const navigatedInApp = await this.navigateWithinDashboard(scopedPath);
    if (!navigatedInApp) {
      await this.page.goto(this.absolute(scopedPath));
    }
    await syncDashboardScopeFromPage(this.page);
  }

  async setSelectedWorkspaceSlug(workspaceSlug: string): Promise<void> {
    const scope = await syncDashboardScopeFromPage(this.page);
    const orgSlug = scope?.orgSlug;
    if (!orgSlug) {
      throw new Error("Missing org slug in current dashboard URL.");
    }
    await this.page.evaluate(
      ({ nextOrgSlug, nextWorkspaceSlug }) => {
        window.localStorage.setItem(`keppo:lastWorkspaceSlug:${nextOrgSlug}`, nextWorkspaceSlug);
      },
      { nextOrgSlug: orgSlug, nextWorkspaceSlug: workspaceSlug },
    );
    const targetPath = `/${orgSlug}/${workspaceSlug}`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.page.goto(this.absolute(targetPath));
      try {
        await waitForWorkspaceShellScope(this.page, {
          orgSlug,
          workspaceSlug,
        });
        return;
      } catch {
        // Retry while the dashboard shell catches up to the newly seeded workspace.
      }
    }
    const resolvedScope = await syncDashboardScopeFromPage(this.page);
    throw new Error(
      `Failed to switch dashboard scope to ${workspaceSlug}. Resolved ${resolvedScope?.workspaceSlug ?? "null"} at ${new URL(this.page.url()).pathname}.`,
    );
  }

  async expectPath(pathname: RegExp | string): Promise<void> {
    if (typeof pathname === "string") {
      await expect(this.page).toHaveURL(
        new RegExp(pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
      return;
    }
    await expect(this.page).toHaveURL(pathname);
  }
}
