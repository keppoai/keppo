# Security model

## Trust boundaries

- Browser: authenticated operator UI only
- API: ingress validation, session/cookie handling, internal bearer routes, webhook verification, MCP transport, automation callbacks
- Convex: durable tenant data, policy state, audit trail, and most business logic
- Providers and sandboxes: external systems reached only after explicit validation and policy checks

## Identity and auth

- Better Auth is the user and org identity system.
- User-facing API routes use the Better Auth session cookie.
- Invite codes remain platform-admin created. Billing-page redemption is session-bound to the authenticated org member, and paid invite promos are non-Stripe access until the org explicitly completes Stripe checkout.
- Organization billing management is role-gated server-side: only org `owner` or `admin` members may open the Stripe portal, start recurring checkout, buy AI-credit packs, buy automation-run top-ups, or change recurring subscription state.
- Automation authoring is role-gated server-side on the Start-owned API routes: only org `owner` or `admin` members may call clarification-question or prompt-generation endpoints, and same-org lower-privilege members are rejected before workspace context lookup or AI-credit deduction.
- Manual automation execution is role-gated server-side: only workspace/org `owner` or `admin` members may trigger manual automation runs, while lower-privilege members may still retain read-only visibility into automation state when separately allowed by product UX.
- Local admin/operator route bypass is never heuristic-only: it requires `KEPPO_LOCAL_ADMIN_BYPASS=true` plus a genuinely local runtime signal (loopback/local deployment) before `/admin` or `/admin/health` widen beyond `KEPPO_ADMIN_USER_IDS`.
- MCP uses workspace bearer credentials from Convex.
- Internal maintenance routes use a shared bearer secret verified with constant-time comparison and a fail-closed missing-secret path.
- Automation log and completion callbacks use HMAC-signed requests.
- Provider webhooks are accepted only after provider-specific signature verification.
- Izzy treats the repo-scoped GitHub App user token as server-only session state: removing a login from `IZZY_ALLOWED_GITHUB_USERS` clears stored GitHub tokens, blocks refresh, and denies protected routes immediately.
- Org-wide provider integration writes remain owner/admin-only even when the flow starts or completes through Start-owned OAuth routes; callback completion must be bound to the initiating authenticated owner/admin rather than only signed org-scoped state.
- OAuth callback completion for org-scoped provider integrations fails closed unless the provider token response or required provider profile lookup returns a provider-issued external account identifier; tenant-owned ids such as `org_id` are never reused as persisted provider account ids.
- Provider-trigger delivery history stores only queue/match metadata plus payload references; operator-facing diagnostics must not expose raw provider payload bodies when skip reasons or lifecycle failures are enough.
- E2E-only Convex helper mutations/queries are callable only when `KEPPO_E2E_MODE=true` and the runtime is local/test (`NODE_ENV in {development,test}`, `CONVEX_DEPLOYMENT=local:*`, or loopback Convex runtime URLs such as `CONVEX_CLOUD_URL=http://127.0.0.1:*`).

## Secret domains

- `BETTER_AUTH_SECRET` signs auth state and is always operator-supplied; it is never derived from `KEPPO_URL`, deployment IDs, or other predictable fallback material.
- `KEPPO_MASTER_KEY` and purpose-specific variants protect encrypted application data; encryption paths do not fall back to `BETTER_AUTH_SECRET`.
- `KEPPO_CALLBACK_HMAC_SECRET`, `KEPPO_OAUTH_STATE_SECRET`, and `KEPPO_CRON_SECRET` protect independent trust boundaries.
- Provider client secrets, Mailgun keys, VAPID keys, and sandbox credentials stay server-side.

## Network and request controls

- Request bodies are bounded by route class using actual byte counts read from the request stream, even when `Content-Length` is absent or misleading.
- Proxy headers are trusted only when `KEPPO_TRUSTED_PROXY` opts into a supported mode.
- Custom MCP and sandbox networking use explicit guardrails against loopback, private, metadata, and unsafe redirect targets.
- Push notification subscriptions are treated as untrusted outbound destinations: registration and delivery both require `https` endpoints whose DNS resolution stays outside loopback, private, link-local, metadata, and other internal address space.
- Rate limits, credential-failure lockouts, and org suspension checks happen before execution.
- High-risk Convex mutations and queries use bounded string validation, explicit creation-path rate limits, and capped indexed scans instead of unbounded `.collect()` reads.
- API responses include baseline browser-hardening headers, with HSTS emitted only on HTTPS requests.

## Audit and failure handling

- Existing retention and sensitivity classes remain in force.
- Audit events continue to record decision and state transition operations.
- Audit events, provider metrics, queue dead letters, and health endpoints are first-class product behavior.
- GitHub Actions security-advisory alerting uses repo-scoped `repository_advisories:read` GitHub App access plus environment-scoped Mailgun config to send count-only triage/draft summary emails without embedding vulnerability details in workflow logs.
- Public errors are sanitized; public health stays minimal and side-effect free, while deep subsystem diagnostics and authenticated runtime-version checks stay behind session-gated or internal-only routes.
- Authenticated operator UI may expose short safe troubleshooting detail, but anonymous/public routes must never render raw backend exception text, signed callback params, bearer secrets, or stack traces.
- Security-relevant changes should be backed by targeted tests and scripted checks where possible.

### Automation sandbox security

- Automation runs execute in isolated sandbox providers (`docker` local, `vercel` production).
- Network policy expectations:
  - `mcp_only` default denies arbitrary outbound web access.
  - `mcp_and_web` is explicit opt-in per automation config version.
  - Production Vercel sandboxes enforce the fine-grained outbound allowlist.
  - Local Docker sandboxes provide container isolation and must translate host-loopback callback and MCP URLs to `host.docker.internal` so the isolated container can reach local API services without falling back to host-process execution.
- sandbox bootstrap uses a separate bootstrap stage with minimal env and a package-registry-only policy; AI keys, MCP bearer tokens, and signed callback URLs are injected only into the runtime stage.
  - automation-issued MCP bearer tokens remain run-scoped: Convex revokes them when the owning run reaches a terminal state, and MCP auth rejects tokens whose `automation_run_id` no longer resolves to a non-terminal run in the same workspace.
- Callback ingress hardening:
  - sandbox log/complete callbacks use per-run HMAC-signed URLs with expiry.
  - API rejects callbacks with missing/invalid signatures or expired timestamps.
  - OAuth integration callback state is HMAC-signed; callbacks reject missing/tampered state tokens.
  - PKCE verifiers for managed OAuth flows stay in server-side storage keyed by the signed state correlation ID; they are not embedded in readable front-channel state.
  - Server-side OAuth connect state for org-scoped integrations also stores the initiating user binding, and callback completion revalidates that same user still has owner/admin integration-management rights before shared credentials are written.
- Stuck-run safety:
  - sandbox providers enforce timeout with a short graceful-stop window first, then escalate to a hard stop if the runner does not exit.
  - the in-sandbox automation runner uses that grace window only to flush any remaining logs or trace-export work before the provider completes timeout teardown; durable trace references are recorded through the signed `/internal/automations/trace` callback instead of filesystem artifact uploads.
  - Convex reaper cron (`automation_scheduler:reapStaleRuns`) marks stale runs `timed_out` and requests sandbox termination.

### Automation credential and key protection

- Org AI keys (`org_ai_keys`) are encrypted at rest with KEK material (`KEPPO_MASTER_KEY_INTEGRATION` / `KEPPO_MASTER_KEY`), versioned by `key_version`, and never returned in plaintext through public queries.
- Bundled automation credentials are stored in the same encrypted org-key table, but they are billing-managed only: public mutations cannot create or delete `bundled` rows directly.
- User-managed BYOK and `subscription_token` credentials are hard-deleted when removed; non-secret metadata needed for auditability is copied into the delete audit event payload before the row is deleted.
- Dyad Gateway master credentials (`KEPPO_LLM_GATEWAY_MASTER_KEY`) stay in API runtime only; dashboard clients, Convex public functions, and sandbox env never receive that management bearer token.
- OpenAI `subscription_token` automation keys are stored as encrypted refreshable OAuth credential envelopes; refresh occurs in API runtime before dispatch, and sandbox runs receive only run-scoped auth material.
- Dispatch decrypts key material only inside API runtime for active run provisioning; dashboard receives hints only (`key_hint`).
- Automation trace export is opt-in: dispatch only injects `KEPPO_OPENAI_TRACING_API_KEY` when operators configure a dedicated tracing key, and trace identifiers/grouping use hashed automation ids instead of raw tenant ids.
- `_decryptForTestsOnly` remains internal-only and requires an explicit local/test flag before use; every successful invocation emits an audit-friendly warning.
- Automation run attribution uses automation identity as MCP actor and does not rely on shared service-account secrets.

### Custom MCP server security

- Custom server registrations are org-scoped; execution access is additionally constrained by workspace-level enable/disable rows.
- Custom server URLs are `https://` by default; insecure `http://` is only accepted for loopback hosts in explicit local/e2e insecure mode.
- Custom server URL registration rejects blocked hostname classes (metadata endpoints and private/loopback/link-local literals) outside explicit local/e2e loopback mode.
- Runtime custom-server discovery/tool execution resolves DNS per request and blocks destinations that resolve to private RFC1918/loopback/link-local/metadata-service IP ranges.
- Runtime custom-server redirects are fail-closed: redirect targets are validated against the same network policy and redirect chains are bounded.
- Remote custom-server bearer credentials are stored in dedicated `custom_mcp_servers.bearer_token_enc` fields and never returned by public queries.
- Discovery and execution errors must never include raw bearer token values.
- MCP JSON-RPC edge responses sanitize dynamic tool-error messages against secret patterns and emit generic fallback messages with internal reference IDs when redaction is triggered.
- Custom tool execution is not a bypass path:
  - custom tools resolve into the same action + approval lifecycle as built-in tools,
  - pending/approved/rejected semantics and audit emission remain enforced by Convex action state transitions.
- Namespaced custom tool IDs (`<slug>.<remote_tool_name>`) and reserved-slug validation prevent collisions with canonical providers.

### Code Mode sandbox and gating

- Code Mode execution runs in sandbox providers:
  - local/e2e default: Docker container sandbox (`docker` mode).
  - production target: Vercel sandbox provider (`vercel` mode).
- `search_tools` fails closed to tools that are actually usable in the current workspace: built-in providers must be both enabled and connected, while custom MCP tools must remain workspace-enabled.
- Vercel sandbox execution is created with `runtime: node24` and `networkPolicy: "deny-all"` for fail-closed outbound network access.
- Host/tool communication in `vercel` mode uses a structured stdout request marker + host-written response files under `/tmp`, so provider tool calls never execute directly inside the microVM.
- Sandbox global surface is restricted (`process`, `require`, `eval`, `Function` are not exposed to user code).
- Tool invocation from sandbox always routes through `__keppo_call_tool` runtime bridge.
- Dual-layer gating is enforced:
  - static analyzer pre-approves directly referenced tools only.
  - runtime proxy intercepts all tool calls and blocks unexpected dynamic calls by default.
- Final execution authorization remains in existing Convex action gating (`executeToolCall`), preserving approval/deny/pending workflow guarantees.
