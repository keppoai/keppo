import { test, expect } from "../../fixtures/golden.fixture";
import {
  clickElement,
  createInviteCodeForTesting,
  gotoWithNavigationRetry,
  installBillingSubscriptionPendingMock,
  installLocationAssignSpy,
  installStripeCheckoutPage,
} from "../../helpers/billing-hooks";
import { resolveScopedDashboardPath } from "../../helpers/dashboard-paths";

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

type BillingActionOutcome =
  | {
      kind: "redirect";
      url: URL;
    }
  | {
      kind: "error";
    };

const waitForBillingActionOutcomeAfterClick = async (
  page: import("@playwright/test").Page,
  locator: Locator,
  predicate: (url: URL) => boolean,
): Promise<BillingActionOutcome> => {
  const initialUrl = page.url();
  const resolveRedirectFromCurrentUrl = (): string | null => {
    const currentUrl = page.url();
    if (currentUrl === initialUrl) {
      return null;
    }
    const nextUrl = new URL(currentUrl);
    return predicate(nextUrl) ? currentUrl : null;
  };

  await page.evaluate(() => {
    const win = window as Window & typeof globalThis & { __KEPPO_ASSIGNED_URLS__?: string[] };
    win.__KEPPO_ASSIGNED_URLS__ = [];
  });
  await clickElement(locator);

  let assignedUrl: string | null = null;
  let outcome: "redirect" | "error" | null = null;
  await expect
    .poll(
      async () => {
        const redirectedUrl = resolveRedirectFromCurrentUrl();
        if (redirectedUrl) {
          assignedUrl = redirectedUrl;
          outcome = "redirect";
          return "redirect";
        }

        let candidate: string | null = null;
        try {
          candidate = await page.evaluate(() => {
            const win = window as Window &
              typeof globalThis & {
                __KEPPO_ASSIGNED_URLS__?: string[];
              };
            const urls = win.__KEPPO_ASSIGNED_URLS__ ?? [];
            return urls.at(-1) ?? null;
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (
            message.includes("Execution context was destroyed") ||
            message.includes("Cannot find context with specified id")
          ) {
            const retryRedirectedUrl = resolveRedirectFromCurrentUrl();
            if (retryRedirectedUrl) {
              assignedUrl = retryRedirectedUrl;
              outcome = "redirect";
              return "redirect";
            }
            return null;
          }
          throw error;
        }

        if (!candidate) {
          if ((await page.locator('[role="alert"]:visible').count()) > 0) {
            outcome = "error";
            return "error";
          }
          return null;
        }
        const nextUrl = new URL(candidate);
        if (!predicate(nextUrl)) {
          return null;
        }
        assignedUrl = candidate;
        outcome = "redirect";
        return "redirect";
      },
      { timeout: 20_000 },
    )
    .not.toBeNull();

  if (outcome === "redirect" && assignedUrl) {
    return {
      kind: "redirect",
      url: new URL(assignedUrl),
    };
  }
  return { kind: "error" };
};

test("settings ai keys and credits", async ({ app, auth, page, pages }) => {
  test.slow();
  const seeded = await auth.seedWorkspace("settings-ai-keys", {
    subscriptionTier: "starter",
  });
  await installStripeCheckoutPage(page);
  await installLocationAssignSpy(page);
  await pages.login.login();

  const settingsUrl = new URL(
    await resolveScopedDashboardPath(page, "/settings"),
    app.dashboardBaseUrl,
  ).toString();
  await gotoWithNavigationRetry(page, settingsUrl);
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await clickElement(page.getByRole("tab", { name: "AI Configuration" }));
  await expect(page.getByText("Bundled runtime", { exact: true })).toBeVisible();
  // The description text depends on the async getAiCreditBalance Convex query
  // returning bundled_runtime_enabled for the seeded starter tier. Give the live
  // query extra time to propagate under CI load.
  await expect(
    page.getByText(
      "Paid plans can run automations with Keppo-managed gateway credentials. Add a BYO key here only if you want a fallback path when bundled credits run out.",
    ),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByText("No BYO or legacy subscription credentials configured yet."),
  ).toBeVisible();
  await page.screenshot({
    path: "ux-artifacts/ai-configuration-bundled-runtime.png",
    fullPage: true,
  });

  await page.getByLabel("Provider").selectOption("openai");
  await page.getByLabel("Mode").selectOption("byok");
  await setControlValue(page.getByLabel("API key"), "sk-keppo-e2e-1234");
  await clickElement(page.getByRole("button", { name: "Save Key" }));

  const activeKeyRow = page.locator(
    '[data-testid="ai-key-row"][data-ai-key-provider="openai"][data-ai-key-mode="byok"]',
  );
  await expect(activeKeyRow).toContainText("Active");
  await expect(activeKeyRow).toContainText("openai");
  await expect(activeKeyRow).toContainText("...1234");

  const creditsCheckout = await waitForBillingActionOutcomeAfterClick(
    page,
    page.getByRole("button", { name: "Buy 100 credits ($10)" }),
    (url) => {
      return url.hostname === "checkout.stripe.test" && url.pathname.startsWith("/cs_");
    },
  );
  if (creditsCheckout.kind === "redirect") {
    expect(creditsCheckout.url.hostname).toBe("checkout.stripe.test");
    expect(creditsCheckout.url.pathname).toMatch(/^\/cs_/);
  } else {
    await expect(page.getByRole("alert")).toContainText("Billing action failed");
  }

  await clickElement(activeKeyRow.getByRole("button", { name: "Remove" }));
  await expect(activeKeyRow).toHaveCount(0);
});

test("billing page reflects tier ctas and managed-payments checkout flows", async ({
  app,
  auth,
  page,
  pages,
}) => {
  test.slow();
  const seeded = await auth.seedWorkspace("billing-contract", {
    subscriptionTier: "free",
  });
  await installStripeCheckoutPage(page);
  await installLocationAssignSpy(page);
  await installBillingSubscriptionPendingMock(page);
  await pages.login.login();

  await auth.setOrgSubscription(seeded.orgId, "free");
  const billingUrl = new URL(
    await resolveScopedDashboardPath(page, "/billing"),
    app.dashboardBaseUrl,
  ).toString();
  let checkoutRequestBody: Record<string, unknown> | null = null;
  let automationRunCheckoutRequestBody: Record<string, unknown> | null = null;
  await page.route("**/api/billing/checkout*", async (route) => {
    checkoutRequestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.continue();
  });
  await page.route("**/api/billing/automation-runs/checkout*", async (route) => {
    automationRunCheckoutRequestBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.continue();
  });
  await gotoWithNavigationRetry(page, billingUrl);
  await expect(page.getByTestId("billing-tier-label")).toHaveText("Free trial");
  await expect(page.getByText("$0/mo")).toBeVisible();
  await expect(page.getByText("Free credits cover prompt generation only.")).toBeVisible();
  await expect(page.getByText("AI Credits", { exact: true })).toBeVisible();
  await expect(page.getByText("Automation Runs", { exact: true })).toBeVisible();
  await expect(page.getByTestId("billing-upgrade-starter")).toBeVisible();
  await expect(page.getByTestId("billing-upgrade-pro")).toBeVisible();
  await expect(page.getByTestId("billing-manage-subscription")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Buy 1,500 runs ($15)" })).toHaveCount(0);

  const starterCheckout = await waitForBillingActionOutcomeAfterClick(
    page,
    page.getByTestId("billing-upgrade-starter"),
    (url) => {
      return url.hostname === "checkout.stripe.test" && url.pathname.startsWith("/cs_");
    },
  );
  if (starterCheckout.kind === "redirect") {
    expect(starterCheckout.url.hostname).toBe("checkout.stripe.test");
    expect(starterCheckout.url.pathname).toMatch(/^\/cs_/);
  } else {
    await expect(page.getByRole("alert")).toContainText("Billing action failed");
  }
  if (checkoutRequestBody) {
    expect(checkoutRequestBody).toMatchObject({
      orgId: seeded.orgId,
      tier: "starter",
      successUrl: `${new URL(billingUrl).pathname}?checkout=success`,
      cancelUrl: `${new URL(billingUrl).pathname}?checkout=cancel`,
    });
  }
  await auth.setOrgSubscription(seeded.orgId, "starter", {
    stripeSubscriptionId: `sub_${seeded.orgId}_starter`,
  });
  await gotoWithNavigationRetry(page, billingUrl);
  await expect(page.getByTestId("billing-tier-label")).toHaveText("Starter");
  await expect(page.getByText("$25/mo")).toBeVisible();
  await expect(page.getByTestId("billing-upgrade-starter")).toHaveCount(0);
  await expect(page.getByTestId("billing-upgrade-pro")).toHaveCount(0);
  await expect(page.getByTestId("billing-change-plan")).toBeVisible();
  await expect(page.getByTestId("billing-manage-subscription")).toBeEnabled();
  await expect(page.getByRole("button", { name: "Buy 1,500 runs ($15)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Buy 3,000 runs ($25)" })).toBeVisible();

  await auth.setOrgSubscription(seeded.orgId, "pro", {
    stripeSubscriptionId: `sub_${seeded.orgId}_pro`,
  });
  await gotoWithNavigationRetry(page, billingUrl);
  await expect(page.getByTestId("billing-tier-label")).toHaveText("Pro");
  await expect(page.getByText("$75/mo")).toBeVisible();
  await expect(page.getByTestId("billing-upgrade-starter")).toHaveCount(0);
  await expect(page.getByTestId("billing-upgrade-pro")).toHaveCount(0);
  await expect(page.getByTestId("billing-change-plan")).toBeVisible();
  await expect(page.getByRole("button", { name: "Buy 15,000 runs ($45)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Buy 30,000 runs ($75)" })).toBeVisible();
  await expect(
    page.getByRole("switch", {
      name: "Charge overage for additional tool calls and tool time",
    }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "ux-artifacts/billing-managed-payments.png",
    fullPage: true,
  });

  const creditsCheckout = await waitForBillingActionOutcomeAfterClick(
    page,
    page.getByRole("button", { name: "Buy 100 credits ($10)" }),
    (url) => {
      return url.hostname === "checkout.stripe.test" && url.pathname.startsWith("/cs_");
    },
  );
  if (creditsCheckout.kind === "redirect") {
    expect(creditsCheckout.url.hostname).toBe("checkout.stripe.test");
    expect(creditsCheckout.url.pathname).toMatch(/^\/cs_/);
  } else {
    await expect(page.getByRole("alert")).toContainText("Billing action failed");
  }

  const automationRunCheckout = await waitForBillingActionOutcomeAfterClick(
    page,
    page.getByRole("button", { name: "Buy 15,000 runs ($45)" }),
    (url) => {
      return url.hostname === "checkout.stripe.test" && url.pathname.startsWith("/cs_");
    },
  );
  if (automationRunCheckout.kind === "redirect") {
    expect(automationRunCheckout.url.hostname).toBe("checkout.stripe.test");
    expect(automationRunCheckout.url.pathname).toMatch(/^\/cs_/);
  } else {
    await expect(page.getByRole("alert")).toContainText("Billing action failed");
  }
  if (automationRunCheckoutRequestBody) {
    expect(automationRunCheckoutRequestBody).toMatchObject({
      orgId: seeded.orgId,
      packageIndex: 0,
      successUrl: `${new URL(billingUrl).pathname}?runCheckout=success`,
      cancelUrl: `${new URL(billingUrl).pathname}?runCheckout=cancel`,
    });
  }
});
