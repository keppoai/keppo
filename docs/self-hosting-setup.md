# Self-Hosting Setup

Deployment, runtime env, auth, and operator onboarding for self-hosted or hosted Keppo environments. For local contributor setup, verification, and repo-maintainer workflow prerequisites, see [Development Setup](dev-setup.md).

Bootstrap shared defaults from [`.env.example`](../.env.example) into your deployment env files or secret manager, then set unique secrets per environment.

## Deployment model

- The default runtime shape is one unified web project rooted at `apps/web`, backed by a Convex deployment.
- `cloud/` is a normal workspace package that holds the canonical billing, scheduler, advanced gating, and Vercel sandbox runtime modules.
- The unified web deployment owns same-origin `/api/*` plus the root-path MCP, webhook, OAuth callback, helper-download, and `/internal/*` ingress surfaces directly.
- Managed provider OAuth callbacks fail closed if the provider profile API cannot produce a provider-issued external account identifier; Keppo will not persist an org-derived fallback account id for connected integrations.
- Preview, staging, and production use the same project boundary. Preview relies on deployment-provided env, while staging and production bundle the selected environment-specific runtime env file into the Nitro server output.
- Hosted builds sync Convex env and run `convex deploy --cmd '<build command>'` so schema/function changes ship with the matching web artifact.
- Preview builds must also export the derived preview origin (`KEPPO_URL` and same-origin Better Auth companions such as `KEPPO_API_INTERNAL_BASE_URL`) into the shell before `convex deploy` begins, because Convex analyzes auth modules before the later hosted env sync step. `KEPPO_API_INTERNAL_BASE_URL` must remain reachable from automation sandboxes for signed log, trace, and completion callbacks.
- Provider rollout is controlled by feature flags rather than route removal.
- Validate deployment changes with `pnpm run check:security`.

## Environment variables

### Required environment variables

| Variable                     | Usage          | Description                                                                                                                                                                   |
| ---------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_CONVEX_URL`            | client         | Convex deployment URL                                                                                                                                                         |
| `VITE_CONVEX_SITE_URL`       | client         | Convex site URL (`https://<deployment>.convex.site`) used by the app-server auth proxy to reach Better Auth                                                                   |
| `VITE_VAPID_PUBLIC_KEY`      | client         | Browser Web Push VAPID public key                                                                                                                                             |
| `BETTER_AUTH_SECRET`         | server, convex | Secret for signing better-auth sessions/JWTs. Must be unique per deployment and explicitly set.                                                                               |
| `KEPPO_URL`                  | server, convex | Unified web origin for better-auth and in-app redirects. Must be unique per deployment. `KEPPO_API_INTERNAL_BASE_URL` derives as `${KEPPO_URL}/api`.                          |
| `CONVEX_URL`                 | server         | Convex deployment URL (server-side)                                                                                                                                           |
| `KEPPO_CONVEX_ADMIN_KEY`     | server         | Admin key for internal Convex calls. Auto-resolved from `.convex/local/default/config.json` for local dev. Required in prod.                                                  |
| `KEPPO_MASTER_KEY`           | server, convex | Default encryption key for credentials/secrets                                                                                                                                |
| `OPENAI_API_KEY`             | server         | OpenAI API key for direct prompt generation fallback when bundled gateway mode is not configured. Optional when all automation authoring/runtime uses the Dyad gateway.      |
| `KEPPO_STRICT_MODE`          | server         | Optional strict boot flag. When truthy, API startup also requires bundled gateway env (`KEPPO_LLM_GATEWAY_URL`, `KEPPO_LLM_GATEWAY_MASTER_KEY`, `KEPPO_LLM_GATEWAY_TEAM_ID`). |
| `KEPPO_CRON_SECRET`          | server, convex | Internal cron/queue route authorization (or `VERCEL_CRON_SECRET`). If unset, `/internal/*` routes fail closed with `503`.                                                     |
| `KEPPO_OAUTH_STATE_SECRET`   | server         | OAuth `state` signature key. Required in strict/prod; falls back to `KEPPO_CALLBACK_HMAC_SECRET` in dev/test.                                                                 |
| `KEPPO_CALLBACK_HMAC_SECRET` | server, convex | Automation callback signature key. Required in strict/prod.                                                                                                                   |

API startup validates env with a Zod schema. Missing required secrets fail at boot.

### Provider integrations

Each provider has its own setup guide with env vars, OAuth callbacks, and operational details:

- [Google](providers/google.md) - Gmail OAuth, scopes, Gmail watch/polling setup
- [Stripe](providers/stripe.md) - OAuth, Managed Payments checkout, billing webhooks (enable `subscription_schedule.updated` on the billing endpoint when using native in-app plan schedules), operator write-mode controls
- [GitHub](providers/github.md) - OAuth, webhook setup, repository allowlisting

Additional providers (`slack`, `notion`, `custom`) require no provider-specific env vars. Reddit requires `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` for managed OAuth. X requires `X_CLIENT_ID` and `X_CLIENT_SECRET`; optional overrides `X_OAUTH_AUTH_URL`, `X_OAUTH_TOKEN_URL`, and `X_API_BASE_URL` let self-hosted operators point at a custom OAuth/API surface instead of the built-in fake-gateway defaults used in local development and E2E. The default outbound fetch allowlist includes `api.x.com:443`, and `X_API_BASE_URL` is merged into the allowlist when set. If you set `KEPPO_EXTERNAL_FETCH_ALLOWLIST` yourself, include `api.x.com:443` (and the host from any non-default `X_API_BASE_URL`) so X connector actions can reach the API.

Provider rollout flags (all default `true`, set `false` to disable):

| Variable                                 | Usage  |
| ---------------------------------------- | ------ |
| `KEPPO_FEATURE_INTEGRATIONS_GOOGLE_FULL` | server |
| `KEPPO_FEATURE_INTEGRATIONS_STRIPE_FULL` | server |
| `KEPPO_FEATURE_INTEGRATIONS_GITHUB_FULL` | server |
| `KEPPO_FEATURE_INTEGRATIONS_SLACK_FULL`  | server |
| `KEPPO_FEATURE_INTEGRATIONS_NOTION_FULL` | server |
| `KEPPO_FEATURE_INTEGRATIONS_REDDIT_FULL` | server |
| `KEPPO_FEATURE_INTEGRATIONS_X_FULL`      | server |
| `KEPPO_FEATURE_INTEGRATIONS_CUSTOM_FULL` | server |

### Optional environment variables

| Variable                                                   | Usage          | Default                           | Description                                                                                                                                                                                                                       |
| ---------------------------------------------------------- | -------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth and access**                                        |                |                                   |                                                                                                                                                                                                                                   |
| `VITE_KEPPO_URL`                                           | client         | -                                 | Dashboard-origin mirror used by same-site auth clients during SSR/prebuilt builds. Keep aligned with `KEPPO_URL`.                                                                                                                 |
| `ENABLE_EMAIL_PASSWORD`                                    | convex, client | `false`                           | Email/password sign-in; web build injects `import.meta.env.VITE_ENABLE_EMAIL_PASSWORD` from this value (same truthy rules as Convex). Legacy `VITE_ENABLE_EMAIL_PASSWORD` when `ENABLE_EMAIL_PASSWORD` is unset.                  |
| `KEPPO_ADMIN_USER_IDS`                                     | convex         | -                                 | CSV of user IDs for platform-admin access                                                                                                                                                                                         |
| `KEPPO_LOCAL_ADMIN_BYPASS`                                 | server, convex | `false`                           | Local dev admin bypass. Do not set in deployed env.                                                                                                                                                                               |
| `BETTER_AUTH_TRUSTED_ORIGINS`                              | convex         | -                                 | CSV of extra trusted origins for multi-origin/self-host                                                                                                                                                                           |
| `CORS_ALLOWED_ORIGINS`                                     | server         | -                                 | CSV of allowed dashboard origins. Wildcard `*` rejected.                                                                                                                                                                          |
| `KEPPO_TRUSTED_PROXY`                                      | server         | `none`                            | Client IP resolution: `none`, `vercel`, or `cloudflare`                                                                                                                                                                           |
| `ALLOWED_EMAIL_DOMAINS`                                    | convex         | -                                 | CSV allowlist override for disposable-email guardrails                                                                                                                                                                            |
| **Notifications**                                          |                |                                   |                                                                                                                                                                                                                                   |
| `MAILGUN_API_KEY`                                          | server, convex | -                                 | Required for email notifications and magic-links                                                                                                                                                                                  |
| `MAILGUN_DOMAIN`                                           | server, convex | -                                 | Required for email notifications and magic-links                                                                                                                                                                                  |
| `MAILGUN_FROM_EMAIL`                                       | server, convex | `notifications@keppo.ai`          | Sender address for emails                                                                                                                                                                                                         |
| `VAPID_PUBLIC_KEY`                                         | server         | -                                 | Required for push notifications                                                                                                                                                                                                   |
| `VAPID_PRIVATE_KEY`                                        | server         | -                                 | Required for push notifications                                                                                                                                                                                                   |
| `VAPID_SUBJECT`                                            | server         | -                                 | e.g. `mailto:alerts@example.com`. Required for push.                                                                                                                                                                              |
| **Observability**                                          |                |                                   |                                                                                                                                                                                                                                   |
| `LOG_LEVEL`                                                | server         | `info`                            | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`                                                                                                                                                                      |
| `VITE_POSTHOG_API_KEY`                                     | client         | -                                 | PostHog analytics + exception capture                                                                                                                                                                                             |
| `VITE_POSTHOG_HOST`                                        | client         | `https://us.i.posthog.com`        | PostHog host                                                                                                                                                                                                                      |
| `POSTHOG_API_KEY`                                          | server         | -                                 | Server-side PostHog                                                                                                                                                                                                               |
| `POSTHOG_HOST`                                             | server         | `https://us.i.posthog.com`        | Server-side PostHog host                                                                                                                                                                                                          |
| `POSTHOG_PERSONAL_API_KEY`                                 | build          | -                                 | Source-map upload key                                                                                                                                                                                                             |
| `POSTHOG_PROJECT_ID`                                       | build          | -                                 | Source-map upload project                                                                                                                                                                                                         |
| `KEPPO_RELEASE_NAME`                                       | build          | `keppo-dashboard`                 | Source-map release name                                                                                                                                                                                                           |
| `KEPPO_RELEASE_VERSION`                                    | build          | auto                              | Source-map release version                                                                                                                                                                                                        |
| `PAGERDUTY_ROUTING_KEY`                                    | server         | -                                 | PagerDuty Events API v2 routing key for alerting                                                                                                                                                                                  |
| `KEPPO_DLQ_ALERT_THRESHOLD`                                | server         | `10`                              | Dead-letter queue alert threshold                                                                                                                                                                                                 |
| **Scheduling and maintenance**                             |                |                                   |                                                                                                                                                                                                                                   |
| `KEPPO_ACTION_TTL_MINUTES`                                 | server, convex | `60`                              | Pending action expiry                                                                                                                                                                                                             |
| `KEPPO_RUN_INACTIVITY_MINUTES`                             | server, convex | `30`                              | Stale run timeout                                                                                                                                                                                                                 |
| `KEPPO_QUEUE_ENQUEUE_SWEEP_LIMIT`                          | server, convex | `50`                              | Approved actions dispatched per sweep. `0` disables.                                                                                                                                                                              |
| `KEPPO_QUEUE_APPROVED_FALLBACK_LIMIT`                      | server         | `0`                               | Legacy maintenance fallback. Keep at `0`.                                                                                                                                                                                         |
| **Rate limiting**                                          |                |                                   |                                                                                                                                                                                                                                   |
| `KEPPO_RATE_LIMIT_MCP_AUTH_FAILURES_PER_MINUTE`            | server         | `20`                              |                                                                                                                                                                                                                                   |
| `KEPPO_RATE_LIMIT_MCP_REQUESTS_PER_CREDENTIAL_PER_MINUTE`  | server         | `60`                              |                                                                                                                                                                                                                                   |
| `KEPPO_RATE_LIMIT_AUTOMATION_QUESTIONS_PER_ORG_PER_MINUTE` | server         | `10`                              |                                                                                                                                                                                                                                   |
| `KEPPO_RATE_LIMIT_OAUTH_CONNECT_PER_IP_PER_MINUTE`         | server         | `10`                              |                                                                                                                                                                                                                                   |
| `KEPPO_RATE_LIMIT_WEBHOOKS_PER_IP_PER_MINUTE`              | server         | `100`                             |                                                                                                                                                                                                                                   |
| **Request body limits**                                    |                |                                   |                                                                                                                                                                                                                                   |
| `KEPPO_MAX_BODY_BYTES_OAUTH`                               | server         | `65536`                           | Max bytes for `/oauth/integrations/*`                                                                                                                                                                                             |
| `KEPPO_MAX_BODY_BYTES_WEBHOOKS`                            | server         | `262144`                          | Max bytes for `/webhooks/*`                                                                                                                                                                                                       |
| `KEPPO_MAX_BODY_BYTES_MCP`                                 | server         | `262144`                          | Max bytes for `/mcp/*`                                                                                                                                                                                                            |
| `KEPPO_MAX_BODY_BYTES_INTERNAL`                            | server         | `262144`                          | Max bytes for `/internal/*`                                                                                                                                                                                                       |
| **Sandbox**                                                |                |                                   |                                                                                                                                                                                                                                   |
| `KEPPO_SANDBOX_PROVIDER`                                   | server         | `docker`                          | Automation sandbox. Set `vercel` or `unikraft` for production-tier remote execution.                                                                                                                                              |
| `KEPPO_CODE_MODE_SANDBOX_PROVIDER`                         | server         | `docker`                          | Code Mode sandbox. Set `vercel` or `unikraft` for remote execution.                                                                                                                                                               |
| `KEPPO_CODE_MODE_TIMEOUT_MS`                               | server         | `120000`                          | Code Mode execution timeout                                                                                                                                                                                                       |
| `KEPPO_AUTOMATION_DEFAULT_TIMEOUT_MS`                      | server         | `300000`                          | Fallback automation run timeout when dispatch cannot resolve an org subscription tier; tier-backed dispatches use the tier max run duration                                                                                       |
| `UNIKRAFT_API_TOKEN`                                       | server         | -                                 | Required when either sandbox provider is `unikraft`. Unikraft Cloud API bearer token.                                                                                                                                             |
| `UNIKRAFT_METRO`                                           | server         | -                                 | Required when either sandbox provider is `unikraft`. Regional metro slug such as `fra0`, `dal0`, `sin0`, `was0`, or `sfo0`.                                                                                                       |
| `UNIKRAFT_SANDBOX_IMAGE`                                   | server         | -                                 | Required when `KEPPO_SANDBOX_PROVIDER=unikraft`. OCI image used for automation MicroVMs.                                                                                                                                          |
| `UNIKRAFT_CODE_MODE_IMAGE`                                 | server         | `node:22-alpine`                  | Optional image for Unikraft Code Mode execution.                                                                                                                                                                                  |
| `UNIKRAFT_CODE_MODE_BRIDGE_BASE_URL`                       | server         | -                                 | Required in strict/non-local setups when `KEPPO_CODE_MODE_SANDBOX_PROVIDER=unikraft`. Public base URL the MicroVM can call for synchronous host bridge requests.                                                                  |
| `UNIKRAFT_CODE_MODE_BRIDGE_BIND_HOST`                      | server         | auto                              | Optional bind host for the temporary local bridge server. Set when `UNIKRAFT_CODE_MODE_BRIDGE_BASE_URL` points at a host/interface other than the default loopback binding.                                                       |
| `VERCEL_OIDC_TOKEN`                                        | server         | -                                 | Recommended Vercel Sandbox auth                                                                                                                                                                                                   |
| `VERCEL_TOKEN`                                             | server         | -                                 | Fallback Vercel Sandbox auth (with team/project IDs)                                                                                                                                                                              |
| `VERCEL_TEAM_ID`                                           | server         | -                                 | Required with `VERCEL_TOKEN`                                                                                                                                                                                                      |
| `VERCEL_PROJECT_ID`                                        | server         | -                                 | Required with `VERCEL_TOKEN`                                                                                                                                                                                                      |
| `VERCEL_AUTOMATION_BYPASS_SECRET`                          | server, convex | auto on Vercel                    | Deployment Protection bypass for automation traffic in `preview` and `staging`; do not propagate it in `production`                                                                                                               |
| `KEPPO_AUTOMATION_MCP_SERVER_URL`                          | server         | auto                              | Explicit MCP endpoint for automation runners                                                                                                                                                                                      |
| `KEPPO_AUTOMATION_DISPATCH_URL`                            | server, convex | auto                              | URL to `/internal/automations/dispatch`                                                                                                                                                                                           |
| `KEPPO_AUTOMATION_TERMINATE_URL`                           | server         | auto                              | URL to `/internal/automations/terminate`                                                                                                                                                                                          |
| `KEPPO_API_INTERNAL_BASE_URL`                              | server, convex | auto                              | Base URL for Convex-to-API internal calls. Derives `${KEPPO_URL}/api` and must be reachable from automation sandboxes for signed log, trace, and completion callbacks.                                                           |
| `KEPPO_OPENAI_TRACING_API_KEY`                             | server         | -                                 | Optional dedicated key for exporting automation traces through the OpenAI tracing API. When unset, Keppo disables trace export instead of reusing `OPENAI_API_KEY`; `KEPPO_E2E_MODE` also disables trace export by default.        |
| `KEPPO_OPENAI_TRACING_ENDPOINT`                            | server         | `https://api.openai.com/v1/traces/ingest` | Optional override for the OpenAI trace-export endpoint. Useful only when you intentionally proxy or test trace ingestion separately from normal model traffic.                                                             |
| `KEPPO_MASTER_KEY_INTEGRATION`                             | server         | —                                 | Optional integration-specific KEK                                                                                                                                                                                                 |
| **LLM gateway**                                            |                |                                   |                                                                                                                                                                                                                                   |
| `KEPPO_LLM_GATEWAY_URL`                                    | server         | -                                 | Dyad Gateway base URL for bundled AI generation and runtime. When set, clarifying questions, prompt generation, Mermaid regeneration, and bundled runtime all meter against gateway spend and sync the derived balance back into Convex. Required when `KEPPO_STRICT_MODE` is truthy. |
| `KEPPO_LLM_GATEWAY_MASTER_KEY`                             | server         | -                                 | Dyad Gateway management bearer token. Required when `KEPPO_STRICT_MODE` is truthy.                                                                                                                                                |
| `KEPPO_LLM_GATEWAY_TEAM_ID`                                | server         | -                                 | Dyad Gateway team id. Required when `KEPPO_STRICT_MODE` is truthy.                                                                                                                                                                |
| `KEPPO_AUTOMATION_MODEL_AUTO`                              | server         | `KEPPO_AUTOMATION_MODEL_BALANCED` | Concrete model behind the `Auto` class.                                                                                                                                                                                           |
| `KEPPO_AUTOMATION_MODEL_FRONTIER`                          | server         | `gpt-5.4`                         | Concrete model behind the `Frontier` class.                                                                                                                                                                                       |
| `KEPPO_AUTOMATION_MODEL_BALANCED`                          | server         | `gpt-5.4`                         | Concrete model behind the `Balanced` class.                                                                                                                                                                                       |
| `KEPPO_AUTOMATION_MODEL_VALUE`                             | server         | `gpt-5.2`                         | Concrete model behind the `Value` class.                                                                                                                                                                                          |
| **Billing**                                                |                |                                   |                                                                                                                                                                                                                                   |
| `STRIPE_CREDIT_PRODUCT_ID`                                 | server         | -                                 | Stripe product id used for one-time AI credit pack checkout sessions.                                                                                                                                                             |
| `STRIPE_AUTOMATION_RUN_PRODUCT_ID`                         | server         | -                                 | Stripe product id used for one-time automation run top-up checkout sessions.                                                                                                                                                      |
| `STRIPE_STARTER_PRICE_ID`                                  | server         | -                                 | Stripe recurring price id for the Starter subscription tier.                                                                                                                                                                      |
| `STRIPE_PRO_PRICE_ID`                                      | server         | -                                 | Stripe recurring price id for the Pro subscription tier.                                                                                                                                                                          |
| **Self-hosted overrides**                                  |                |                                   |                                                                                                                                                                                                                                   |
| `KEPPO_PROVIDER_MODULES`                                   | server         | -                                 | CSV of canonical provider IDs, `all`, or `*`                                                                                                                                                                                      |
| `KEPPO_PROVIDER_DEPRECATIONS_JSON`                         | server         | -                                 | JSON object of deprecation notices keyed by provider ID                                                                                                                                                                           |
| `VITE_API_BASE`                                            | client         | `/api`                            | Only set for non-default self-hosted API routing                                                                                                                                                                                  |

Notes:

- `KEPPO_API_INTERNAL_BASE_URL` must be publicly reachable from the Vercel sandbox. Loopback addresses will dispatch a sandbox that cannot stream logs or send callbacks.
- `UNIKRAFT_CODE_MODE_BRIDGE_BASE_URL` must be reachable from the Unikraft MicroVM. In local-only experiments you can rely on the default loopback bridge URL, but production/preview deployments need a public or otherwise routable callback origin.
- If Vercel Deployment Protection is enabled, propagate `VERCEL_AUTOMATION_BYPASS_SECRET` into both the API runtime and the hosted Convex env only for `preview` and `staging`. Do not propagate or use it when `KEPPO_ENVIRONMENT=production`.
- Local `docker` sandbox execution requires a working Docker engine on the API host.
- Sandboxed automation runs use a repo-owned `openai-agents-js` runner pinned to `@openai/agents@0.8.2` in both the local automation sandbox image and the Vercel bootstrap path. Custom image-based automation runtimes should preserve that pin and the `/sandbox/.keppo-automation-runner/` entrypoint contract unless you are intentionally upgrading the runner.
- OpenAI trace export is opt-in. Keppo sends hashed run/group identifiers plus non-sensitive metadata by default; full prompts, tool arguments, tool outputs, and automation memory are not included in trace exports.
- Client IP resolution: `none` ignores forwarded headers, `vercel` prefers `x-real-ip`, `cloudflare` prefers `cf-connecting-ip`.
- When bundled gateway mode is enabled, Keppo treats gateway spend as the source of truth for bundled AI usage and syncs the operator-visible remaining balance back into Convex `ai_credits`. Included allowance and purchased credit-pack expiry remain Keppo-owned entitlements.
- Invite-code behavior is billing-oriented:
  - free invite codes are no longer required for dashboard access.
  - paid promos: Starter/Pro invite codes create a one-month `invite_code_redemptions` row, temporarily set the subscription to `trialing`, and fall back to Free unless the org starts a Stripe subscription before expiry.

## Same-site auth (always on)

- Better Auth uses `KEPPO_URL` as `baseURL` on Convex and the dashboard client targets `window.location.origin` (SSR uses `VITE_KEPPO_URL` / `VITE_CONVEX_*` fallbacks). Browser requests go through `/api/auth/*` on the dashboard origin; cross-domain Better Auth plugins are not used.
- In local dev, keep `KEPPO_URL=http://localhost:3000`, `VITE_KEPPO_URL=http://localhost:3000`, `CONVEX_URL=http://localhost:3210`, and `CONVEX_SITE_URL=http://localhost:3211`.
- Register OAuth callback URLs on the dashboard origin, for example `https://staging.keppo.ai/api/auth/callback/google` and `https://staging.keppo.ai/api/auth/callback/github`.

## Auth configuration

`convex/auth.config.ts` uses `getAuthConfigProvider()` from `@convex-dev/better-auth/auth-config`. `convex/http.ts` registers better-auth routes at `https://<deployment>.convex.site/api/auth/*`.

`KEPPO_URL` must match the dashboard origin users visit.

Common auth failures:

- Missing `BETTER_AUTH_SECRET` in Convex env
- Wrong `KEPPO_URL` for the active environment
- Missing `VITE_CONVEX_SITE_URL` in dashboard env
- Missing social provider credentials (`GOOGLE_*`, `GITHUB_*`) when social login is enabled

## Unikraft Cloud setup

1. Create a Unikraft Cloud account and generate an API token for the target metro.
2. Push the existing automation sandbox image to an OCI registry reachable by Unikraft Cloud, then set `UNIKRAFT_SANDBOX_IMAGE` to that image reference.
3. If you want Code Mode on Unikraft, set `UNIKRAFT_CODE_MODE_IMAGE` as needed and configure `UNIKRAFT_CODE_MODE_BRIDGE_BASE_URL` so the MicroVM can reach the host bridge callback.
4. Set `KEPPO_SANDBOX_PROVIDER=unikraft` and/or `KEPPO_CODE_MODE_SANDBOX_PROVIDER=unikraft` once those credentials and image references are in place.

## First-run operator path

When a better-auth organization is created, Convex bootstrap creates a `retention_policies` record (if missing), one default workspace with manual approval mode, and one workspace credential record.

For a clean self-hosted install:

1. Sign in and land in the default workspace.
2. Follow the highlighted readiness step on the dashboard home or sidebar guide.
3. Connect an integration in `/integrations`.
4. Enable that integration for the active workspace in `/settings/workspaces`.
5. Confirm AI access in `/settings` under `AI Configuration`. Deployments with bundled gateway mode use bundled credits there; deployments without bundled gateway mode add an organization AI key.
6. Create the first automation in `/automations`, starting with manual trigger mode unless you already trust the prompt and policy settings.
7. Trigger a first action so approvals, runs, notifications, and audit history all have live data.

### Wiping all Convex data (internal / destructive)

To delete **every** document in all application tables and Better Auth component tables (for example after a botched migration or to reset a throwaway deployment):

1. In the Convex dashboard for that deployment, set environment variable `KEPPO_ALLOW_DANGEROUS_DROP_ALL=true`.
2. Open **Functions**, run internal action `dangerous_admin.dangerouslyDropAllTables` with `confirm`: `"DELETE_ALL_DATA"` (the action drains the wipe in paged mutation batches so large deployments do not hit single-mutation read limits).
3. After the wipe completes, remove `KEPPO_ALLOW_DANGEROUS_DROP_ALL` (or set it to anything other than `true`) so the action cannot run accidentally.

This also deletes app-owned blobs in Convex file storage (`_storage`) when rows reference them, but it does not enumerate unrelated orphaned storage objects. It is not a substitute for `convex dev --local` reset when you only need a clean local backend.

## Further reading

- [Development Setup](dev-setup.md) - local contributor setup, verification, and workflow prerequisites
- [Architecture](specs/high-level-architecture.md) - system components and ownership model
- [API route surface](specs/control-plane-api.md) - full route table, auth expectations, and protocol details
- [Testing strategy](specs/testing-strategy.md) - canonical ownership of test layers and browser-test scope
- [Security rules](rules/security.md) - auth, webhooks, sandboxing, and runtime secret guardrails
- [Environment/runtime rules](rules/env_runtime.md) - local and hosted env loading, Convex sync, and runtime boundary rules
- [Provider SDK fidelity rules](rules/provider_sdk_fidelity.md) - provider adapter and metadata guardrails
- [Non-E2E testing rules](rules/non_e2e_testing.md) - fast-layer ownership and authoring constraints
- [E2E testing rules](rules/e2e_testing.md) - browser-test isolation, budgets, and infra contracts
- [GitHub workflow rules](rules/github-workflows.md) - runner, label, and agent-selection rules
- [GitHub workflow security rules](rules/github-security.md) - trusted checkout and post-agent mutation boundaries
- [Operations runbooks](runbooks/README.md) - incident response procedures and alerting setup
