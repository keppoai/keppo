# Control-plane API

The control-plane HTTP surface now runs through the unified TanStack Start runtime in `apps/web`: same-origin `/api/health*`, `/api/invites/*`, `/api/billing/*`, `/api/automations/generate-questions`, `/api/automations/generate-prompt`, `/api/mcp/test`, `/api/oauth/integrations/:provider/connect`, `/oauth/integrations/:provider/callback`, `/webhooks/:provider`, `GET|POST|DELETE /mcp/:workspaceId`, `/internal/cron/maintenance`, `/internal/queue/dispatch-approved-action`, `/internal/health/deep`, `/internal/dlq*`, the full `/internal/automations/*` dispatch/terminate/log/complete family, and `/api/notifications/push/subscribe` routes plus typed app-internal server functions. Shared server helpers live under `apps/web/app/lib/server/api-runtime`; there is no separate first-party HTTP runtime.

## Public routes

| Area                       | Routes                                                                                                                                                                                                                                             |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------- |
| Health                     | `GET /api/health`, `GET /api/version`, `GET /api/health/deep`, `GET /api/health/flags`, `GET /api/health/audit-errors`, `GET /api/health/dlq`, `POST /api/health/dlq/:id/replay`, `POST /api/health/dlq/:id/abandon`, `GET /health`, `GET /health/deep` |
| Billing                    | `POST /api/billing/checkout`, `POST /api/billing/credits/checkout`, `POST /api/billing/portal`, `POST /api/billing/subscription/change`, `GET /api/billing/subscription/pending-change`, `GET /api/billing/usage`, `POST /webhooks/stripe-billing` |
| Invites and notifications  | `POST /api/invites/create`, `POST /api/invites/accept`, `POST /api/notifications/push/subscribe`                                                                                                                                                   |
| Provider auth and webhooks | `POST /api/oauth/integrations/:provider/connect`, `GET /oauth/integrations/:provider/callback`, `POST /webhooks/:provider`                                                                                                                         |
| MCP                        | `GET                                                                                                                                                                                                                                               | POST | DELETE /mcp/:workspaceId` |
| Automations                | `POST /api/automations/generate-questions`, `POST /api/automations/generate-prompt`                                                                                                                         |

## Internal and operator routes

| Area                    | Routes                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Maintenance and queue   | `POST /internal/cron/maintenance`, `POST /internal/queue/dispatch-approved-action`                                                                     |
| Automation runtime      | `POST /internal/automations/dispatch`, `POST /internal/automations/terminate`, `POST /internal/automations/log`, `POST /internal/automations/complete` |
| Notifications           | `POST /internal/notifications/deliver`                                                                                                                 |
| DLQ and operator health | `GET /internal/health/deep`, `GET /internal/dlq`, `POST /internal/dlq/:id/replay`, `POST /internal/dlq/:id/abandon`                                    |

## Auth expectations

- User-facing billing, invite, push-subscribe, question-generation, and prompt-generation routes require an authenticated Better Auth session.
- Automation authoring routes (`POST /api/automations/generate-questions`, `POST /api/automations/generate-prompt`) also require the session member to be an org `owner` or `admin`; same-org `approver` and `viewer` members receive `403 workspace_forbidden` before workspace lookup, AI generation, or credit deduction.
- OAuth connect derives org scope from the authenticated session, not from caller input.
- MCP uses workspace bearer credentials, not user cookies.
- Internal maintenance and queue routes require the internal bearer secret.
- Automation log and completion callbacks are HMAC-signed.
- Provider webhooks are verified by provider-specific webhook hooks.

## Registry and rollout behavior

- Provider IDs must be canonical; aliases such as `gmail` are rejected at route boundaries.
- A global kill switch can disable registry-backed OAuth, webhook, and provider dispatch paths.
- Per-provider rollout flags can disable individual providers without changing route shapes.
- API handlers do not own domain authorization logic; Convex functions/actions enforce authorization and state transitions.
- API handlers use admin-authenticated Convex client calls for internal surfaces.
- API request logging is structured via `apps/web/app/lib/server/api-runtime/logger.ts` (`pino`): each request gets/propagates `X-Request-Id`, request-scoped child loggers are resolved from request metadata inside the Start-owned handlers, and log output is JSON in production (pretty in dev/test/e2e) with sensitive fields redacted.
- API responses include baseline hardening headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), geolocation=(), microphone=()`), and add HSTS only on HTTPS requests.
- API error/event telemetry is captured via `apps/web/app/lib/server/api-runtime/posthog.ts` (`posthog-node`) when `POSTHOG_API_KEY` is configured: unhandled route errors include request/user/workspace context, and key lifecycle analytics events are emitted for OAuth connect/callback, webhook processing, and internal cron execution.
- API boot performs fail-fast environment validation via `apps/web/app/lib/server/api-runtime/env.ts` (Zod-backed schema); strict/prod mode requires core + billing + managed OAuth credentials plus explicit `BETTER_AUTH_SECRET`, while relaxed dev/test/e2e mode may omit provider OAuth credentials but does not derive auth or encryption secrets from `BETTER_AUTH_SECRET`.
- API edge rate-limiting is durable: Start-owned request handlers and MCP auth/request throttles call Convex `rate_limits:checkRateLimit` (table `rate_limits`) so limits persist across API restarts/cold starts.
- `GET /api/health` is the unauthenticated Start-owned same-origin readiness surface for the unified web runtime and returns minimal app metadata (`ok`, `runtime`, `app`).
- `GET /api/version` is a Start-owned authenticated dashboard route that returns a no-store opaque `buildId` token for stale-client detection and reload prompts; anonymous/public routes do not receive deployment metadata.
- `GET /api/health/deep`, `GET /api/health/flags`, `GET /api/health/audit-errors`, and `GET/POST /api/health/dlq*` are Start-owned same-origin admin routes executed directly inside `apps/web`. They resolve Better Auth cookies in-process, enforce the platform-admin or explicit local-bypass gate there, and no longer cross the legacy Hono bridge for dashboard health reads or DLQ actions.
- `POST /api/invites/create`, `POST /api/invites/accept`, `POST /api/billing/*`, `POST /api/automations/generate-questions`, `POST /api/automations/generate-prompt`, `GET|POST /internal/cron/maintenance`, `POST /internal/queue/dispatch-approved-action`, `GET /internal/health/deep`, `POST /internal/notifications/deliver`, `GET /internal/dlq`, `POST /internal/dlq/:id/replay`, `POST /internal/dlq/:id/abandon`, `GET /api/mcp/test`, and `POST /api/notifications/push/subscribe` are Start-owned routes executed directly inside `apps/web` with baseline API hardening headers applied in-process.
- `POST /api/oauth/integrations/:provider/connect` is Start-owned in `apps/web`. It resolves Better Auth session cookies in-process, enforces provider rollout and registry feature flags plus the owner/admin org-integration-management gate there, normalizes `return_to` to safe in-app paths, persists connect state bound to the initiating user, and returns the provider `oauth_start_url`.
- `GET /oauth/integrations/:provider/callback` is Start-owned in `apps/web`. It verifies signed OAuth state, enforces provider rollout and callback idempotency, revalidates that the current session still belongs to the initiating owner/admin for that org-scoped connect state, exchanges provider credentials in-process, persists the resulting org integration, and redirects back into the dashboard.
- `POST /webhooks/:provider` is Start-owned in `apps/web`. It resolves canonical webhook-capable providers in-process, verifies provider signatures before any state mutation, enforces provider rollout and registry feature flags there, records delivery dedupe/automation-trigger fanout, and only returns `200` after matched-org ingestion succeeds so provider retries remain available on ingest failures.
- Provider webhook fanout fails closed when event extraction does not yield a provider-issued external account identifier; unmatched deliveries must not scan or update integrations across tenants.
- Provider event ingestion normalizes webhook-backed deliveries and scheduler-produced polling events into one provider-event envelope before trigger matching, skip-reason persistence, and automation-run queueing.
- Polling trigger reconciliation is provider-agnostic. The node scheduler enumerates every registered polling trigger from provider modules, applies trigger-level scheduling metadata, and runs provider-owned lifecycle hooks instead of hardcoding Gmail-only traversal.
- The current native polling trigger set is Gmail incoming email (`google.gmail.incoming_email`), Reddit inbox mentions and unread inbox messages (`reddit.inbox.mention`, `reddit.inbox.unread_message`), and X mentions (`x.mentions.post`).
- Root-path `/mcp/*`, `/internal/*`, and `/downloads/*` ingress enters the Start runtime directly in hosted/dev builds. Unknown protocol-like paths now fail closed with structured `404 route_not_found` responses instead of forwarding into a second runtime.
- `GET /api/health/deep` is a dashboard-facing platform-admin route that returns per-subsystem status + latency (`convex`, `queue`, `master_key`, `cron`, `dlq`, `rate_limits`, `circuit_breakers`) and returns `503` when any critical subsystem is down. Local development may also access it when `KEPPO_LOCAL_ADMIN_BYPASS=true` and the runtime is genuinely local/loopback.
- Cron-health expectations are environment-aware: hosted preview omits `maintenance-sweep` and `automation-provider-trigger-reconcile` from expected cron health, while non-preview deployments treat missing heartbeat rows for expected jobs as stale once other cron activity shows the deployment has been live beyond that job's stale threshold.
- `GET /internal/health/deep` is the internal-bearer deep-health route. It returns the same detailed subsystem payload as the admin dashboard route and is the only request path that emits PagerDuty incidents for subsystem, cron, and fleet circuit-breaker degradation.
- `GET /api/health/flags` is a dashboard-facing admin session route that returns merged DB/default feature-flag state from Convex for operational visibility.
- `GET /api/health/audit-errors` is a dashboard-facing admin session route that returns the most recent audit events whose `event_type` contains `failed` or `error`, bounded to 50 by default.
- The Convex backing functions for `/api/health/flags` and `/api/health/audit-errors` are internal-only queries invoked by the Start server bridge with Convex admin-key auth. The Start route performs the platform-admin or explicit local-bypass check before calling them, so browser callers never reach those reads without passing the same-origin admin gate.
- `GET /api/health/dlq` + `POST /api/health/dlq/:id/replay|abandon` are dashboard-facing admin session routes (cookie-auth + platform-admin check via `KEPPO_ADMIN_USER_IDS`, or explicit local bypass via `KEPPO_LOCAL_ADMIN_BYPASS=true` on genuinely local/loopback runtime) for DLQ triage tooling.
- When `PAGERDUTY_ROUTING_KEY` is configured, only `GET /internal/health/deep` emits PagerDuty Events API v2 incidents with dedup keys for subsystem outages (`health:subsystem:<name>`), cron jobs with `FAILING` status (`cron:<jobName>`), and fleet-level circuit-breaker degradation (`circuit_breakers:multiple_open` when 2+ provider breakers are open), then auto-resolves when conditions clear.
- OAuth callback handlers persist integration/account/credential state through internal Convex mutations.
- OAuth callback handlers enforce HMAC-signed state integrity, state correlation + expiry checks, and callback idempotency keys.
- OAuth callback handlers fail closed when provider token exchange succeeds but neither the provider token response nor any required provider profile lookup returns a provider-issued external account identifier; API-owned tenant ids are not persisted as webhook-matchable provider account ids.
- OAuth callback and provider webhook handlers share one idempotency utility (`apps/web/app/lib/server/api-runtime/idempotency.ts`) for lock claim, replay wait, release-on-failure, and completion semantics.
- Expired API dedupe rows are cleaned by cron heartbeat job `api-dedupe-expiry-cleanup` (`cron_heartbeats:purgeExpiredApiDedupeKeysWithHeartbeat`) every 15 minutes.
- The production maintenance sweep is driven by Convex cron job `maintenance-sweep` (`cron_heartbeats:scheduledMaintenanceSweepWithHeartbeat`) every 2 minutes; hosted preview intentionally does not register that cron and relies on `POST /internal/cron/maintenance` for explicit operator/test runs there.
- OAuth provider resolution is registry-driven (`providerRegistry.resolveProvider`) with canonical-only enforcement; non-canonical values (for example `gmail`) are rejected with typed `400 non_canonical_provider` payloads.
- OAuth connect/callback boundaries parse params/query/body through shared Zod contracts (`packages/shared/src/providers/boundaries/`) via shared parser helpers, with normalized typed parser failures (`invalid_request`, `invalid_state`, `unsupported_provider`, `non_canonical_provider`).
- Boundary parse failures for OAuth/webhook/internal queue ingress use the shared boundary envelope contract (`boundaryErrorEnvelopeSchema`) so responses include deterministic `error.code`, `error.message`, `error.source`, `error.issues[]`, and optional `error.provider`.
- Route-local JSON decoding should go through the shared JSON helpers before schema validation; API handlers should not rely on `JSON.parse(...) as ...` at the route edge.
- High-risk ingress routes (`/oauth/integrations/*`, `/webhooks/*`, `/mcp/*`, `/internal/*`) enforce request-body caps on actual bytes read, not just declared `Content-Length`, and return `413 payload_too_large` envelopes when limits are exceeded.
- `POST /internal/automations/dispatch` requires both the internal bearer secret and a scheduler-minted single-use `dispatch_token` bound to the requested `automation_run_id`; requests that cannot claim that short-lived token fail closed before any org AI keys are loaded, the claim becomes invalid as soon as the run leaves `pending`, and scheduler retries must reuse the exact in-flight pending-run token instead of overwriting or recomputing it.
- OAuth connect/callback routes run through one canonical provider resolution path (`/oauth/integrations/:provider/*`).
- OAuth connect/callback provider behavior is dispatched through shared provider-module hooks (`buildAuthRequest`, `exchangeCredentials`) in `packages/shared/src/providers.ts`, not API-local provider maps.
- MCP route payloads parse JSON-RPC request envelopes and `tools/call` parameter envelopes through shared contracts before any tool dispatch.
- MCP credential ingress is parse-first for `Authorization` (Bearer token), `:workspaceId` route params, and `Mcp-Session-Id` headers before Convex auth/session lookup.
- MCP JSON-RPC success/error envelopes are emitted through shared response contracts; parse-boundary failures include normalized boundary details in `error.data` (`code`, `message`, `source`, `issues[]`).
- MCP dynamic execution errors are sanitized before returning to clients; secret-pattern matches are replaced with generic fallback text and an internal `ref` identifier.
- Webhook routes are generated from webhook-capable provider modules; webhook payload envelopes are parsed through shared contracts and signature verification/event extraction are delegated to module hooks (`verifyWebhook`, `extractWebhookEvent`) with delivery dedupe enforced at the edge.
- Webhook route responses (success + error) are parse-validated against shared response contracts before returning to clients.
- Missing/malformed webhook signatures return typed `400 invalid_signature_payload` based on shared hook verification reasons.
- Webhook event-extraction failures also fail closed at the API boundary with typed `400 invalid_payload` responses instead of bubbling unhandled exceptions from provider hooks.
- API-to-Convex bridge calls validate Convex action/mutation request and response payloads through shared contracts (`parseConvexPayload`) for MCP dispatch, maintenance ticks, OAuth upserts, and webhook ingestion.
- API-to-Convex bridge calls run through explicit timeout/retry envelopes in `apps/web/app/lib/server/api-runtime/convex.ts`: queries default to `5s`, mutations to `10s`, and actions to `30s`, with exponential backoff on transient timeout/network/Convex availability failures before surfacing the error.
- Start-owned automation internal dispatch/termination routes are protected by internal bearer auth and invoked by Convex scheduler actions.
- Automation prompt + internal dispatch/termination/callback ingress routes normalize payload/runtime failures to typed `error_code` values plus human-readable `error` messages (for example `missing_workspace_id`, `missing_automation_run_id`) so operators can group API failures by machine-stable code.
- Dashboard-facing REST failures should preserve machine-readable structure whenever possible: HTTP status plus typed `error_code`, human-readable `error`, and optional safe metadata or shared error envelopes for richer troubleshooting.
- Shared request-first utilities in `apps/web/app/lib/server/api-runtime` now centralize auth/session parsing, request-id propagation, logging, body parsing, idempotency, and rate-limit helpers for the Start-owned handlers rather than routing through a second app runtime.
- Privileged public routes require authenticated API session identity (`/api/invites/create`, `/api/invites/accept`, `/api/notifications/push/subscribe`, `/api/billing/*`, `/api/automations/generate-questions`, `/api/automations/generate-prompt`, `/api/oauth/integrations/:provider/connect`).
- Public-route error bodies remain sanitized even when authenticated operator routes can include safe technical detail. The dashboard is responsible for mapping public payloads into the shared public-safe error presentation.
- API session identity resolution accepts standard `Cookie` session headers for local dev/E2E and staging/production deployments that proxy Better Auth through the dashboard origin.
- Public route handlers derive trusted `orgId`/`userId` from authenticated session context and reject explicit cross-org/user overrides.
- Provider rollout flags are enforced at the edge using provider module metadata (`featureGate`) via Convex-backed `feature_flags` lookups with env/default fallback when Convex is unreachable.
- Disabled providers return typed `403 provider_disabled` payloads on OAuth/webhook routes.
- A global registry-path kill switch (`KEPPO_FEATURE_PROVIDER_REGISTRY_PATH=false`) fails closed for OAuth/webhook/provider tool dispatch with typed `provider_registry_disabled` responses.
- API records provider observability events (`event_type=provider.metric`) through internal Convex audit mutation calls for:
  - provider resolution failures + explicit unknown/non-canonical rejection counters,
  - OAuth connect/callback attempt/success counters (success-rate denominator + numerator),
  - webhook verification attempt/success/failure counters,
  - MCP capability mismatch blocks.
- Fire-and-forget API side effects (rate-limit audit writes, provider metrics, PagerDuty incident emission) are no longer best-effort drops: after bounded Convex retries they enqueue `dead_letter_queue` rows with `source_table=fire_and_forget` so the maintenance tick can re-drive recovery paths.
- Billing checkout, one-time purchase, portal, and subscription-change endpoints require authenticated session identity, resolve org scope from session, and reject non-`owner`/`admin` org members with `403 forbidden` before creating Stripe sessions or mutating subscription state.
- Recurring billing checkout sessions enable Stripe-hosted promotion-code entry so free-to-paid conversions can apply valid coupon codes directly in Checkout.
- Billing checkout/portal redirect targets (`successUrl`, `cancelUrl`, `returnUrl`) must be same-origin with `KEPPO_DASHBOARD_ORIGIN`; off-origin values are rejected with typed `invalid_redirect_url` errors.
- Billing AI-credit checkout endpoint validates `packageIndex`, resolves org scope from authenticated session, and stamps org/credit metadata for webhook fulfillment.
- Stripe billing webhook endpoint uses `stripe-signature` verification with `STRIPE_BILLING_WEBHOOK_SECRET` before any subscription mutations (falling back to legacy `STRIPE_WEBHOOK_SECRET` only when the split secret is unset).
- Stripe billing webhooks are edge-deduped via API dedupe keys (`scope=webhook_delivery`) so repeated `event.id` deliveries are idempotent.
- Billing webhook lifecycle events (`checkout.session.completed`, `customer.subscription.updated|deleted`, `invoice.payment_failed|paid`) are reconciled into Convex `subscriptions` + `orgs.subscription_tier`.
- Billing webhook `checkout.session.completed` events with credit metadata fulfill one-time AI-credit purchases via `ai_credits:addPurchasedCredits`.
- Billing webhook lifecycle events emit notification events for `subscription_past_due` and `subscription_downgraded`.
- Push subscription route requires authenticated session identity and registers endpoints using session-derived org/user values.
- Automation question-generation and prompt-generation routes require authenticated session identity, reject non-`owner`/`admin` members before workspace lookup, and reject workspace/org mismatches.
- The automation builder now uses a two-call flow:
  - `POST /api/automations/generate-questions` returns up to 4 structured clarification questions using only `radio`, `checkbox`, and single-line `text` inputs, plus explicit billing metadata that states the question stage is free.
  - `POST /api/automations/generate-prompt` accepts the original `user_description` plus optional `clarification_questions[]` and `clarification_answers[]`, deducts the single visible generation credit, and returns the generated draft with `credit_balance` plus explicit draft billing metadata.
- Magic-link auth delivery logging is correlation-based and redacted; raw magic-link URLs are not emitted to logs.
- Internal notification delivery route resolves pending notification events + endpoints, dispatches channel handlers (Mailgun/Web Push), and writes delivery status (`sent`/`pending` retry/`failed`) back to Convex.
- Internal notification delivery route returns retry scheduling hints (`retryJobs[]` with `eventId` + `retryAfterMs`) so `notifications_node:deliverNotificationEvents` can apply per-event exponential backoff with jitter instead of a fixed delay.
- Terminal notification delivery failures are materialized into `dead_letter_queue` rows (`source_table=notification_events`) for replay/abandon workflows.
- Maintenance task failures are recorded to `dead_letter_queue` (`source_table=maintenance_task`) while still preserving fallback completion semantics for the parent maintenance tick.
- Provider runtime `secrets` passed to connector/auth/webhook hooks use an explicit env allowlist (OAuth endpoint/credential vars + provider webhook secrets + fake external base URL), not full `process.env`.

No legacy `/v1/*` routes remain.
