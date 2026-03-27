import type { Locator, Page } from "@playwright/test";
import { KeppoStore } from "@keppo/shared/store";
import { test, expect } from "../../fixtures/golden.fixture";
import { resolveScopedDashboardPath } from "../../helpers/dashboard-paths";

const clickElement = async (locator: Locator): Promise<void> => {
  await locator.evaluate((element) => (element as HTMLElement).click());
};

const openNotificationSettings = async (params: {
  page: Page;
  appBaseUrl: string;
}): Promise<void> => {
  await params.page.goto(
    new URL(
      await resolveScopedDashboardPath(params.page, "/settings"),
      params.appBaseUrl,
    ).toString(),
  );
  await expect(params.page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await clickElement(params.page.getByRole("tab", { name: "Notifications" }));
  await expect(
    params.page.getByText("Manage email and push notification delivery preferences."),
  ).toBeVisible();
};

const addEmailEndpoint = async (params: { page: Page; destination: string }): Promise<void> => {
  await params.page.getByPlaceholder("name@example.com").fill(params.destination);
  await clickElement(params.page.getByRole("button", { name: "Add email" }));
  await expect(params.page.getByText(params.destination, { exact: true })).toBeVisible();
};

const waitForPersistedEmailEndpoint = async (params: {
  store: KeppoStore;
  page: Page;
  orgId: string;
  destination: string;
}): Promise<string> => {
  let endpointId = "";
  // Combine backend persistence, page visibility, and control readiness into a
  // single poll so brief optimistic-to-persisted row transitions cannot cause
  // the sequential polls to see a zero-text-count window and time out.
  await expect
    .poll(
      async () => {
        // 1. Backend must have persisted the endpoint.
        try {
          const endpoint = await params.store.findNotificationEndpoint({
            orgId: params.orgId,
            destination: params.destination,
            type: "email",
          });
          endpointId = endpoint?.id ?? "";
        } catch {
          endpointId = "";
        }
        if (!endpointId) return "no-backend-record";

        // 2. The endpoint text must be visible exactly once on the page.
        const textCount = await params.page.getByText(params.destination, { exact: true }).count();
        if (textCount !== 1) return "text-not-visible";

        // 3. Row controls (remove button + toggle) must be enabled.
        const endpointCard = getEndpointCard(params.page, params.destination);
        const removeButtonDisabled = await endpointCard
          .getByRole("button", { name: "Remove email endpoint" })
          .isDisabled()
          .catch(() => true);
        const toggleDisabled = await getEndpointToggle(endpointCard)
          .isDisabled()
          .catch(() => true);
        if (removeButtonDisabled || toggleDisabled) return "controls-disabled";

        return "ready";
      },
      { timeout: 30_000 },
    )
    .toBe("ready");
  return endpointId;
};

const getEndpointCard = (page: Page, destination: string): Locator => {
  return page.locator("div.rounded-md.border.p-3").filter({
    has: page.getByText(destination, { exact: true }),
  });
};

const getEndpointToggle = (endpointCard: Locator): Locator => {
  return endpointCard.locator("div.flex.items-center.justify-between.gap-3").getByRole("switch");
};

test.describe("notification preference email endpoints", () => {
  test("adding an email notification endpoint persists it to the backend", async ({
    app,
    auth,
    page,
    pages,
  }) => {
    const store = new KeppoStore(app.runtime.convexUrl, process.env["KEPPO_CONVEX_ADMIN_KEY"]);
    const seeded = await auth.seedWorkspace("notification-endpoint-add", {
      preferSelectedWorkspace: true,
    });
    const destination = `alerts+${app.namespace}@example.com`;

    await pages.login.login();
    await openNotificationSettings({
      page,
      appBaseUrl: app.dashboardBaseUrl,
    });
    await addEmailEndpoint({
      page,
      destination,
    });
    await waitForPersistedEmailEndpoint({
      store,
      page,
      orgId: seeded.orgId,
      destination,
    });
  });

  test("toggling an email notification endpoint off and on updates its enabled state", async ({
    app,
    auth,
    page,
    pages,
  }) => {
    const store = new KeppoStore(app.runtime.convexUrl, process.env["KEPPO_CONVEX_ADMIN_KEY"]);
    const seeded = await auth.seedWorkspace("notification-endpoint-toggle", {
      preferSelectedWorkspace: true,
    });
    const destination = `ops+${app.namespace}@example.com`;

    await pages.login.login();
    await openNotificationSettings({
      page,
      appBaseUrl: app.dashboardBaseUrl,
    });
    await addEmailEndpoint({
      page,
      destination,
    });
    await waitForPersistedEmailEndpoint({
      store,
      page,
      orgId: seeded.orgId,
      destination,
    });

    const endpointCard = getEndpointCard(page, destination);
    const endpointToggle = getEndpointToggle(endpointCard);

    await expect(endpointToggle).toHaveAttribute("aria-checked", "true");
    await endpointToggle.click();
    await expect(endpointToggle).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async () => {
        try {
          return (
            await store.findNotificationEndpoint({
              orgId: seeded.orgId,
              destination,
              type: "email",
            })
          )?.enabled;
        } catch {
          return undefined;
        }
      })
      .toBe(false);

    await endpointToggle.click();
    await expect(endpointToggle).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => {
        try {
          return (
            await store.findNotificationEndpoint({
              orgId: seeded.orgId,
              destination,
              type: "email",
            })
          )?.enabled;
        } catch {
          return undefined;
        }
      })
      .toBe(true);
  });

  test("removing an email notification endpoint deletes it from the list and backend", async ({
    app,
    auth,
    page,
    pages,
  }) => {
    const store = new KeppoStore(app.runtime.convexUrl, process.env["KEPPO_CONVEX_ADMIN_KEY"]);
    const seeded = await auth.seedWorkspace("notification-endpoint-remove", {
      preferSelectedWorkspace: true,
    });
    const destination = `remove+${app.namespace}@example.com`;

    await pages.login.login();
    await openNotificationSettings({
      page,
      appBaseUrl: app.dashboardBaseUrl,
    });
    await addEmailEndpoint({
      page,
      destination,
    });
    await waitForPersistedEmailEndpoint({
      store,
      page,
      orgId: seeded.orgId,
      destination,
    });

    const endpointCard = getEndpointCard(page, destination);
    await clickElement(endpointCard.getByRole("button", { name: "Remove email endpoint" }));
    await expect(page.getByText(destination, { exact: true })).toHaveCount(0);
    await expect
      .poll(async () => {
        try {
          return await store.findNotificationEndpoint({
            orgId: seeded.orgId,
            destination,
            type: "email",
          });
        } catch {
          return {};
        }
      })
      .toBeNull();
  });
});
