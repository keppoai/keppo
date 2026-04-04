# Environment and Runtime Rules

## Local Convex startup

- For local Convex, do not call `convex env set` before `convex dev --local` has started listening. The local CLI requires a live backend before runtime env writes succeed.
- When syncing multiple Convex env vars from repo or process state, prefer one bulk `convex env set --force --from-file <dotenv-file>` call when the installed CLI supports those flags. If the local CLI only supports `convex env set NAME value`, fall back to per-key writes instead of passing unsupported options and aborting local startup or E2E bootstrap.
- Local startup scripts must:
  - export required shell env first (`BETTER_AUTH_SECRET`, `KEPPO_URL`, etc.),
  - start `convex dev --local`,
  - wait for the local backend/config to exist,
  - then sync runtime env into Convex, including the local/test runtime marker used by E2E-only helpers.
- For E2E harnesses, prefer `NODE_ENV=test` as the runtime-local signal instead of forcing `CONVEX_DEPLOYMENT=local:*` into Convex env; unrelated local-development feature gates may treat the deployment marker as opt-in behavior.
- For local runtime env sync, target the running backend as self-hosted (`CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY`) instead of selecting it through `CONVEX_DEPLOYMENT`. Using `convex env set` against a local deployment name routes through the hosted control plane and fails with deployment-config or access-token errors.
- Treat `.convex/local/default/config.json` as the local source of truth for deployment name, URLs, and admin key.
- Shared `dotenvx` loaders must select env files from `KEPPO_ENVIRONMENT` with a closed set: `development` loads committed `.env.dev` plus untracked `.env.local` as the machine-local override, `preview` uses deployment-provided env plus the generated `.env.preview` runtime asset from the hosted build, `staging` loads committed `.env.staging` without `.env.local`, and `production` should rely on deployment-provided env with optional `.env.production`.
- The `apps/web` Vercel entrypoint must require an explicit `KEPPO_ENVIRONMENT=preview|staging|production`; `preview` loads deployment-provided env and a generated `.env.preview` Nitro server asset so Convex preview URLs survive into runtime validation, while `staging` and `production` map to repo-root `.env.staging` / `.env.production` bundled into Nitro server assets for runtime loading.
- Hosted `staging` and `production` build wrappers must export the selected repo-root env file into the shell before the Vite/TanStack Start build begins. Syncing Convex runtime env alone is insufficient because browser `VITE_*` values such as `VITE_CONVEX_URL` must exist at bundle-build time.
- Hosted Convex env sync must start from the selected repo-root env file but preserve non-empty deployment-provided overrides and secrets from the shell environment. Keep deployment-only values such as `VERCEL_AUTOMATION_BYPASS_SECRET` for `preview` and `staging`, but intentionally exclude that bypass secret from `production`.
- Convex-managed runtime env keys must come from the shared manifest in `scripts/convex-managed-env.mjs`. When Convex code adds a new `process.env.*` read, classify it there as either managed-by-sync or intentionally unmanaged so local and hosted sync paths cannot drift.
- Managed Convex env collectors must preserve explicit empty-string overrides from the caller environment. For keys like `KEPPO_LLM_GATEWAY_URL`, dropping an explicit empty value during sync leaves stale runtime config behind and can silently keep bundled-runtime behavior enabled.
- Hosted `staging` and `production` Vercel deploys must sync the selected hosted Convex runtime env and then run `convex deploy --cmd '<build command>'` so Convex code/schema deploy in lockstep with the web artifact.
- Hosted preview builds must provision Convex before building the web artifact. When the build relies on Convex-injected preview env such as `VITE_CONVEX_URL`, use `convex deploy --cmd '<build command>'` instead of running `convex env set` or a standalone `convex deploy` after the build.
- Hosted preview build wrappers must export derived preview origin env (`KEPPO_URL`, `KEPPO_API_INTERNAL_BASE_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, and related same-origin values) into the shell before `convex deploy` starts. Better Auth is analyzed during Convex module import, so deferring those values until a later `convex env set` step is too late.
- Hosted unified web builds should default dashboard API traffic to same-origin `/api`. Keep `VITE_API_BASE` as an explicit override only for non-default self-hosted API routing rather than a required hosted input.
- When `KEPPO_URL` defines the unified web origin, derive `KEPPO_API_INTERNAL_BASE_URL` from that origin plus `/api`.
- When constructing root-owned internal/protocol URLs (`/internal/*`, `/mcp/*`, `/oauth/*`, `/webhooks/*`) from `KEPPO_API_INTERNAL_BASE_URL`, resolve them with URL semantics instead of string concatenation so a same-origin `/api` base still targets the real root route (`/internal/...`, not `/api/internal/...`).
- E2E and local-Convex harnesses that boot the fake Dyad gateway must also export `KEPPO_LLM_GATEWAY_URL` to that fake gateway base URL before syncing Convex env. Otherwise Convex reports `bundled_runtime_enabled: false`, and paid-tier billing/runtime tests silently behave like generation-only mode.
- Dashboard auth is always same-origin (`/api/auth/*`). Never call `authClient.getCookie()` from dashboard code; rely on browser cookies forwarded with the current request. Use the shared Better Auth cookie helper to short-circuit and omit `betterAuthCookie` entirely; direct `getCookie()` calls can trigger nonexistent `/api/auth/get-cookie` requests and Zod input failures on server functions.
- When Vercel Deployment Protection guards automation-facing hosted routes, propagate `VERCEL_AUTOMATION_BYPASS_SECRET` into both the API runtime and hosted Convex env only for non-production hosted environments. `production` must not inject or propagate that bypass secret.
- If local Convex state is recreated, refresh `.env.local` from `.convex/local/default/config.json` for:
  - `CONVEX_DEPLOYMENT`
  - `CONVEX_URL`
  - `CONVEX_SITE_URL`
  - `VITE_CONVEX_URL`
  - `VITE_CONVEX_SITE_URL`
  - `KEPPO_CONVEX_ADMIN_KEY`
- Runtime env sync helpers must replace all existing occurrences of managed keys in `.env.local`, not just the first match. Duplicate `CONVEX_*` or `VITE_CONVEX_*` entries make local bootstrap diagnostics misleading and can leave later commands targeting stale ports.

## Secret defaults and startup behavior

- Security-sensitive runtime secrets are fail-closed. Outside development/e2e contexts, Keppo does not accept fallback defaults for auth, crypto, webhook verification, or internal route protection.
- If required secrets are missing, services will fail startup or return explicit fail-closed responses (`401`/`503`) instead of silently running with insecure defaults.
- Use `.env.example` as the bootstrap template for local/self-host setups, then set unique deployment secrets per environment.
- This repo defaults local Convex CLI usage to `CONVEX_AUTOMATION_MODE=anonymous` via `.env.dev`, which avoids requiring `convex login` when working only with local deployments.
- Root `pnpm dev` waits for the local Convex sync to write `VITE_CONVEX_URL` / `VITE_CONVEX_SITE_URL` into `.env.local`, then starts the dashboard through `dotenvx` so those repo-root `VITE_*` values reach the Vite process.
- To refresh Vercel sandbox auth locally, run `pnpm vercel-refresh`; it pulls Vercel env, copies `VERCEL_OIDC_TOKEN` into `.env.local`, and deletes the temp file.
- Configure Vercel with `apps/web` as the project Root Directory so Nitro's Build Output API bundle lands at the project-local `.vercel/output/` path Vercel expects. Leave Vercel's Output Directory unset.

## Secret handling

- Keep committed `.env.dev`, `.env.staging`, and optional `.env.production` plus untracked `.env.local` `dotenvx`-compatible. Do not commit machine-local admin keys or runtime secrets in `.env.local`.
- Shared `dotenvx` loaders must honor committed `.env.keys` values for `DOTENV_PRIVATE_KEY_DEV`, `DOTENV_PRIVATE_KEY_LOCAL`, and generic `DOTENV_PRIVATE_KEY`; CI/test flows must not rely on manual shell exports alone to decrypt committed env files such as `.env.dev`.
- CI workflows that run `dotenvx`-backed local/test harnesses must provide explicit test-safe values for required encrypted secrets (for example `BETTER_AUTH_SECRET`, callback/cron secrets, master key, provider client secrets, `OPENAI_API_KEY`) whenever the runner does not have access to `.env.keys`.
- Shared `dotenvx` loaders must also preserve explicit caller-provided secret env vars after `dotenvx run`; encrypted `.env.dev` entries that cannot be decrypted in CI/test must not erase test-safe values already exported by the workflow or wrapper script.
- Keep `BETTER_AUTH_SECRET` stable across local restarts unless you are intentionally resetting local auth state.
- Keep local dashboard, Convex, and Better Auth origins on the same hostname. Prefer `localhost` across `KEPPO_URL`, `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, `CONVEX_URL`, and `CONVEX_SITE_URL`; mixing `localhost` with `127.0.0.1` splits browser cookies and can make Better Auth session checks fail while the app shell still appears signed in.
- Local admin/operator bypasses must be explicit. Use `KEPPO_LOCAL_ADMIN_BYPASS=true` only in machine-local development env, sync it into the local Convex runtime, and do not infer admin access from `NODE_ENV`, loopback hosts, or deployment names alone.
- The internal Convex action `dangerous_admin.dangerouslyDropAllTables` is fail-closed unless Convex env sets `KEPPO_ALLOW_DANGEROUS_DROP_ALL=true`. Remove that flag after use on shared deployments.
- If operator-facing env requirements change, update `docs/self-hosting-setup.md` in the same change.

## Auth versus integrations

- Better Auth social-login credentials and provider-integration credentials are related but not interchangeable.
- Signing in with Google or GitHub does not create a provider integration row; only the integration connect flow does that.
- If a provider appears unavailable, verify the running Convex or API env, not just the contents of `.env.dev`/`.env.local`.

## Catalog and callback behavior

- Keep catalog-backed providers visible in the dashboard even when their env is missing; surface configuration problems as warnings instead of hiding entries.
- Keep dashboard, API, Convex, and provider-console callback hosts aligned for the active environment.
- When overriding local or fake provider endpoints, propagate the same hosts into worker allowlists and any sandbox network policy inputs.

## Sandbox plumbing

- Remote sandboxes should receive a minimal, sandbox-valid `PATH`, not the host machine `PATH`.
- Sandbox providers must not infer which CLI package to install by parsing the first token of `runtime.command`; managed runner commands may be wrapped shell blocks for signal handling and artifact upload, so keep the installed runner package explicit in the sandbox contract.
- Docker sandboxes must rewrite host loopback URLs to `host.docker.internal` or an equivalent gateway alias.
- Local Code Mode should default to the sandbox provider, not a silent in-process fallback.
- Bundled sandboxed OpenAI runs that point `OPENAI_BASE_URL` at the Dyad gateway must stay on the HTTP Responses transport; that gateway does not support websocket Responses, so the repo-owned automation runner must force HTTP transport when it configures the OpenAI Agents SDK.
- Automation model-class routing must resolve from the explicit env contract: `KEPPO_AUTOMATION_MODEL_AUTO`, `KEPPO_AUTOMATION_MODEL_FRONTIER`, `KEPPO_AUTOMATION_MODEL_BALANCED`, and `KEPPO_AUTOMATION_MODEL_VALUE`. Treat `Auto` as an env alias, not a hard-coded model name.

## Serverless state

- Never rely on in-memory maps, module-level caches, or singleton state to persist across HTTP requests in Vercel serverless functions. Each request may hit a different function instance with cold state. Treat every request as potentially the first one the instance has seen.
- If state must survive across requests (e.g., MCP session → run mapping), store the authoritative record in Convex and recover it per-request when the in-memory cache misses. In-memory maps are an optional warm-instance optimization, never the source of truth.
- MCP transports using the `@modelcontextprotocol/sdk` `WebStandardStreamableHTTPServerTransport` in stateless mode (no `sessionIdGenerator`) cannot be reused across requests. Create a fresh transport per request for recovered/stateless sessions.
- MCP tool-call branches that return an error payload directly must log a warning before responding, even when the failure was downgraded into a structured result instead of being re-thrown. Otherwise Vercel request logs lose the only durable trace of the failure.

## Runtime boundaries

- Do not reintroduce filesystem overlays, source-copy scripts, or mirrored runtime trees between `cloud/`, `convex/`, `apps/web/app/lib/server/api-runtime/`, and `packages/shared/src`.
- When framework-owned filenames must stay fixed, keep them as thin wrappers that import the canonical implementation instead of duplicating behavior.
- During the TanStack Start rewrite, treat `apps/web/src/router.tsx` as the active runtime router. External Start routes are not live just because a matching wrapper exists under `apps/web/app/routes`; the route must be registered in the router that `apps/web/app/router.tsx` exports.
- Shared server logging used from bundled TanStack Start SSR or E2E runtimes must avoid `pino-pretty` worker transports. Prefer plain stdout logging in those contexts so the runtime does not depend on CommonJS-only `__dirname` behavior inside bundled worker helpers.
- Convex module definitions must not throw at import time based on runtime-only env availability. If a component/schema adapter is evaluated during `convex dev` analysis, keep that path analysis-safe and enforce required secrets in the actual runtime entrypoint instead.
