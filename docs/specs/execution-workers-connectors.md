# Execution workers, queues, and connectors

## Provider connector layer

- Provider modules under `packages/shared/src/providers/modules/*` are the source of truth for auth, metadata, tool definitions, refresh behavior, webhook hooks, and UI contracts.
- The current canonical providers are `google`, `stripe`, `github`, `slack`, `notion`, `reddit`, `x`, and `custom`.
- The provider registry snapshot in `packages/shared/provider-registry.snapshot.json` is checked by guardrail scripts and is the concise source of truth for shipped provider metadata.
- Polling automation trigger registration is derived from provider module metadata, not from a separate hand-maintained trigger registry.
- Custom MCP server discovery and execution are stateless request-scoped exchanges through the shared custom-MCP client; Keppo stores discovered metadata and the results it owns, not remote session state.

## Queue and approved writes

- Approval-required writes persist an action in Convex, then schedule native Convex execution for the approved action.
- The API `queueClient` is now a thin Convex scheduling adapter; there is no separate Vercel queue transport on the primary path.
- Approved-action execution relies on Convex action OCC/state transitions so repeated schedules do not double-execute the same approval transition.
- Dead letters are stored in Convex and exposed through internal/operator routes for replay or abandonment.

## Automations

- Automation configs and runs live in Convex.
- Provider-trigger configs persist a provider id, provider trigger key, schema version, structured filter payload, preferred/fallback delivery modes, and provider-managed subscription state instead of only flat event strings.
- API dispatches automation runs to a sandbox provider selected by `KEPPO_SANDBOX_PROVIDER` (`docker`, `vercel`, or `unikraft`).
- The supported runner types are `chatgpt_codex` and `claude_code`.
- Sandboxes stream logs and completion back through signed callback routes; termination is a separate internal route.

## Code Mode

- Code Mode uses `search_tools` and `execute_code` plus the `code_mode_tool_index` table.
- `search_tools` queries the indexed tool catalog and filters results to providers enabled for the workspace.
- `execute_code` generates a typed SDK, statically extracts referenced tools, then runs sandboxed JavaScript with gated provider calls.
- Sandbox provider selection for Code Mode is independent from automation sandbox selection and is controlled by `KEPPO_CODE_MODE_SANDBOX_PROVIDER` (`docker`, `vercel`, or `unikraft`).

## Guardrails

- Shared runtime provider registry (`packages/shared/src/providers.ts`) remains the single dispatch entrypoint.
- Registry invariants continue to enforce:
  - canonical provider IDs,
  - unique tool ownership,
  - capability/hook consistency.
- Rollout controls still enforced server-side:
  - per-provider `metadata.featureGate`
  - global `KEPPO_FEATURE_PROVIDER_REGISTRY_PATH`.
  - both read through the shared feature-flag registry/default helpers in `packages/shared/src/feature-flags.ts`.

### Connector execution responsibilities

- Execute approved writes only after Convex state transition to `approved`.
- Refresh OAuth credentials via provider-module `refreshCredentials` hooks when required.
- Emit audit and integration health transitions (`connected`/`degraded`) from Convex execution path.
- Persist canonical integration refresh failure `error_code` and `error_category` values (`INTEGRATION_ERROR_*`) in credential/integration records and refresh-failure audit payloads; do not emit legacy ad-hoc fallback codes.
- Emit machine-readable worker execution error codes with stable `code: message` prefixes so API routes can record metrics and classify failures without parsing free-form text.
- Retry backoff for provider writes and MCP polling applies random jitter (`0.5x` to `1.0x`) to reduce synchronized retry bursts.
- SDK-backed provider connectors execute through provider-scoped circuit breakers (`packages/shared/src/circuit-breaker.ts`): default threshold/cooldown is `5` failures / `30s`, Stripe is more tolerant (`7`), and high-volatility providers (Reddit/X) use lower thresholds (`3`). Open/half-open states fail fast with typed `CircuitOpenError` until probe recovery.
- Provider circuit breakers are registry-backed singletons per provider and expose runtime snapshots (`listProviderCircuitBreakerStates`) so health surfaces can report breaker fleet state without duplicating connector state.
- Dispatch-map migration is live for `packages/shared/src/providers/modules/custom/connector.ts` via `createDispatchConnector(...)`, replacing per-method if-chains with tool-keyed handler maps (reference pattern for remaining provider connectors).
- Shared provider base classes now own the repeated connector and SDK scaffolding:
  - `packages/shared/src/connectors/base-connector.ts` centralizes scope validation, input parsing, namespace resolution, dispatch invocation, and default redaction for SDK-backed connectors.
  - `packages/shared/src/provider-sdk/base-sdk.ts` centralizes provider SDK call-log capture for real clients.
  - `packages/shared/src/provider-sdk/base-fake-client.ts` centralizes fake-client namespace state lifecycle, reset semantics, and call-log capture for deterministic fakes.
  - Provider modules keep ownership of provider-specific policies, dispatch payload shaping, request normalization, and fixture seeding; Stripe is the reference migration onto the new bases.
  - Provider entrypoints stay stable at `connector.ts`, `sdk.ts`, and `fake-client.ts`, but the large provider-specific implementations may live in adjacent runtime files (for example `connector-runtime.ts`, `sdk-runtime.ts`, `fake-client-runtime.ts`) so imports stay stable while the scanned entry files remain thin.
- Enforce capability checks (`read`, `write`, `refresh_credentials`) before provider dispatch.
- Validate queue/maintenance envelopes using shared boundary contracts before any execution.
- Worker-side JSON payload decode should use the shared parse helpers plus worker schemas so scheduler, MCP, and cloud overlays fail closed on malformed stored payloads before connector execution starts.
- For SDK-backed provider adapters, `packages/shared/src/provider-sdk/<provider>/real.ts` must instantiate official SDK clients and avoid direct protocol calls (`safeFetchWithRetry`, raw `fetch`, `axios`) inside real adapters.
- Google/Gmail connector runtime now includes full T1 + T2 coverage plus T3 label/filter/send-as alias detail-management actions (`updateLabel`, `deleteLabel`, `getFilter`, `getSendAsAlias`, `updateSendAsAlias`) behind the same SDK boundary and deterministic fake contract.
- GitHub connector runtime now includes T1/T2 issue/PR/repo/search/workflow/review/comment coverage plus T3 release/milestone and repository content-management slices (`createRelease`, `updateRelease`, `generateReleaseNotes`, `getLatestRelease`, `listReleases`, `listMilestones`, `createMilestone`, `updateMilestone`, `listBranches`, `getFileContents`, `createOrUpdateFile`, `listLabels`, `createLabel`) through the same SDK boundary and deterministic fake-gateway contract.
- Notion connector runtime now includes T1 + T2 coverage plus T3 page-move/markdown/comment-detail actions (`movePage`, `getPageAsMarkdown`, `updatePageMarkdown`, `getComment`) through the same SDK boundary and deterministic fake-gateway contract.
- Slack connector runtime now includes full T1 + T2 channel/message/reaction/user/file/scheduling/pin/DM read-write coverage plus an initial T3 conversation-management slice (`renameChannel`, `kickFromChannel`, `leaveChannel`, `closeDM`) through the same SDK boundary and deterministic fake-gateway contract.
- Reddit connector runtime now includes full T1 + T2 search/list/info/comment/vote/message/user/subreddit coverage plus an initial T3 moderation slice (`approve`, `removeContent`, `lockPost`, `unlockPost`) through the same SDK boundary and deterministic fake-gateway contract.
- X connector runtime now includes full T1 post/user/timeline/engagement/dm coverage through the same SDK boundary and deterministic fake-gateway contract.

### Storage write path guarantees

1. Inline fields are redacted.
2. Raw tool IO persists only when retention policy allows it.
3. `normalized_payload` remains encrypted at rest.
4. Audit payloads use redacted previews only.

These guarantees are unchanged by the queue migration; only execution transport changed.

### Automation sandbox execution contract

- Start-owned web runtime automation routes own sandbox dispatch and callback ingress:
  - `POST /internal/automations/dispatch`
  - `POST /internal/automations/terminate`
  - `POST /internal/automations/log`
  - `POST /internal/automations/complete`
- `POST /internal/automations/dispatch` requires both the internal bearer secret and a scheduler-minted single-use `dispatch_token` bound to the targeted `automation_run_id`; the runtime must reject requests that cannot claim that per-run token before decrypting org-scoped AI credentials.
- Sandbox provider interface is environment-switched (`docker` for local, `vercel` or `unikraft` for production-tier deployments) with contract:
  - `dispatch({ bootstrap: { command, env, network_access }, runtime: { command, env, network_access, callbacks }, timeout_ms })`
  - `terminate(sandbox_id)`
- Local `docker` sandbox provider behavior:
  - builds or reuses the local sandbox image from `apps/web/app/lib/server/api-runtime/sandbox/Dockerfile`,
  - launches each automation run in a real detached Docker container instead of a host subprocess,
  - rewrites loopback MCP/callback targets (`localhost`, `127.0.0.1`, `::1`) to `host.docker.internal` for in-container reachability,
  - streams container stdout/stderr back through the existing signed log callback and posts terminal completion from the api-runtime host after `docker wait`,
  - stores `sandbox_id` as the Start-owned runtime sandbox handle used for later container termination.
- Production `vercel` sandbox provider behavior:
  - creates a Vercel Sandbox VM with separate bootstrap/runtime stages,
  - keeps bootstrap env minimal and restricted to package-registry networking while installing the requested runner CLI (`@openai/codex` or `@anthropic-ai/claude-code`),
  - launches an in-sandbox Node wrapper that executes the runner command, forwards stdout/stderr to the signed log callback, and posts terminal completion directly to the signed completion callback,
  - maps the saved automation `network_access` mode into both sandbox egress policy and runner-native tool restrictions (Codex uses `--config 'sandbox_mode="workspace-write"' --config 'sandbox_workspace_write={ network_access = false }'` for `mcp_only` and otherwise relies on the default `codex exec` network-enabled behavior for `mcp_and_web`; Claude Code adds `--disallowed-tools WebFetch,WebSearch` for `mcp_only` and otherwise relies on the default tool set),
  - stores `sandbox_id` as an opaque sandbox-handle that includes the detached command identifier so terminate requests can signal the runner process before stopping the VM,
  - when Deployment Protection is enabled, uses `VERCEL_AUTOMATION_BYPASS_SECRET` for Convex dispatch/terminate requests and sandbox-origin callback traffic, and appends the same bypass token to sandbox MCP URLs because the runner CLI can only consume the MCP endpoint as a URL,
  - constrains `mcp_only` runs to the MCP host, callback host, and model-provider API host(s); `mcp_and_web` remains unrestricted.
- Production `unikraft` sandbox provider behavior:
  - creates a Unikraft Cloud MicroVM from an OCI image referenced by `UNIKRAFT_SANDBOX_IMAGE`,
  - injects the composed runner command and the signed log/completion callback URLs through environment variables (`KEPPO_RUNNER_COMMAND`, `KEPPO_LOG_CALLBACK_URL`, `KEPPO_COMPLETE_CALLBACK_URL`, `KEPPO_TIMEOUT_MS`),
  - reuses the same automation sandbox image contract as Docker, so the guest entrypoint reads `KEPPO_RUNNER_COMMAND` and launches the requested runner inside the MicroVM,
  - polls instance logs through the Unikraft REST API and forwards bounded stdout batches to `/internal/automations/log`,
  - posts terminal completion from the host after the instance reaches a terminal state or is cancelled/timed out,
  - deletes the instance on completion, timeout, or cancellation instead of relying on persistent VM state,
  - does not enforce instance-level egress policy; `mcp_only` versus `mcp_and_web` continues to be enforced at the runner/tooling layer.
- Code Mode `unikraft` sandbox behavior:
  - creates a Unikraft instance from `UNIKRAFT_CODE_MODE_IMAGE` (defaulting to a plain Node image when unset),
  - injects the generated SDK and entry source through base64-encoded env vars, then decodes them in the guest and runs `node entry.mjs`,
  - uses an HTTP bridge variant instead of the file-based bridge because the remote MicroVM cannot write response files back onto the host filesystem,
  - logs request markers with `REQUEST_PREFIX` for visibility and returns the final structured result through the usual `RESULT_PREFIX` log line,
  - requires the MicroVM to reach a host callback URL (`UNIKRAFT_CODE_MODE_BRIDGE_BASE_URL` in strict/non-local setups), which is the main networking constraint of this provider.
- Dispatch path requirements:
  - resolve automation run dispatch context from Convex snapshot (`automation_runs:getAutomationRunDispatchContext`),
  - decrypt org AI key/token (`org_ai_keys:getOrgAiKey`) and inject them only into the runtime stage after bootstrap succeeds,
  - refresh OpenAI OAuth-backed `subscription_token` credentials server-side before dispatch when the cached access token is expired or near expiry,
  - create automation-attributed MCP session identity and update run lifecycle to `running`,
  - issue an automation-scoped workspace credential whose auth metadata includes the owning `automation_run_id` so automation-only MCP tools can be enforced at runtime,
  - revoke automation-issued credentials on terminal lifecycle transitions and reject them at MCP auth time if the referenced run is missing, workspace-mismatched, or already terminal,
  - wrap the saved automation prompt with runtime-owned instructions that require a final `record_outcome({ success, summary })` tool call exactly once and define approval-waiting as `success=true` when the requested work is otherwise complete.
- OpenAI localhost callback boundary:
  - the browser OAuth flow redirects to `127.0.0.1:1455/auth/callback`,
  - connect metadata is issued by the Start-owned web runtime (`/api/automations/openai/connect`) and includes the authorize URL plus the localhost callback capture command,
  - the dashboard completes the exchange through `/api/automations/openai/complete`; only the API runtime exchanges the OAuth code or stores refreshable credentials.
- Callback/log contract:
  - log/complete callback URLs are HMAC-signed and include run-scoped expiry metadata.
  - `/internal/automations/log` appends bounded log lines through `automation_runs:appendAutomationRunLog`.
  - `/internal/automations/complete` transitions run to terminal state via `automation_runs:updateAutomationRunStatus`.
  - automation-backed MCP sessions expose one additional internal tool, `record_outcome`, which is unavailable to normal MCP clients and records a single final outcome on the owning automation run.
  - `record_outcome` writes are exactly-once at the run level: the first valid call wins, duplicate calls fail, and terminal lifecycle updates synthesize a fallback outcome that matches the final terminal status when no valid outcome was recorded before the run ended. If a run later finishes in a failure state after an earlier success outcome was recorded, the terminal failure replaces that stale success with a fallback failure outcome.
  - hot rows are archived to cold storage via `automation_scheduler:archiveHotLogs`; cold blobs expire per tier retention via `automation_scheduler:expireColdLogs`.
- Scheduler/trigger contract:
  - `automation_scheduler:checkScheduledAutomations` creates due schedule runs and schedules dispatch actions.
  - `automation_scheduler_node:reconcileProviderTriggerSubscriptions` is the provider-trigger maintenance entrypoint. It loads active provider-trigger configs, refreshes provider-owned lifecycle state, renews Gmail watches when configured, advances polling cursors, and ingests normalized provider events into Convex.
  - `automation_scheduler:processAutomationTriggerEvents` drains the bounded `automation_trigger_events` queue, preserves matched/skipped metadata, and schedules dispatch actions from the recorded config snapshot.
  - `automation_scheduler:reapStaleRuns` marks timed-out runs and requests sandbox termination.
  - Internal scheduler boundaries are canonicalized in `convex/automation_scheduler_shared.ts`; `buildDispatchAutomationRunArgs`, `buildTerminateAutomationRunArgs`, and `buildGetDispatchAuditContextArgs` are the only supported builders for internal scheduler args.
  - Internal Convex scheduler args use camelCase `runId`; external transport, audit, and persistence payloads keep existing snake_case `automation_run_id` where that field is already part of the public or stored contract.
  - Scheduler changes must update both the base `convex/` wrapper and the `cloud/convex/` overlay in the same change because cloud overlays can replace the live implementation even when the local tree looks correct.
  - `automation_scheduler:dispatchAutomationRun` and `automation_scheduler:terminateAutomationRun` return canonical typed status enums (`*_url_missing`, `*_http_error`, `*_request_failed`, terminal success) plus optional `http_status` when transport returns non-2xx.
- Scheduler/reaper/event processors run with bounded per-tick scan limits (indexed `.take(limit)` reads) to avoid unbounded cross-tenant `.collect()` scans.
- Log archival/expiry scans read from bounded `automation_runs` status+ended indexes (`by_status_ended`) with configurable scan limits.
- Metered-billing flush candidate selection is bounded to indexed Pro-tier subscription batches (`subscriptions.by_tier`) before usage-meter joins.
- Maintenance task hard failures are mirrored into Convex `dead_letter_queue` rows (`source_table=maintenance_task`) for operator replay.
- Notification delivery retries use a bounded policy (`max_retries=5`) with exponential backoff + deterministic jitter (`base=5s`, `cap=120s`); terminal failures (budget exhausted or non-retryable) are mirrored into `dead_letter_queue` (`source_table=notification_events`) and can be replayed through internal API.
- API fire-and-forget operational side effects (provider metrics, rate-limit audits, PagerDuty fan-out) escalate to `dead_letter_queue` as `source_table=fire_and_forget` after Convex retry exhaustion; replay delegates back to the generic maintenance tick so they are retried through the same maintenance pathways.
- A dedicated `dlq-auto-retry` cron runs every 5 minutes, scans a bounded batch of pending DLQ entries, classifies transient failures through the shared canonical error catalog, marks retryable rows as `retrying`, and schedules deferred replay with deterministic jitter (`base=60s`, `cap=10m`). Non-retryable/auth rows remain `pending` for explicit operator action.
- A dedicated `synthetic-canary` cron runs every 5 minutes, resolves a live workspace credential as a stable canary target, checks `KEPPO_API_INTERNAL_BASE_URL + /health`, ignores its own heartbeat when evaluating `checkCronHealth`, and emits `canary.failed` audit events with latency and target identifiers before the heartbeat wrapper records the cron failure.

### E2E fidelity requirements

- Local queue broker supports deterministic:
  - enqueue,
  - namespace-scoped reset/state/failure-injection controls for parallel test isolation,
  - visibility timeout/retry lifecycle,
  - dead-letter simulation,
  - failure injection,
  - explicit logical-clock advancement.
- Cron driver triggers maintenance with deterministic cadence and manual tick controls.
- E2E assertions cover:
  - retry-to-single-terminal-state behavior,
  - duplicate-delivery idempotency,
  - cron expiry/run-timeout behavior,
  - queue+cron interplay (no approved-action starvation).
- E2E-only Convex helper queries/mutations are enabled only when `KEPPO_E2E_MODE=true` and the backend runtime is explicitly local/test (for example `NODE_ENV=test`, `CONVEX_DEPLOYMENT=local:*`, or loopback Convex runtime URLs such as `CONVEX_CLOUD_URL=http://127.0.0.1:*`), preventing production deployments from exposing test helpers through env drift alone.
