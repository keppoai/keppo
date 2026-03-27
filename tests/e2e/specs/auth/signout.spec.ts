import { test } from "../../fixtures/golden.fixture";

test("signout", async ({ pages, golden }) => {
  await pages.login.login();
  await pages.login.signOut();
  await golden.aria("auth-signout");
});
