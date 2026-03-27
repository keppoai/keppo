import { createHmac } from "node:crypto";
import { test, expect } from "../../fixtures/golden.fixture";

const signStripeProviderPayload = (rawBody: string): string => {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const secret =
    process.env.STRIPE_PROVIDER_WEBHOOK_SECRET ??
    process.env.STRIPE_WEBHOOK_SECRET ??
    "whsec_e2e_billing";
  const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return `t=${timestamp},v1=${signature}`;
};

test("start-owned stripe webhooks run on the unified web runtime", async ({ app, request }) => {
  const eventId = `evt_start_owned_webhook_${app.namespace}`;
  const rawBody = JSON.stringify({
    id: eventId,
    type: "invoice.payment_succeeded",
    account: "acct_test",
  });

  const first = await request.fetch(`${app.dashboardBaseUrl}/webhooks/stripe`, {
    method: "POST",
    headers: {
      ...app.headers,
      "content-type": "application/json",
      "stripe-signature": signStripeProviderPayload(rawBody),
    },
    data: rawBody,
  });

  expect(first.status()).toBe(200);
  await expect(first.json()).resolves.toMatchObject({
    received: true,
    provider: "stripe",
    duplicate: false,
  });

  const duplicate = await request.fetch(`${app.dashboardBaseUrl}/webhooks/stripe`, {
    method: "POST",
    headers: {
      ...app.headers,
      "content-type": "application/json",
      "stripe-signature": signStripeProviderPayload(rawBody),
    },
    data: rawBody,
  });

  expect(duplicate.status()).toBe(200);
  await expect(duplicate.json()).resolves.toMatchObject({
    received: true,
    provider: "stripe",
    duplicate: true,
  });
});
