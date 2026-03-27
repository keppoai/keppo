import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../../fixtures/golden.fixture";
import { createConvexAdmin } from "../../helpers/convex-admin";
import { ensureEmailPasswordUser } from "../../helpers/email-password-user";

const PASSWORD = "KeppoE2E!123";

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

const openMembersPage = async (page: Page, appBaseUrl: string, orgSlug: string): Promise<void> => {
  await page.goto(new URL(`/${orgSlug}/settings/members`, appBaseUrl).toString());
  await expect(page.getByRole("heading", { name: "Members" })).toBeVisible();
};

const inviteMember = async (params: {
  page: Page;
  appBaseUrl: string;
  orgSlug: string;
  email: string;
  role: "owner" | "admin" | "approver" | "viewer";
}): Promise<void> => {
  await openMembersPage(params.page, params.appBaseUrl, params.orgSlug);
  const inviteEmailInput = params.page.getByPlaceholder("name@example.com");
  await setControlValue(inviteEmailInput, params.email);
  await params.page
    .locator("form")
    .filter({ has: params.page.getByRole("button", { name: "Send Invite" }) })
    .getByRole("combobox")
    .selectOption(params.role);
  await clickElement(params.page.getByRole("button", { name: "Send Invite" }));
  await expect(inviteEmailInput).toHaveValue("");
  await params.page.reload();
  await expect(params.page.getByRole("cell", { name: params.email })).toBeVisible();
};

const acceptLatestInvite = async (params: {
  admin: ReturnType<typeof createConvexAdmin>;
  page: Page;
  pages: {
    login: {
      login: (
        email?: string,
        password?: string,
        options?: {
          path?: string;
          expectedPath?: RegExp;
          expectDashboard?: boolean;
        },
      ) => Promise<void>;
    };
  };
  appBaseUrl: string;
  orgId: string;
  email: string;
}): Promise<void> => {
  let token = "";
  await expect
    .poll(
      async () => {
        const inviteToken = (await params.admin.getLatestInviteTokenForEmail(
          params.orgId,
          params.email,
        )) as {
          rawToken?: string;
        } | null;
        token = inviteToken?.rawToken ?? "";
        return token;
      },
      { timeout: 5_000 },
    )
    .toMatch(/^inv_tok_/);

  const acceptUrl = `${params.appBaseUrl}/invites/accept?token=${encodeURIComponent(token)}`;
  await params.page.goto(acceptUrl);
  await expect(params.page.getByText("Accept invitation", { exact: true })).toBeVisible();
  await clickElement(params.page.getByRole("button", { name: "Continue to sign in" }));
  await params.pages.login.login(params.email, PASSWORD, {
    expectedPath: /\/invites\/accept\?token=/,
    expectDashboard: false,
  });

  await expect
    .poll(
      async () => {
        if (
          await params.page
            .getByText("Invitation accepted", { exact: true })
            .isVisible()
            .catch(() => false)
        ) {
          return "accepted";
        }
        if (
          await params.page
            .getByText("Invitation no longer valid", { exact: true })
            .isVisible()
            .catch(() => false)
        ) {
          return "invalid";
        }
        if (
          await params.page
            .getByText("Accepting invitation...", { exact: true })
            .isVisible()
            .catch(() => false)
        ) {
          return "loading";
        }
        if (
          await params.page
            .getByText("Checking your sign-in...", { exact: true })
            .isVisible()
            .catch(() => false)
        ) {
          return "loading";
        }
        return `${new URL(params.page.url()).pathname}${new URL(params.page.url()).search}`;
      },
      {
        timeout: 45_000,
        message: "Timed out waiting for invite acceptance to reach a terminal state.",
      },
    )
    .toBe("accepted");
  await expect(params.page.getByText(/You've joined /i)).toBeVisible();
};

test.describe("member role changes", () => {
  test.slow();

  test("owner can change a member role from viewer to admin", async ({
    app,
    auth,
    page,
    pages,
  }) => {
    const admin = createConvexAdmin(app);
    const ownerEmail = `owner+${app.namespace}@example.com`;
    const viewerEmail = `viewer+${app.namespace}@example.com`;

    await ensureEmailPasswordUser({
      dashboardBaseUrl: app.dashboardBaseUrl,
      headers: app.headers,
      email: ownerEmail,
      password: PASSWORD,
      name: "Owner User",
    });
    await ensureEmailPasswordUser({
      dashboardBaseUrl: app.dashboardBaseUrl,
      headers: app.headers,
      email: viewerEmail,
      password: PASSWORD,
      name: "Viewer User",
    });

    const seeded = await auth.seedWorkspace("member-role-owner", {
      userEmail: ownerEmail,
      userName: "Owner User",
      subscriptionTier: "starter",
    });

    await pages.login.login(ownerEmail, PASSWORD, { expectDashboard: false });
    await inviteMember({
      page,
      appBaseUrl: app.dashboardBaseUrl,
      orgSlug: seeded.orgSlug,
      email: viewerEmail,
      role: "viewer",
    });

    await pages.login.signOut();
    await clearBrowserAuthState(page);
    await acceptLatestInvite({
      admin,
      page,
      pages,
      appBaseUrl: app.dashboardBaseUrl,
      orgId: seeded.orgId,
      email: viewerEmail,
    });

    await pages.login.signOut();
    await clearBrowserAuthState(page);
    await pages.login.login(ownerEmail, PASSWORD, { expectDashboard: false });
    await openMembersPage(page, app.dashboardBaseUrl, seeded.orgSlug);

    const memberRow = page.getByRole("row").filter({ hasText: viewerEmail });
    await expect(memberRow).toContainText("Viewer");
    await memberRow.getByRole("combobox").selectOption("admin");
    await clickElement(memberRow.getByRole("button", { name: "Change Role" }));
    await expect(memberRow).toContainText("Admin");
  });

  test("admin cannot promote a member to owner", async ({ app, auth, page, pages }) => {
    const admin = createConvexAdmin(app);
    const ownerEmail = `owner+${app.namespace}@example.com`;
    const adminEmail = `admin+${app.namespace}@example.com`;

    for (const [email, name] of [
      [ownerEmail, "Owner User"],
      [adminEmail, "Admin User"],
    ] as const) {
      await ensureEmailPasswordUser({
        dashboardBaseUrl: app.dashboardBaseUrl,
        headers: app.headers,
        email,
        password: PASSWORD,
        name,
      });
    }

    const seeded = await auth.seedWorkspace("member-role-admin", {
      userEmail: ownerEmail,
      userName: "Owner User",
      subscriptionTier: "starter",
    });

    await pages.login.login(ownerEmail, PASSWORD, { expectDashboard: false });
    await inviteMember({
      page,
      appBaseUrl: app.dashboardBaseUrl,
      orgSlug: seeded.orgSlug,
      email: adminEmail,
      role: "admin",
    });

    let token = "";
    await expect
      .poll(
        async () => {
          const inviteToken = (await admin.getLatestInviteTokenForEmail(
            seeded.orgId,
            adminEmail,
          )) as {
            rawToken?: string;
          } | null;
          token = inviteToken?.rawToken ?? "";
          return token;
        },
        { timeout: 5_000 },
      )
      .toMatch(/^inv_tok_/);

    await pages.login.signOut();
    await clearBrowserAuthState(page);
    const authUser = (await admin.getAuthUserByEmail(adminEmail)) as {
      id?: string;
    } | null;
    const adminUserId = authUser?.id ?? "";
    expect(adminUserId).toMatch(/^.+$/);
    await admin.acceptInviteForUser(token, adminUserId);
    await pages.login.login(adminEmail, PASSWORD, { expectDashboard: false });
    await pages.login.setActiveOrganization(seeded.authOrganizationId, seeded.orgSlug);

    await openMembersPage(page, app.dashboardBaseUrl, seeded.orgSlug);

    await expect(page.getByText("2 of 2 members")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: ownerEmail })).toContainText("Owner");
    await expect(page.getByRole("button", { name: "Change Role" })).toHaveCount(0);
    await expect(page.getByRole("table").getByRole("combobox")).toHaveCount(0);

    const inviteRoleSelect = page
      .locator("form")
      .filter({ has: page.getByRole("button", { name: "Send Invite" }) })
      .getByRole("combobox");
    await expect
      .poll(async () => {
        return await inviteRoleSelect.locator("option").allInnerTexts();
      })
      .toEqual(["Admin", "Approver", "Viewer"]);
  });

  test("sole owner protections prevent self-demotion paths in the members UI", async ({
    app,
    auth,
    page,
    pages,
  }) => {
    const ownerEmail = `owner+${app.namespace}@example.com`;

    await ensureEmailPasswordUser({
      dashboardBaseUrl: app.dashboardBaseUrl,
      headers: app.headers,
      email: ownerEmail,
      password: PASSWORD,
      name: "Owner User",
    });

    const seeded = await auth.seedWorkspace("member-role-sole-owner", {
      userEmail: ownerEmail,
      userName: "Owner User",
      subscriptionTier: "starter",
    });

    await pages.login.login(ownerEmail, PASSWORD, { expectDashboard: false });
    await openMembersPage(page, app.dashboardBaseUrl, seeded.orgSlug);

    const ownerRow = page.getByRole("row").filter({ hasText: ownerEmail });
    await expect(ownerRow).toContainText("Owner");
    await expect(ownerRow.getByRole("button", { name: "Change Role" })).toHaveCount(0);
    await expect(ownerRow.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Leave Organization" })).toBeDisabled();
  });
});
