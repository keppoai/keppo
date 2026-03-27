import { mkdirSync } from "node:fs";
import { expect, test } from "../../fixtures/golden.fixture";
import { syncDashboardScopeFromPage } from "../../helpers/dashboard-paths";

test.slow();

const seedDeletableWorkspace = async (auth: {
  seedWorkspace: (suffix: string) => Promise<{
    orgSlug: string;
    workspaceSlug: string;
    workspaceName: string;
  }>;
}) => {
  return await auth.seedWorkspace("workspace-delete-target");
};

test("deleting a workspace removes it from the active workspace surfaces", async ({
  auth,
  page,
  pages,
}) => {
  await pages.login.login();
  const workspace = await seedDeletableWorkspace(auth);

  await pages.workspaces.open();
  await pages.workspaces.selectWorkspace(workspace.workspaceName);
  await pages.workspaces.deleteSelectedWorkspace();

  await pages.workspaces.expectWorkspaceHidden(workspace.workspaceName);
  await expect(page).toHaveURL(new RegExp(`/${workspace.orgSlug}/[^/]+$`));
  const scope = await syncDashboardScopeFromPage(page);
  expect(scope?.workspaceSlug).not.toBe(workspace.workspaceSlug);
});

test("deleting the active workspace switches the dashboard to a remaining workspace", async ({
  app,
  auth,
  page,
  pages,
}) => {
  await pages.login.login();
  const workspace = await seedDeletableWorkspace(auth);

  await page.goto(
    new URL(
      `/${workspace.orgSlug}/${workspace.workspaceSlug}/automations`,
      app.dashboardBaseUrl,
    ).toString(),
  );
  await expect(page.getByRole("heading", { name: "Automations", exact: true })).toBeVisible();

  await pages.workspaces.open();
  await pages.workspaces.selectWorkspace(workspace.workspaceName);
  await pages.workspaces.deleteSelectedWorkspace();

  await expect(page).toHaveURL(new RegExp(`/${workspace.orgSlug}/[^/]+$`));
  const scope = await syncDashboardScopeFromPage(page);
  expect(scope?.workspaceSlug).not.toBe(workspace.workspaceSlug);
  await expect(
    page.getByText("Create your first automation to get started.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("workspace deletion requires explicit confirmation and cancel preserves the workspace", async ({
  auth,
  page,
  pages,
}) => {
  await pages.login.login();
  const workspace = await seedDeletableWorkspace(auth);

  await pages.workspaces.open();
  await pages.workspaces.selectWorkspace(workspace.workspaceName);
  await pages.workspaces.openDeleteDialog();

  mkdirSync("ux-artifacts", { recursive: true });
  await page.screenshot({
    path: "ux-artifacts/workspace-delete-confirmation.png",
    fullPage: true,
  });

  await pages.workspaces.cancelDeleteWorkspace();
  await pages.workspaces.expectWorkspaceVisible(workspace.workspaceName);
  await expect(page).toHaveURL(/\/settings\/workspaces$/);
});
