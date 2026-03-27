import { expectAriaDiffSnapshot } from "../helpers/aria-diff";
import { ActionQueuePage } from "../pages/ActionQueue.page";
import { AutomationsPage } from "../pages/Automations.page";
import { AuditLogPage } from "../pages/AuditLog.page";
import { DashboardPage } from "../pages/Dashboard.page";
import { IntegrationsPage } from "../pages/Integrations.page";
import { LoginPage } from "../pages/Login.page";
import { RulesPage } from "../pages/Rules.page";
import { WorkspaceSettingsPage } from "../pages/WorkspaceSettings.page";
import { test as base, expect } from "./provider.fixture";

export type GoldenFixture = {
  pages: {
    login: LoginPage;
    dashboard: DashboardPage;
    automations: AutomationsPage;
    actions: ActionQueuePage;
    workspaces: WorkspaceSettingsPage;
    integrations: IntegrationsPage;
    rules: RulesPage;
    audit: AuditLogPage;
  };
  golden: {
    aria: (name: string) => Promise<void>;
  };
};

export const test = base.extend<GoldenFixture>({
  pages: async ({ page, app }, use) => {
    await use({
      login: new LoginPage(page, app),
      dashboard: new DashboardPage(page, app),
      automations: new AutomationsPage(page, app),
      actions: new ActionQueuePage(page, app),
      workspaces: new WorkspaceSettingsPage(page, app),
      integrations: new IntegrationsPage(page, app),
      rules: new RulesPage(page, app),
      audit: new AuditLogPage(page, app),
    });
  },

  golden: async ({ page }, use) => {
    await use({
      aria: async (name: string) => {
        await expectAriaDiffSnapshot({
          page,
          name,
        });
      },
    });
  },
});

export { expect };
