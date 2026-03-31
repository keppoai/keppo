# Plan: Add Linear Provider Integration

## Status: Draft

## Goal

Add Linear as a fully canonical provider in Keppo with comprehensive tool coverage (issues, projects, teams, cycles, comments, labels, users, workflows), OAuth2 managed authentication, webhook support, and full SDK/fake/conformance parity with existing providers like GitHub.

## Problem

Linear is one of the most requested integrations for engineering teams. It's a natural fit for Keppo's approval-gated automation model — teams want to automate issue triage, status transitions, comment notifications, and sprint management but need safety rails for destructive operations. Currently Keppo supports 7 canonical providers (`google`, `stripe`, `slack`, `github`, `notion`, `reddit`, `x`) plus `custom`. Linear is absent from this list.

## Non-Goals

- Automation trigger definitions (polling/push triggers for Linear events) — can be added in a follow-up after the base provider ships.
- Linear OAuth app registration guidance or hosted setup — that's a docs/setup.md update.
- E2E Playwright specs for the Linear integration detail page — E2E coverage follows once the provider is stable.
- Dashboard icon SVG design — will use a placeholder icon until a Linear brand icon is added to the icon set.

## Implementation Plan

### Phase 1: Canonical Provider Registration

Register `linear` as a canonical provider ID across all shared infrastructure.

**Files changed:**

- `packages/shared/src/provider-ids.ts`
- `packages/shared/src/provider-default-scopes.ts`
- `packages/shared/src/provider-catalog.ts`
- `packages/shared/src/circuit-breaker.ts`
- `packages/shared/src/feature-flags.ts` (auto-generated from provider ID pattern)
- `packages/shared/src/types.ts` (if `Provider` type is derived from `CanonicalProviderId`)
- `packages/shared/src/provider-deprecations.ts` (ensure no-op entry or no entry needed)

**Steps:**

- [ ] Add `"linear"` to `CANONICAL_PROVIDER_IDS` array in `provider-ids.ts`
- [ ] Add `linear: ["linear.read", "linear.write"]` to `PROVIDER_DEFAULT_SCOPES` in `provider-default-scopes.ts`
- [ ] Add `linear: ["LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET"]` to `providerConfigurationRequirements` in `provider-catalog.ts`
- [ ] Add Linear circuit breaker config in `circuit-breaker.ts` — use default thresholds (5 failures / 30s cooldown), similar to GitHub
- [ ] Verify the `CanonicalProviderId` type union and any downstream `Provider` type in `types.ts` automatically pick up the new entry (they derive from `CANONICAL_PROVIDER_IDS`)
- [ ] Verify `feature-flags.ts` auto-generates `KEPPO_FEATURE_INTEGRATIONS_LINEAR_FULL` from the provider ID pattern via `providerRolloutFeatureFlag`

**Verification:** `pnpm check` passes in `packages/shared`. The new provider ID is recognized by `resolveProvider("linear")`.

### Phase 2: Tool Definitions

Define the full Linear tool catalog with Zod input schemas.

**Files changed:**

- `packages/shared/src/tool-definitions/linear.ts` (new)
- `packages/shared/src/tool-definitions.ts`

**Steps:**

- [ ] Create `packages/shared/src/tool-definitions/linear.ts` with comprehensive tool definitions:
  - **Read tools (capability: "read", risk_level: "low", requires_approval: false):**
    - `linear.listIssues` — list issues with optional filters (team, state, assignee, label)
    - `linear.getIssue` — get issue by ID or identifier (e.g., `ENG-123`)
    - `linear.searchIssues` — full-text search issues
    - `linear.listProjects` — list projects with optional team filter
    - `linear.getProject` — get project by ID
    - `linear.listTeams` — list teams in workspace
    - `linear.getTeam` — get team by ID or key
    - `linear.listCycles` — list cycles for a team
    - `linear.getCycle` — get cycle by ID
    - `linear.listLabels` — list labels (optional team scope)
    - `linear.listUsers` — list workspace members
    - `linear.getUser` — get user by ID
    - `linear.listComments` — list comments on an issue
    - `linear.listWorkflowStates` — list workflow states for a team
    - `linear.listProjectUpdates` — list project updates
  - **Write tools (capability: "write", risk_level varies, requires_approval: true):**
    - `linear.createIssue` — risk: "medium"
    - `linear.updateIssue` — risk: "medium" (state transitions, assignments, priority)
    - `linear.deleteIssue` — risk: "high"
    - `linear.createComment` — risk: "medium"
    - `linear.updateComment` — risk: "medium"
    - `linear.deleteComment` — risk: "medium"
    - `linear.createProject` — risk: "medium"
    - `linear.updateProject` — risk: "medium"
    - `linear.deleteProject` — risk: "high"
    - `linear.createLabel` — risk: "low"
    - `linear.addIssueLabel` — risk: "low"
    - `linear.removeIssueLabel` — risk: "low"
    - `linear.assignIssue` — risk: "medium"
    - `linear.unassignIssue` — risk: "medium"
    - `linear.createProjectUpdate` — risk: "medium"
    - `linear.archiveIssue` — risk: "medium"
    - `linear.unarchiveIssue` — risk: "low"
- [ ] Add `linearTools` export to `packages/shared/src/tool-definitions.ts` — import, re-export, and add to `allTools` array
- [ ] Each tool definition must include: `name`, `provider: "linear"`, `capability`, `risk_level`, `requires_approval`, `output_sensitivity`, `action_type`, `description`, `redaction_policy`, `input_schema` (Zod)

**Verification:** `pnpm check` passes. `allTools` includes all Linear tools. `toolMap` resolves every `linear.*` tool name.

### Phase 3: SDK Layer

Create the Linear SDK port, real client (using `@linear/sdk`), fake client, and fixtures.

**Files changed:**

- `packages/shared/src/provider-sdk/linear/types.ts` (new)
- `packages/shared/src/provider-sdk/linear/client-interface.ts` (new)
- `packages/shared/src/provider-sdk/linear/client.ts` (new)
- `packages/shared/src/provider-sdk/linear/sdk-runtime.ts` (new)
- `packages/shared/src/provider-sdk/linear/real.ts` (new)
- `packages/shared/src/provider-sdk/linear/fake.ts` (new)
- `packages/shared/src/provider-sdk/linear/fake-client-runtime.ts` (new)
- `packages/shared/src/provider-sdk/linear/fake-client-adapter.ts` (new)
- `packages/shared/src/provider-sdk/linear/fixtures.ts` (new)
- `packages/shared/src/provider-sdk/linear/errors.ts` (new)
- `package.json` (add `@linear/sdk` dependency)

**Steps:**

- [ ] Add `@linear/sdk` to `packages/shared/package.json` dependencies
- [ ] Create `types.ts` — define SDK arg/result types for all tools:
  - `LinearSdkContext` (`accessToken`, optional `namespace`)
  - Result types: `LinearIssue`, `LinearProject`, `LinearTeam`, `LinearCycle`, `LinearLabel`, `LinearUser`, `LinearComment`, `LinearWorkflowState`, `LinearProjectUpdate`, `LinearDeleteResult`
  - Arg types for each SDK method (e.g., `LinearListIssuesArgs`, `LinearCreateIssueArgs`, etc.)
  - `LinearSdkPort` interface extending `ProviderSdkPort` with all methods
- [ ] Create `client-interface.ts` — thin typed interface wrapping `@linear/sdk` LinearClient methods used by the SDK
- [ ] Create `client.ts` — `createRealLinearClient` factory that instantiates the `@linear/sdk` `LinearClient` with access token and optional base URL override (`LINEAR_API_BASE_URL` env var for fake routing)
- [ ] Create `errors.ts` — `toProviderSdkError` for Linear-specific error mapping
- [ ] Create `sdk-runtime.ts` — `LinearSdk` class extending `BaseSdkPort`, implementing all `LinearSdkPort` methods by delegating to the client interface
- [ ] Create `real.ts` — `createRealLinearSdk` using `createRealSdkFactory`
- [ ] Create `fixtures.ts` — deterministic fixture data for all Linear entity types
- [ ] Create `fake-client-runtime.ts` — `FakeLinearClientStore` with in-memory state, namespace isolation, reset, and call-log capture (following `FakeGithubClientStore` pattern)
- [ ] Create `fake-client-adapter.ts` — adapter from fake client store to client interface
- [ ] Create `fake.ts` — `createFakeLinearSdk` using `createFakeSdkFactory`

**Verification:** `pnpm check` passes. Unit tests for fake client store confirm CRUD lifecycle, namespace isolation, and call-log capture.

### Phase 4: Provider Module

Create the provider module with all required facets.

**Files changed:**

- `packages/shared/src/providers/modules/linear/index.ts` (new)
- `packages/shared/src/providers/modules/linear/metadata.ts` (new)
- `packages/shared/src/providers/modules/linear/auth.ts` (new)
- `packages/shared/src/providers/modules/linear/tools.ts` (new)
- `packages/shared/src/providers/modules/linear/schemas.ts` (new)
- `packages/shared/src/providers/modules/linear/ui.ts` (new)
- `packages/shared/src/providers/modules/linear/refresh.ts` (new)
- `packages/shared/src/providers/modules/linear/webhooks.ts` (new)
- `packages/shared/src/providers/modules/linear/connector.ts` (new)
- `packages/shared/src/providers/modules/linear/connector-runtime.ts` (new)
- `packages/shared/src/providers/modules/index.ts`

**Steps:**

- [ ] Create `metadata.ts`:
  - `providerId: "linear"`
  - `auth: { mode: PROVIDER_AUTH_MODE.oauth2, managed: true }`
  - `capabilities: { read: true, write: true, refreshCredentials: true, webhook: true, automationTriggers: false }`
  - `featureGate: "KEPPO_FEATURE_INTEGRATIONS_LINEAR_FULL"`
  - `riskClass: "medium"`
  - `envRequirements: ["LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET", "LINEAR_WEBHOOK_SECRET"]`
  - `display: { label: "Linear", description: "Linear issue and project management", icon: "linear" }`
- [ ] Create `auth.ts` — `createManagedOAuthAuthFacet("linear", linearManagedOAuthConfig)`:
  - Linear OAuth uses `https://linear.app/oauth/authorize` and `https://api.linear.app/oauth/token`
  - Env keys: `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`
  - Scopes: `read`, `write`, `issues:create`, `comments:create`
  - `resolveExternalAccountId` — extract from viewer profile (Linear returns a `viewer` query with `id` and `email`)
- [ ] Create `refresh.ts` — `createManagedOAuthRefreshFacet("linear", linearManagedOAuthConfig)`
- [ ] Create `webhooks.ts`:
  - `verifyWebhook` — Linear signs webhooks with HMAC-SHA256, signature in `Linear-Signature` header
  - `extractWebhookEvent` — extract `deliveryId` from webhook body, `eventType` from `type` field (e.g., `Issue`, `Comment`), and `action` from `action` field
- [ ] Create `connector-runtime.ts` — `createLinearConnector` extending `BaseConnector`:
  - Define `readLinearTools` and `writeLinearTools` arrays
  - Define `requiredScopesByTool` mapping
  - Implement read dispatch map (each read tool → SDK method call)
  - Implement prepare dispatch map (each write tool → `PreparedWrite` with idempotency key)
  - Implement write dispatch map (each write tool → SDK method execution)
- [ ] Create `connector.ts` — re-export `createLinearConnector` as default
- [ ] Create `tools.ts` — `createConnectorToolsFacet("linear", connector)`
- [ ] Create `schemas.ts` — `buildSchemasFacetFromTools(getProviderToolDefinitions("linear"))`
- [ ] Create `ui.ts` — `getProviderDetailUi("linear")`
- [ ] Create `index.ts` — assemble `linearProviderModule` via `createProviderModuleV2`
- [ ] Register in `packages/shared/src/providers/modules/index.ts`:
  - Import `linearProviderModule`
  - Add to `providerModulesV2` array
  - Add to named exports

**Verification:** `pnpm check` passes. `assertProviderModulesV2Invariants` passes for the new module. Provider registry resolves `linear` with all facets.

### Phase 5: UI Registration

Wire Linear into the dashboard UI contracts.

**Files changed:**

- `packages/shared/src/providers-ui.ts`

**Steps:**

- [ ] Add `linearUiConfig: ProviderDetailUiConfig` with:
  - `panelTitle: "Create issue"`
  - `panelDescription: "Create and approve a linear.createIssue action."`
  - `fixedToolName: "linear.createIssue"`
  - Fields: `teamId` (text, required), `title` (text, required), `description` (textarea, optional), `priority` (number 0-4, optional)
  - `buildActionRequest` serializer
- [ ] Add `linear` entry to `PROVIDER_DETAIL_UI` record
- [ ] Add `linear` entry to `PROVIDER_DISPLAY` record:
  - `label: "Linear"`, `description: "Track issues, projects, and cycles"`, `icon: "linear"`, `colorClass: "bg-indigo-50 dark:bg-indigo-950/30"`

**Verification:** `pnpm check` passes. `getProviderDetailUi("linear")` returns the correct config. `getProviderDisplayName("linear")` returns `"Linear"`.

### Phase 6: Snapshot and Conformance

Update the provider registry snapshot and conformance test infrastructure.

**Files changed:**

- `packages/shared/provider-registry.snapshot.json` (regenerated)
- `tests/provider-conformance/action-matrix.ts`
- `tests/e2e/providers/registry.ts`
- `tests/e2e/providers/fakes/linear.ts` (new)

**Steps:**

- [ ] Regenerate `provider-registry.snapshot.json` by running the snapshot update script (check `package.json` for the exact command, likely `pnpm run update-snapshot` or similar in `packages/shared`)
- [ ] Add Linear scenarios to `tests/provider-conformance/action-matrix.ts`:
  - Read scenario: `linear.listIssues` with valid input
  - Write scenario: `linear.createIssue` with valid input
  - Negative scenarios for missing required fields
- [ ] Create `tests/e2e/providers/fakes/linear.ts` — `LinearFake` implementing `ProviderFakeContract` with in-memory issue/project/comment state
- [ ] Register Linear in `tests/e2e/providers/registry.ts`:
  - Add `linear` entry to `fakeProviderFactories` with `gatewayProviderId: "linear"`, `fixturePack: "connect-create-issue"`, conformance read/write paths, and `LinearFake` factory

**Verification:** Snapshot matches current registry state. `pnpm test` for provider-conformance passes. E2E fake provider registry includes Linear.

### Phase 7: Convex Schema and Docs

Update the Convex schema canonical enums and all relevant specs/docs.

**Files changed:**

- `convex/schema.ts` (if provider enums are explicitly listed)
- `docs/specs/core-domain-model.md`
- `docs/specs/execution-workers-connectors.md`
- `docs/setup.md`
- `docs/rules/additional_convex_rules.md` (if provider enums are listed there)

**Steps:**

- [ ] Check `convex/schema.ts` for hardcoded provider enum lists and add `"linear"` if present
- [ ] Update `docs/specs/core-domain-model.md` — add `linear` to the Canonical enums Providers list
- [ ] Update `docs/specs/execution-workers-connectors.md` — add Linear connector runtime coverage summary following the pattern of other providers
- [ ] Update `docs/setup.md` — add `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_WEBHOOK_SECRET` to the environment variables section
- [ ] Add `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET`, `LINEAR_WEBHOOK_SECRET` to `.env.example`

**Verification:** `pnpm check` passes across the monorepo. Specs mention Linear. `.env.example` includes the new vars.

### Phase 8: Build and Final Verification

Rebuild shared package and verify everything compiles end-to-end.

**Steps:**

- [ ] Run `cd packages/shared && pnpm build` to rebuild the shared package
- [ ] Run `pnpm check` at repo root to verify full type-checking passes
- [ ] Run `pnpm test` in `packages/shared` for unit tests
- [ ] Run `pnpm test` in `tests/provider-conformance` for conformance tests
- [ ] Commit generated `convex/_generated/` files if they changed
- [ ] Verify the provider registry snapshot is up to date

## Files Changed

### New files:

- `packages/shared/src/tool-definitions/linear.ts`
- `packages/shared/src/provider-sdk/linear/types.ts`
- `packages/shared/src/provider-sdk/linear/client-interface.ts`
- `packages/shared/src/provider-sdk/linear/client.ts`
- `packages/shared/src/provider-sdk/linear/sdk-runtime.ts`
- `packages/shared/src/provider-sdk/linear/real.ts`
- `packages/shared/src/provider-sdk/linear/fake.ts`
- `packages/shared/src/provider-sdk/linear/fake-client-runtime.ts`
- `packages/shared/src/provider-sdk/linear/fake-client-adapter.ts`
- `packages/shared/src/provider-sdk/linear/fixtures.ts`
- `packages/shared/src/provider-sdk/linear/errors.ts`
- `packages/shared/src/providers/modules/linear/index.ts`
- `packages/shared/src/providers/modules/linear/metadata.ts`
- `packages/shared/src/providers/modules/linear/auth.ts`
- `packages/shared/src/providers/modules/linear/tools.ts`
- `packages/shared/src/providers/modules/linear/schemas.ts`
- `packages/shared/src/providers/modules/linear/ui.ts`
- `packages/shared/src/providers/modules/linear/refresh.ts`
- `packages/shared/src/providers/modules/linear/webhooks.ts`
- `packages/shared/src/providers/modules/linear/connector.ts`
- `packages/shared/src/providers/modules/linear/connector-runtime.ts`
- `tests/e2e/providers/fakes/linear.ts`

### Modified files:

- `packages/shared/package.json` (`@linear/sdk` dependency)
- `packages/shared/src/provider-ids.ts`
- `packages/shared/src/provider-default-scopes.ts`
- `packages/shared/src/provider-catalog.ts`
- `packages/shared/src/circuit-breaker.ts`
- `packages/shared/src/tool-definitions.ts`
- `packages/shared/src/providers-ui.ts`
- `packages/shared/src/providers/modules/index.ts`
- `packages/shared/provider-registry.snapshot.json`
- `tests/provider-conformance/action-matrix.ts`
- `tests/e2e/providers/registry.ts`
- `docs/specs/core-domain-model.md`
- `docs/specs/execution-workers-connectors.md`
- `docs/setup.md`
- `.env.example`
- `convex/schema.ts` (if applicable)

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `@linear/sdk` adds significant bundle size to shared package | Medium | Low | Tree-shake unused exports; the SDK is only imported in `provider-sdk/linear/client.ts` |
| Linear OAuth flow differs from standard OAuth2 (e.g., PKCE required) | Low | Medium | Linear uses standard OAuth2 authorization code flow; verify against Linear API docs before implementing |
| Linear API rate limits are stricter than expected | Low | Medium | Circuit breaker with default 5/30s threshold handles transient failures; can tune later |
| Linear webhook signature format changes | Low | Low | Webhook verification follows the same HMAC-SHA256 pattern as GitHub; well-documented by Linear |
| Adding a 9th canonical provider breaks hardcoded `Record<CanonicalProviderId, ...>` types | Medium | Medium | TypeScript will surface missing entries at compile time via `Record` exhaustiveness; fix all type errors in Phase 1 |

## Definition of Done

- [ ] `linear` is a fully canonical provider in `CANONICAL_PROVIDER_IDS`
- [ ] All Linear tools are defined with Zod schemas and registered in `allTools`
- [ ] Real SDK client wraps `@linear/sdk` and fake SDK client provides deterministic in-memory state
- [ ] Provider module passes `assertProviderModulesV2Invariants`
- [ ] OAuth2 auth, refresh, and webhook facets are wired
- [ ] UI config registered in `PROVIDER_DETAIL_UI` and `PROVIDER_DISPLAY`
- [ ] Provider registry snapshot is regenerated and committed
- [ ] Conformance test scenarios pass for Linear read and write paths
- [ ] E2E fake provider registry includes Linear
- [ ] All specs (`core-domain-model.md`, `execution-workers-connectors.md`) updated
- [ ] `docs/setup.md` and `.env.example` include Linear env vars
- [ ] `pnpm check` and `pnpm test` pass across the monorepo

## Iteration Log

| Iteration | Timestamp | Summary | Commit | Errors/Issues |
| --------- | --------- | ------- | ------ | ------------- |
