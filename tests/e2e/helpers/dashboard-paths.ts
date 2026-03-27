import { expect, type Page } from "@playwright/test";

type DashboardScope = {
  orgSlug: string;
  workspaceSlug: string | null;
};

declare global {
  interface Window {
    __KEPPO_E2E_SCOPE__?: DashboardScope | null;
  }
}

const ORG_SCOPED_PREFIXES = new Set([
  "/settings",
  "/settings/members",
  "/settings/billing",
  "/settings/audit",
  "/settings/workspaces",
]);

const isGlobalPath = (pathname: string): boolean => {
  return (
    pathname === "/login" ||
    pathname.startsWith("/invites/") ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
  );
};

export const normalizeLegacyDashboardPath = (pathname: string): string => {
  if (pathname === "/custom-servers") return "/servers";
  if (pathname.startsWith("/custom-servers/")) {
    return pathname.replace("/custom-servers/", "/servers/");
  }
  if (pathname === "/members") return "/settings/members";
  if (pathname === "/billing") return "/settings/billing";
  if (pathname === "/audit") return "/settings/audit";
  if (pathname === "/workspaces") return "/settings/workspaces";
  if (pathname === "/health") return "/admin/health";
  return pathname;
};

const inferScopeFromPathname = (pathname: string): DashboardScope | null => {
  if (isGlobalPath(pathname)) {
    return null;
  }
  const segments = pathname.split("/").filter(Boolean);
  const orgSlug = segments[0] ?? null;
  const workspaceSlug = segments[1] ?? null;
  if (!orgSlug) {
    return null;
  }
  if (segments[1] === "settings" || segments[1] === "admin" || !workspaceSlug) {
    return { orgSlug, workspaceSlug: null };
  }
  return { orgSlug, workspaceSlug };
};

const evaluateAfterNavigationSettles = async <T>(page: Page, fn: () => T): Promise<T> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.waitForLoadState("domcontentloaded");
      return await page.evaluate(fn);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Execution context was destroyed") &&
        attempt < 2
      ) {
        await page.waitForLoadState("networkidle");
        continue;
      }
      throw error;
    }
  }
  throw new Error("Failed to evaluate dashboard scope after navigation settled.");
};

export const setDashboardScope = async (
  page: Page,
  scope: DashboardScope | null,
): Promise<void> => {
  await page.waitForLoadState("domcontentloaded");
  await page.evaluate((nextScope) => {
    window.__KEPPO_E2E_SCOPE__ = nextScope;
  }, scope);
};

export const syncDashboardScopeFromPage = async (page: Page): Promise<DashboardScope | null> => {
  const scope = inferScopeFromPathname(new URL(page.url()).pathname);
  if (scope) {
    if (scope.workspaceSlug) {
      await setDashboardScope(page, scope);
      return scope;
    }
    await page.waitForLoadState("domcontentloaded");
    const preservedScope = await page.evaluate((orgSlug) => {
      const remembered = window.__KEPPO_E2E_SCOPE__ ?? null;
      if (remembered?.orgSlug === orgSlug && remembered.workspaceSlug) {
        return remembered;
      }
      const storedWorkspaceSlug = window.localStorage.getItem(`keppo:lastWorkspaceSlug:${orgSlug}`);
      return storedWorkspaceSlug
        ? {
            orgSlug,
            workspaceSlug: storedWorkspaceSlug,
          }
        : {
            orgSlug,
            workspaceSlug: null,
          };
    }, scope.orgSlug);
    await setDashboardScope(page, preservedScope);
    return preservedScope;
  }
  return await evaluateAfterNavigationSettles(page, () => {
    return window.__KEPPO_E2E_SCOPE__ ?? null;
  });
};

export const resolveScopedDashboardPath = async (page: Page, pathname: string): Promise<string> => {
  const normalized = normalizeLegacyDashboardPath(pathname);
  const currentScope =
    inferScopeFromPathname(new URL(page.url()).pathname) ??
    (await syncDashboardScopeFromPage(page));
  if (normalized === "/") {
    if (currentScope?.orgSlug && currentScope.workspaceSlug) {
      return `/${currentScope.orgSlug}/${currentScope.workspaceSlug}`;
    }
    return normalized;
  }
  if (isGlobalPath(normalized)) {
    return normalized;
  }
  if (!currentScope?.orgSlug) {
    throw new Error(`Unable to resolve scoped dashboard path for ${normalized}.`);
  }
  if (ORG_SCOPED_PREFIXES.has(normalized)) {
    return `/${currentScope.orgSlug}${normalized}`;
  }
  const workspaceSlug =
    currentScope.workspaceSlug ??
    (await page.evaluate((orgSlug) => {
      return window.localStorage.getItem(`keppo:lastWorkspaceSlug:${orgSlug}`);
    }, currentScope.orgSlug));
  if (!workspaceSlug) {
    throw new Error(`Missing workspace scope while resolving ${normalized}.`);
  }
  return `/${currentScope.orgSlug}/${workspaceSlug}${normalized}`;
};

export const waitForWorkspaceShellScope = async (
  page: Page,
  params: {
    orgSlug: string;
    workspaceSlug: string;
  },
): Promise<void> => {
  const targetRootPath = `/${params.orgSlug}/${params.workspaceSlug}`;

  await page.waitForLoadState("domcontentloaded");
  await setDashboardScope(page, params);

  await expect
    .poll(
      async () => {
        const currentPath = new URL(page.url()).pathname;
        const scoped = await syncDashboardScopeFromPage(page).catch(() => null);

        return {
          currentPath,
          orgSlug: scoped?.orgSlug ?? null,
          workspaceSlug: scoped?.workspaceSlug ?? null,
        };
      },
      {
        timeout: 15_000,
        intervals: [250, 500, 1_000],
      },
    )
    .toEqual({
      currentPath: targetRootPath,
      orgSlug: params.orgSlug,
      workspaceSlug: params.workspaceSlug,
    });
};
