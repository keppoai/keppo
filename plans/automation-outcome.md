# Plan: Automation Outcome Recording

## Status: Implemented

## Goal

Add a required `record_outcome({ success, summary })` automation-only tool call so every automation run finishes with a short, operator-visible outcome summary. The runtime must enforce the contract, synthesize a fallback `success: false` outcome when the agent does not provide one, and surface the outcome clearly in the runs list, run detail view, and grouped timeline.

## Problem

Automation runs currently end with only terminal status plus optional `error_message`. Operators can inspect logs, but they cannot quickly tell whether the agent believes it completed the requested job, whether it is waiting for approval, or what was actually accomplished. There is also no runtime contract that forces the agent to provide a final, human-readable run summary.

## Non-Goals

- Redesign the broader automation run UX outside the outcome-specific surfaces.
- Add markdown or rich-text rendering for outcome summaries.
- Change the generic MCP protocol for non-automation sessions.
- Introduce new environment variables, deployment steps, or external services.

## Implementation Plan

### Phase 1: Persist and enforce automation outcomes

**Files changed:**

- `convex/schema.ts`
- `convex/automation_runs.ts`
- `convex/validators.ts`
- `packages/shared/src/automations.ts`
- `apps/web/app/lib/server/api-runtime/convex-client/automation-ai.ts`

**Steps:**

- [x] Add first-class automation-run outcome fields to `automation_runs` storage and read models, including persisted success state, plain-text summary, recording source, and timestamp.
- [x] Extend automation run view validators and parsers so queries and internal dispatch context can read outcome data without log inference.
- [x] Add an internal mutation dedicated to recording an outcome exactly once for an automation run, with validation for plain-text `summary` and runtime protection against duplicate writes.
- [x] Update terminal-status handling so completion can synthesize a fallback `success: false` outcome when no valid outcome was recorded before the run ends.

**Verification:** Run focused Convex tests covering normal outcome recording, duplicate/invalid attempts, and fallback synthesis on completion.

### Phase 2: Expose `record_outcome` to automation runs and update prompt/runtime behavior

**Files changed:**

- `packages/shared/src/tool-definitions/keppo.ts`
- `packages/shared/src/tool-definitions.ts`
- `convex/mcp_node/internal_tools.ts`
- `convex/mcp_node/catalog.ts`
- `apps/web/app/lib/server/api-runtime/routes/mcp.ts`
- `apps/web/app/lib/server/api-runtime/routes/automations.ts`
- `apps/web/app/lib/server/automation-runtime.ts`
- `apps/web/app/lib/server/automation-runtime.test.ts`

**Steps:**

- [x] Define a new internal tool contract for `keppo.record_outcome` / `record_outcome` with `{ success: boolean, summary: string }` input validation.
- [x] Restrict the tool to automation sessions so the shared MCP surface does not expose it to normal operator MCP clients.
- [x] Implement the tool handler so the first valid call persists the outcome, appends a timeline-visible run log entry, and rejects duplicate calls.
- [x] Wrap automation execution prompts with runtime-owned instructions that explicitly require calling `record_outcome(...)` exactly once at the end and clarify that “waiting for approvals” still counts as `success: true`.
- [x] Update completion handling so terminal run status and outcome enforcement work together for success, failure, cancellation, timeout, and missing-outcome cases.

**Verification:** Run focused API-runtime/server Vitest coverage for MCP tool exposure/call behavior, prompt composition, and complete-route fallback behavior.

### Phase 3: Show outcomes at a glance in dashboard run surfaces

**Files changed:**

- `apps/web/src/lib/automations-view-model.ts`
- `apps/web/src/components/automations/run-list.tsx`
- `apps/web/src/routes/automations.$automationId.runs.$runId.lazy.tsx`
- `apps/web/src/components/automations/run-chat-viewer.tsx`
- `apps/web/src/components/automations/run-chat-bubble.tsx`

**Steps:**

- [x] Extend dashboard run parsing helpers and summary helpers to prefer the recorded automation outcome over generic status-only copy.
- [x] Update the runs list rows and search surface so operators can scan and filter by the recorded outcome summary.
- [x] Update the run detail header/summary card to display the recorded success/failure outcome and synthesized fallback text when applicable.
- [x] Render the recorded outcome in the grouped timeline so the transcript ends with a visible final result rather than forcing operators to infer it from raw logs.

**Verification:** Run targeted dashboard/component tests for parsing and rendering, and manually verify the run list/detail surfaces locally.

### Phase 4: Lock behavior with tests and spec updates

**Files changed:**

- `tests/convex/automation-lifecycle.test.ts`
- `apps/web/app/lib/server/automation-runtime.test.ts`
- `apps/web/src/lib/automations-view-model.test.ts`
- `docs/specs/core-domain-model.md`
- `docs/specs/execution-workers-connectors.md`
- `docs/specs/dashboard-ux.md`

**Steps:**

- [x] Add regression coverage for stored outcome fields, exactly-once semantics, fallback outcome generation, and operator-visible summaries.
- [x] Update the core-domain, execution/runtime, and dashboard UX specs so the new automation outcome contract and UI behavior stay documented with the implementation.
- [x] Review whether the bug reveals a reusable rule; if so, add or update a focused rule under `docs/rules/` and keep `AGENTS.md` in sync.

**Verification:** Run the smallest relevant unit/Vitest suites plus `pnpm check` or the closest targeted validation path that covers changed types/contracts.

## Files Changed

- `plans/automation-outcome.md`
- `convex/schema.ts`
- `convex/automation_runs.ts`
- `convex/validators.ts`
- `packages/shared/src/automations.ts`
- `packages/shared/src/tool-definitions/keppo.ts`
- `packages/shared/src/tool-definitions.ts`
- `convex/mcp_node/internal_tools.ts`
- `convex/mcp_node/catalog.ts`
- `apps/web/app/lib/server/api-runtime/routes/mcp.ts`
- `apps/web/app/lib/server/api-runtime/routes/automations.ts`
- `apps/web/app/lib/server/automation-runtime.ts`
- `apps/web/app/lib/server/api-runtime/convex-client/automation-ai.ts`
- `apps/web/app/lib/server/automation-runtime.test.ts`
- `apps/web/src/lib/automations-view-model.ts`
- `apps/web/src/components/automations/run-list.tsx`
- `apps/web/src/routes/automations.$automationId.runs.$runId.lazy.tsx`
- `apps/web/src/components/automations/run-chat-viewer.tsx`
- `apps/web/src/components/automations/run-chat-bubble.tsx`
- `apps/web/src/lib/automations-view-model.test.ts`
- `tests/convex/automation-lifecycle.test.ts`
- `docs/specs/core-domain-model.md`
- `docs/specs/execution-workers-connectors.md`
- `docs/specs/dashboard-ux.md`

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Shared MCP changes accidentally expose `record_outcome` to non-automation clients | Medium | High | Gate tool catalog and tool calls on automation-session context only, and add route-level tests. |
| Duplicate or late outcome calls race with terminal completion | Medium | Medium | Make the outcome write mutation idempotent/guarded, and have completion synthesize fallback only when no outcome exists. |
| UI copy becomes inconsistent between run status and outcome success | Medium | Medium | Keep status as lifecycle state, but route all user-facing “what happened” summaries through one shared outcome-aware helper. |
| Timeline rendering regresses legacy runs without outcome data | Low | Medium | Keep legacy fallback behavior intact and append outcome as an additive structured/system event. |

## Definition of Done

- [x] Automation runs persist a single final outcome with `success` and plain-text `summary`.
- [x] The runtime enforces the `record_outcome(...)` contract and synthesizes `success: false` fallback outcomes when the agent does not comply.
- [x] The automation prompt/runtime instructions explicitly require exactly one final outcome call and define approval-waiting as success.
- [x] Operators can see the run outcome at a glance in the runs list, run detail summary, and grouped timeline.
- [x] Relevant tests and specs are updated in the same change.

## Iteration Log

| Iteration | Timestamp | Summary | Commit | Errors/Issues |
| --------- | --------- | ------- | ------ | ------------- |
| 1 | 2026-03-30 | Implemented persisted automation outcomes, automation-only `record_outcome`, fallback synthesis on terminal runs, dashboard outcome badges/cards/timeline rendering, and matching tests/spec updates. | Uncommitted | `convex codegen` remains blocked locally because `CONVEX_DEPLOYMENT` is not configured in this workspace. |
