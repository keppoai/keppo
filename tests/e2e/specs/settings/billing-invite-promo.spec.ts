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

test("billing page redeems paid invite promos and hides Stripe-only controls", async ({
  app,
  auth,
  page,
  pages,
}) => {
  test.slow();
  await createInviteCodeForTesting({
    convexUrl: app.runtime.convexUrl,
    code: "PRO222",
    label: "Billing Promo",
    grantTier: "pro",
  });
  await auth.seedWorkspace("billing-invite-promo", {
    subscriptionTier: "free",
  });
  await installStripeCheckoutPage(page);
  await installLocationAssignSpy(page);
  await installBillingSubscriptionPendingMock(page);
  await pages.login.login();

  const billingUrl = new URL(
    await resolveScopedDashboardPath(page, "/billing"),
    app.dashboardBaseUrl,
  ).toString();
  await gotoWithNavigationRetry(page, billingUrl);
  await expect(page.getByTestId("billing-redeem-invite-code-input")).toBeVisible();
  await page.getByTestId("billing-redeem-invite-code-input").fill("PRO222");
  await clickElement(page.getByTestId("billing-redeem-invite-code-submit"));

  const promoBanner = page.getByTestId("billing-invite-promo-banner");
  await expect(promoBanner).toContainText("Code PRO222");
  await expect(promoBanner).toContainText("is unlocked until");
  await expect(page.getByTestId("billing-tier-label")).toHaveText("Pro");
  await expect(page.getByTestId("billing-current-plan-ai-credits-summary")).toContainText(
    "bundled AI credits",
  );
  await expect(page.getByTestId("billing-change-plan")).toHaveCount(0);
  await expect(page.getByTestId("billing-manage-subscription")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start Starter subscription" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start Pro subscription" })).toBeVisible();
  await page.screenshot({
    path: "ux-artifacts/billing-invite-promo-active.png",
    fullPage: true,
  });
});
