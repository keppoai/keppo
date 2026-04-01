# Stripe Provider Integration

## Environment variables

| Variable | Usage | Description |
| --- | --- | --- |
| `STRIPE_CLIENT_ID` | server | Stripe OAuth client ID. Required in strict/prod. |
| `STRIPE_SECRET_KEY` | server | Server-side key for Checkout/Portal/Webhooks. Required in strict/prod. |
| `STRIPE_PROVIDER_WEBHOOK_SECRET` | server | Webhook verification for `/webhooks/stripe` provider events |
| `STRIPE_BILLING_WEBHOOK_SECRET` | server | Webhook verification for `/webhooks/stripe-billing` billing events |
| `STRIPE_WEBHOOK_SECRET` | server | Legacy fallback for both webhook routes. Prefer split secrets above. |
| `STRIPE_STARTER_PRICE_ID` | server | Monthly Starter subscription price ID |
| `STRIPE_PRO_PRICE_ID` | server | Monthly Pro subscription price ID |
| `STRIPE_CREDIT_PRODUCT_ID` | server | One-time AI credit checkout product ID |
| `STRIPE_REDIRECT_URI` | server | OAuth callback URL. Derived when unset. |
| `STRIPE_OAUTH_AUTH_URL` | server | Optional auth endpoint override |
| `STRIPE_OAUTH_TOKEN_URL` | server | Optional token endpoint override |
| `STRIPE_API_BASE_URL` | server | Optional API base override |
| `KEPPO_FEATURE_INTEGRATIONS_STRIPE_FULL` | server | Rollout flag. Default `true`. Set `false` to disable. |

Subscription checkout and one-time credit-pack checkout require Stripe Managed Payments to be enabled in your Stripe account. Keppo creates Checkout Sessions with `managed_payments[enabled]=true` and sends `Stripe-Version: 2026-03-04.preview` (Stripe’s current [public preview](https://docs.stripe.com/sdks/versioning) channel for Managed Payments; see [update Checkout for Managed Payments](https://docs.stripe.com/payments/managed-payments/update-checkout)).

## Integration connect callback

The provider integration OAuth callback is:

```
${KEPPO_API_INTERNAL_BASE_URL}/oauth/integrations/stripe/callback
```

This is derived automatically when `STRIPE_REDIRECT_URI` is unset.

## Webhook setup

Register two webhook endpoints in your Stripe dashboard:

1. **Provider events** — `https://<your-domain>/webhooks/stripe` using `STRIPE_PROVIDER_WEBHOOK_SECRET`
2. **Billing events** — `https://<your-domain>/webhooks/stripe-billing` using `STRIPE_BILLING_WEBHOOK_SECRET`

Billing webhooks should include the Managed Payments checkout events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed` in addition to the usual subscription and invoice events. When using in-dashboard plan changes that schedule downgrades via Stripe Subscription Schedules, also send `subscription_schedule.updated` so Keppo can record `billing.subscription_schedule_updated` audit events.

For new deployments, always use the split secrets. The legacy `STRIPE_WEBHOOK_SECRET` is a fallback only.

## Operator controls

Integration metadata key `allowed_write_modes` (string array) limits write actions to specific modes. The dashboard renders these as checkboxes with **Select all** and **Select none** actions.

Supported write modes:

- `refund` — issue, cancel, or update refunds
- `cancel_subscription` — cancel subscriptions
- `adjust_balance` — adjust customer balance
- `update_customer` — update customer details, manage tax IDs, delete discounts
- `update_subscription` — update subscriptions, manage subscription items/schedules, delete discounts
- `resume_subscription` — resume paused subscriptions
- `invoice_actions` — send/void/pay/finalize invoices, create coupons/promotions/checkout sessions/setup intents, update charges
- `credit_notes` — create or void credit notes
- `disputes` — update or close disputes
- `portal_session` — create portal sessions
- `payment_methods` — detach payment methods
- `invoice_items` — create or delete invoice items

**Semantics:**

- **Unset / missing key** — all write modes are allowed (default for new integrations).
- **Explicit empty array `[]`** — all write modes are blocked (no Stripe writes permitted).
- **Non-empty array** — only the listed modes are allowed; unlisted modes are blocked.
