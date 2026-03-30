# Vercel Deployment Guide

Keppo’s default hosted shape is one Vercel web project rooted at [`apps/web`](../apps/web). That project uses [`apps/web/vercel.json`](../apps/web/vercel.json), builds the TanStack Start app in place, and ships the unified web/runtime boundary directly.

The unified web project owns all hosted entrypoints. Requests land in the Start runtime first, and unknown protocol-like ingress now fails closed instead of forwarding into a separate legacy runtime.

Start-owned hosted entrypoints now include:

- Provider webhook ingress (`/webhooks/:provider`)
- OAuth helper download redirects (`/downloads/oauth-helper/{macos|windows}/latest`)
- Internal maintenance cron route (`/internal/cron/maintenance`)
- Internal approved-action dispatch route (`/internal/queue/dispatch-approved-action`)
- Internal automation runtime routes (`/internal/automations/dispatch`, `/internal/automations/terminate`, `/internal/automations/log`, `/internal/automations/complete`)
- Internal deep-health route (`/internal/health/deep`)
- Internal DLQ routes (`/internal/dlq`, `/internal/dlq/:id/replay`, `/internal/dlq/:id/abandon`)

Production maintenance scheduling runs in Convex. The API maintenance route is only an internal manual/operator hook.

## 1) Create the web project

- Import the repo once.
- Set the Vercel project Root Directory to `apps/web` so Vercel picks up [`apps/web/vercel.json`](../apps/web/vercel.json) and the project-local `.vercel/output/` bundle.
- Use the Node/Other Vercel runtime so the Start server output remains the primary entrypoint.
- Leave Output Directory unset.

## 2) Hosted behavior

- Dashboard requests are served from the same deployment origin through Vercel static hosting.
- API requests default to same-origin `/api/*`.
- [`apps/web/vercel.json`](../apps/web/vercel.json) applies the baseline browser-hardening headers to static responses.
- [`apps/web/vercel.json`](../apps/web/vercel.json) keeps only `/health*` rewritten to `/api/health*` so the hosted readiness surface stays JSON-shaped. Root-path `/webhooks/*`, `/downloads/*`, `/mcp/*`, and `/internal/*` now reach the Start runtime directly, and unowned protocol paths fail closed with JSON `404 route_not_found`.
- `VITE_API_BASE` is optional for hosted deploys. Keep it unset or set it to `/api`; only use a full URL for non-default self-hosted API routing.

## 3) Required env

Important routes:

- Public:
  - `GET /api/health`
  - `POST /api/oauth/integrations/:provider/connect`
  - `GET /oauth/integrations/:provider/callback`
  - `POST /webhooks/:provider`
  - `GET /downloads/oauth-helper/{macos|windows}/latest`
  - `POST /mcp/:workspaceId`
  - `DELETE /mcp/:workspaceId`
- Internal (cron/queue):
  - `POST /internal/cron/maintenance`
  - `POST /internal/queue/dispatch-approved-action`
  - `POST /internal/automations/dispatch`
  - `POST /internal/automations/terminate`
  - `POST /internal/automations/log`
  - `POST /internal/automations/complete`
- Internal (operator health):
  - `GET /internal/health/deep`
  - `GET /internal/dlq`
  - `POST /internal/dlq/:id/replay`
  - `POST /internal/dlq/:id/abandon`

Required env:

- `KEPPO_ENVIRONMENT=preview|staging|production`
- `preview` uses deployment-provided env only; `staging` loads `.env.staging` at runtime; `production` can load optional `.env.production` values while still relying on deployment-provided secrets
- `CONVEX_URL`
- `KEPPO_CONVEX_ADMIN_KEY`
- `KEPPO_URL=https://<web-domain>` for `staging`/`production`
- For `preview`, `KEPPO_URL` is derived from Vercel’s `VERCEL_BRANCH_URL` first and falls back to `VERCEL_URL` unless you explicitly override it
- OAuth/provider secrets used by enabled providers (Google/Stripe/GitHub).

Build behavior:

- [`apps/web/vercel.json`](../apps/web/vercel.json) runs `pnpm --dir ../.. run build:web:vercel`.
- `pnpm run build:web:vercel` now branches by `KEPPO_ENVIRONMENT`.
- For `preview`, it derives `KEPPO_URL`, `KEPPO_API_INTERNAL_BASE_URL`, and `BETTER_AUTH_TRUSTED_ORIGINS` from `VERCEL_BRANCH_URL` or `VERCEL_URL` and exports them before running `pnpm exec convex deploy --cmd "./scripts/build-web-with-preview-convex.sh"`. That lets Convex analyze Better Auth modules without tripping the non-local `KEPPO_URL` guard. The helper script then maps the provisioned `CONVEX_URL` / `CONVEX_SITE_URL` into `VITE_CONVEX_URL` / `VITE_CONVEX_SITE_URL` for the dashboard build, and `./scripts/convex-sync-hosted-env.sh` pushes the same preview-safe runtime env into the preview deployment.
- For `staging` and `production`, it loads the selected repo-root env file, runs `./scripts/convex-sync-hosted-env.sh` first so hosted Convex runtime env stays in sync, then runs `pnpm exec convex deploy --cmd "./scripts/build-web-with-hosted-convex.sh"` so Convex code/schema and the web artifact deploy together.
- Preview builds must not rely on a localhost fallback for `VITE_CONVEX_URL`; missing hosted Convex env should fail the build instead.
- Nitro bundles repo-root `.env.staging` and `.env.production` into the server function as `runtime-env` server assets; at runtime the API entrypoint loads only the file selected by `KEPPO_ENVIRONMENT`, and `preview` intentionally skips file-backed env.
- Preview builds default `ENABLE_EMAIL_PASSWORD=true` (the web bundle injects `VITE_ENABLE_EMAIL_PASSWORD` from it). The dashboard’s existing email/password flow auto-creates the user on first successful sign-in attempt, so `demo@keppo.ai` / `demo` works as a lazy-created preview demo account unless you override those values.

Cron + scheduling env:

- `KEPPO_CRON_SECRET=<shared-internal-secret>` (or `VERCEL_CRON_SECRET`)
- Optional automation sandbox runtime:
  - `KEPPO_SANDBOX_PROVIDER=vercel`
  - recommended auth: `VERCEL_OIDC_TOKEN`
  - fallback auth: `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`

Convex env (same deployment) must include:

- `BETTER_AUTH_SECRET=<random-secret>`
- `KEPPO_MASTER_KEY=<runtime-encryption-key>`
- `KEPPO_URL=https://<dashboard-domain>`
- Optional maintenance sweep overrides when you do not want Convex defaults:
  - `KEPPO_ACTION_TTL_MINUTES=<minutes>`
  - `KEPPO_RUN_INACTIVITY_MINUTES=<minutes>`
  - `KEPPO_QUEUE_ENQUEUE_SWEEP_LIMIT=<count>`
- optional social sign-in credentials:
  - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
  - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`

## 4) Vercel config

The [`apps/web/vercel.json`](../apps/web/vercel.json) configures the build, routing, and function bundle. Production maintenance cadence is defined in `convex/crons.ts`.

## 5) Domain/callback checklist

1. Web domain: `https://app.example.com`
2. API env:
   - `KEPPO_DASHBOARD_ORIGIN=https://app.example.com`
   - optional `CORS_ALLOWED_ORIGINS=https://app.example.com`
   - `KEPPO_API_INTERNAL_BASE_URL=https://app.example.com/api`
   - provider redirect URIs under `https://app.example.com/oauth/...`
3. Better-auth callbacks are registered on the dashboard origin:
   - `https://app.example.com/api/auth/callback/google`
   - `https://app.example.com/api/auth/callback/github`
4. For preview deploys, `VITE_CONVEX_URL` should come from the `convex deploy --cmd` preview provisioning flow rather than a hand-maintained preview env value. `KEPPO_DASHBOARD_ORIGIN` now derives from `VERCEL_BRANCH_URL` by default and falls back to `VERCEL_URL`, and `KEPPO_API_INTERNAL_BASE_URL` defaults from that origin plus `/api`; only set explicit overrides when preview needs a non-default host.

## 6) Quick verify

- `GET https://app.example.com/api/health` returns `{"ok":true}`.
- `GET https://app.example.com/` returns the dashboard shell from Vercel static hosting.
- Manual maintenance route is unauthorized without bearer secret.
- Manual maintenance route runs with `Authorization: Bearer <KEPPO_CRON_SECRET>`.
