# Plan: Disable Automatic Cron Work in Preview

## Status: Done

## Goal

Stop the two high-cost background Convex cron jobs from being registered at all in hosted preview environments while preserving the underlying maintenance actions and operator-triggered/manual maintenance flows. After this change, preview deployments should not schedule routine provider-trigger reconciliation or maintenance sweeps unless an operator explicitly invokes the manual path.

## Problem

Preview deployments currently register and run the same background cron jobs that production uses for maintenance and provider-trigger reconciliation. Those jobs consume compute continuously in short-lived or low-traffic preview environments, but they provide limited value there because preview is primarily used for UI review, targeted debugging, and ad hoc validation. Wrapper-level no-ops would still leave Convex scheduling and invoking the jobs, so they would reduce expensive downstream work but would not fully eliminate the preview cron wakeups that are currently burning compute.

## Non-Goals

- Disabling cron jobs globally or for `staging` / `production`.
- Disabling manual/operator maintenance paths such as `POST /internal/cron/maintenance`.
- Changing the behavior of the underlying worker functions `mcp_node.runMaintenanceTick` or `automation_scheduler_node.reconcileProviderTriggerSubscriptions` when called directly.
- Adding a new opt-in or opt-out environment flag beyond the existing `KEPPO_ENVIRONMENT=preview` contract.

## Implementation Plan

### Phase 1: Make preview cron registration selective

**Files changed:**

- `convex/environment.ts`
- `convex/crons.ts`

**Steps:**

- [x] Add a small shared helper in `convex/environment.ts` that normalizes `process.env.KEPPO_ENVIRONMENT` and returns `true` only for hosted preview environments.
- [x] Use that helper to skip registering only `maintenance-sweep` and `automation-provider-trigger-reconcile` when the Convex deployment is running as preview.
- [x] Leave all other cron registrations unchanged unless discovery during implementation shows one of them transitively depends on the removed jobs in a way that must also be documented.
- [x] Keep the preview gate scoped to cron registration only; do not change `scheduledMaintenanceSweepManual`, direct `runMaintenanceTick`, direct `automation_scheduler_node:reconcileProviderTriggerSubscriptions`, or the heartbeat wrapper implementations beyond any cleanup needed after moving the gate upward.
- [x] Add a short code comment near the registration guard explaining that preview intentionally avoids registering these two jobs to reduce hosted preview compute while leaving manual maintenance paths intact.

**Verification:** Validate that preview-mode module loading omits only the two targeted cron registrations and that non-preview environments still register them with the existing cadence and handler references.

### Phase 2: Add regression coverage for registration and manual fallback behavior

**Files changed:**

- `tests/convex/crons.test.ts`
- `tests/convex/maintenance.test.ts`
- `tests/local-convex/automations.test.ts`
- `tests/scripts/hosted-convex-sync-keys.test.ts`

**Steps:**

- [x] Add a focused test around `convex/crons.ts` that stubs `KEPPO_ENVIRONMENT=preview` and asserts `maintenance-sweep` and `automation-provider-trigger-reconcile` are absent from the registered cron set while the other jobs remain registered.
- [x] Add the non-preview counterpart assertion so `staging` or `production` still register both jobs exactly as before.
- [x] Add or update a maintenance test that confirms the manual path remains active in preview by exercising `scheduledMaintenanceSweepManual` or the equivalent maintenance action path, since the scheduled job will no longer exist there.
- [x] Add or update cron-health coverage so preview omits the disabled jobs from health expectations and non-preview deployments mark missing expected heartbeat rows stale once the deployment has clearly been live long enough.
- [x] Add a provider-trigger-focused regression in `tests/local-convex/automations.test.ts` or the closest existing automation-trigger suite that verifies direct `automation_scheduler_node:reconcileProviderTriggerSubscriptions` behavior remains unchanged for intentional/manual execution in preview-like envs.
- [x] Add or update a hosted Convex env-manifest test that proves `KEPPO_ENVIRONMENT` is synced into hosted Convex runtimes before `convex/crons.ts` evaluates the preview gate.
- [x] Keep the assertions explicit about the intended split: preview removes cron registration, but direct/manual actions still execute real work.

**Verification:** Run only the targeted cron-registration, maintenance, and local-Convex provider-trigger test files, and confirm they pass under both preview-stubbed and non-preview env conditions.

### Phase 3: Update specs and operator docs to match preview behavior

**Files changed:**

- `convex/cron_heartbeats.ts`
- `docs/specs/control-plane-api.md`
- `docs/specs/execution-workers-connectors.md`
- `docs/rules/env_runtime.md`
- `docs/self-hosting-setup.md`
- `scripts/convex-managed-env.mjs`

**Steps:**

- [x] Update the control-plane spec to state that the production maintenance sweep is still cron-driven every 2 minutes, but hosted preview does not register that cron and relies on manual invocation for explicit maintenance runs.
- [x] Update the execution-workers/connectors spec to document that hosted preview does not register the automatic provider-trigger reconciliation cron, so provider-trigger ingestion is not expected to progress automatically there.
- [x] Update environment/runtime rules to record the new preview behavior near the existing hosted preview runtime guidance so future env changes do not accidentally re-enable these background jobs.
- [x] Update self-hosting docs to clarify that preview deployments intentionally do not register these automatic background cron workloads for compute control and that manual maintenance remains available for operator validation.

**Verification:** Review the updated docs/specs for consistency with the final code path and ensure the preview-specific behavior is described in exactly one canonical way across operator docs and specs.

## Files Changed

- `plans/disable-preview-crons.md`
- `convex/environment.ts`
- `convex/crons.ts`
- `convex/cron_heartbeats.ts`
- `scripts/convex-managed-env.mjs`
- `tests/convex/crons.test.ts` or equivalent new focused test file
- `tests/convex/maintenance.test.ts`
- `tests/local-convex/automations.test.ts`
- `tests/scripts/hosted-convex-sync-keys.test.ts`
- `docs/specs/control-plane-api.md`
- `docs/specs/execution-workers-connectors.md`
- `docs/rules/env_runtime.md`
- `docs/self-hosting-setup.md`

## Risks and Mitigations

| Risk                                                                                                                                       | Likelihood | Impact | Mitigation                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview registration guard accidentally disables manual/operator maintenance too.                                                          | Medium     | High   | Keep the guard only in `convex/crons.ts` and add explicit regression coverage for manual/direct calls in preview.                                                                                                                                                 |
| Preview health surfaces may show these jobs as stale because they are no longer registered and therefore no longer produce heartbeat rows. | Medium     | Medium | Scope `checkCronHealth` expectations by environment, omit preview-disabled jobs there, and mark missing non-preview heartbeat rows stale once the deployment has clearly produced other cron activity. |
| Future refactors move the preview guard down into worker functions and unintentionally affect staging/production or manual flows.          | Low        | High   | Centralize the helper in `convex/environment.ts`, document its scope with a code comment, and call out the boundary clearly in specs/docs.                                                                                                                         |
| Provider-trigger preview behavior becomes surprising for engineers who expect preview to ingest real provider events automatically.        | High       | Medium | Document the behavior explicitly in specs and self-hosting/runtime docs, and keep direct/manual reconcile entrypoints intact for intentional testing.                                                                                                             |

## Definition of Done

- [x] Hosted preview deployments do not register `maintenance-sweep`.
- [x] Hosted preview deployments do not register `automation-provider-trigger-reconcile`.
- [x] Manual/operator-triggered maintenance and direct underlying worker actions remain functional in preview.
- [x] Targeted cron-registration, maintenance, and provider-trigger regression tests cover the preview-only registration boundary.
- [x] Specs and operator docs explain that preview does not register these automatic background jobs for compute control.

## Iteration Log

| Iteration | Timestamp           | Summary                                                                                                                                                                                                                                                         | Commit      | Errors/Issues |
| --------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------- |
| 1         | 2026-04-06 09:31 PT | Added preview-only cron registration guards for maintenance and provider-trigger reconcile, covered preview-vs-non-preview registration plus manual/direct fallback behavior in targeted Convex and local-Convex tests, and updated runtime/spec/operator docs. | Uncommitted | None.         |
