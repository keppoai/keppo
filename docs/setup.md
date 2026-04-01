# Setup

## Prerequisites

- **Node.js** 22 (see `node-version` in CI workflows)
- **pnpm** (see `packageManager` in root `package.json`)
- **Convex CLI** (`npx convex`)
- **Docker** (required for local automation sandbox runs when `KEPPO_SANDBOX_PROVIDER=docker`)
- **Secure Exec dependencies** (installed by `pnpm install`; used only for CI/test runs when `KEPPO_SANDBOX_PROVIDER=secure_exec` or `KEPPO_CODE_MODE_SANDBOX_PROVIDER=secure_exec`)
- **Unikraft Cloud account + API token** (required when `KEPPO_SANDBOX_PROVIDER=unikraft` or `KEPPO_CODE_MODE_SANDBOX_PROVIDER=unikraft`)
- Environment variables loaded via [dotenvx](https://dotenvx.com)

## Runtime layout

- `cloud/` is a normal workspace package that holds the canonical billing, scheduler, advanced gating, and Vercel sandbox runtime modules.
- `convex/` and `apps/web` are the active runtime seams. `apps/web` is the canonical app/runtime boundary for local development, typed server functions, the public docs surface at `/docs`, the built-in docs search endpoint at `/api/search`, and the full live HTTP surface for health, invites, billing, provider OAuth connect/callback, provider webhooks, the root MCP transport, the OpenAI helper/connect/callback flow, helper download redirects, automation prompt generation, internal cron/queue dispatch, internal deep-health and DLQ routes, MCP test, and push subscription. Shared server-only helper modules live under `apps/web/app/lib/server/api-runtime/`.
- `apps/web` builds through Vite with Nitro's `nitro/vite` plugin and the `vercel` preset. Production output lands in `apps/web/.vercel/output/`, and local preview of that build runs via `pnpm --filter @keppo/web start`, which serves `functions/__server.func/index.mjs` plus the generated static assets through `srvx`.
- Public docs content is authored under `apps/web/content/docs/**` and loaded through Fumadocs MDX. Keep `meta.json` navigation files, article frontmatter, and repo specs in sync when docs behavior or information architecture changes.
- There is no overlay or source-copy step in normal build, dev, test, or deploy flows.
- Workspace package imports are expected to use explicit concrete subpaths; passive barrel files are rejected by `pnpm run check:barrels`.

## Quickstart (local dev)

```bash
cp .env.example .env.local          # optional machine-local overrides
pnpm install
pnpm run dev                         # start local Convex + TanStack Start app on :3000
```

Bootstrap shared defaults from [`.env.example`](../.env.example) into your local env files before starting services, then layer machine-specific secrets in `.env.local` as needed. See [`docs/rules/env_runtime.md`](rules/env_runtime.md) for secret defaults, startup behavior, and env file loading rules.

Local app and docs URLs:

- Dashboard and landing page: `http://localhost:3000/`
- Public docs: `http://localhost:3000/docs`
- Built-in docs search API: `http://localhost:3000/api/search`

## Local verification

Use the repo-owned command surface before pushing changes:

```bash
pnpm run typecheck
pnpm run check:security
pnpm run check:sdk-type-compat
```

- `pnpm run typecheck` is the required local type-safety gate. It runs workspace typechecks, the dedicated Convex gate, and the repo-wide strict type-safety check.
- When `packages/shared/src/**` changes, rebuild `@keppo/shared` before dependent tests or E2E (`pnpm --filter @keppo/shared build`) so downstream packages consume fresh contract exports.
- Public docs changes should also run `pnpm --filter @keppo/web test` and `pnpm --filter @keppo/web build`, then a targeted docs Playwright spec with `pnpm run test:e2e:base -- tests/e2e/specs/docs/public-docs.spec.ts`. Do not run the full E2E suite locally; validate the full browser suite on GitHub Actions.

## Testing reference

Use the repo-owned command surface for the smallest layer that exercises the real boundary under test:

- `pnpm test:web` for rendered dashboard and Start-owned server-runtime Vitest coverage in `apps/web`
- `pnpm test:convex` for focused Convex mutation/query coverage
- `pnpm test:local-convex` for backend integration coverage that needs API + Convex + fake gateways but not a browser
- `pnpm test:shared` and `pnpm test:conformance` for shared package and provider conformance coverage
- `pnpm test:non-e2e:authoring` for authoring guardrails on non-E2E suites
- `pnpm run test:e2e:base -- <playwright-args...>` for local browser debugging

Local browser policy:

- Do not run the full E2E suite locally.
- Use targeted Playwright specs only, then validate the full suite on GitHub Actions.
- For automation-trigger work, use `pnpm run test:e2e:base -- tests/e2e/specs/automations/provider-event-triggers.spec.ts`.
- For intentional Code Mode sandbox verification, set `KEPPO_E2E_REQUIRE_CODE_MODE_SANDBOX=1` so sandbox unavailability becomes a hard failure instead of a skip.

## Hosted deployment model

- The default hosted shape is one Vercel web project rooted at `apps/web`, backed by a hosted Convex deployment.
- The unified web deployment owns same-origin `/api/*` plus the root-path MCP, webhook, OAuth callback, helper-download, and `/internal/*` ingress surfaces directly.
- Preview, staging, and production use the same project boundary. Preview relies on deployment-provided env, while staging and production bundle the selected environment-specific runtime env file into the Nitro server output.
- Hosted builds sync Convex env and run `convex deploy --cmd '<build command>'` so schema/function changes ship with the matching web artifact.
- Preview builds must also export the derived preview origin (`KEPPO_URL` and same-origin Better Auth companions such as `KEPPO_API_INTERNAL_BASE_URL`) into the shell before `convex deploy` begins, because Convex analyzes auth modules before the later hosted env sync step.
- Provider rollout is controlled by feature flags rather than route removal.
- Validate deployment changes with `pnpm run check:security`.

---

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
| `OPENAI_API_KEY`             | server         | OpenAI API key for prompt generation. Required in all modes.                                                                                                                  |
| `KEPPO_STRICT_MODE`          | server         | Optional strict boot flag. When truthy, API startup also requires bundled gateway env (`KEPPO_LLM_GATEWAY_URL`, `KEPPO_LLM_GATEWAY_MASTER_KEY`, `KEPPO_LLM_GATEWAY_TEAM_ID`). |
| `KEPPO_CRON_SECRET`          | server, convex | Internal cron/queue route authorization (or `VERCEL_CRON_SECRET`). If unset, `/internal/*` routes fail closed with `503`.                                                     |
| `KEPPO_OAUTH_STATE_SECRET`   | server         | OAuth `state` signature key. Required in strict/prod; falls back to `KEPPO_CALLBACK_HMAC_SECRET` in dev/test.                                                                 |
| `KEPPO_CALLBACK_HMAC_SECRET` | server, convex | Automation callback signature key. Required in strict/prod.                                                                                                                   |

API startup validates env with a Zod schema. Missing required secrets fail at boot.

### Provider integrations

Each provider has its own setup guide with env vars, OAuth callbacks, and operational details:

- [Google](providers/google.md) — Gmail OAuth, scopes, Gmail watch/polling setup
- [Stripe](providers/stripe.md) — OAuth, Managed Payments checkout, billing webhooks (enable `subscription_schedule.updated` on the billing endpoint when using native in-app plan schedules), operator write-mode controls
- [GitHub](providers/github.md) — OAuth, webhook setup, repository allowlisting

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

### Provider catalog maintenance

The concise source of truth for shipped provider metadata is:

- provider modules in `packages/shared/src/providers/modules/*`
- the committed snapshot `packages/shared/provider-registry.snapshot.json`
- the generated human-readable catalog `docs/providers.md`

When provider metadata changes:

```bash
pnpm run create:provider-module -- --provider <provider-id>
pnpm run validate:provider-manifest -- <manifest-path>
pnpm run update:provider-registry-snapshot
pnpm run update:provider-docs
pnpm run check:provider-registry-snapshot
pnpm run check:provider-docs
```

Rollout remains server-side:

- per-provider `metadata.featureGate`
- global registry kill switch `KEPPO_FEATURE_PROVIDER_REGISTRY_PATH`

Disabled providers fail closed at connect, callback, webhook, and dispatch boundaries instead of silently disappearing from the runtime contract.

### Optional environment variables

| Variable                                                   | Usage          | Default                    | Description                                                                                                                                                                                                      |
| ---------------------------------------------------------- | -------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Auth and access**                                        |                |                            |                                                                                                                                                                                                                  |
| `VITE_KEPPO_URL`                                           | client         | —                          | Dashboard-origin mirror used by same-site auth clients during SSR/prebuilt builds. Keep aligned with `KEPPO_URL`.                                                                                                |
| `ENABLE_EMAIL_PASSWORD`                                    | convex, client | `false`                    | Email/password sign-in; web build injects `import.meta.env.VITE_ENABLE_EMAIL_PASSWORD` from this value (same truthy rules as Convex). Legacy `VITE_ENABLE_EMAIL_PASSWORD` when `ENABLE_EMAIL_PASSWORD` is unset. |
| `KEPPO_ADMIN_USER_IDS`                                     | convex         | —                          | CSV of user IDs for platform-admin access                                                                                                                                                                        |
| `KEPPO_LOCAL_ADMIN_BYPASS`                                 | server, convex | `false`                    | Local dev admin bypass. Do not set in deployed env.                                                                                                                                                              |
| `BETTER_AUTH_TRUSTED_ORIGINS`                              | convex         | —                          | CSV of extra trusted origins for multi-origin/self-host                                                                                                                                                          |
| `CORS_ALLOWED_ORIGINS`                                     | server         | —                          | CSV of allowed dashboard origins. Wildcard `*` rejected.                                                                                                                                                         |
| `KEPPO_TRUSTED_PROXY`                                      | server         | `none`                     | Client IP resolution: `none`, `vercel`, or `cloudflare`                                                                                                                                                          |
| `ALLOWED_EMAIL_DOMAINS`                                    | convex         | —                          | CSV allowlist override for disposable-email guardrails                                                                                                                                                           |
| **Notifications**                                          |                |                            |                                                                                                                                                                                                                  |
| `MAILGUN_API_KEY`                                          | server, convex | —                          | Required for email notifications and magic-links                                                                                                                                                                 |
| `MAILGUN_DOMAIN`                                           | server, convex | —                          | Required for email notifications and magic-links                                                                                                                                                                 |
| `MAILGUN_FROM_EMAIL`                                       | server, convex | `notifications@keppo.ai`   | Sender address for emails                                                                                                                                                                                        |
| `VAPID_PUBLIC_KEY`                                         | server         | —                          | Required for push notifications                                                                                                                                                                                  |
| `VAPID_PRIVATE_KEY`                                        | server         | —                          | Required for push notifications                                                                                                                                                                                  |
| `VAPID_SUBJECT`                                            | server         | —                          | e.g. `mailto:alerts@example.com`. Required for push.                                                                                                                                                             |
| **Observability**                                          |                |                            |                                                                                                                                                                                                                  |
| `LOG_LEVEL`                                                | server         | `info`                     | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`                                                                                                                                                     |
| `VITE_POSTHOG_API_KEY`                                     | client         | —                          | PostHog analytics + exception capture                                                                                                                                                                            |
| `VITE_POSTHOG_HOST`                                        | client         | `https://us.i.posthog.com` | PostHog host                                                                                                                                                                                                     |
| `POSTHOG_API_KEY`                                          | server         | —                          | Server-side PostHog                                                                                                                                                                                              |
| `POSTHOG_HOST`                                             | server         | `https://us.i.posthog.com` | Server-side PostHog host                                                                                                                                                                                         |
| `POSTHOG_PERSONAL_API_KEY`                                 | build          | —                          | Source-map upload key                                                                                                                                                                                            |
| `POSTHOG_PROJECT_ID`                                       | build          | —                          | Source-map upload project                                                                                                                                                                                        |
| `KEPPO_RELEASE_NAME`                                       | build          | `keppo-dashboard`          | Source-map release name                                                                                                                                                                                          |
| `KEPPO_RELEASE_VERSION`                                    | build          | auto                       | Source-map release version                                                                                                                                                                                       |
| `PAGERDUTY_ROUTING_KEY`                                    | server         | —                          | PagerDuty Events API v2 routing key for alerting                                                                                                                                                                 |
| `KEPPO_DLQ_ALERT_THRESHOLD`                                | server         | `10`                       | Dead-letter queue alert threshold                                                                                                                                                                                |
| **Scheduling and maintenance**                             |                |                            |                                                                                                                                                                                                                  |
| `KEPPO_ACTION_TTL_MINUTES`                                 | server, convex | `60`                       | Pending action expiry                                                                                                                                                                                            |
| `KEPPO_RUN_INACTIVITY_MINUTES`                             | server, convex | `30`                       | Stale run timeout                                                                                                                                                                                                |
| `KEPPO_QUEUE_ENQUEUE_SWEEP_LIMIT`                          | server, convex | `50`                       | Approved actions dispatched per sweep. `0` disables.                                                                                                                                                             |
| `KEPPO_QUEUE_APPROVED_FALLBACK_LIMIT`                      | server         | `0`                        | Legacy maintenance fallback. Keep at `0`.                                                                                                                                                                        |
| **Rate limiting**                                          |                |                            |                                                                                                                                                                                                                  |
| `KEPPO_RATE_LIMIT_MCP_AUTH_FAILURES_PER_MINUTE`            | server         | `20`                       |                                                                                                                                                                                                                  |
| `KEPPO_RATE_LIMIT_MCP_REQUESTS_PER_CREDENTIAL_PER_MINUTE`  | server         | `60`                       |                                                                                                                                                                                                                  |
| `KEPPO_RATE_LIMIT_AUTOMATION_QUESTIONS_PER_ORG_PER_MINUTE` | server         | `10`                       |                                                                                                                                                                                                                  |
| `KEPPO_RATE_LIMIT_OAUTH_CONNECT_PER_IP_PER_MINUTE`         | server         | `10`                       |                                                                                                                                                                                                                  |
| `KEPPO_RATE_LIMIT_WEBHOOKS_PER_IP_PER_MINUTE`              | server         | `100`                      |                                                                                                                                                                                                                  |
| **Request body limits**                                    |                |                            |                                                                                                                                                                                                                  |
| `KEPPO_MAX_BODY_BYTES_OAUTH`                               | server         | `65536`                    | Max bytes for `/oauth/integrations/*`                                                                                                                                                                            |
| `KEPPO_MAX_BODY_BYTES_WEBHOOKS`                            | server         | `262144`                   | Max bytes for `/webhooks/*`                                                                                                                                                                                      |
| `KEPPO_MAX_BODY_BYTES_MCP`                                 | server         | `262144`                   | Max bytes for `/mcp/*`                                                                                                                                                                                           |
| `KEPPO_MAX_BODY_BYTES_INTERNAL`                            | server         | `262144`                   | Max bytes for `/internal/*`                                                                                                                                                                                      |
| **Sandbox**                                                |                |                            |                                                                                                                                                                                                                  |
| `KEPPO_SANDBOX_PROVIDER`                                   | server         | `docker`                   | Automation sandbox. Set `vercel` or `unikraft` for production-tier remote execution.                                                                                                                             |
| `KEPPO_CODE_MODE_SANDBOX_PROVIDER`                         | server         | `docker`                   | Code Mode sandbox. Set `vercel` or `unikraft` for remote execution.                                                                                                                                              |
| `KEPPO_CODE_MODE_TIMEOUT_MS`                               | server         | `30000`                    | Code Mode execution timeout                                                                                                                                                                                      |
| `KEPPO_AUTOMATION_DEFAULT_TIMEOUT_MS`                      | server         | `300000`                   | Automation run timeout                                                                                                                                                                                           |
| `UNIKRAFT_API_TOKEN`                                       | server         | —                          | Required when either sandbox provider is `unikraft`. Unikraft Cloud API bearer token.                                                                                                                            |
| `UNIKRAFT_METRO`                                           | server         | —                          | Required when either sandbox provider is `unikraft`. Regional metro slug such as `fra0`, `dal0`, `sin0`, `was0`, or `sfo0`.                                                                                      |
| `UNIKRAFT_SANDBOX_IMAGE`                                   | server         | —                          | Required when `KEPPO_SANDBOX_PROVIDER=unikraft`. OCI image used for automation MicroVMs.                                                                                                                         |
| `UNIKRAFT_CODE_MODE_IMAGE`                                 | server         | `node:22-alpine`           | Optional image for Unikraft Code Mode execution.                                                                                                                                                                 |
| `UNIKRAFT_CODE_MODE_BRIDGE_BASE_URL`                       | server         | —                          | Required in strict/non-local setups when `KEPPO_CODE_MODE_SANDBOX_PROVIDER=unikraft`. Public base URL the MicroVM can call for synchronous host bridge requests.                                                 |
| `UNIKRAFT_CODE_MODE_BRIDGE_BIND_HOST`                      | server         | auto                       | Optional bind host for the temporary local bridge server. Set when `UNIKRAFT_CODE_MODE_BRIDGE_BASE_URL` points at a host/interface other than the default loopback binding.                                      |
| `VERCEL_OIDC_TOKEN`                                        | server         | —                          | Recommended Vercel Sandbox auth                                                                                                                                                                                  |
| `VERCEL_TOKEN`                                             | server         | —                          | Fallback Vercel Sandbox auth (with team/project IDs)                                                                                                                                                             |
| `VERCEL_TEAM_ID`                                           | server         | —                          | Required with `VERCEL_TOKEN`                                                                                                                                                                                     |
| `VERCEL_PROJECT_ID`                                        | server         | —                          | Required with `VERCEL_TOKEN`                                                                                                                                                                                     |
| `VERCEL_AUTOMATION_BYPASS_SECRET`                          | server, convex | auto on Vercel             | Deployment Protection bypass for automation traffic                                                                                                                                                              |
| `KEPPO_AUTOMATION_MCP_SERVER_URL`                          | server         | auto                       | Explicit MCP endpoint for automation runners                                                                                                                                                                     |
| `KEPPO_AUTOMATION_DISPATCH_URL`                            | server, convex | auto                       | URL to `/internal/automations/dispatch`                                                                                                                                                                          |
| `KEPPO_AUTOMATION_TERMINATE_URL`                           | server         | auto                       | URL to `/internal/automations/terminate`                                                                                                                                                                         |
| `KEPPO_API_INTERNAL_BASE_URL`                              | server, convex | auto                       | Base URL for Convex-to-API internal calls. Derives `${KEPPO_URL}/api`.                                                                                                                                           |
| `KEPPO_MASTER_KEY_INTEGRATION`                             | server         | —                          | Optional integration-specific KEK                                                                                                                                                                                |
| **LLM gateway**                                            |                |                            |                                                                                                                                                                                                                  |
| `KEPPO_LLM_GATEWAY_URL`                                    | server         | —                          | Dyad Gateway base URL for bundled AI runtime. Required when `KEPPO_STRICT_MODE` is truthy.                                                                                                                       |
| `KEPPO_LLM_GATEWAY_MASTER_KEY`                             | server         | —                          | Dyad Gateway management bearer token. Required when `KEPPO_STRICT_MODE` is truthy.                                                                                                                               |
| `KEPPO_LLM_GATEWAY_TEAM_ID`                                | server         | —                          | Dyad Gateway team id. Required when `KEPPO_STRICT_MODE` is truthy.                                                                                                                                               |
| **Billing**                                                |                |                            |                                                                                                                                                                                                                  |
| `STRIPE_CREDIT_PRODUCT_ID`                                 | server         | —                          | Stripe product id used for one-time AI credit pack checkout sessions.                                                                                                                                            |
| `STRIPE_AUTOMATION_RUN_PRODUCT_ID`                         | server         | —                          | Stripe product id used for one-time automation run top-up checkout sessions.                                                                                                                                     |
| `STRIPE_STARTER_PRICE_ID`                                  | server         | —                          | Stripe recurring price id for the Starter subscription tier.                                                                                                                                                     |
| `STRIPE_PRO_PRICE_ID`                                      | server         | —                          | Stripe recurring price id for the Pro subscription tier.                                                                                                                                                         |
| **OAuth helper**                                           |                |                            |                                                                                                                                                                                                                  |
| `KEPPO_OAUTH_HELPER_MACOS_URL`                             | server         | —                          | macOS helper download URL. `404` when unset.                                                                                                                                                                     |
| `KEPPO_OAUTH_HELPER_WINDOWS_URL`                           | server         | —                          | Windows helper download URL. `404` when unset.                                                                                                                                                                   |
| `KEPPO_OAUTH_HELPER_MACOS_FILENAME`                        | server         | —                          | Dashboard filename label for macOS helper                                                                                                                                                                        |
| `KEPPO_OAUTH_HELPER_WINDOWS_FILENAME`                      | server         | —                          | Dashboard filename label for Windows helper                                                                                                                                                                      |
| `KEPPO_OAUTH_HELPER_VERSION`                               | server         | `dev`                      | Helper version string                                                                                                                                                                                            |
| **Self-hosted overrides**                                  |                |                            |                                                                                                                                                                                                                  |
| `KEPPO_PROVIDER_MODULES`                                   | server         | —                          | CSV of canonical provider IDs, `all`, or `*`                                                                                                                                                                     |
| `KEPPO_PROVIDER_DEPRECATIONS_JSON`                         | server         | —                          | JSON object of deprecation notices keyed by provider ID                                                                                                                                                          |
| `VITE_API_BASE`                                            | client         | `/api`                     | Only set for non-default self-hosted API routing                                                                                                                                                                 |

Notes:

- `KEPPO_API_INTERNAL_BASE_URL` must be publicly reachable from the Vercel sandbox. Loopback addresses will dispatch a sandbox that cannot stream logs or send callbacks.
- `UNIKRAFT_CODE_MODE_BRIDGE_BASE_URL` must be reachable from the Unikraft MicroVM. In local-only experiments you can rely on the default loopback bridge URL, but production/preview deployments need a public or otherwise routable callback origin.
- If Vercel Deployment Protection is enabled, propagate `VERCEL_AUTOMATION_BYPASS_SECRET` into both the API runtime and the hosted Convex env.
- Local `docker` sandbox execution requires a working Docker engine on the API host.
- For local development, keep `KEPPO_URL`, `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, `CONVEX_URL`, and `CONVEX_SITE_URL` on the same hostname. Prefer `localhost` everywhere; mixing `localhost` and `127.0.0.1` splits Better Auth cookies.
- Local same-site auth defaults to the dashboard origin proxy: `http://localhost:3000/api/auth/*` proxies to the local Convex Better Auth site on `http://localhost:3211/api/auth/*`. Browser E2E uses the same shape with the worker dashboard port.
- Client IP resolution: `none` ignores forwarded headers, `vercel` prefers `x-real-ip`, `cloudflare` prefers `cf-connecting-ip`.
- Invite-code behavior is billing-oriented:
  - free invite codes are no longer required for dashboard access.
  - paid promos: Starter/Pro invite codes create a one-month `invite_code_redemptions` row, temporarily set the subscription to `trialing`, and fall back to Free unless the org starts a Stripe subscription before expiry.

### Unikraft Cloud setup

1. Create a Unikraft Cloud account and generate an API token for the target metro.
2. Push the existing automation sandbox image to an OCI registry reachable by Unikraft Cloud, then set `UNIKRAFT_SANDBOX_IMAGE` to that image reference.
3. If you want Code Mode on Unikraft, set `UNIKRAFT_CODE_MODE_IMAGE` as needed and configure `UNIKRAFT_CODE_MODE_BRIDGE_BASE_URL` so the MicroVM can reach the host bridge callback.
4. Set `KEPPO_SANDBOX_PROVIDER=unikraft` and/or `KEPPO_CODE_MODE_SANDBOX_PROVIDER=unikraft` once those credentials and image references are in place.

### Same-site auth (always on)

- Better Auth uses `KEPPO_URL` as `baseURL` on Convex and the dashboard client targets `window.location.origin` (SSR uses `VITE_KEPPO_URL` / `VITE_CONVEX_*` fallbacks). Browser requests go through `/api/auth/*` on the dashboard origin; cross-domain Better Auth plugins are not used.
- In local dev, keep `KEPPO_URL=http://localhost:3000`, `VITE_KEPPO_URL=http://localhost:3000`, `CONVEX_URL=http://localhost:3210`, and `CONVEX_SITE_URL=http://localhost:3211`.
- Register OAuth callback URLs on the dashboard origin, for example `https://staging.keppo.ai/api/auth/callback/google` and `https://staging.keppo.ai/api/auth/callback/github`.

### Environment diagnostics

```bash
pnpm env:check
```

Follows `KEPPO_ENVIRONMENT` through the shared `dotenvx` loader. Exits non-zero when required values are missing.

### Local validation for provider-trigger changes

- Do not run the full E2E suite locally for automation-trigger work.
- Use targeted local browser coverage instead:

```bash
pnpm run test:e2e:base -- tests/e2e/specs/automations/provider-event-triggers.spec.ts
```

- Validate full browser coverage on GitHub Actions after pushing the branch.

---

## Auth configuration

`convex/auth.config.ts` uses `getAuthConfigProvider()` from `@convex-dev/better-auth/auth-config`. `convex/http.ts` registers better-auth routes at `https://<deployment>.convex.site/api/auth/*`.

`KEPPO_URL` must match the dashboard origin users visit.

Common auth failures:

- Missing `BETTER_AUTH_SECRET` in Convex env
- Wrong `KEPPO_URL` for the active environment
- Missing `VITE_CONVEX_SITE_URL` in dashboard env
- Missing social provider credentials (`GOOGLE_*`, `GITHUB_*`) when social login is enabled

---

## GitHub Actions agent workflows

The `issue-agent.yml` and `fix-pr.yml` workflows run in the `ai-bots` GitHub Actions environment and require:

- repository variable `KEPPO_GITHUB_APP_ID`
- environment secret `KEPPO_GITHUB_APP_PRIVATE_KEY`
- environment secret `CLAUDE_CODE_OAUTH_TOKEN`
- environment secret `CODEX_AUTH_JSON`
- environment secret `VERCEL_DEMO_BLOB_READ_WRITE_TOKEN` when agent-driven PRs are expected to publish demo videos
- environment variable `KEPPO_SESSION_LOG_UPLOAD_URL` when issue-agent runs should publish session logs
- environment secret `KEPPO_SESSION_LOG_UPLOAD_TOKEN` for bearer-authenticated session log uploads

Notes:

- `CODEX_AUTH_JSON` must contain the full contents of a working Codex CLI auth file, equivalent to `~/.codex/auth.json`.
- `VERCEL_DEMO_BLOB_READ_WRITE_TOKEN` should point at a public Vercel Blob store reserved for reviewer-facing PR demos.
- Session-log upload endpoints should return a `viewer_url` immediately for uploaded or duplicate logs.

Label contract:

- Issue labels: `/do-issue`, `/plan-issue`, `?agent:claude`, `?agent:codex`, `do-issue:pending|done|failed`, `plan-issue:pending|done|failed`, `prompt-injection-risk`
- PR labels: `/fix-pr`, `?agent:claude`, `?agent:codex`, `fix-pr:pending|done|failed`, `/sync-pr`, `sync-pr:pending|failed`, `needs-human:review-issue`, `needs-human:final-check`

Selection rules:

- Issues default to Codex when neither agent label is present.
- If both issue agent labels are present, `/do-issue` creates two branches and two PRs, while `/plan-issue` posts two separate plan comments.
- PRs default to Codex when neither agent label is present.
- If both PR agent labels are present, `/fix-pr` fails closed because both agents cannot safely mutate the same PR branch at once.

---

## GitHub security advisory alerts workflow

The `github-security-advisory-alerts.yml` workflow runs nightly and on manual dispatch in the `ai-bots` GitHub Actions environment. It counts repository security advisories that are still in `triage` or `draft` and sends an email alert only when that combined count is non-zero.

Required configuration:

- repository variable `KEPPO_GITHUB_APP_ID`
- environment secret `KEPPO_GITHUB_APP_PRIVATE_KEY`
- environment secret `MAILGUN_API_KEY`
- environment variable `MAILGUN_DOMAIN`
- environment variable `MAILGUN_FROM_EMAIL`
- environment variable `SECURITY_ADVISORY_ALERT_EMAILS` — comma-separated recipient list

## Nightly recent security review workflow

The `security-review-recent.yml` workflow runs nightly at `2:00 AM` Pacific time and on manual dispatch in the `ai-bots` GitHub Actions environment. It runs Codex with the repo-local `security-review:recent` skill against commits from the last 7 days, writes confirmed `critical`/`high` findings to `out-security-review/findings.json`, files draft repository security advisories for new findings, credits `wwwillchen` on newly created advisories, performs local exact-match dedupe against unpublished advisories, performs a bounded Codex semantic check only against already published advisories, and sends a Mailgun email when the run confirms any vulnerabilities.

Required configuration:

- environment secret `CODEX_AUTH_JSON`
- repository variable `KEPPO_GITHUB_APP_ID`
- environment secret `KEPPO_GITHUB_APP_PRIVATE_KEY`
- environment secret `MAILGUN_API_KEY`
- environment variable `MAILGUN_DOMAIN`
- environment variable `MAILGUN_FROM_EMAIL`
- environment variable `SECURITY_ADVISORY_ALERT_EMAILS` — comma-separated recipient list
- environment variable `SECURITY_ADVISORY_COLLABORATOR` — optional collaborator login to credit on newly created advisories; defaults to `wwwillchen`

Token requirements:

- The workflow intentionally keeps the job `GITHUB_TOKEN` at `contents: read` and mints a GitHub App installation token only for the deterministic advisory-filing step.
- `actions/create-github-app-token` does not support `repository_advisories` fine-grained permission inputs yet, so this workflow must currently mint the installation token without `permission-*` scoping and rely on the App installation's configured permissions.

---

## Convex preview deployment cleanup

The `convex-preview-cleanup.yml` workflow runs nightly and on manual dispatch to delete stale Convex preview deployments. It uses the `convex-preview-cleanup` GitHub Actions environment and requires:

- environment secret `CONVEX_TEAM_ACCESS_TOKEN` — a Convex team access token with permission to list and delete deployments
- environment variable `CONVEX_PROJECT_ID` — the numeric Convex project ID

Workflow dispatch inputs:

- `max_age_days` — delete preview deployments older than this many days (default: 3)
- `dry_run` — when true, log which deployments would be deleted without actually deleting them

---

## First-run operator path

When a better-auth organization is created, Convex bootstrap creates a `retention_policies` record (if missing), one default workspace with manual approval mode, and one workspace credential record.

For a clean self-hosted install:

1. Sign in and land in the default workspace.
2. Follow the highlighted readiness step on the dashboard home or sidebar guide.
3. Connect an integration in `/integrations`.
4. Enable that integration for the active workspace in `/settings/workspaces`.
5. Add an organization AI key in `/settings` under `AI Configuration`.
6. Create the first automation in `/automations`, starting with manual trigger mode unless you already trust the prompt and policy settings.
7. Trigger a first action so approvals, runs, notifications, and audit history all have live data.

### Wiping all Convex data (internal / destructive)

To delete **every** document in all application tables and Better Auth component tables (for example after a botched migration or to reset a throwaway deployment):

1. In the Convex dashboard for that deployment, set environment variable `KEPPO_ALLOW_DANGEROUS_DROP_ALL=true`.
2. Open **Functions**, run internal action `dangerous_admin.dangerouslyDropAllTables` with `confirm`: `"DELETE_ALL_DATA"` (the action drains the wipe in paged mutation batches so large deployments do not hit single-mutation read limits).
3. After the wipe completes, remove `KEPPO_ALLOW_DANGEROUS_DROP_ALL` (or set it to anything other than `true`) so the action cannot run accidentally.

This also deletes app-owned blobs in Convex file storage (`_storage`) when rows reference them, but it does not enumerate unrelated orphaned storage objects. It is not a substitute for `convex dev --local` reset when you only need a clean local backend.

---

## Further reading

- [Architecture](specs/high-level-architecture.md) — system components and ownership model
- [API route surface](specs/control-plane-api.md) — full route table, auth expectations, and protocol details
- [Testing strategy](specs/testing-strategy.md) — canonical ownership of test layers and browser-test scope
- [Security rules](rules/security.md) — auth, webhooks, sandboxing, and runtime secret guardrails
- [Environment/runtime rules](rules/env_runtime.md) — local and hosted env loading, Convex sync, and runtime boundary rules
- [Provider SDK fidelity rules](rules/provider_sdk_fidelity.md) — provider adapter and metadata guardrails
- [Non-E2E testing rules](rules/non_e2e_testing.md) — fast-layer ownership and authoring constraints
- [E2E testing rules](rules/e2e_testing.md) — browser-test isolation, budgets, and infra contracts
- [GitHub workflow rules](rules/github-workflows.md) — runner, label, and agent-selection rules
- [GitHub workflow security rules](rules/github-security.md) — trusted checkout and post-agent mutation boundaries
- [Operations runbooks](runbooks/README.md) — incident response procedures and alerting setup
- [Izzy setup](izzy/setup.md) — standalone issue-authoring app
