# Security Rules

## Scope

Consult this file before changing auth, API ingress, internal routes, webhooks, billing, sandbox execution, outbound networking, health diagnostics, or runtime secret handling.

For GitHub Actions workflows that run Claude, Codex, or other coding agents, also consult `docs/rules/github-security.md`.

## Core principles

- Prefer fail-closed behavior for missing, malformed, unverifiable, or unexpectedly broad security inputs.
- Keep auth secrets, encryption keys, OAuth secrets, webhook secrets, callback HMAC secrets, and internal bearer secrets separate by purpose.
- Never log raw secrets, tokens, webhook bodies with secrets, or unredacted callback signatures.
- When logging structured responses that may contain credentials, redact secrets by field name or structured path before printing; do not rely on provider-specific token prefixes or formats.
- Local-only operator bypasses must require an explicit opt-in env and an actual local-runtime signal; never broaden privileged access based only on `NODE_ENV`, hostnames, or deployment-name heuristics.

## Auth and trust boundaries

- User-facing routes must derive identity from the Better Auth session, not caller-provided org or user fields.
- NextAuth session callbacks must not copy provider or repository-scoped bearer tokens into the client-visible session payload when server-side code can read the JWT or provider token directly.
- Start-owned routes that manage org-wide integrations or credentials must enforce the same owner/admin authorization as the canonical dashboard mutation path; do not rely on an internal Convex mutation caller to supply that missing role check.
- Start-owned routes that author automations or spend org-scoped AI credits must enforce the same owner/admin authorization boundary as the dashboard automation builder before loading workspace context, deducting credits, or calling AI generation providers.
- Convex queries and mutations default to callable; every tenant-scoped or operationally sensitive public function must explicitly enforce `requireOrgMember`, `requireIdentity`, or platform-admin checks before reading or returning data.
- When a Convex function is only meant for server-side bridges authenticated with the Convex admin key, expose it as `internalQuery`/`internalMutation` instead of a public function with a user-identity check that admin-key callers cannot satisfy.
- Internal routes must require cryptographic proof such as the internal bearer secret or callback HMAC.
- Internal routes that can unlock tenant-scoped credentials or execution context must not trust caller-supplied resource ids on the strength of a shared platform bearer alone; require a server-minted run-scoped or resource-scoped claim and verify it before loading secrets.
- Run-scoped internal dispatch claims must be short-lived, single-use, and retry-safe: reuse an in-flight claim instead of silently overwriting it while the owning run is still pending.
- Retry-safe dispatch claim reuse must preserve the exact accepted raw claim for later attempts; do not recompute a reused claim from rotatable key material after it has been issued.
- Security-sensitive token, credential, and secret generation must use a CSPRNG (`crypto.getRandomValues`, `randomUUID`, or Node crypto), never `Math.random()`.
- Run-scoped credentials must be enforced at both ends: revoke them when the owning run becomes terminal, and reject them at auth time if the referenced run is missing, mismatched, or no longer active.
- PKCE `code_verifier` values are secrets. Do not place them in readable front-channel state, query strings, or other browser-visible payloads; store them server-side or in an encrypted backend-owned channel and retrieve them for token exchange on the callback.
- Secret comparisons for bearer tokens, callback signatures, and similar auth material must use constant-time comparison with a length guard.
- Webhook handlers must verify provider signatures before any state mutation.
- Dead-letter operator triage functions (`dead_letter.listPending`, `dead_letter.replay`, `dead_letter.abandon`) must remain internal Convex functions. Server-side callers may reach them only through admin-authenticated Convex clients, never by re-exposing them as public unauthenticated endpoints.
- Return URLs and redirect targets must be normalized and restricted to safe in-app destinations.
- `BETTER_AUTH_SECRET` must be explicit; do not derive it from `KEPPO_URL`, deployment IDs, or other predictable material.
- Encryption keys must come from `KEPPO_MASTER_KEY` or a purpose-specific variant, not from `BETTER_AUTH_SECRET`.

## Input handling

- Enforce request size limits on the bytes actually read, not only on declared `Content-Length`.
- Bound strings, arrays, objects, schemas, prompts, and policy expressions before expensive work.
- Avoid unguarded `JSON.parse` and `v.any()` on public or worker-facing boundaries; prefer the shared parse helpers so malformed payloads fail closed with typed boundary errors before business logic runs.
- API responses should set baseline browser hardening headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, and HTTPS-only HSTS).
- Never interpolate untrusted issue, PR, webhook, or user-authored content directly into GitHub Actions `run:` shell blocks. Pass untrusted content through environment variables or files first so the shell treats it as data.
- When writing multiline untrusted content to `GITHUB_OUTPUT` or similar workflow files, use a unique per-write delimiter rather than a static heredoc marker.
- Issue-driven AI workflows must only run from trusted trigger actors and trusted issue/comment authors. Treat issue and comment text as untrusted reference data loaded from files, never as inline agent instructions.
- When issue-driven workflows trust GitHub bot authors, normalize bot logins before allowlist checks because API payloads may report the same bot as `name` or `name[bot]` depending on the event surface.
- Keep trusted GitHub bot allowlists synchronized across workflow gates, deterministic post-agent helpers, and reviewer-moderation skills. If `vercel` is trusted in one workflow path, treat normalized `vercel`/`vercel[bot]` identities consistently everywhere that path can continue.
- When issue-driven AI workflows need GitHub writes, prefer keeping GitHub tokens out of Claude/Codex agent steps entirely. Have the agent produce local commits or artifacts, then let deterministic workflow steps push branches, comment, and open or edit PRs.
- For PR-review AI workflows, prefetch review threads, PR metadata, and failing-check context into files before invoking Claude/Codex. Have the agent emit machine-readable review-thread actions, then apply replies, resolutions, summary comments, and label changes in deterministic post-agent steps with a scoped token.
- For GitHub workflows that must expose credentialed GitHub access to Claude or Codex, scope that access to the narrowest repository and permission set the agent actually needs. Keep base-repo label, comment, issue, and PR state changes in explicit non-agent steps whenever possible.
- In agent-running workflows, disable `actions/checkout` credential persistence unless the workflow explicitly reconfigures a scoped push remote afterward. Do not rely on the default checkout token remaining available to the agent.
- Do not grant `id-token: write` to Claude or Codex agent jobs unless a documented workflow step actually consumes GitHub OIDC. Agent jobs should run without OIDC by default.

## Networking and sandboxing

- Treat forwarded IP headers as untrusted unless `KEPPO_TRUSTED_PROXY` enables a supported proxy mode.
- Validate redirect hops and resolved addresses for constrained outbound networking.
- Block loopback, private, link-local, and metadata targets for untrusted outbound requests unless an explicit local-only mode allows them.
- The Docker sandbox provider is local-dev only. Both automation and code-mode sandbox factories must throw at construction time when `docker` mode is selected outside a local-dev environment (`NODE_ENV=development|test` or `KEPPO_E2E_MODE=true`). Production deployments must use the `vercel` or `unikraft` sandbox provider.
- Sandboxes should receive the minimum env and network access needed to bootstrap and execute.
- Sandbox and MCP failure payloads must stay short, typed, and redacted. Return stable error codes and generic operator-safe reasons to clients; keep verbose sandbox internals and raw startup traces out of client-visible responses.
- Host-side sandbox bridges must canonicalize and bound-check any sandbox-provided file paths before host file I/O; reject absolute/parent traversal attempts fail-closed. Resolve symlinks with `realpath` on existing path components and re-check containment to prevent symlink-based escapes.
- E2E-only Convex helpers require both `KEPPO_E2E_MODE=true` and a local/test runtime signal such as `KEPPO_E2E_RUNTIME_SIGNAL=local`, `NODE_ENV=test`, `CONVEX_DEPLOYMENT=local:*`, or a loopback Convex runtime URL (`CONVEX_CLOUD_URL`, `CONVEX_SITE_URL`, `CONVEX_URL`, or `CONVEX_SELF_HOSTED_URL` on `127.0.0.1|localhost|::1`).

## Verification

- Security fixes should ship with targeted regression tests for the closed exploit path.
- Security fixes that tighten Convex visibility should also add or update a static invariant in `scripts/check-security-invariants.mjs` when the contract can be expressed syntactically.
- OAuth connect state for org-scoped credential writes must bind to the initiating user and callback handlers must re-check that same user's current authorization before persisting shared credentials.
- If runtime or operator setup changes, update `docs/self-hosting-setup.md` and, when local contributor flows change, `docs/dev-setup.md` in the same change.
- Run `pnpm check:security` and the most relevant targeted tests when touching security-sensitive code.
- `pnpm check:security` must cover static invariant checks plus targeted auth/API/Convex security regressions.
