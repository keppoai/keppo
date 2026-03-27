import { mkdirSync } from "node:fs";
import type { Locator } from "@playwright/test";
import { KeppoStore } from "@keppo/shared/store";
import { expect, test } from "../fixtures/golden.fixture";
import { createConvexAdmin } from "../helpers/convex-admin";
import { resolveScopedDashboardPath } from "../helpers/dashboard-paths";
import { waitForToolReady } from "../helpers/mcp-client";

const clickElement = async (locator: Locator): Promise<void> => {
  await locator.evaluate((element) => (element as HTMLElement).click());
};

test("notification bell shows unread and click-through navigates to approvals", async ({
  app,
  auth,
  page,
  pages,
  provider,
}) => {
  test.slow();
  await pages.login.login();
  const seeded = await auth.seedWorkspaceWithProvider("notifications-ui", "google", undefined, {
    preferSelectedWorkspace: true,
  });
  await auth.setToolAutoApproval(seeded.workspaceId, "gmail.sendEmail", false);

  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);

  try {
    await mcp.initialize();
    await waitForToolReady(mcp, {
      toolName: "gmail.listUnread",
      args: { limit: 1 },
    });
    await mcp.callTool("gmail.sendEmail", {
      to: ["customer@example.com"],
      subject: "Needs approval",
      body: "Notification check",
    });

    await page.goto(
      new URL(await resolveScopedDashboardPath(page, "/"), app.dashboardBaseUrl).toString(),
    );

    const bell = page.getByRole("button", {
      name: "Notifications",
      exact: true,
    });
    await expect(bell).toBeVisible();
    await expect
      .poll(async () => {
        const title = await page.title();
        return /^\(\d+\+?\)\s/.test(title);
      })
      .toBe(true);

    await clickElement(bell);
    await expect(page.getByTestId("notification-panel")).toBeVisible();
    await clickElement(
      page.locator(
        '[data-testid="notification-item"][data-notification-event-type="approval_needed"]',
      ),
    );
    await expect(page).toHaveURL(/\/approvals$/);
  } finally {
    await mcp.close();
  }
});

test("mark all read clears unread title and favicon badge", async ({
  app,
  auth,
  page,
  pages,
  provider,
}) => {
  test.slow();
  await pages.login.login();
  const seeded = await auth.seedWorkspaceWithProvider(
    "notifications-mark-all",
    "google",
    undefined,
    {
      preferSelectedWorkspace: true,
    },
  );
  await auth.setToolAutoApproval(seeded.workspaceId, "gmail.sendEmail", false);

  const mcp = provider.createMcpClient(seeded.workspaceId, seeded.credentialSecret);

  try {
    await mcp.initialize();
    await waitForToolReady(mcp, {
      toolName: "gmail.listUnread",
      args: { limit: 1 },
    });
    await mcp.callTool("gmail.sendEmail", {
      to: ["customer@example.com"],
      subject: "Needs approval 1",
      body: "Notification check one",
    });
    await mcp.callTool("gmail.sendEmail", {
      to: ["customer@example.com"],
      subject: "Needs approval 2",
      body: "Notification check two",
    });

    await page.goto(
      new URL(await resolveScopedDashboardPath(page, "/"), app.dashboardBaseUrl).toString(),
    );

    await expect
      .poll(async () => {
        const title = await page.title();
        return /^\(\d+\+?\)\s/.test(title);
      })
      .toBe(true);
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return (document.querySelector("link[rel='icon']") as HTMLLinkElement | null)?.href;
        });
      })
      .toContain("data:image/png");

    await clickElement(page.getByRole("button", { name: "Notifications", exact: true }));
    const markAllReadButton = page.getByRole("button", {
      name: "Mark all read",
    });
    await expect(markAllReadButton).toBeEnabled();
    await clickElement(markAllReadButton);

    await expect
      .poll(async () => {
        const title = await page.title();
        return /^\(\d+\+?\)\s/.test(title);
      })
      .toBe(false);
    await expect
      .poll(async () => {
        return page.evaluate(() => {
          return (document.querySelector("link[rel='icon']") as HTMLLinkElement | null)?.href;
        });
      })
      .not.toContain("data:image/png");
  } finally {
    await mcp.close();
  }
});

test("notification preferences render on settings page", async ({ app, pages, page }) => {
  await pages.login.login();
  await page.goto(
    new URL(await resolveScopedDashboardPath(page, "/settings"), app.dashboardBaseUrl).toString(),
  );

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await clickElement(page.getByRole("tab", { name: "Notifications" }));
  await expect(
    page.getByText("Manage email and push notification delivery preferences."),
  ).toBeVisible();
  await expect(page.getByText("Email endpoints", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /Enable push notifications|Disable push/i,
    }),
  ).toBeVisible();
});

test("notification preferences warn when an endpoint has repeated delivery failures", async ({
  app,
  auth,
  page,
  pages,
}) => {
  mkdirSync("ux-artifacts", { recursive: true });
  const admin = createConvexAdmin(app);
  const store = new KeppoStore(app.runtime.convexUrl, process.env.KEPPO_CONVEX_ADMIN_KEY);
  const seeded = await auth.seedWorkspace("notifications-delivery-warning", {
    preferSelectedWorkspace: true,
  });
  const destination = `ops+${app.namespace}@example.com`;

  await pages.login.login();
  await page.goto(
    new URL(await resolveScopedDashboardPath(page, "/settings"), app.dashboardBaseUrl).toString(),
  );
  await clickElement(page.getByRole("tab", { name: "Notifications" }));
  await page.getByPlaceholder("name@example.com").fill(destination);
  await clickElement(page.getByRole("button", { name: "Add email" }));
  await expect(page.getByText(destination)).toBeVisible();

  await expect
    .poll(async () => {
      return (
        await store.findNotificationEndpoint({
          orgId: seeded.orgId,
          destination,
          type: "email",
        })
      )?.id;
    })
    .toBeTruthy();

  const endpoint = await store.findNotificationEndpoint({
    orgId: seeded.orgId,
    destination,
    type: "email",
  });
  expect(endpoint?.id).toBeTruthy();

  const firstFailure = await admin.createNotificationEvent({
    orgId: seeded.orgId,
    eventType: "approval_needed",
    channel: "email",
    title: "Approval required",
    body: "Delivery warning attempt one",
    ctaUrl: "/approvals",
    ctaLabel: "Review approvals",
    endpointId: endpoint!.id,
  });
  await admin.markNotificationEventFailed(firstFailure.id, "smtp mailbox rejected recipient");

  const secondFailure = await admin.createNotificationEvent({
    orgId: seeded.orgId,
    eventType: "approval_needed",
    channel: "email",
    title: "Approval required",
    body: "Delivery warning attempt two",
    ctaUrl: "/approvals",
    ctaLabel: "Review approvals",
    endpointId: endpoint!.id,
  });
  await admin.markNotificationEventFailed(secondFailure.id, "smtp mailbox rejected recipient");

  await expect(page.getByText("Recent delivery failures", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Last failure: smtp mailbox rejected recipient")).toBeVisible({
    timeout: 10_000,
  });

  await page.screenshot({
    path: "ux-artifacts/notification-delivery-warning.png",
    fullPage: true,
  });
});

test("push subscribe and unsubscribe flow registers endpoint", async ({
  app,
  pages,
  page,
  auth,
}) => {
  const store = new KeppoStore(app.runtime.convexUrl, process.env.KEPPO_CONVEX_ADMIN_KEY);
  await page.addInitScript(() => {
    let currentSubscription: {
      endpoint: string;
      toJSON: () => {
        endpoint: string;
        expirationTime: null;
        keys: {
          p256dh: string;
          auth: string;
        };
      };
      unsubscribe: () => Promise<boolean>;
    } | null = null;

    const fakeSubscription = {
      endpoint: "https://push.example.test/subscription",
      toJSON() {
        return {
          endpoint: "https://push.example.test/subscription",
          expirationTime: null,
          keys: {
            p256dh: "fake-p256dh",
            auth: "fake-auth",
          },
        };
      },
      unsubscribe: async () => {
        currentSubscription = null;
        return true;
      },
    };

    const pushManager = {
      getSubscription: async () => currentSubscription,
      subscribe: async () => {
        currentSubscription = fakeSubscription;
        return fakeSubscription;
      },
    };

    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: function PushManager() {},
    });

    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "granted",
        requestPermission: async () => "granted",
      },
    });

    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: async () => ({ pushManager }),
        getRegistration: async () => ({
          pushManager,
        }),
      },
    });
  });

  await pages.login.login();
  const seeded = await auth.seedWorkspace("notifications-push", {
    preferSelectedWorkspace: true,
  });

  await page.goto(
    new URL(await resolveScopedDashboardPath(page, "/settings"), app.dashboardBaseUrl).toString(),
  );
  await clickElement(page.getByRole("tab", { name: "Notifications" }));
  await expect(page.getByText("Push notifications", { exact: true })).toBeVisible();
  const pushButton = page.getByRole("button", {
    name: /Enable push notifications/i,
  });
  await clickElement(pushButton);
  await expect
    .poll(async () => {
      return await store.findNotificationEndpoint({
        orgId: seeded.orgId,
        type: "push",
        destination: "https://push.example.test/subscription",
      });
    })
    .toMatchObject({
      enabled: true,
      destination: "https://push.example.test/subscription",
      type: "push",
    });
  await expect(page.getByRole("button", { name: /Disable push/i })).toBeVisible();

  await clickElement(page.getByRole("button", { name: /Disable push/i }));
  await expect(page.getByRole("button", { name: /Enable push notifications/i })).toBeVisible();
  await expect
    .poll(async () => {
      return (
        await store.findNotificationEndpoint({
          orgId: seeded.orgId,
          type: "push",
          destination: "https://push.example.test/subscription",
        })
      )?.enabled;
    })
    .toBe(false);
});

test("push subscribe failure renders inline guidance and copyable technical details", async ({
  app,
  pages,
  page,
  auth,
}) => {
  await page.addInitScript(() => {
    const pushManager = {
      getSubscription: async () => null,
      subscribe: async () => {
        throw new Error(
          "Push gateway rejected the subscription handshake after policy validation.",
        );
      },
    };

    Object.defineProperty(window, "PushManager", {
      configurable: true,
      value: function PushManager() {},
    });

    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: {
        permission: "granted",
        requestPermission: async () => "granted",
      },
    });

    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: {
        register: async () => ({ pushManager }),
        getRegistration: async () => ({
          pushManager: {
            getSubscription: async () => ({
              unsubscribe: async () => true,
            }),
          },
        }),
      },
    });
  });

  await pages.login.login();
  await auth.seedWorkspace("notifications-push-error", {
    preferSelectedWorkspace: true,
  });

  await page.goto(
    new URL(await resolveScopedDashboardPath(page, "/settings"), app.dashboardBaseUrl).toString(),
  );
  await clickElement(page.getByRole("tab", { name: "Notifications" }));
  await expect(page.getByText("Push notifications", { exact: true })).toBeVisible();
  await clickElement(page.getByRole("button", { name: /Enable push notifications/i }));

  const errorAlert = page.getByRole("alert").filter({ hasText: "Push notification setup failed" });
  await expect(errorAlert).toBeVisible();
  await expect(
    errorAlert.getByText("Confirm browser notification permission and retry."),
  ).toBeVisible();
  await expect(
    errorAlert.getByText(/Push gateway rejected the subscription handshake/i),
  ).toHaveCount(0);
  await clickElement(errorAlert.getByRole("button", { name: "Technical details" }));
  await expect(
    errorAlert.getByText(
      "message: Push gateway rejected the subscription handshake after policy validation.",
    ),
  ).toBeVisible();
  await expect(errorAlert.getByRole("button", { name: "Copy error details" })).toBeVisible();
});
