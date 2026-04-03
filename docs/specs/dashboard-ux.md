# Dashboard UX

## Shell and data model

- The dashboard is the TanStack Start web app in `apps/web`.
- The same web app also serves a public docs surface at `/docs`, but that surface is intentionally outside the authenticated dashboard shell.
- Normal product data flows use Convex directly for reads, mutations, and live updates.
- API calls are reserved for session-bound or secret-bound flows such as OAuth, billing, push subscription, and automation prompt generation.

## Main routes

- Sign-in UX is provided by better-auth (magic link + social + e2e email/password).
- Public routes include `/`, `/docs`, `/docs/**`, `/login`, and `/invites/accept`.
- Data access and mutations run through Convex React hooks.
- Routing/auth gating is driven by Convex auth state and role checks returned from Convex functions.
- Route ownership stays split between eager shell routes and lazy feature routes:
  - `__root`, `/$orgSlug`, `/$orgSlug/$workspaceSlug`, `/login`, `/`, and `/invites/accept` stay eager so auth gates, redirects, shell chrome, and workspace selection resolve immediately.
  - `/docs` and `/docs/$` stay public and route through a docs-only layout that shares app-wide providers, theme tokens, and the same-origin search endpoint without mounting authenticated dashboard chrome.
  - Authenticated feature pages such as overview, approvals, rules, integrations, automations, settings, billing, members, admin, health, prompt builder, and custom-server screens load through TanStack lazy-route modules.
  - Lazy feature routes must define explicit route-boundary pending states so code-split navigation never leaves the content area blank while the sidebar and breadcrumb shell stay mounted.
- Dashboard URLs are org/workspace scoped:
  - workspace pages live under `/:orgSlug/:workspaceSlug/...`
  - org settings pages live under `/:orgSlug/settings/...`
  - `/` redirects to the authenticated user's last-used workspace (or first workspace)
  - if an operator lands on a workspace-only route without a valid workspace slug (for example `/:orgSlug/approvals` or a stale `/:orgSlug/:workspaceSlug/...` link), the dashboard must recover to the preferred valid workspace and preserve the intended subpath instead of leaving the shell in a permanent switching state
  - automation detail and run routes use the persisted automation slug path segment (`/:orgSlug/:workspaceSlug/automations/:automationSlug` and `.../runs/:runId`) even though Convex still keeps stable opaque automation IDs internally
- No dashboard compatibility auth mode is retained.
- The router is wrapped in a global React error boundary that renders a safe fallback (`Something went wrong`) with a reload action.
- Global and route-level error surfaces must show operator-safe copy first and only expose short safe technical detail such as a stable error code, never raw backend exception strings or stack traces.
- Authenticated dashboard forms, panels, and page-level failures use one shared error presentation contract: title, human-readable summary, next-step guidance, and a default-collapsed technical-details disclosure with copy affordance.
- Dashboard boot initializes PostHog (`apps/web/src/posthog.ts`) when `VITE_POSTHOG_API_KEY` is present; both global error boundaries capture runtime exceptions with component-stack context.
- Dashboard hosted `preview`, `staging`, and `production` builds emit browser source maps. When `POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` are set, those builds also upload source maps to PostHog via `@posthog/rollup-plugin`, using release metadata from `KEPPO_RELEASE_NAME`/`KEPPO_RELEASE_VERSION` (with commit SHA fallbacks).
- A catch-all not-found route renders a dedicated `404` page (`Page not found`) instead of silent blank/error states.
- Primary high-traffic pages (dashboard overview, integrations, automations, approvals, audit) render skeleton loading states while Convex queries are unresolved.
- Auth bootstrap and workspace switches preserve the authenticated shell chrome; the content area may transition into a structured loading state, but the sidebar and breadcrumb header should not blank or collapse away.
- Workspace-route recovery is operator-visible rather than silent: stale or malformed workspace URLs resolve into a structured shell transition and then self-heal to a valid workspace route without dropping sidebar/header context.
- Bundle analysis for route splits should compare the generated `artifacts/dashboard-bundle/` reports before and after major route-splitting changes.
- `/`: overview
- `/approvals`, `/rules`, `/integrations`, `/integrations/$provider`
- `/automations`, `/automations/$automationId`, `/prompt-builder`
- `/servers`, `/servers/$serverId`
- `/audit`, `/workspaces`, `/billing`, `/members`, `/settings`, `/admin`
- `/login` and `/invites/accept` outside the authenticated shell

## Interaction model

- Workspace context is persistent and drives what approvals, tools, integrations, and automations the operator is viewing.
- Breadcrumbs resolve human-facing entity labels for providers, automations, runs, and custom servers instead of exposing raw route params whenever the dashboard already has enough data to name the entity.
- Notification unread state updates the bell, sidebar badge, document title, and favicon from the same Convex unread count.
- Integration and custom-server screens show configuration problems as warnings; they do not silently hide available capabilities.
- Integration, rules, and custom-server empty/recovery states explain the operator task in plain language and include a direct path back to the relevant setup surface instead of dead-end “not found” or “no tools” copy.
- Automation and approval views are designed around status transitions and auditability rather than optimistic hidden side effects.
- The global command surface is an operator tool, not a shortcut to one modal. `Cmd+K` / `Ctrl+K` can jump between key routes, open the guided builder, run active automations, and start provider-connect flows from anywhere inside a workspace-scoped shell.
- The public docs surface reuses the same shortcut convention for built-in docs search (`Cmd+K` / `Ctrl+K`) and serves results from the same-origin `/api/search` endpoint instead of a third-party hosted search provider.
- Docs discovery is explicit from user-visible surfaces: the landing page primary navigation and CTA cluster link into `/docs`, and the in-product help dialog includes a `Read the docs` entry point for signed-in operators.

- Provider catalog from Convex.
- Integration list/grid rendering is driven by provider catalog metadata (no hardcoded provider list in hooks/components).
- Dashboard provider catalog + integration/workspace-integration query payloads are validated with shared boundary contracts before rendering provider lists or detail actions.
- Dashboard approvals, rules, and workspace-list query payloads are parse-validated with shared Convex boundary contracts; invalid payloads fail closed to safe empty/null UI states instead of rendering unchecked data.
- Dashboard helpers that decode archived logs, persisted JSON blobs, or structured backend errors must use the shared JSON parse helpers so malformed payloads degrade to safe fallback UI instead of ad hoc casts.
- Dashboard integrations list/detail surfaces must render provider deprecation notifications automatically when provider catalog entries include `deprecation` metadata.
- Connect/disconnect/test/register operations through Convex-first APIs.
- OAuth initiation for Google, Stripe, and GitHub goes through API edge routes (`/oauth/integrations/{provider}/connect`), then callback returns to dashboard.
- Individual provider detail page at `/:orgSlug/:workspaceSlug/integrations/$provider` exposes provider context and test action tooling.
- Integration detail routes enforce canonical provider IDs (`/:orgSlug/:workspaceSlug/integrations/google`, not `/:orgSlug/:workspaceSlug/integrations/gmail`).
- Integration detail route errors must distinguish non-canonical aliases (show canonical replacement) from unsupported providers.
- Provider detail forms are driven by shared UI contracts from `@keppo/shared/providers-ui` (`getProviderDetailUi`, field definitions, defaults, serializers, metadata-editor contracts).
- The integration detail route renders provider fields generically (text/number/csv/json/textarea) and submits through shared serializers instead of provider-specific JSX branches.
- Provider detail write-action controls remain capability-driven from provider catalog metadata (`supported_tools`), and shared UI contracts decide whether the provider uses a fixed write tool (`gmail.sendEmail`, `stripe.issueRefund`, `github.commentIssue`) or catalog-selected generic write tool.
- Provider metadata editors (for example Stripe `allowed_write_modes`, GitHub `allowed_repositories`) are configured in shared UI contracts and persisted through a generic dashboard editor renderer.
- Detail-page write actions must be disabled with explicit UX feedback when a provider is disabled for the selected workspace integration policy.
- Integration detail cards expose degradation diagnostics (`last_health_check_at`, `last_successful_health_check_at`, `last_error_*`, `last_webhook_at`, reconnect guidance).
- Integration `connected` semantics are credential-centric, not health-state-centric: non-auth degraded providers stay connected with warning UI, while expired or auth-degraded credentials switch to reconnect-required UI.
- The legacy inline custom-provider form on `/integrations` is replaced by navigation to dedicated custom-server management screens.

## Visual system

Generic visual, interaction, and accessibility rules live in `docs/rules/ux.md`. This spec keeps only the product-contract details that shape the information architecture:

- The public docs surface inherits the same shared tokens, typography, and light/dark behavior as the main app while using docs-specific layout primitives for navigation, table of contents, and search.
- The authenticated shell keeps workspace navigation primary in the sidebar, while lower-frequency organization controls collapse into a compact `Organization settings` disclosure.
- Admin access does not consume persistent sidebar space; eligible users get a visible `Admin` affordance in the header and user menu.
- The admin abuse `Danger Zone` preview must distinguish user-delete outcomes per organization membership:
  - sole-member orgs are eligible for full org deletion
  - shared org memberships owned by someone else are removed without deleting the org
  - sole-owner/shared-member orgs must block deletion until ownership is transferred or the org is deleted explicitly
- Admin hard-delete confirmation labels render the confirmation token with semantic code styling, and the lookup inputs submit on `Enter`.

- `/:orgSlug/:workspaceSlug/servers` (workspace-scoped list + registration):
  - server cards show display name, URL, connection status, tool count, last discovery timestamp, token-configured indicator.
  - add-server form fields: display name, slug, URL, bearer token.
  - successful registration immediately schedules discovery.
- `/:orgSlug/:workspaceSlug/servers/$serverId` (detail + tool management):
  - server info card with editable name/URL/token.
  - discovery controls: `Rediscover Tools` and `Test Connection`.
  - discovered-tools table with inline per-tool controls:
    - risk level dropdown (`low|medium|high|critical`),
    - `requires_approval` switch,
    - `enabled` switch.
  - bulk configuration actions (risk/approval/enabled defaults).
  - destructive delete flow with confirmation.
- Sidebar navigation includes `Custom Servers` entry with connected-server count badge.
- Sidebar organization links are grouped under a compact disclosure instead of four always-expanded top-level rows.

## Product behaviors that matter

- Real-time updates come from Convex subscriptions, not ad hoc polling.
- When the UI exposes a manual refresh action, that control must issue a real query refresh against the backing data source; exported refresh callbacks cannot be dead no-ops.
- The health screen surfaces feature flags, audit errors, DLQ state, and subsystem health.
- The prompt builder creates automations inside the current workspace and routes operators back into the automation workflow.
- Custom MCP server routes let org admins register servers, inspect discovered tools, and enable them for workspaces.

## Dashboard overview modes

- The overview route (`/:orgSlug/:workspaceSlug/`) has two operator-facing modes keyed off `automations.length`.
- First-time mode (`automations.length === 0`) replaces the multi-card dashboard with one focused flow:
  - greeting header plus readiness badge
  - subtitle: `Create your first automation to get started.`
  - full-width `AutomationPromptBox` hero with no additional status/health/approvals cards competing for attention
  - compact setup progress panel that shows `Step N of 4`, a progress bar, and per-step badges
- Returning-user mode (`automations.length > 0`) becomes automation-centric:
  - primary full-width automation summary card with active automation count, latest run status/time, and compact attention alerts
  - quick actions for `Run Automation` and `Open Automations` live in that summary card
  - a compact `Create another` builder card sits below the summary
  - the secondary row contains `RecentActions` plus one compact `Health and readiness` card
  - the legacy standalone `Workspace status` and expandable `Workspace readiness` cards are removed from the main overview
- Overview loading keeps the shell mounted and shows skeletons inside the route content area.

## Readiness model

- The user-facing readiness checklist is collapsed to four steps in the presentation layer:
  - `Connect a provider`
  - `Confirm AI access`
  - `Create your first automation`
  - `Run your first automation`
- `Connect a provider` is only complete once both `has_connected_integration` and `has_enabled_workspace_integration` are true.
- The underlying Convex `onboarding:getReadiness` payload shape is unchanged; only the dashboard presentation merges the lower-level milestones.

## Credential expiry messaging

- Integration boundary payloads include `has_refresh_token` so dashboard surfaces can distinguish short-lived access tokens from truly expiring credentials.
- Dashboard expiry warnings only render for connected integrations where `has_refresh_token === false` and `credential_expires_at` is within the warning window.
- Refreshable OAuth integrations such as Google should not immediately show “credential expiring soon” warnings after a successful connect because the refresh token path can renew the access token automatically.
- Reconnect-required messaging is reserved for expired credentials and auth degradation classes (`missing_scopes`, revoked credentials, missing refresh token, explicit auth failures). Transient network, provider API, rate-limit, and policy degradations keep the provider visually connected while still contributing to degraded-attention surfaces.

#### B. Workspaces

- On bootstrap, each org gets a default workspace automatically so first login lands with at least one workspace pre-created.
- Every workspace has a stable slug, and workspace switching rewrites the current URL instead of storing the selected workspace only in `localStorage`.
- Create workspace.
- Workspace creation enforces subscription tier limits (free=2, starter=5, pro=25) with explicit limit errors in UI.
- Delete workspace with an explicit confirmation dialog:
  - the last remaining workspace cannot be deleted
  - deleting the currently selected workspace immediately switches the operator to another active workspace
  - deleting a workspace revokes its active workspace credential
  - workspace lists and slug recovery only budget active workspaces, so disabled historical rows do not hide still-active destinations
- Configure workspace integrations.
- Configure workspace custom-server enablement via `Custom MCP Servers` card (per-server toggle, default-enabled behavior when no explicit override exists).
- Update policy mode.
- Update Code Mode setting (`code_mode_enabled`) via a dedicated workspace settings switch:
  - label: `Code Mode`
  - description: `Replace individual tools with search_tools and execute_code for reduced token usage. search_tools only lists providers that are both enabled for this workspace and currently connected.`
- Rotate workspace credentials.
- Workspace MCP settings show credential status and rotation controls, but do not expose the Keppo MCP endpoint or client-specific setup instructions.

#### C. Billing

- Billing page at `/:orgSlug/settings/billing` shows current tier, status, billing period, and usage progress bars.
- Billing page surfaces dedicated AI Credits and Automation Runs cards near the top so operators can see remaining prompt credits and current-period run capacity without digging through tool-call metrics.
- Billing page includes one unified row of plan cards for `Free trial`, `Starter`, and `Pro` that compares monthly price, workspace capacity, included AI credits, and monthly tool-call limits while attaching the correct plan-specific CTA to each card.
- The unified plan cards follow billing-source-aware actions: `free` orgs can start checkout only on higher paid tiers, the `Free trial` card explains there is no subscription to manage instead of offering cancellation, Stripe-paid orgs manage the current paid tier from its card and can change only to eligible adjacent tiers, and invite promos keep Stripe checkout available without exposing native Stripe manage/change controls.
- Billing copy explains that hosted bundled credits, including the free-trial one-time grant, can power both prompt generation and automation runtime when bundled runtime is enabled; self-managed deployments continue to require org-managed provider keys when bundled runtime is unavailable.
- Upgrade CTAs call API billing checkout endpoint (`/billing/checkout`) for starter/pro Stripe Managed Payments sessions, with Stripe-hosted promotion-code entry enabled during recurring checkout.
- Billing page includes AI credit-pack CTAs and paid-tier automation run top-up CTAs so one-time purchases live beside recurring subscription management.
- Automation Runs card shows effective run capacity for the current billing period, including any active purchased top-ups, and breaks out purchased remaining runs when present.
- Manage Subscription CTA calls API billing portal endpoint (`/billing/portal`) for Stripe customer self-service.
- Usage display is driven by Convex billing query subscription data (`billing.getCurrentOrgBilling`).
- Billing state distinguishes `free`, `stripe`, and `invite_promo` sources:
  - `free` shows recurring-plan checkout CTAs plus an invite-code redemption card.
  - `stripe` shows native plan-change and portal controls.
  - `invite_promo` shows a promo-active banner with the granted tier and exact expiry date, keeps recurring checkout CTAs available, and hides portal/change-plan controls until the org converts to Stripe.

#### D. Members

- Members page at `/:orgSlug/settings/members` lists org members with role badges and join dates.
- Owner/admin can invite by email with role selection; invite creation calls API route (`POST /invites/create`) to send Mailgun email.
- Owner/admin can revoke pending invites.
- Owner can update member roles; owner/admin can remove non-self members.
- Leave-org action is available for members except sole-owner edge case.
- Member count displays against tier seat limits and links to billing.

#### E. Prompt builder

- Provider/tool catalog sourced from Convex.
- Tool tagging remains available and the page exports only the generated system prompt.

#### F. Approvals queue (real-time)

- Pending actions via Convex query subscription.
- Approvals queue supports live status filtering (`All`, `Pending`, `Approved`, `Rejected`), client-side search across action type and payload preview, keyboard review shortcuts (`j/k/a/r`) when the table region is focused, and batch approve/reject controls for multi-select review.
- Approve/reject via Convex mutations.
- Dashboard "Test Action" dialog tool presets/field serialization are sourced from shared provider UI contracts (`@keppo/shared/providers-ui`) instead of dashboard-local provider maps.
- No SSE dependency.

#### G. Action inspector

- Action detail, approvals, rule matches, policy decisions, and timeline from Convex query.

#### H. Rules configuration

- CEL rules/policies/auto-approvals CRUD via Convex mutations.
- Auto-approval tool presets and risk badges are sourced from shared provider UI contracts (`@keppo/shared/providers-ui`) instead of dashboard-local tool lists.
- Decision logs from Convex query.
- CEL Rules tab is feature-gated:
  - visible only when `admin.orgFeatureAccess(featureKey=\"cel_rules\")` is `true` for the active org
  - hidden orgs default to Policies tab and receive empty CEL rule/match data from backend queries

#### I. Audit logs

- Filtered audit queries via Convex.
- Client-side export from Convex query result set.

#### J. Invite acceptance

- Public route at `/invites/accept?token=...` is accessible while signed out.
- Signed-out users are prompted to sign in; login redirect preserves the invite accept URL.
- Signed-in users submit token to API route (`POST /invites/accept`) and see success/failure state.
- Public invite and login failures must stay sanitized even when upstream responses include richer operator detail.

#### K. Invite codes

- Dashboard access is no longer gated by invite codes at sign-in or on first workspace load.
- `/admin/invite-codes` lets platform admins create, review, and activate/deactivate invite codes, including the granted tier and per-code redemption counts.
- Billing surfaces can redeem paid invite codes, showing plan-specific success copy with the unlocked tier and expiry date.

#### L. Notifications

- Header includes a clickable AI-credit badge that routes to billing, a help/support dialog entry point, and a notification bell with unread count badge.
- Bell popover lists recent in-app notifications (`notifications.listInAppNotifications`) with unread-first ordering.
- Bell popover defaults to 10 recent items and can load 10 more inline without leaving the popover.
- Clicking a notification marks it read and navigates to its scoped CTA route (`/:orgSlug/:workspaceSlug/approvals`, `/:orgSlug/settings/billing`, etc.).
- Real-time approval alerts raise an in-app toast for newly arrived approvals; the alert layer is suppressed under `navigator.webdriver` so ARIA goldens stay deterministic in E2E.
- A “Mark all read” action clears unread notifications for the active org.
- Sidebar “Approvals” entry renders live unread badge count from `notifications.countUnread`.
- Document title is prefixed with unread count and favicon is dynamically badged when unread count is non-zero.
- Settings page includes a Notifications card for:
  - endpoint management (email add/remove/toggle),
  - push enable/disable flow via service worker subscription,
  - per-event per-channel endpoint preference toggles,
  - local sound-notification preference for approval toasts.
- Notification CTA routing must support dynamic in-app routes (for example `/:orgSlug/:workspaceSlug/automations/{id}`) in addition to static routes.

#### M. Automations automation

- Sidebar includes `Automations` entry.
- **Automation Builder** (`automation-prompt-box.tsx`): staged guided creation flow shared by the dashboard home hero, automations page, and global modal entrypoint.
  - Appears on the dashboard home page (`variant="hero"`) and the automations page (`variant="compact"`), and the same builder is rendered in the global `Cmd+K` / `Ctrl+K` modal.
  - Stages are explicit and ordered: `brief -> questions -> draft -> providers -> settings -> ready`, with distinct pending states for question generation and draft generation plus a short success transition before navigation.
  - The builder persists the in-progress prompt, generated questions, answers, current question index, and generated draft per workspace so switching between the home hero, automations page, and modal does not reset progress.
  - It calls `POST /api/automations/generate-questions` first, then `POST /api/automations/generate-prompt` only after the operator finishes the questionnaire.
  - The question stage is one-question-at-a-time, keyboard-first, and limited to `radio`, `checkbox`, and single-line `text` inputs.
  - Question generation may return fewer than 4 questions or none at all when the brief is already specific.
  - The question-stage payload includes explicit billing metadata stating that clarifying questions do not deduct a credit and the single credit is charged only when the final draft is generated.
  - The draft-generation payload returns `name`, `trigger_type`, `schedule_cron`, `event_provider`, `event_type`, `provider_recommendations`, `prompt`, `description`, `mermaid_content`, `credit_balance`, and explicit draft billing metadata.
  - The draft stage exposes `name`, plain-language `description`, separate `mermaid_content`, the executable prompt, and a compact answer summary so operators can see which clarifications shaped the generated workflow before creation.
  - Provider recommendations are advisory metadata, not hard blockers; each recommendation includes the provider id, reason, and confidence (`required` or `recommended`).
  - The provider stage shows inline `Connect`, `Open`, and `Skip` actions so users can satisfy likely dependencies without leaving the builder context permanently.
  - The settings stage keeps model/runtime/network choices explicit before creation instead of burying them behind a single review card, warns clearly when no usable AI access is configured, and expresses network access as a web-access toggle instead of MCP jargon.
  - Success routes to the slugged automation detail URL, while the underlying create mutation still returns the stable automation id for internal lookups.
- **Operator Command Palette** (`operator-command-palette.tsx` + `automation-prompt-modal.tsx`): global `Cmd+K` / `Ctrl+K` opens a centered command palette that can jump to automations, run active automations, open approvals/integrations/admin, connect providers, and launch the same staged builder in a follow-up dialog. It is only active when authenticated and a workspace is selected.
- `/:orgSlug/:workspaceSlug/automations` route:
  - top-level actions include `Build automation`, `Create manually`, and visible AI-credit balance for the current org.
  - the guided builder (compact variant) sits below the automation list for quick AI-assisted creation without pushing the table out of view.
  - `Create manually` routes to a dedicated page rather than opening an in-place dialog.
  - automation list with status, trigger, runner, and latest-run summary bundled into the initial list payload so rows render in a stable single pass without per-row pop-in.
  - dedicated child routes `/automations/build` and `/automations/create` provide focused entry points for the AI builder and the manual multi-step form.
- the manual create page shows the derived runtime mode for the selected provider, blocks submission when hosted bundled credits are unavailable or when a self-managed deployment has no active provider key, and keeps AI generation out of the flow entirely.
- create-automation dialog (advanced/manual path) shows the same derived runtime state, blocks submission when neither hosted bundled credits nor a self-managed provider key is available, keeps prompt authoring in the primary flow, and tucks runner/model/network controls behind an `Advanced Settings` disclosure with inline help text for provider-trigger delivery and network access.
  - manual create, config-edit, and advanced create-dialog schedule forms share one dropdown-based cron builder that emits valid five-field cron strings under the hood, defaults to daily at 9:00 AM, and keeps inline validation through shared `react-hook-form` + `zod` wiring.
- Trigger config UX:
  - schedule trigger uses a structured builder for frequency, time, weekday, and day-of-month choices; the stored value remains a cron expression and the UI shows a `humanizeCron()` summary (for example “Every day at 9:00 AM”).
  - event trigger is provider-owned: the operator chooses a trigger-capable integration, then a provider-declared trigger definition, then fills structured filters such as Gmail sender/recipient/subject/label/unread constraints without seeing raw schema JSON.
  - manual trigger is represented as an on-demand option.
  - CEL predicate input is visible only when org has `trigger_cel` feature access.
  - legacy migrated event triggers render an explicit migration warning until the operator resaves them as a provider-owned trigger definition.
- `/:orgSlug/:workspaceSlug/automations/$automationId` route:
  - route param resolves against the persisted workspace-scoped slug first, with safe fallback to the legacy opaque id during rollout or direct deep links.
  - summary card spans the full content width, keeps a clickable status badge that routes to the latest run when available, and places the workflow diagram behind a collapsed disclosure by default.
  - controls sit in a compact horizontal action bar below the summary instead of a tall right sidebar.
  - controls include an `Edit with AI` entrypoint that reuses the guided builder pattern against the current automation context, asks only the missing clarifications, and shows a user-friendly reviewed diff before applying changes.
  - unresolved automation queries keep the page structure visible with a shell-friendly loading skeleton instead of collapsing to plain text.
  - automation metadata stores prose in `description` and diagram syntax in `mermaid_content`; the detail page renders the prose as structured text and the Mermaid field as a diagram, while legacy fenced `mermaid` blocks in old descriptions remain readable during rollout.
  - Mermaid freshness is derived from the current prompt versus the stored Mermaid prompt hash; when they diverge, the detail view shows an advisory banner with a `Regenerate diagram` action that uses the current prompt as the source of truth.
  - tabs: `Home`, `Config`, `Runs`, `Versions`.
  - Home tab puts Recent Runs ahead of Configuration and renders recent runs as a compact table with status, trigger type, relative start time, and duration.
  - Home tab includes trigger observability for provider-trigger automations: recent matched/skipped deliveries, skip reasons, current delivery mode, trigger-subscription health, last queued dispatch time, and deep links to the resulting automation runs.
  - config editor saves immutable versions and supports optional change summary.
  - config editor shows the same stale-diagram advisory when the prompt changes without a corresponding Mermaid refresh, and can regenerate Mermaid in-place before save.
  - versions tab supports inspect, compare (field-level diff), and rollback.
- `/:orgSlug/:workspaceSlug/integrations/$provider` route:
  - integrations list cards surface the current unhealthy reason inline whenever a connected provider is degraded, with a short stable diagnostic label when an error category/code exists.
  - Google integration details include incoming-email trigger health sourced from persisted trigger lifecycle metadata: active delivery mode, push-watch expiry, polling cursor, last sync/poll timestamps, and the latest provider error so operators can see when Gmail fell back from push to polling.
  - provider detail headers show the operator-safe reason an integration is unhealthy, not just a generic degraded summary, and may include the stable diagnostic category/code for support triage.
  - runs tab shows a conversation-style card list with status icon, trigger type, relative time, duration, and a short triage summary instead of only status plus timestamp; when a run has a recorded final outcome, each row also shows an explicit reported/fallback outcome badge and uses the recorded plain-text summary as the primary “what happened” line. Fallback badges must preserve success vs failure meaning instead of styling every inferred outcome as a failure. Clicking a run navigates to its detail route.
- `/:orgSlug/:workspaceSlug/automations/$automationId/runs/$runId` route:
  - header bar with back button, status badge, trigger type, duration, run ID, cancel action, and an explicit recorded/fallback outcome badge when a final outcome exists.
  - two tabs: `Chat` (default) and `Raw Logs`.
  - summary card distinguishes lifecycle state from final outcome: when the run has a recorded outcome, the card headline and summary text come from that outcome rather than generic status-only copy. The summary icon must stay aligned with the actual lifecycle state so pending/running/cancelled runs never render a success checkmark by default.
  - Chat tab renders structured log events as styled bubbles:
    - consecutive compatible events are grouped into a single bubble so live runs read as coherent sections instead of one-line fragments.
    - `system`: inline operational updates with info icon; adjacent status lines can collapse into one system block, but structured automation-outcome system events stay isolated and render as dedicated success/failure outcome cards.
    - `automation_config`: grouped runtime settings chips/cards for contiguous config lines, with collapsible raw object fallback for bundled config payloads.
    - `thinking`: left-aligned grouped block with brain icon; adjacent reasoning fragments stay in one calm bubble and preserve paragraph boundaries.
    - `search_tools`: dedicated first-class card for Code Mode tool discovery that shows the captured search query inline, summarizes top matching tools in the collapsed state, and keeps the full result list behind a disclosure that is closed by default.
    - `execute_code`: dedicated first-class card for Code Mode execution that surfaces the model-generated 1-2 sentence description inline, falls back to generic `Executed code` copy for historical runs without that field, and keeps the raw JavaScript behind an explicit expandable syntax-highlighted code block.
    - `tool_call`: generic card with tool name, collapsible args JSON tree, attached result payload, duration badge, and success/error status; structured result output should bind to the initiating tool call instead of rendering as a detached bubble.
    - `output`: emphasized bubble with terminal icon; contiguous plain-text output lines merge together, while JSON output renders as a compact tree with collapsed nested branches by default.
    - `error`: red-tinted bubble with alert icon and optional error code badge.
    - `raw`: monospace fallback for legacy runs without structured event data.
  - each bubble has an expandable debug section showing seq range, timestamps, and the raw lines absorbed into that grouped bubble.
  - Raw Logs tab renders the original terminal-style log viewer for full unprocessed output.
- Structured log events:
  - `automation_run_logs` table includes optional `event_type` and `event_data` fields.
  - event types: `system`, `automation_config`, `thinking`, `tool_call`, `output`, `error`.
  - log ingestion classifies raw sandbox output into structured events via pattern matching, including Codex `mcp: keppo/search_tools started`, `mcp: keppo/search_tools (completed)`, `mcp: keppo/execute_code started`, and `mcp: keppo/execute_code (completed)` lifecycle lines.
  - when an automation-authenticated MCP request executes `search_tools` or `execute_code`, the MCP route also appends narrow structured `tool_call` logs with the actual request payload and result summary so grouped timeline cards can show operator-useful details even though raw Codex lifecycle lines do not contain them.
  - legacy runs without event fields fall back to `raw` type rendering in the chat UI.
- Log viewer behavior:
  - hot mode streams `automation_runs:getAutomationRunLogs` via Convex reactivity with optional scroll lock.
  - cold mode fetches archived blob from storage URL and renders decompressed lines.
  - expired mode renders explicit retention-expired state.

#### M. Settings: AI configuration and credits

- Settings page includes org-level AI configuration:
  - when hosted bundled runtime is enabled, the page hides self-managed API-key entry, explains that Keppo manages runtime credentials automatically, and shows any bundled credential rows as billing-managed records.
  - when hosted bundled runtime is unavailable, the page falls back to the self-managed AI key manager:
    - list stored active/inactive keys with provider/mode/hint and update time; user-removed BYOK and `subscription_token` credentials disappear after deletion instead of lingering as inactive rows.
    - add/update key flow (`provider`, secret input) creates BYOK credentials via `org_ai_keys:upsertOrgAiKey`.
    - legacy OpenAI `subscription_token` credentials can remain visible for existing orgs but cannot be created from the dashboard anymore.
    - remove flow via `org_ai_keys:deleteOrgAiKey`; bundled keys remain billing-managed and cannot be removed from the dashboard.
    - inline usage summary of which providers are currently running in bundled or self-managed mode based on present org billing and key state, rather than storing per-automation mode selections.
- Settings page includes AI credit panel:
  - allowance usage + purchased balance from `ai_credits:getAiCreditBalance`.
  - Stripe checkout launch for credit packs via `/billing/credits/checkout`.
  - purchase history with remaining credits + expiry from `ai_credits:listAiCreditPurchases`.

#### N. Admin feature rollout

- `/admin` route is visible to users listed in Convex env `KEPPO_ADMIN_USER_IDS`; local development may also expose it when `KEPPO_LOCAL_ADMIN_BYPASS=true` is set and the runtime is genuinely local/loopback.
- The main authenticated shell surfaces admin access from the header/user affordances rather than dedicating a persistent sidebar section.
- Admin routes live in a standalone platform-admin shell rather than reusing the workspace/org sidebar shell.
- Admin sidebar sections are:
  - `Overview` (`/admin`)
  - `Feature Flags` (`/admin/flags`)
  - `System Health` (`/admin/health`)
  - `Usage` (`/admin/usage`)
  - `Abuse` (`/admin/abuse`)
- Admin sidebar footer includes `Back to dashboard` plus the shared user menu.
- Admin overview shows platform-wide counts for organizations, users, active automation runs, and suspended organizations, plus quick links into the four operational sections.
- Feature Flags page includes:
  - Feature Flags card (global dogfood feature toggles)
  - Dogfood Organizations card (org allowlist for dogfood features)
- Initial seeded flag key is `cel_rules`.

#### O. Admin health operations

- `/admin/health` remains visible in the user menu for platform admins and for local-development sessions when `KEPPO_LOCAL_ADMIN_BYPASS=true` is set and the API + Convex runtime are genuinely local/loopback.
- Non-admins who reach `/admin` or any admin child route see a dedicated restricted-state panel rather than a blank or partially-rendered shell.
- Admin view auto-refreshes every 30 seconds and includes:
  - subsystem status cards from API `GET /health/deep`,
  - cron job status table (`HEALTHY` / `STALE` / `FAILING`),
  - durable rate-limit activity summary (bucket counts from sampled active keys),
  - feature-flag table from API `GET /health/flags` with enable/disable actions for platform admins or explicit local admin-bypass sessions,
  - recent audit-error table from API `GET /health/audit-errors?limit=50` showing timestamp, event type, actor, provider, and summary,
  - dead-letter queue table with `Replay` and `Abandon` actions,
  - provider circuit-breaker state table.
- `/admin/usage` shows a sortable organization table for subscription tier, tool calls, AI credit usage, automation runs, and suspension status; suspended orgs and >80%-of-limit orgs receive explicit row highlighting, and selecting a row opens a detail panel with last-period usage, active runs, and suspension history.
- `/admin/abuse` shows active suspensions, a full organization table with suspend/unsuspend controls, and a 100-row cross-platform suspension history table.
- `/admin/abuse` also includes a destructive `Danger Zone` with two explicit, admin-only hard-delete flows:
  - `Delete Organization` accepts an org slug or Better Auth org ID, loads a preview with member/workspace/automation counts, keeps destructive errors inline inside the preview card, submits from both the button and `Enter`, and blocks permanent deletion until any active Stripe subscription is canceled.
  - `Delete User` accepts a user email or Better Auth user ID, loads a preview of the user's organization memberships, keeps destructive errors inline inside the preview card, submits from both the button and `Enter`, and only permanently deletes organizations where the target user is the sole member; shared memberships are removed and sole-owner shared orgs stay blocked pending ownership transfer.
- The dashboard overview never invents activity data; its activity panel must derive from real audit events and fall back to an explicit empty state when there is no recent activity to chart.
- The dashboard overview centers on truthful readiness: onboarding progress, pending approvals, provider readiness, active-automation coverage, and the next action the operator should take. It should not fall back to shallow org/workspace counters that imply precision without helping the user decide what to do next.
- Workspace onboarding derives completion from backend state (`onboarding:getReadiness`) for connected integrations, workspace-enabled integrations, AI key presence, automation creation, and first-action activity; only the MCP-copy milestone remains client-derived because it reflects local operator setup.
- The sidebar always exposes a `Setup Guide` affordance that re-opens the readiness checklist after dismissal instead of hiding onboarding permanently.
- The dashboard home starts with action-oriented guidance: a `Needs attention` section for pending high-risk approvals, degraded integrations, recent failed runs, and expiring credentials, followed by contextual quick actions and an empty-workspace getting-started card when the workspace has no operational data yet.
- Rules empty state must teach the operator what rules do, suggest a first concrete policy or approval pattern, and open directly into rule creation for managers.
- The settings surface is tabbed into `Account`, `Appearance`, `Notifications`, and `AI Configuration`, and theme selection is available inline instead of only via the global header toggle.
