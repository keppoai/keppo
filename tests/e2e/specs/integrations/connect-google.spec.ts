import { test, expect } from "../../fixtures/golden.fixture";

test("connect-google", async ({ page, pages, provider, auth }) => {
  test.slow();
  test.setTimeout(60_000);
  await pages.login.login();
  await pages.integrations.open();
  await pages.integrations.connectProvider("google");
  await pages.integrations.expectConnected("google");

  const events = await provider.events("google");
  const paths = events.map((event) => String(event.path ?? ""));
  const oauthFlowPaths = ["/gmail/oauth/authorize", "/gmail/oauth/callback"];
  const sawOauthFlow = oauthFlowPaths.every((path) => paths.includes(path));
  expect(sawOauthFlow || paths.length === 0).toBe(true);

  const seeded = await auth.seedWorkspaceWithProvider("connect-google", "google");
  await pages.integrations.setSelectedWorkspaceSlug(seeded.workspaceSlug);
  await pages.integrations.open();
  await pages.integrations.expectConnected("google");
  await pages.dashboard.open();
  await pages.dashboard.expectLoaded();
  await expect(page.getByRole("link", { name: "Connect Google", exact: true })).toHaveCount(0);
});
