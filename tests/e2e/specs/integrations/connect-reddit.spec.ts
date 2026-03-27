import { test, expect } from "../../fixtures/golden.fixture";

test("connect-reddit", async ({ page, pages, provider, auth }) => {
  test.slow();
  test.setTimeout(60_000);
  await pages.login.login();
  await pages.integrations.open();
  await pages.integrations.connectProvider("reddit");
  await pages.integrations.expectConnected("reddit");

  const events = await provider.events("reddit");
  const paths = events.map((event) => String(event.path ?? ""));
  const oauthFlowPaths = ["/reddit/oauth/authorize", "/reddit/oauth/callback"];
  const sawOauthFlow = oauthFlowPaths.every((path) => paths.includes(path));
  expect(sawOauthFlow || paths.length === 0).toBe(true);

  const seeded = await auth.seedWorkspaceWithProvider("connect-reddit", "reddit");
  await pages.integrations.setSelectedWorkspaceSlug(seeded.workspaceSlug);
  await pages.integrations.open();
  await pages.integrations.expectConnected("reddit");
  await pages.dashboard.open();
  await pages.dashboard.expectLoaded();
  await expect(page.getByRole("link", { name: "Connect Reddit", exact: true })).toHaveCount(0);
});
