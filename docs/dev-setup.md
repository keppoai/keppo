# Development Setup

Local contributor setup, verification, and repo-maintainer workflow prerequisites. For deployment/runtime env and operator onboarding, see [Self-Hosting Setup](self-hosting-setup.md).

## Prerequisites

- **Node.js** 22 (see `node-version` in CI workflows)
- **pnpm** (see `packageManager` in root `package.json`)
- **Convex CLI** (`npx convex`)
- **Docker** (required for local automation sandbox runs when `KEPPO_SANDBOX_PROVIDER=docker`, for local Code Mode runs when `KEPPO_CODE_MODE_SANDBOX_PROVIDER=docker`, and for PR/main GitHub Actions E2E validation of those Docker-backed paths)
- **ffmpeg / ffprobe** (required when trimming or reviewing reviewer-facing PR demo videos with the repo-owned `$create-video-demo` tooling)
- **Secure Exec dependencies** (installed by `pnpm install`; used only for CI/test runs when `KEPPO_SANDBOX_PROVIDER=secure_exec` or `KEPPO_CODE_MODE_SANDBOX_PROVIDER=secure_exec`)
- **Unikraft Cloud account + API token** (required only when intentionally validating `KEPPO_SANDBOX_PROVIDER=unikraft` or `KEPPO_CODE_MODE_SANDBOX_PROVIDER=unikraft`)
- **Rust toolchain + adjacent `../jslite` checkout, explicit `KEPPO_JSLITE_PROJECT_PATH`, or explicit `KEPPO_JSLITE_SIDECAR_PATH`** (required only when intentionally validating `KEPPO_CODE_MODE_SANDBOX_PROVIDER=jslite`; this mode is local/dev-only and stays blocked in production)
- Environment variables loaded via [dotenvx](https://dotenvx.com)

## Runtime layout

- `cloud/` is a normal workspace package that holds the canonical billing, scheduler, advanced gating, and Vercel sandbox runtime modules.
- `convex/` and `apps/web` are the active runtime seams. `apps/web` is the canonical app/runtime boundary for local development, typed server functions, the public docs surface at `/docs`, the built-in docs search endpoint at `/api/search`, and the full live HTTP surface for health, invites, billing, provider OAuth connect/callback, provider webhooks, the root MCP transport, automation prompt generation, internal cron/queue dispatch, internal deep-health and DLQ routes, MCP test, and push subscription. Shared server-only helper modules live under `apps/web/app/lib/server/api-runtime/`.
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
- `pnpm run test:e2e:meta` for non-browser E2E infra and authoring guardrails that also run in the shared PR/main CI lane
- `pnpm run test:e2e:base -- <playwright-args...>` for local browser debugging

### Local browser policy

- Do not run the full E2E suite locally.
- Use targeted Playwright specs only, then validate the full suite on GitHub Actions.
- Docs changes use `pnpm run test:e2e:base -- tests/e2e/specs/docs/public-docs.spec.ts`.
- For automation-trigger work, use `pnpm run test:e2e:base -- tests/e2e/specs/automations/provider-event-triggers.spec.ts`.
- For shared E2E runtime-contract debugging, use `pnpm run test:e2e:base -- tests/e2e/specs/meta/order-and-workers.spec.ts`; the non-browser companion checks live in `pnpm run test:e2e:meta`.
- For intentional Code Mode sandbox verification, set `KEPPO_E2E_REQUIRE_CODE_MODE_SANDBOX=1` so sandbox unavailability becomes a hard failure instead of a skip. The shared PR/main GitHub Actions E2E workflow exports that env and explicit Docker sandbox-provider env by default.

## Environment diagnostics

```bash
pnpm env:check
```

Follows `KEPPO_ENVIRONMENT` through the shared `dotenvx` loader. Exits non-zero when required values are missing.

## Local auth and runtime notes

- Better Auth uses `KEPPO_URL` as `baseURL` on Convex and the dashboard client targets `window.location.origin` (SSR uses `VITE_KEPPO_URL` / `VITE_CONVEX_*` fallbacks). Browser requests go through `/api/auth/*` on the dashboard origin; cross-domain Better Auth plugins are not used.
- In local dev, keep `KEPPO_URL=http://localhost:3000`, `VITE_KEPPO_URL=http://localhost:3000`, `CONVEX_URL=http://localhost:3210`, and `CONVEX_SITE_URL=http://localhost:3211`.
- For local development, keep `KEPPO_URL`, `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, `CONVEX_URL`, and `CONVEX_SITE_URL` on the same hostname. Prefer `localhost` everywhere; mixing `localhost` and `127.0.0.1` splits Better Auth cookies.
- Local same-site auth defaults to the dashboard origin proxy: `http://localhost:3000/api/auth/*` proxies to the local Convex Better Auth site on `http://localhost:3211/api/auth/*`. Browser E2E uses the same shape with the worker dashboard port.

## Provider catalog maintenance

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

## GitHub Actions maintainer setup

### Agent workflows

The `issue-agent.yml` and `fix-pr.yml` workflows run in the `ai-bots` GitHub Actions environment and require:

- repository variable `KEPPO_GITHUB_APP_ID`
- environment secret `KEPPO_GITHUB_APP_PRIVATE_KEY`
- environment secret `CLAUDE_CODE_OAUTH_TOKEN`
- environment secret `CODEX_AUTH_JSON`
- optional environment secrets `CODEX_AUTH_JSON_1` and `CODEX_AUTH_JSON_2` for random Codex auth rotation in GitHub Actions
- environment secret `COPILOT_GITHUB_TOKEN` with a fine-grained PAT that has the `Copilot Requests` permission when `?agent:gh-copilot` issue runs are enabled
- environment secret `VERCEL_DEMO_BLOB_READ_WRITE_TOKEN` when agent-driven PRs are expected to publish demo videos
- environment variable `KEPPO_SESSION_LOG_UPLOAD_URL` when issue-agent runs should publish session logs
- environment secret `KEPPO_SESSION_LOG_UPLOAD_TOKEN` for bearer-authenticated session log uploads

Notes:

- `CODEX_AUTH_JSON` must contain the full contents of a working Codex CLI auth file, equivalent to `~/.codex/auth.json`.
- When `CODEX_AUTH_JSON_1` and `CODEX_AUTH_JSON_2` are present, Codex workflows randomly choose one non-empty unique auth blob from that pool plus `CODEX_AUTH_JSON` on each run.
- `COPILOT_GITHUB_TOKEN` should be a fine-grained PAT from a GitHub user with an active Copilot license and the `Copilot Requests` permission.
- `VERCEL_DEMO_BLOB_READ_WRITE_TOKEN` should point at a public Vercel Blob store reserved for reviewer-facing PR demos.
- Session-log upload endpoints should return a `viewer_url` immediately for uploaded or duplicate logs.

Label contract:

- Issue labels: `/do-issue`, `/plan-issue`, `?agent:claude`, `?agent:codex`, `?agent:gh-copilot`, `do-issue:pending|done|failed`, `plan-issue:pending|done|failed`
- PR labels: `/fix-pr`, `?agent:claude`, `?agent:codex`, `fix-pr:pending|done|failed`, `/sync-pr`, `sync-pr:pending|failed`, `needs-human:review-issue`, `needs-human:final-check`

Selection rules:

- Issues default to Codex when no issue agent label is present.
- If multiple issue agent labels are present, `/do-issue` creates one branch and PR per selected agent, while `/plan-issue` posts one plan comment per selected agent, with up to three parallel issue-agent runs when all supported labels are present.
- PRs default to Codex when neither agent label is present.
- If both PR agent labels are present, `/fix-pr` fails closed because both agents cannot safely mutate the same PR branch at once.

### GitHub security advisory alerts workflow

The `github-security-advisory-alerts.yml` workflow runs nightly and on manual dispatch in the `ai-bots` GitHub Actions environment. It fetches repository security advisories that are still in `triage` or `draft`, filters the alert to `high` and `critical` severities only, and sends an email only when that filtered combined count is non-zero. The email includes each alertable advisory's summary and `created_at` timestamp. `medium`, `low`, and unset-severity advisories are excluded from both the count and the alert trigger.

Required configuration:

- repository variable `KEPPO_GITHUB_APP_ID`
- environment secret `KEPPO_GITHUB_APP_PRIVATE_KEY`
- environment secret `MAILGUN_API_KEY`
- environment variable `MAILGUN_DOMAIN`
- environment variable `MAILGUN_FROM_EMAIL`
- environment variable `SECURITY_ADVISORY_ALERT_EMAILS` - comma-separated recipient list

### Nightly recent security review workflow

The `security-review-recent.yml` workflow runs nightly at `2:00 AM` Pacific time and on manual dispatch in the `ai-bots` GitHub Actions environment. Manual dispatch supports `codex` and `claude` agents and defaults to `codex`. The workflow runs the selected agent against the repo-local `security-review:recent` prompt context for commits from the last 7 days, writes confirmed `critical`/`high` findings as individual markdown files to `out-security-review/findings/`, uploads session logs, files draft repository security advisories for new findings, deduplicates against existing advisory summaries, and sends a Mailgun email when the run confirms any vulnerabilities.

Required configuration:

- environment secret `CODEX_AUTH_JSON`
- optional environment secrets `CODEX_AUTH_JSON_1` and `CODEX_AUTH_JSON_2` for random Codex auth rotation in GitHub Actions
- environment secret `CLAUDE_CODE_OAUTH_TOKEN` when dispatching with `agent=claude`
- repository variable `KEPPO_GITHUB_APP_ID`
- environment secret `KEPPO_GITHUB_APP_PRIVATE_KEY`
- environment secret `MAILGUN_API_KEY`
- environment variable `MAILGUN_DOMAIN`
- environment variable `MAILGUN_FROM_EMAIL`
- environment variable `SECURITY_ADVISORY_ALERT_EMAILS` - comma-separated recipient list

Token requirements:

- The workflow intentionally keeps the job `GITHUB_TOKEN` at `contents: read` and mints a GitHub App installation token only for the deterministic advisory-filing step.
- Claude runs pin `@anthropic-ai/claude-code` to the workflow-declared `CLAUDE_CODE_VERSION` and use an explicit allowlist-based permission model instead of bypassing permissions entirely.
- `actions/create-github-app-token` does not support `repository_advisories` fine-grained permission inputs yet, so this workflow must currently mint the installation token without `permission-*` scoping and rely on the App installation's configured permissions.

### Nightly recent code architecture workflow

The `code-architect-recent.yml` workflow runs nightly at `4:00 AM` Pacific time during daylight saving time (`3:00 AM` Pacific during standard time) and on manual dispatch in the `ai-bots` GitHub Actions environment. Manual dispatch supports `codex` and `claude` agents and defaults to `codex`. The workflow runs the selected agent against the repo-local `code-architect:recent` prompt context for commits from the last 7 days, writes confirmed `critical`/`high` structural maintainability findings as individual markdown files to `out-code-architect/findings/`, uploads session logs, files GitHub issues labeled `architecture-review` for new findings, deduplicates against existing architecture-review issues, and sends a Mailgun email when the run creates new issues or needs operator attention.

Required configuration:

- environment secret `CODEX_AUTH_JSON`
- optional environment secrets `CODEX_AUTH_JSON_1` and `CODEX_AUTH_JSON_2` for random Codex auth rotation in GitHub Actions
- environment secret `CLAUDE_CODE_OAUTH_TOKEN` when dispatching with `agent=claude`
- repository variable `KEPPO_GITHUB_APP_ID`
- environment secret `KEPPO_GITHUB_APP_PRIVATE_KEY`
- environment secret `MAILGUN_API_KEY`
- environment variable `MAILGUN_DOMAIN`
- environment variable `MAILGUN_FROM_EMAIL`
- environment variable `CODE_ARCHITECT_ALERT_EMAILS` - comma-separated recipient list

Token requirements:

- The workflow intentionally keeps the job `GITHUB_TOKEN` at `contents: read` and mints a GitHub App installation token with `issues: write` only for the deterministic issue-filing step.
- Claude runs pin `@anthropic-ai/claude-code` to the workflow-declared `CLAUDE_CODE_VERSION`, restrict writes to `./out-code-architect/**`, and execute the recent-file selection helper from the trusted workflow checkout.

### Convex preview deployment cleanup

The `convex-preview-cleanup.yml` workflow runs nightly and on manual dispatch to delete stale Convex preview deployments. It uses the `convex-preview-cleanup` GitHub Actions environment and requires:

- environment secret `CONVEX_TEAM_ACCESS_TOKEN` - a Convex team access token with permission to list and delete deployments
- environment variable `CONVEX_PROJECT_ID` - the numeric Convex project ID

Workflow dispatch inputs:

- `max_age_days` - delete preview deployments older than this many days (default: 3)
- `dry_run` - when true, log which deployments would be deleted without actually deleting them

## Further reading

- [Self-Hosting Setup](self-hosting-setup.md) - deployment/runtime env and operator onboarding
- [Architecture](specs/high-level-architecture.md) - system components and ownership model
- [Testing strategy](specs/testing-strategy.md) - canonical ownership of test layers and browser-test scope
- [Security rules](rules/security.md) - auth, webhooks, sandboxing, and runtime secret guardrails
- [Environment/runtime rules](rules/env_runtime.md) - local and hosted env loading, Convex sync, and runtime boundary rules
- [Operations runbooks](runbooks/README.md) - incident response procedures and alerting setup
- [Izzy setup](izzy/setup.md) - standalone issue-authoring app
