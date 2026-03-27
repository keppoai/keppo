import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../../fixtures/golden.fixture";
import { createConvexAdmin } from "../../helpers/convex-admin";
import { ensureEmailPasswordUser } from "../../helpers/email-password-user";

const setControlValue = async (locator: Locator, value: string): Promise<void> => {
  await locator.evaluate((element, nextValue) => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    descriptor?.set?.call(element, nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
};

const clickElement = async (locator: Locator): Promise<void> => {
  await locator.evaluate((element) => (element as HTMLElement).click());
};

const clearBrowserAuthState = async (page: Page): Promise<void> => {
  await page.context().clearCookies();
  await page.evaluate(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
};

test("invite acceptance preserves login return path and adds the member", async ({
  app,
  auth,
  page,
  pages,
}) => {
  test.setTimeout(90_000);
  const admin = createConvexAdmin(app);
  const inviterEmail = `e2e+${app.namespace}@example.com`;
  const inviteeEmail = `invitee+${app.namespace}@example.com`;
  const password = "KeppoE2E!123";

  await ensureEmailPasswordUser({
    dashboardBaseUrl: app.dashboardBaseUrl,
    headers: app.headers,
    email: inviterEmail,
    password,
    name: "Invite Owner",
  });
  await ensureEmailPasswordUser({
    dashboardBaseUrl: app.dashboardBaseUrl,
    headers: app.headers,
    email: inviteeEmail,
    password,
    name: "Invitee User",
  });

  const seeded = await auth.seedWorkspace("invite-acceptance", {
    userName: "Invite Owner",
    subscriptionTier: "starter",
  });
  await pages.login.login(inviterEmail, password, {
    expectDashboard: false,
  });

  await page.goto(new URL(`/${seeded.orgSlug}/settings/members`, app.dashboardBaseUrl).toString());
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  await setControlValue(page.getByPlaceholder("name@example.com"), inviteeEmail);
  await page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Send Invite" }) })
    .getByRole("combobox")
    .selectOption("viewer");
  await clickElement(page.getByRole("button", { name: "Send Invite" }));

  let inviteId = "";
  let token = "";
  await expect
    .poll(
      async () => {
        const inviteToken = (await admin.getLatestInviteTokenForEmail(
          seeded.orgId,
          inviteeEmail,
        )) as {
          inviteId?: string;
          rawToken?: string;
        } | null;
        inviteId = inviteToken?.inviteId ?? "";
        token = inviteToken?.rawToken ?? "";
        return token;
      },
      { timeout: 5_000 },
    )
    .toMatch(/^inv_tok_/);

  expect(inviteId).toMatch(/^inv_/);
  expect(token).toMatch(/^inv_tok_/);

  await page.reload();
  await expect(page.getByRole("cell", { name: inviteeEmail })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Viewer" })).toBeVisible();

  await pages.login.signOut();
  await clearBrowserAuthState(page);

  const acceptUrl = `${app.dashboardBaseUrl}/invites/accept?token=${encodeURIComponent(token)}`;
  await page.goto(acceptUrl);
  await expect(page.getByText("Accept invitation", { exact: true })).toBeVisible();
  await clickElement(page.getByRole("button", { name: "Continue to sign in" }));
  await expect(page).toHaveURL(/\/login\?returnTo=%2Finvites%2Faccept%3Ftoken%3D/);

  await pages.login.login(inviteeEmail, password, {
    expectedPath: /\/invites\/accept\?token=/,
    expectDashboard: false,
  });

  await expect
    .poll(
      async () => {
        if (await page.getByText("Invitation accepted", { exact: true }).isVisible()) {
          return "accepted";
        }
        if (await page.getByText("Invitation no longer valid", { exact: true }).isVisible()) {
          return "invalid";
        }
        if (await page.getByText("Accepting invitation...", { exact: true }).isVisible()) {
          return "loading";
        }
        if (await page.getByText("Checking your sign-in...", { exact: true }).isVisible()) {
          return "loading";
        }
        return `${new URL(page.url()).pathname}${new URL(page.url()).search}`;
      },
      {
        timeout: 45_000,
        message: "Timed out waiting for invite acceptance to reach a terminal state after login.",
      },
    )
    .toBe("accepted");
  await expect(page.getByText(/You've joined /i)).toBeVisible();

  await page.goto(acceptUrl);
  await expect(page.getByText("Invitation no longer valid", { exact: true })).toBeVisible();
  await expect(page.getByText(/expired or is no longer available/i)).toBeVisible();

  await page.goto(app.dashboardBaseUrl);
  await pages.login.signOut();
  await clearBrowserAuthState(page);
  await pages.login.login(inviterEmail, password, {
    expectDashboard: false,
  });
  await page.goto(new URL(`/${seeded.orgSlug}/settings/members`, app.dashboardBaseUrl).toString());

  const memberRow = page.getByRole("row").filter({ hasText: inviteeEmail });
  await expect(memberRow).toBeVisible();
  await expect(memberRow).toContainText("Viewer");
});

test("members page disables invites when the org is at its seat limit", async ({
  app,
  auth,
  page,
  pages,
}) => {
  const admin = createConvexAdmin(app);
  const email = `e2e+${app.namespace}@example.com`;
  const password = "KeppoE2E!123";

  await ensureEmailPasswordUser({
    dashboardBaseUrl: app.dashboardBaseUrl,
    headers: app.headers,
    email,
    password,
    name: "Seat Limit User",
  });
  const seeded = await auth.seedWorkspace("invite-seat-limit", {
    subscriptionTier: "free",
  });

  await admin.setOrgMaxMembers(seeded.orgId, 1);

  await pages.login.login(email, password, { expectDashboard: false });
  await page.goto(new URL(`/${seeded.orgSlug}/settings/members`, app.dashboardBaseUrl).toString());

  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
  await expect(page.getByText("1 of 1 members")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send Invite" })).toBeDisabled();
  await expect(
    page.getByText(
      "Member limit reached. Upgrade your plan or remove a member before inviting more.",
    ),
  ).toBeVisible();
});
