import { KeppoStore } from "@keppo/shared/store";
import type { Page } from "@playwright/test";
import { setTimeout as sleep } from "node:timers/promises";
import { LoginPage } from "../pages/Login.page";
import { syncDashboardScopeFromPage } from "../helpers/dashboard-paths";
import { ensureEmailPasswordUser } from "../helpers/email-password-user";
import { test as base, expect, type AppContext } from "./app-context.fixture";

type SeedWorkspaceResult = {
  orgId: string;
  authOrganizationId: string;
  orgSlug: string;
  workspaceId: string;
  workspaceSlug: string;
  workspaceName: string;
  credentialSecret: string;
};

type SeedableProvider =
  | "google"
  | "stripe"
  | "slack"
  | "github"
  | "notion"
  | "reddit"
  | "x"
  | "custom";

type ProviderConnectOverrides = {
  displayName?: string;
  scopes?: string[];
  externalAccountId?: string;
  accessToken?: string;
  refreshToken?: string | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
};

type WorkspacePolicyMode = "manual_only" | "rules_plus_agent";
type WorkspaceDefaultActionBehavior =
  | "require_approval"
  | "allow_if_rule_matches"
  | "auto_approve_all";

type SeedWorkspaceOptions = {
  preferSelectedWorkspace?: boolean;
  userEmail?: string;
  userName?: string;
  subscriptionTier?: "free" | "starter" | "pro";
  policyMode?: WorkspacePolicyMode;
  defaultActionBehavior?: WorkspaceDefaultActionBehavior;
  skipWorkspaceIntegrationBinding?: boolean;
  skipUiWorkspaceSelectionSync?: boolean;
};

export type AuthFixture = {
  loginPage: LoginPage;
  auth: {
    login: () => Promise<void>;
    seedWorkspace: (suffix: string, options?: SeedWorkspaceOptions) => Promise<SeedWorkspaceResult>;
    seedWorkspaceWithProvider: (
      suffix: string,
      provider: SeedableProvider,
      overrides?: ProviderConnectOverrides,
      options?: SeedWorkspaceOptions,
    ) => Promise<SeedWorkspaceResult>;
    connectProviderForOrg: (
      orgId: string,
      provider: SeedableProvider,
      overrides?: ProviderConnectOverrides,
      workspaceId?: string,
      bindWorkspaceIntegration?: boolean,
    ) => Promise<void>;
    disconnectProviderForOrg: (orgId: string, provider: SeedableProvider) => Promise<void>;
    setToolAutoApproval: (workspaceId: string, toolName: string, enabled: boolean) => Promise<void>;
    setOrgSubscription: (
      orgId: string,
      tier: "free" | "starter" | "pro",
      options?: {
        status?: "active" | "past_due" | "canceled" | "trialing";
        stripeCustomerId?: string | null;
        stripeSubscriptionId?: string | null;
      },
    ) => Promise<void>;
    setOrgSuspended: (orgId: string, suspended: boolean, reason?: string) => Promise<void>;
  };
};

const createStore = (app: AppContext): KeppoStore => {
  return new KeppoStore(app.runtime.convexUrl, process.env.KEPPO_CONVEX_ADMIN_KEY);
};

const toDashboardUrl = (app: AppContext, pathname: string): string => {
  return new URL(pathname, app.dashboardBaseUrl).toString();
};

const syncSelectedWorkspaceInUi = async (params: {
  app: AppContext;
  page: Page;
  workspaceName: string;
  workspaceSlug: string;
  orgSlug: string;
}): Promise<void> => {
  const targetPath = `/${params.orgSlug}/${params.workspaceSlug}`;
  await params.page.evaluate(
    ({ workspaceSlug, orgSlug }) => {
      localStorage.setItem(`keppo:lastWorkspaceSlug:${orgSlug}`, workspaceSlug);
    },
    {
      workspaceSlug: params.workspaceSlug,
      orgSlug: params.orgSlug,
    },
  );
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await params.page.goto(toDashboardUrl(params.app, targetPath), {
      waitUntil: "domcontentloaded",
    });
    const currentPath = new URL(params.page.url()).pathname;
    if (currentPath === targetPath || currentPath.startsWith(`${targetPath}/`)) {
      return;
    }
    const switcher = params.page.locator('[data-sidebar="menu-button"]').first();
    if (await switcher.isVisible().catch(() => false)) {
      await switcher.click().catch(() => null);
      const workspaceOption = params.page.getByRole("menuitem", {
        name: params.workspaceName,
        exact: true,
      });
      if (await workspaceOption.isVisible().catch(() => false)) {
        await workspaceOption.click();
        await params.page
          .waitForURL(new RegExp(`${targetPath}(?:/.*)?$`), {
            timeout: 2_000,
          })
          .catch(() => null);
        const selectedPath = new URL(params.page.url()).pathname;
        if (selectedPath === targetPath || selectedPath.startsWith(`${targetPath}/`)) {
          return;
        }
      }
    }
    await sleep(250);
  }
  throw new Error(`Timed out selecting seeded workspace at ${targetPath}.`);
};
export const test = base.extend<AuthFixture>({
  loginPage: async ({ page, app }, use) => {
    await use(new LoginPage(page, app));
  },

  auth: async ({ app, loginPage, page }, use) => {
    const enabledWorkspaceProviders = new Map<string, Set<SeedableProvider>>();

    const login = async (): Promise<void> => {
      const store = createStore(app);
      const authUserEmail = process.env.KEPPO_E2E_AUTH_EMAIL ?? `e2e+${app.namespace}@example.com`;
      const authUserName = process.env.KEPPO_E2E_AUTH_NAME ?? "E2E User";
      const authPassword = process.env.KEPPO_E2E_AUTH_PASSWORD ?? "KeppoE2E!123";
      await ensureEmailPasswordUser({
        dashboardBaseUrl: app.dashboardBaseUrl,
        headers: app.headers,
        email: authUserEmail,
        password: authPassword,
        name: authUserName,
      });
      await store.ensurePersonalOrgForUser({
        id: `usr_${app.namespace}`,
        email: authUserEmail,
        name: authUserName,
      });
      await loginPage.login();
    };

    const seedWorkspace = async (
      suffix: string,
      options: SeedWorkspaceOptions = {},
    ): Promise<SeedWorkspaceResult> => {
      const store = createStore(app);
      const authUserEmail =
        options.userEmail ?? process.env.KEPPO_E2E_AUTH_EMAIL ?? `e2e+${app.namespace}@example.com`;
      const authUserName = options.userName ?? process.env.KEPPO_E2E_AUTH_NAME ?? "E2E User";
      const authPassword = process.env.KEPPO_E2E_AUTH_PASSWORD ?? "KeppoE2E!123";
      await ensureEmailPasswordUser({
        dashboardBaseUrl: app.dashboardBaseUrl,
        headers: app.headers,
        email: authUserEmail,
        password: authPassword,
        name: authUserName,
      });
      const orgId = await store.ensurePersonalOrgForUser({
        id: `usr_${app.namespace}`,
        email: authUserEmail,
        name: authUserName,
      });
      const defaultSubscriptionTier = process.env.KEPPO_E2E_DEFAULT_SUBSCRIPTION_TIER;
      const subscriptionTier = options.subscriptionTier ?? defaultSubscriptionTier;
      if (
        subscriptionTier === "free" ||
        subscriptionTier === "starter" ||
        subscriptionTier === "pro"
      ) {
        await store.setOrgSubscription({
          org_id: orgId,
          tier: subscriptionTier,
          status: "active",
          stripe_customer_id: subscriptionTier === "free" ? null : `cus_${app.namespace}_${suffix}`,
        });
      }

      const preferredWorkspace = options.preferSelectedWorkspace
        ? await (async () => {
            const selectedWorkspaceSlug =
              new URL(page.url()).pathname.split("/").filter(Boolean)[1] ?? null;
            if (!selectedWorkspaceSlug) {
              return null;
            }
            return store.findWorkspaceForOrg(orgId, selectedWorkspaceSlug);
          })()
        : null;

      const workspace =
        preferredWorkspace ??
        (await store.createWorkspace({
          org_id: orgId,
          name: `workspace-${suffix}-${app.namespace}-${app.metadata.testId}`,
          policy_mode: options.policyMode ?? "manual_only",
          default_action_behavior: options.defaultActionBehavior ?? "require_approval",
        }));
      const credential = await store.rotateCredential(workspace.id);
      const authOrg = await store.getAuthOrganization(orgId);
      if (!authOrg) {
        throw new Error(`Unable to resolve Better Auth organization for seeded org ${orgId}.`);
      }

      if (!options.skipUiWorkspaceSelectionSync) {
        try {
          await syncSelectedWorkspaceInUi({
            app,
            page,
            workspaceName: workspace.name,
            workspaceSlug: workspace.slug,
            orgSlug: authOrg.slug,
          });
        } catch {
          // no-op: provider-only tests can seed workspaces without UI state.
        }
      }

      await syncDashboardScopeFromPage(page).catch(() => null);

      return {
        orgId,
        authOrganizationId: authOrg.id,
        orgSlug: authOrg.slug,
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        workspaceName: workspace.name,
        credentialSecret: credential.secret,
      };
    };

    const connectProviderForOrg = async (
      orgId: string,
      provider: SeedableProvider,
      overrides: ProviderConnectOverrides = {},
      workspaceId?: string,
      bindWorkspaceIntegration = true,
    ): Promise<void> => {
      const store = createStore(app);
      const scopesByProvider: Record<SeedableProvider, string[]> = {
        google: [
          "gmail.readonly",
          "gmail.send",
          "gmail.modify",
          "gmail.compose",
          "gmail.settings.basic",
          "gmail.labels",
        ],
        stripe: ["stripe.read", "stripe.write"],
        slack: ["slack.read", "slack.write"],
        github: ["repo:read", "repo:write", "workflow", "read:org"],
        notion: ["notion.read", "notion.write"],
        reddit: ["reddit.read", "reddit.write"],
        x: ["x.read", "x.write"],
        custom: ["custom.read", "custom.write"],
      };
      const tokenProviderByProvider: Record<SeedableProvider, string> = {
        google: "gmail",
        stripe: "stripe",
        slack: "slack",
        github: "github",
        notion: "notion",
        reddit: "reddit",
        x: "x",
        custom: "custom",
      };
      const tokenProvider = tokenProviderByProvider[provider];
      await store
        .disconnectIntegration({
          org_id: orgId,
          provider,
        })
        .catch(() => null);
      await store.connectIntegration({
        org_id: orgId,
        provider,
        display_name: overrides.displayName ?? `${provider} ${app.metadata.testId}`,
        scopes: overrides.scopes ?? scopesByProvider[provider],
        external_account_id:
          overrides.externalAccountId ?? `${provider}+${app.namespace}@example.com`,
        access_token: overrides.accessToken ?? `fake_${tokenProvider}_access_token`,
        refresh_token:
          overrides.refreshToken === undefined
            ? `fake_${tokenProvider}_refresh_token`
            : overrides.refreshToken,
        credential_expires_at: overrides.expiresAt ?? new Date(Date.now() + 3600_000).toISOString(),
        metadata: {
          e2e_namespace: app.namespace,
          e2e_test_id: app.metadata.testId,
          provider,
          canonical_provider: provider,
          ...overrides.metadata,
        },
      });

      let targetWorkspaceId = workspaceId ?? null;
      if (!targetWorkspaceId) {
        try {
          const scope = await syncDashboardScopeFromPage(page);
          const workspaceSlug = scope?.workspaceSlug;
          if (workspaceSlug) {
            const matchingWorkspace = await store.findWorkspaceForOrg(orgId, workspaceSlug);
            targetWorkspaceId = matchingWorkspace?.id ?? null;
          }
        } catch {
          targetWorkspaceId = null;
        }
      }

      if (targetWorkspaceId && bindWorkspaceIntegration) {
        try {
          const nextProviders = new Set(enabledWorkspaceProviders.get(targetWorkspaceId) ?? []);
          nextProviders.add(provider);
          enabledWorkspaceProviders.set(targetWorkspaceId, nextProviders);
          await store.setWorkspaceIntegrations({
            workspace_id: targetWorkspaceId,
            providers: [...nextProviders],
          });
        } catch {
          // Workspace integration toggles are best-effort for fixture speed/isolation.
        }
      }
    };

    const disconnectProviderForOrg = async (
      orgId: string,
      provider: SeedableProvider,
    ): Promise<void> => {
      const store = createStore(app);
      await store.disconnectIntegration({
        org_id: orgId,
        provider,
      });

      for (const [workspaceId, providers] of enabledWorkspaceProviders.entries()) {
        if (!providers.delete(provider)) {
          continue;
        }
        if (providers.size === 0) {
          enabledWorkspaceProviders.delete(workspaceId);
        }
        try {
          await store.setWorkspaceIntegrations({
            workspace_id: workspaceId,
            providers: [...providers],
          });
        } catch {
          // Best-effort cleanup for fixture state.
        }
      }
    };

    const setToolAutoApproval = async (
      workspaceId: string,
      toolName: string,
      enabled: boolean,
    ): Promise<void> => {
      const store = createStore(app);
      await store.setToolAutoApproval({
        workspace_id: workspaceId,
        tool_name: toolName,
        enabled,
      });
    };

    const setOrgSubscription = async (
      orgId: string,
      tier: "free" | "starter" | "pro",
      options: {
        status?: "active" | "past_due" | "canceled" | "trialing";
        stripeCustomerId?: string | null;
        stripeSubscriptionId?: string | null;
      } = {},
    ): Promise<void> => {
      const store = createStore(app);
      await store.setOrgSubscription({
        org_id: orgId,
        tier,
        status: options.status ?? "active",
        stripe_customer_id:
          options.stripeCustomerId === undefined
            ? tier === "free"
              ? null
              : `cus_${orgId}`
            : options.stripeCustomerId,
        stripe_subscription_id:
          options.stripeSubscriptionId === undefined
            ? tier === "free"
              ? null
              : `sub_${orgId}`
            : options.stripeSubscriptionId,
      });
    };

    const setOrgSuspended = async (
      orgId: string,
      suspended: boolean,
      reason = "e2e abuse-prevention test",
    ): Promise<void> => {
      const store = createStore(app);
      await store.setOrgSuspended({
        org_id: orgId,
        suspended,
        reason,
      });
    };

    const seedWorkspaceWithProvider = async (
      suffix: string,
      provider: SeedableProvider,
      overrides: ProviderConnectOverrides = {},
      options: SeedWorkspaceOptions = {},
    ): Promise<SeedWorkspaceResult> => {
      const seeded = await seedWorkspace(suffix, options);
      await connectProviderForOrg(
        seeded.orgId,
        provider,
        overrides,
        seeded.workspaceId,
        !options.skipWorkspaceIntegrationBinding,
      );
      return seeded;
    };

    await use({
      login,
      seedWorkspace,
      seedWorkspaceWithProvider,
      connectProviderForOrg,
      disconnectProviderForOrg,
      setToolAutoApproval,
      setOrgSubscription,
      setOrgSuspended,
    });
  },
});

export { expect };
