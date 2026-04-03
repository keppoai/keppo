# Billing and Subscription Rules

## Source of truth

- Tier limits and recurring plan prices live in `packages/shared/src/subscriptions.ts`.
- Automation limits, AI-credit allowances, and automation run top-up packages live in `packages/shared/src/automations.ts`.
- Paid expansion beyond bundled allowances happens through one-time AI credit packs and paid-tier automation run top-ups, not metered overage billing.
- Do not duplicate those constants in Convex, API, or dashboard code.

## Billing ingress

- Validate `successUrl`, `cancelUrl`, and `returnUrl` against `KEPPO_DASHBOARD_ORIGIN` before calling Stripe.
- Stripe webhook handlers must verify signatures before mutating subscription, AI credit, or automation run top-up state.
- Billing webhooks and one-time purchase fulfillment must be idempotent.
- Stripe subscription webhooks must fail closed when the recurring subscription price ID is missing or does not map to a configured paid tier; never substitute `free` for an unknown Stripe plan.
- Stripe subscription period persistence and Stripe-driven plan-change mutations must read still-supported Stripe period fields. For managed-payments subscriptions, use subscription-level periods only when both timestamps are present; otherwise prefer a complete subscription-item period and fail closed instead of substituting `Date.now()` when timestamps are missing.
- Operators should monitor the `billing.webhook.subscription_period_missing` log key. Repeated occurrences mean Stripe retries will stay stuck until the payload contract or webhook handling is corrected.
- Reject malformed Stripe metadata before mutating AI credit or automation run top-up state; never write `NaN`, zero, or invalid tier values into billing records.
- Existing paid orgs may change plans in-app via `POST /api/billing/subscription/change` (upgrades use `subscriptions.update` with prorations; paid-to-paid downgrades use Subscription Schedules from the current period end; cancel-to-free uses `cancel_at_period_end`). First-time free→paid remains Stripe Checkout.
- Invite promo billing is a separate non-Stripe source of temporary paid access: treat it as `billing_source="invite_promo"`, keep Stripe portal/native plan-change flows disabled, and leave recurring checkout available so the org can convert to Stripe explicitly.
- `subscriptions.invite_code_id` is historical invite attribution only. Time-bounded paid invite promos must live in `invite_code_redemptions` and must expire or convert independently of the subscription row's invite marker.
- Billing portal access plus every Stripe session creation route (`/api/billing/checkout`, `/api/billing/credits/checkout`, `/api/billing/automation-runs/checkout`, and `/api/billing/subscription/change`) must be restricted to org `owner` or `admin` roles server-side, even when the UI hides those controls for lower-privilege members.

## Usage enforcement

- Quota and suspension checks must happen before provider execution.
- Tool usage finalization must record runtime even on failures and timeouts.
- Automation sandbox dispatch must derive its runtime timeout from the org tier's `automation_limits.max_run_duration_ms` when a subscription tier is available; `KEPPO_AUTOMATION_DEFAULT_TIMEOUT_MS` is a fallback for contexts that do not resolve a tier and must not silently undercut paid-tier entitlements.
- Usage-threshold notifications should be emitted from canonical usage-meter state, not guessed in the UI.
- Automation run top-ups extend the effective run, tool-call, and total tool-time limits for paid tiers only. Run and tool-call deductions consume the oldest active purchased package first; purchased tool time is additive for the active package lifetime and disappears on expiry.
- Normal top-up reads should use the cached org-level ledger; reserve per-purchase scans for write-side recomputation or missing-ledger fallback paths.

## Credits and seats

- Included AI credits use one org-level ledger for prompt generation and bundled automation runtime.
- Free-trial included credits are a one-time org-level grant that can fund both prompt generation and bundled automation runtime when hosted bundled runtime is enabled; self-managed deployments still require provider credentials for runtime.
- Deduct included credits first, then the oldest active purchased credits.
- Purchased credit fulfillment must map a completed Stripe event to exactly one credit grant.
- Automation run top-ups use a separate org-level ledger plus per-purchase records with a 90-day expiry.
- Expiry and expiring-notification jobs must bound their expiry-window scans and deduplicate delivery per org/window.
- Starter automation run packages are `1,500 runs / 75,000 tool calls / 7,200,000 ms` for `$15` and `3,000 runs / 150,000 tool calls / 14,400,000 ms` for `$25`.
- Pro automation run packages are `15,000 runs / 750,000 tool calls / 18,000,000 ms` for `$45` and `30,000 runs / 1,500,000 tool calls / 36,000,000 ms` for `$75`.
- Seat limits must include pending invites as well as active members.

## Current tiers

- The shipped subscription tiers are `free`, `starter`, and `pro`.
- `starter` is `$25/month` with `100` bundled AI credits per billing cycle.
- `pro` is `$75/month` with `300` bundled AI credits per billing cycle.
- `free` is labeled `Free trial` and grants a one-time `20` AI credits for newly created orgs; in hosted bundled mode those credits can fund both prompt generation and automation runtime, while existing free orgs may still carry legacy monthly credit rows until migrated separately.
- Base monthly tool-call allowances track `50x` the run budget: free `7,500`, starter `75,000`, pro `750,000`.
