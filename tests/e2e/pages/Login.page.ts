import { KeppoStore } from "@keppo/shared/store";
import { expect } from "@playwright/test";
import { z } from "zod";
import { BasePage } from "./base-page";
import { syncDashboardScopeFromPage } from "../helpers/dashboard-paths";
import { ensureEmailPasswordUser } from "../helpers/email-password-user";

type DashboardScope = {
  orgSlug: string;
  workspaceSlug: string | null;
};

type OrganizationSummary = {
  id: string;
  slug: string;
};

type AuthPostResult = {
  ok: boolean;
  status: number;
};

const organizationSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
});

const organizationListSchema = z.array(organizationSummarySchema);

const authSessionSchema = z.object({
  user: z.unknown().nullable(),
});

const ensuredEmailPasswordUsers = new Set<string>();
const ensuredPersonalOrgs = new Set<string>();
const personalOrgIdsByUser = new Map<string, string>();
let lastResolvedLoginEmail: string | null = null;

const getEnvValue = (key: string): string | undefined => process.env[key];

const parseOrganizationList = (payload: unknown): OrganizationSummary[] => {
  return organizationListSchema.catch([]).parse(payload);
};

const responseHasUser = (payload: unknown): boolean => {
  const parsed = authSessionSchema.safeParse(payload);
  return parsed.success && parsed.data.user !== null && parsed.data.user !== undefined;
};

export class LoginPage extends BasePage {
  private async fetchAuthJson<T>(
    path: string,
    decode: (payload: unknown) => T | null,
  ): Promise<T | null> {
    try {
      const payload = await this.page.evaluate(async (nextPath) => {
        const response = await fetch(nextPath, {
          credentials: "include",
        }).catch(() => null);
        if (!response?.ok) {
          return null;
        }
        return await response.json();
      }, path);
      return payload === null ? null : decode(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        /Execution context was destroyed|Target page, context or browser has been closed/i.test(
          message,
        )
      ) {
        return null;
      }
      throw error;
    }
  }

  private async postAuth(path: string, body: unknown): Promise<AuthPostResult | null> {
    try {
      return await this.page.evaluate(
        async ({ nextPath, nextBody }) => {
          const response = await fetch(nextPath, {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(nextBody),
          }).catch(() => null);
          if (!response) {
            return null;
          }
          return {
            ok: response.ok,
            status: response.status,
          };
        },
        { nextPath: path, nextBody: body },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        /Execution context was destroyed|Target page, context or browser has been closed/i.test(
          message,
        )
      ) {
        return null;
      }
      throw error;
    }
  }

  private async hasAuthenticatedSession(): Promise<boolean> {
    const payload = await this.fetchAuthJson("/api/auth/get-session", (json) => json);
    return responseHasUser(payload);
  }

  private async getActiveOrganization(): Promise<OrganizationSummary | null> {
    const resolvedEmail =
      lastResolvedLoginEmail ??
      getEnvValue("KEPPO_E2E_AUTH_EMAIL") ??
      `e2e+${this.app.namespace}@example.com`;
    const seededOrgKey = `${this.app.runtime.convexUrl}:${resolvedEmail}`;
    const seededOrgId = personalOrgIdsByUser.get(seededOrgKey) ?? null;
    if (seededOrgId) {
      const store = new KeppoStore(
        this.app.runtime.convexUrl,
        getEnvValue("KEPPO_CONVEX_ADMIN_KEY"),
      );
      const authOrg = await store.getAuthOrganization(seededOrgId);
      if (authOrg?.id && authOrg.slug) {
        return {
          id: authOrg.id,
          slug: authOrg.slug,
        };
      }
    }

    const organizations = await this.fetchAuthJson("/api/auth/organization/list", (payload) => {
      return parseOrganizationList(payload);
    });
    return organizations?.[0] ?? null;
  }

  private async ensureActiveOrganizationScope(): Promise<void> {
    const organization = await this.getActiveOrganization();
    if (!organization) {
      return;
    }
    await this.setActiveOrganization(organization.id, organization.slug);
  }

  async setActiveOrganization(organizationId: string, orgSlug: string): Promise<void> {
    await this.postAuth("/api/auth/organization/set-active", {
      organizationId,
    });

    await this.page.evaluate(
      (scope) => {
        window.__KEPPO_E2E_SCOPE__ = scope;
      },
      {
        orgSlug,
        workspaceSlug: null,
      } satisfies DashboardScope,
    );

    const currentPath = new URL(this.page.url()).pathname;
    if (currentPath === "/" || currentPath === "/login") {
      await this.page.goto(this.absolute("/"));
    }
  }

  private async waitForAuthenticatedSession(): Promise<void> {
    await expect
      .poll(
        async () => {
          return await this.hasAuthenticatedSession();
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  }

  private async ensureWorkspaceScope(): Promise<DashboardScope | null> {
    await this.ensureActiveOrganizationScope();
    const organization = await this.getActiveOrganization();
    if (!organization) {
      return null;
    }

    const store = new KeppoStore(this.app.runtime.convexUrl, getEnvValue("KEPPO_CONVEX_ADMIN_KEY"));
    const workspace = await store.findWorkspaceForOrg(organization.id);
    const scope: DashboardScope = {
      orgSlug: organization.slug,
      workspaceSlug:
        workspace && "slug" in workspace && typeof workspace.slug === "string"
          ? workspace.slug
          : null,
    };

    await this.page.evaluate((nextScope) => {
      if (nextScope.workspaceSlug) {
        window.localStorage.setItem(
          `keppo:lastWorkspaceSlug:${nextScope.orgSlug}`,
          nextScope.workspaceSlug,
        );
      }
      window.__KEPPO_E2E_SCOPE__ = nextScope;
    }, scope);

    if (scope.workspaceSlug) {
      const targetPath = `/${scope.orgSlug}/${scope.workspaceSlug}`;
      const currentPath = new URL(this.page.url()).pathname;
      if (currentPath === "/login" || currentPath === "/" || currentPath === `/${scope.orgSlug}`) {
        await this.page.goto(this.absolute(targetPath));
      }
    }

    return scope;
  }

  async login(
    email?: string,
    password?: string,
    options: {
      path?: string;
      expectedPath?: RegExp;
      expectDashboard?: boolean;
    } = {},
  ): Promise<void> {
    const loginPath = options.path ?? "/login";
    const currentUrl = new URL(this.page.url());
    const currentPathWithSearch = `${currentUrl.pathname}${currentUrl.search}`;
    const shouldReuseCurrentLoginRoute =
      !loginPath.includes("?") && currentUrl.pathname === loginPath;
    if (currentPathWithSearch !== loginPath && !shouldReuseCurrentLoginRoute) {
      await this.goto(loginPath);
    }
    const resolvedEmail =
      email ?? getEnvValue("KEPPO_E2E_AUTH_EMAIL") ?? `e2e+${this.app.namespace}@example.com`;
    const resolvedPassword = password ?? getEnvValue("KEPPO_E2E_AUTH_PASSWORD") ?? "KeppoE2E!123";
    lastResolvedLoginEmail = resolvedEmail;
    const userProvisionKey = `${this.app.runtime.convexUrl}:${resolvedEmail}`;
    if (!ensuredEmailPasswordUsers.has(userProvisionKey)) {
      await ensureEmailPasswordUser({
        dashboardBaseUrl: this.app.dashboardBaseUrl,
        headers: this.app.headers,
        email: resolvedEmail,
        password: resolvedPassword,
        name: getEnvValue("KEPPO_E2E_AUTH_NAME") ?? "E2E User",
      });
      ensuredEmailPasswordUsers.add(userProvisionKey);
    }
    const store = new KeppoStore(this.app.runtime.convexUrl, getEnvValue("KEPPO_CONVEX_ADMIN_KEY"));
    const personalOrgProvisionKey = `${this.app.runtime.convexUrl}:${resolvedEmail}`;
    if (!ensuredPersonalOrgs.has(personalOrgProvisionKey)) {
      const orgId = await store.ensurePersonalOrgForUser({
        id: `usr_${this.app.namespace}`,
        email: resolvedEmail,
        name: getEnvValue("KEPPO_E2E_AUTH_NAME") ?? "E2E User",
      });
      personalOrgIdsByUser.set(personalOrgProvisionKey, orgId);
      ensuredPersonalOrgs.add(personalOrgProvisionKey);
    } else if (!personalOrgIdsByUser.has(personalOrgProvisionKey)) {
      const orgId = await store.ensurePersonalOrgForUser({
        id: `usr_${this.app.namespace}`,
        email: resolvedEmail,
        name: getEnvValue("KEPPO_E2E_AUTH_NAME") ?? "E2E User",
      });
      personalOrgIdsByUser.set(personalOrgProvisionKey, orgId);
    }
    await this.page.getByPlaceholder("Enter your email").fill(resolvedEmail);
    const useTestCredentialsButton = this.page.getByRole("button", {
      name: /Use test credentials/i,
    });
    if (await useTestCredentialsButton.isVisible().catch(() => false)) {
      await useTestCredentialsButton.click();
    }
    const passwordInput = this.page.getByPlaceholder("Password");
    await expect(passwordInput).toBeVisible({ timeout: 5_000 });
    await passwordInput.fill(resolvedPassword);
    const signInButton = this.page.getByRole("button", {
      name: /Sign in with email and password/i,
    });
    await expect(signInButton).toBeEnabled({ timeout: 5_000 });
    await signInButton.click({ timeout: 3_000 });

    const authError = this.page.getByText("Sign-in unavailable", {
      exact: true,
    });
    let lastOutcome = "pending";
    await expect
      .poll(
        async () => {
          const url = new URL(this.page.url());
          if (await authError.isVisible().catch(() => false)) {
            lastOutcome = "auth-error";
            return lastOutcome;
          }

          const hasSession = await this.hasAuthenticatedSession();
          const sessionDebug = hasSession ? "browser-cookie" : "no-browser-cookie";

          if (options.expectedPath) {
            lastOutcome =
              options.expectedPath.test(`${url.pathname}${url.search}`) && hasSession
                ? "expected-path"
                : `pending[path:${url.pathname},session:${sessionDebug}]`;
            return lastOutcome;
          }

          if (hasSession) {
            const scope = await this.ensureWorkspaceScope().catch(() => null);
            if (scope?.workspaceSlug) {
              lastOutcome = "dashboard";
              return lastOutcome;
            }
            if (scope?.orgSlug) {
              lastOutcome = "org-scope";
              return lastOutcome;
            }
          }

          if (options.expectDashboard ?? true) {
            const scope = await syncDashboardScopeFromPage(this.page).catch(() => null);
            if (!scope?.orgSlug && url.pathname !== "/login") {
              await this.ensureActiveOrganizationScope().catch(() => null);
            }
            lastOutcome = scope?.orgSlug
              ? "dashboard"
              : `pending[path:${url.pathname},session:${sessionDebug},scope:${scope?.orgSlug ?? "none"}]`;
            return lastOutcome;
          }

          if (url.pathname !== "/login") {
            lastOutcome = "navigated";
            return lastOutcome;
          }

          lastOutcome = `pending[path:${url.pathname},session:${sessionDebug}]`;
          return lastOutcome;
        },
        {
          timeout: 20_000,
        },
      )
      .not.toMatch(/^pending/);

    if (lastOutcome === "auth-error") {
      throw new Error(await authError.innerText());
    }

    await this.waitForAuthenticatedSession().catch(() => null);

    if (options.expectedPath) {
      await expect(this.page).toHaveURL(options.expectedPath, {
        timeout: 10_000,
      });
      return;
    }

    await this.ensureWorkspaceScope().catch(() => null);

    if (options.expectDashboard ?? true) {
      await expect
        .poll(
          async () => {
            const scoped = await syncDashboardScopeFromPage(this.page).catch(() => null);
            if (scoped?.orgSlug) {
              return scoped;
            }
            return await this.ensureWorkspaceScope().catch(() => null);
          },
          { timeout: 15_000 },
        )
        .toEqual(expect.objectContaining({ orgSlug: expect.any(String) }));
    }
  }

  async signOut(): Promise<void> {
    const userMenuButton = this.page.getByRole("button", {
      name: /@example\.com/i,
    });
    const signOutItem = this.page.getByRole("menuitem", { name: /^Sign Out$/ });
    const canUseMenu = await userMenuButton.isVisible({ timeout: 2_000 }).catch(() => false);

    if (canUseMenu) {
      await userMenuButton.evaluate((element) => {
        (element as HTMLButtonElement).click();
      });
      const menuOpened = await signOutItem.isVisible({ timeout: 2_000 }).catch(() => false);
      if (menuOpened) {
        await signOutItem.evaluate((element) => {
          (element as HTMLButtonElement).click();
        });
      } else {
        await this.page.context().clearCookies();
        await this.page.evaluate(() => {
          window.localStorage.clear();
          window.sessionStorage.clear();
        });
        await this.page.goto(this.absolute("/login"));
      }
    } else {
      await this.page.context().clearCookies();
      await this.page.evaluate(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
      await this.page.goto(this.absolute("/login"));
    }

    await expect
      .poll(() => {
        const url = new URL(this.page.url());
        return `${url.pathname}${url.search}`;
      })
      .toMatch(/^\/(?:login(?:\?.*)?)?$/);
    await expect(this.page.getByPlaceholder("Enter your email")).toBeVisible({
      timeout: 10_000,
    });
  }
}
