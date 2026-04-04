# Plan: Group Approvals By Automation Run

## Status: Done

## Goal

Group the approvals queue by `automation_run_id` so actions created by the same automation run render together, operators can approve or reject all pending actions in that run from one visual section, and individual actions inside the run remain reviewable and independently approvable or rejectable. Done means the grouped queue still works with live Convex updates, status filters, search, keyboard review shortcuts, and the existing split detail panel.

## Problem

The current approvals page is flat by action. When one automation run emits multiple pending actions, the queue hides that shared context and forces operators to either resolve actions one by one or manually assemble a batch selection across separate rows. That makes review slower, obscures which actions belong to one run, and increases the odds of partially resolving a run without realizing it.

## Non-Goals

- Redesign the automation run detail page or broader automation execution UX.
- Replace the existing cross-run row-selection batch flow; grouped run actions should layer on top of it unless implementation proves that a specific overlap is actively harmful.
- Introduce a new all-or-nothing backend transaction that approves or rejects an entire run atomically.
- Change the core per-action approval model, audit records, or execution dispatch semantics.
- Run the full local E2E suite.

## Implementation Plan

### Phase 1: Expose Run Context In The Approval Queue Contract

**Files changed:**

- `convex/actions.ts`
- `packages/shared/src/providers/boundaries/convex-schemas.ts`
- `packages/shared/src/providers/boundaries/types.ts`
- `tests/convex/usability-query-bounds.test.ts`

**Steps:**

- [x] Extend the action list/detail view returned by `actions:listByWorkspace`, `actions:listPendingByWorkspace`, and `actions:getActionDetail` to include the required `automation_run_id` for every action.
- [x] Add minimal optional run-display context to the list payload when it is cheaply available from the owning run or automation (for example run start time and automation name/slug), but keep the contract able to fall back to a short run id for non-automation-backed actions.
- [x] Update the shared Convex boundary schemas/types so malformed run-grouping data fails closed in the dashboard instead of rendering unchecked group headers.
- [x] Keep the query implementation bounded by enriching from unique run ids rather than ad hoc per-row lookups, and extend the existing usability query regression to cover the grouped-queue payload shape.

**Verification:** Rebuild `@keppo/shared` with `cd packages/shared && pnpm build`, then run the targeted Convex/boundary coverage that exercises `tests/convex/usability-query-bounds.test.ts` and any affected shared parser tests.

### Phase 2: Build A Grouped Approvals View Model And Render Run Sections

**Files changed:**

- `apps/web/src/lib/approvals-view-model.ts`
- `apps/web/src/lib/approvals-view-model.test.ts`
- `apps/web/src/routes/approvals.lazy.tsx`
- `apps/web/src/components/approvals/approvals-table.tsx`

**Steps:**

- [x] Introduce a dedicated approvals view-model helper that filters, searches, sorts, and groups actions by `automation_run_id`, while also exposing a flattened ordered id list for keyboard navigation and “next pending” behavior.
- [x] Sort groups by the same operator priorities the flat queue uses today: highest pending risk first, then newest relevant action, and sort actions inside each group deterministically.
- [x] Refactor `ApprovalsPage` to derive summary cards, visible ids, selected ids, and grouped sections from the same view model so the route keeps one source of truth.
- [x] Update `ApprovalsTable` to render visually distinct run headers with group counts and inline `Approve group` / `Reject group` affordances when a run contains multiple pending actions in the current filtered view.
- [x] Preserve per-action row controls and the existing checkbox-based bulk selection flow inside grouped sections so operators can still approve a single action or build a custom cross-run batch.

**Verification:** Run targeted `apps/web` jsdom coverage for the new view model and approvals route/table rendering, and manually verify grouped behavior in `Pending`, `All`, and search-filtered views.

### Phase 3: Unify Group-Level Decision Handling Without Breaking Single-Action Review

**Files changed:**

- `apps/web/src/routes/approvals.lazy.tsx`
- `apps/web/src/components/approvals/approval-detail-panel.tsx`
- `apps/web/src/routes/approvals.lazy.test.tsx`
- `apps/web/src/hooks/use-actions.test.ts`

**Steps:**

- [x] Replace the current ad hoc batch-approve loop with one shared route-level helper so row actions, selected-row batch actions, and new group actions all use the same pending/error/feedback path.
- [x] Make group approve/reject operate only on pending actions in the chosen run section and report partial failures clearly instead of silently leaving the queue in a mixed state.
- [x] Preserve the currently inspected action in the detail panel when possible after a group decision, and continue offering a clean path to the next pending action if any remain.
- [x] Add lightweight run-context copy to the detail surface when helpful (for example, indicating how many sibling actions belong to the same run) without turning the panel into a combined multi-action inspector.
- [x] Update route and hook tests to cover both “approve the group” and “approve only one action inside the group” flows.

**Verification:** Run the relevant targeted `apps/web` Vitest suites for approvals route rendering and action-hook mutation behavior.

### Phase 4: Add Deterministic Coverage, Visual Validation, And Spec Updates

**Files changed:**

- `convex/e2e_actions.ts`
- `tests/e2e/pages/ActionQueue.page.ts`
- `tests/e2e/specs/actions/grouped-approvals.spec.ts`
- `docs/specs/dashboard-ux.md`
- `ux-artifacts/grouped-approvals.png`
- `plans/group-approvals.md`

**Steps:**

- [x] Extend the E2E-only backend helpers so a targeted browser spec can seed multiple pending actions under the same `automation_run_id` without relying on flaky timing or unrelated setup flows.
- [x] Add one focused Playwright spec that verifies grouped rendering, `Approve group`, `Reject group`, and single-action approval inside the same run.
- [x] Capture a screenshot artifact in `ux-artifacts/` for the grouped approvals state, then run the `$design-critique` workflow against that screenshot and fix every issue it surfaces before calling the work complete.
- [x] Update the dashboard UX spec to describe the approvals queue as grouped by automation run, with per-run bulk decisions and preserved single-action review.
- [x] Record implementation progress and commit hashes in this plan’s iteration log as execution proceeds.

**Verification:** Run only the targeted approvals Playwright spec plus the relevant web/Convex tests from earlier phases; do not run the full E2E suite locally.

## Files Changed

- `plans/group-approvals.md`
- `convex/actions.ts`
- `packages/shared/src/providers/boundaries/convex-schemas.ts`
- `packages/shared/src/providers/boundaries/types.ts`
- `tests/convex/usability-query-bounds.test.ts`
- `apps/web/src/lib/approvals-view-model.ts`
- `apps/web/src/lib/approvals-view-model.test.ts`
- `apps/web/src/routes/approvals.lazy.tsx`
- `apps/web/src/components/approvals/approvals-table.tsx`
- `apps/web/src/components/approvals/approval-detail-panel.tsx`
- `apps/web/src/routes/approvals.lazy.test.tsx`
- `apps/web/src/hooks/use-actions.test.ts`
- `convex/e2e_actions.ts`
- `tests/e2e/pages/ActionQueue.page.ts`
- `tests/e2e/specs/actions/grouped-approvals.spec.ts`
- `docs/specs/dashboard-ux.md`
- `ux-artifacts/grouped-approvals.png`

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Group headers end up too sparse or too opaque when the queue only knows the run id | Medium | Medium | Always expose `automation_run_id`, add optional display context when cheap, and fall back to a compact short-id header instead of blocking grouping on richer metadata. |
| Group-level actions leave confusing partial state when one action fails and others succeed | Medium | High | Route all batch/group decisions through one helper that reports partial failures explicitly, clears only the ids that actually resolved, and keeps current review context stable. |
| Grouping breaks current keyboard navigation, selection preservation, or “next pending” behavior | Medium | High | Keep a flattened ordered id list in the view model and cover grouped navigation/selection behavior with focused route tests. |
| Query enrichment for run context regresses performance or bounded-list assumptions | Medium | Medium | Enrich from unique run ids only, keep extra context optional, and extend the existing usability-query regression coverage rather than trusting manual spot checks. |
| The grouped layout looks acceptable in jsdom tests but becomes cramped or confusing on smaller screens | Medium | Medium | Capture a real screenshot artifact, run `$design-critique`, and iterate on the mobile/desktop group header layout before finishing. |

## Definition of Done

- [x] The approvals queue renders actions grouped by `automation_run_id` in the current filtered view.
- [x] Runs with multiple pending actions expose `Approve group` and `Reject group` controls.
- [x] Operators can still approve or reject a single action within a grouped run from the row and detail surfaces.
- [x] Search, status filters, keyboard review, real-time updates, and existing selected-row batch actions still work with grouped sections.
- [x] Targeted Convex, web, and Playwright coverage plus the required screenshot/design-critique pass ship in the same change.
- [x] `docs/specs/dashboard-ux.md` is updated to match the shipped grouped approvals behavior.

## PR Handoff

- If the final implementation materially changes the operator review flow, record or refresh a short demo with `$create-video-demo` unless `KEPPO_SKIP_DEMO_VIDEO=true`, then attach the hosted demo comment after the PR is pushed.

## Iteration Log

| Iteration | Timestamp | Summary | Commit | Errors/Issues |
| --------- | --------- | ------- | ------ | ------------- |
| 1 | 2026-04-03 16:37 PT | Implemented grouped approvals end to end: Convex run context enrichment, grouped web queue/detail UI, shared decision handling, targeted web + Convex coverage, Playwright grouped-approvals spec, screenshot critique, and UX copy polish for run labels/search scope. | `45da209` | Fixed a route-test hang by moving interaction assertions to stable table coverage; fixed the Playwright helper to wait on run-section disappearance instead of unrelated detail-panel state. |
