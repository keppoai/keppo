# Stripe Webhook Failures

## Symptoms

- Stripe dashboard shows failed deliveries.
- Billing state in dashboard lags behind Stripe subscription or credit-pack checkout events.
- API logs show `invalid_signature` or webhook processing errors.

## Diagnosis

1. Check Stripe webhook delivery logs for failing event IDs and HTTP status codes.
2. Verify `STRIPE_BILLING_WEBHOOK_SECRET` matches the endpoint secret for `POST /webhooks/stripe-billing`, or `STRIPE_PROVIDER_WEBHOOK_SECRET` matches `POST /webhooks/stripe` when debugging provider-triggered automations. Legacy `STRIPE_WEBHOOK_SECRET` only applies when the split secrets are unset.
3. Confirm API route availability and latency for `POST /webhooks/stripe-billing`.
4. Check whether the failing delivery is a Managed Payments checkout settlement event (`checkout.session.completed`, `checkout.session.async_payment_succeeded`, or `checkout.session.async_payment_failed`) or a downstream subscription/invoice event.
5. Inspect API logs around the failing event ID, checkout session ID, payment intent ID, or subscription ID and the related dedupe key.
6. Validate recent deploys did not change raw request-body handling before signature verification.

## Fix

1. Correct webhook secret mismatch and redeploy if needed.
2. Replay failed Stripe events from Stripe dashboard after secret/route fix.
3. Confirm each replayed event is processed once and reflected in subscription state or purchased-credit grants without double-fulfillment.
4. If failures are payload-specific, patch parser/handler and replay again.

## Prevention

- Rotate and document webhook secrets per environment.
- Keep signature verification fail-closed and preserve raw request body.
- Alert on sustained non-2xx responses for Stripe webhooks.
