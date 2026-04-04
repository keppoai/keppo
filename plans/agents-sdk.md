# Plan: Automation Sandbox Agents SDK Runner

## Status: Draft

## Goal

Replace the sandboxed automation runner's direct `codex exec` path with a repo-owned runner built on `openai-agents-js`, while preserving Keppo's existing automation lifecycle outside the sandbox. The end state should improve stability by removing Codex CLI/bootstrap coupling, improve testability with deterministic runner-owned event mapping, and improve traceability by exporting OpenAI-compatible traces and persisting trace references on each automation run.

## Problem

Sandboxed automations currently depend on a shell-composed Codex CLI flow: the runtime bootstraps `.codex` state, invokes `codex exec --json`, parses Codex-specific JSONL output back into Keppo events, and uploads a private session artifact from `.codex/sessions`. That design is brittle in a few ways:

- runner behavior depends on CLI/home-directory side effects instead of a repo-owned TypeScript contract;
- structured run timelines depend on parsing Codex-specific output rather than consuming typed SDK events directly;
- traceability is limited to stored Codex session files instead of OpenAI trace metadata that can be queried outside the sandbox;
- provider implementations and tests are tightly coupled to a pinned CLI package rather than a library-based runner that can be unit tested.

## Non-Goals

- Changing GitHub workflow bots, PR review runners, or any non-automation Codex usage.
- Reworking Code Mode sandbox execution.
- Replacing the existing Keppo MCP server, workspace credential model, or `record_outcome` contract.
- Adding Anthropic sandbox execution through `openai-agents-js`; Anthropic automation models remain fail-closed until a separate supported path exists.
- Renaming dashboard-facing legacy `runner_type` labels as part of this migration.

## Implementation Plan

### Phase 1: Introduce a Repo-Owned Agents SDK Runner Contract

**Files changed:**

- `apps/web/package.json`
- `pnpm-lock.yaml`
- `apps/web/app/lib/server/api-runtime/sandbox/types.ts`
- `apps/web/app/lib/server/api-runtime/routes/automations.ts`
- `apps/web/app/lib/server/api-runtime/routes/automations.callback-base.test.ts`
- `apps/web/app/lib/server/api-runtime/sandbox/agents-sdk-runner.ts`
- `apps/web/app/lib/server/api-runtime/sandbox/agents-sdk-runner.test.ts`

**Steps:**

- [ ] Add a pinned `@openai/agents` dependency in `@keppo/web` and keep the existing `openai` dependency as the model client foundation for the sandbox runner.
- [ ] Introduce a repo-owned sandbox runner module that creates a single-turn automation agent, attaches the remote Keppo MCP server through the Agents SDK MCP client, and reuses the existing automation prompt/memory contract.
- [ ] Extend the sandbox contract so providers receive explicit runner metadata instead of inferring a Codex CLI package from `runtime.command`, matching the existing `docs/rules/env_runtime.md` requirement for explicit managed runner packages.
- [ ] Add an event-mapping layer that converts streamed Agents SDK events into Keppo's existing structured run event types (`system`, `thinking`, `tool_call`, `output`, `error`) before callback upload.
- [ ] Keep the runtime prompt builder stable so `record_outcome({ success, summary })`, `add_memory`, and `edit_memory` instructions remain unchanged during the runner swap.

**Verification:** Run targeted web Vitest coverage for the new runner module and callback command builders, ensuring the generated sandbox contract no longer references `codex exec`, `.codex`, or Codex-specific bootstrap steps.

### Phase 2: Swap Automation Dispatch from Codex CLI to Agents SDK

**Files changed:**

- `apps/web/app/lib/server/automation-runtime.ts`
- `apps/web/app/lib/server/automation-runtime.test.ts`
- `apps/web/app/lib/server/api-runtime/routes/automations.ts`
- `apps/web/app/lib/server/api-runtime/convex-client/automation-ai.ts`
- `apps/web/app/lib/server/api-runtime/convex-client/refs.ts`
- `apps/web/app/lib/server/api-runtime/convex.ts`
- `packages/shared/src/automations.ts`

**Steps:**

- [ ] Replace `buildRunnerCommand`, `buildRunnerBootstrapCommand`, and `buildRunnerAuthBootstrapCommand` Codex-specific behavior with an Agents SDK runtime shape that launches a repo-owned Node runner inside the sandbox.
- [ ] Preserve the existing model-class routing and key-mode resolution in `automation-runtime.ts`, but translate those results into Agents SDK/OpenAI client configuration instead of `.codex` login or config files.
- [ ] Keep OpenAI automations running on the Responses API over HTTP transport, especially for bundled gateway and fake-gateway paths that already require non-WebSocket operation.
- [ ] Preserve legacy stored `runner_type` values as compatibility metadata while routing sandboxed OpenAI automations through the Agents SDK path internally.
- [ ] Move structured-event generation to the runner so `/internal/automations/log` receives explicit `event_type` and `event_data`, allowing Codex JSON classification to be removed or reduced to a legacy fallback.

**Verification:** Run targeted `automation-runtime` and callback-base unit tests to confirm dispatch still provisions MCP credentials, model selection, network policy, and final completion semantics without any `.codex` bootstrap or Codex JSON parsing on the primary path.

### Phase 3: Replace Codex Session Artifacts with OpenAI Trace References

**Files changed:**

- `convex/schema.ts`
- `convex/automation_runs.ts`
- `convex/admin_delete.ts`
- `convex/e2e_shared.ts`
- `convex/e2e_automations.ts`
- `tests/convex/automation-lifecycle.test.ts`
- `apps/web/app/lib/server/automation-runtime.ts`
- `apps/web/app/lib/server/api-runtime/routes/automations.ts`
- `apps/web/app/lib/server/api-runtime/convex-client/automation-ai.ts`
- `apps/web/app/lib/server/api-runtime/convex-client/refs.ts`
- `apps/web/app/lib/server/api-runtime/convex.ts`

**Steps:**

- [ ] Add a trace callback contract that records run-scoped trace metadata such as `trace_id`, `group_id`, `workflow_name`, export status, and the last OpenAI response identifier instead of uploading a `.codex/sessions` file.
- [ ] Persist trace metadata on `automation_runs`, replace Codex-specific session-trace storage/log messages with runner-agnostic trace-reference fields, and update cleanup/delete paths accordingly.
- [ ] Use stable run-derived tracing identifiers so every automation run can be correlated deterministically between Keppo and the OpenAI trace system.
- [ ] Export traces through an explicit Agents SDK tracing pathway that keeps broad export credentials out of the sandbox when necessary, while still making the OpenAI trace the durable debugging surface.
- [ ] Fail closed when trace export cannot be completed: keep the run itself valid, but persist a typed export-status/result so operators can distinguish runner success from trace-export failure.

**Verification:** Run targeted Convex lifecycle tests and runtime callback tests to confirm trace metadata is written exactly once per run, survives terminal transitions, and replaces the current session-artifact-only contract without leaving orphaned storage or Codex-specific log text behind.

### Phase 4: Align Docker, Vercel, Unikraft, and the Test Harnesses

**Files changed:**

- `apps/web/app/lib/server/api-runtime/sandbox/Dockerfile`
- `apps/web/app/lib/server/api-runtime/sandbox/docker.ts`
- `apps/web/app/lib/server/api-runtime/sandbox/docker.test.ts`
- `cloud/api/sandbox/vercel.ts`
- `apps/web/app/lib/server/api-runtime/sandbox/vercel.test.ts`
- `apps/web/app/lib/server/api-runtime/sandbox/unikraft.ts`
- `apps/web/app/lib/server/api-runtime/sandbox/unikraft.test.ts`
- `tests/e2e/infra/fake-gateway.ts`
- `tests/e2e/specs/automations/automation-runtime.spec.ts`
- `docs/specs/execution-workers-connectors.md`
- `docs/specs/security-model.md`
- `docs/self-hosting-setup.md`

**Steps:**

- [ ] Update the local Docker sandbox image and provider contract so local runs use the same pinned Agents SDK runner implementation as remote sandboxes rather than a globally installed Codex CLI.
- [ ] Update the Vercel sandbox bootstrap/install path to materialize the repo-owned runner and its pinned npm dependencies, while preserving the existing minimal bootstrap environment and runtime-secret separation.
- [ ] Update the Unikraft provider and image contract so it launches the same runner entrypoint and trace callback flow as Docker/Vercel.
- [ ] Extend the fake OpenAI gateway and targeted automation runtime tests to exercise streamed Responses API tool calls, explicit structured log events, and trace-reference persistence under the new runner.
- [ ] Update the execution and security specs plus self-hosting documentation so they describe the Agents SDK runner, the new trace contract, and any changed sandbox runtime prerequisites without spec drift.

**Verification:** Run the sandbox provider unit tests plus targeted automation runtime and local-convex coverage; if browser-level verification is needed, run only the targeted automation runtime E2E spec outside the Codex sandbox per repo policy.

## Files Changed

- `plans/agents-sdk.md`
- `apps/web/package.json`
- `pnpm-lock.yaml`
- `apps/web/app/lib/server/api-runtime/sandbox/types.ts`
- `apps/web/app/lib/server/api-runtime/sandbox/agents-sdk-runner.ts`
- `apps/web/app/lib/server/api-runtime/sandbox/agents-sdk-runner.test.ts`
- `apps/web/app/lib/server/api-runtime/routes/automations.ts`
- `apps/web/app/lib/server/api-runtime/routes/automations.callback-base.test.ts`
- `apps/web/app/lib/server/automation-runtime.ts`
- `apps/web/app/lib/server/automation-runtime.test.ts`
- `apps/web/app/lib/server/api-runtime/convex-client/automation-ai.ts`
- `apps/web/app/lib/server/api-runtime/convex-client/refs.ts`
- `apps/web/app/lib/server/api-runtime/convex.ts`
- `packages/shared/src/automations.ts`
- `convex/schema.ts`
- `convex/automation_runs.ts`
- `convex/admin_delete.ts`
- `convex/e2e_shared.ts`
- `convex/e2e_automations.ts`
- `tests/convex/automation-lifecycle.test.ts`
- `apps/web/app/lib/server/api-runtime/sandbox/Dockerfile`
- `apps/web/app/lib/server/api-runtime/sandbox/docker.ts`
- `apps/web/app/lib/server/api-runtime/sandbox/docker.test.ts`
- `cloud/api/sandbox/vercel.ts`
- `apps/web/app/lib/server/api-runtime/sandbox/vercel.test.ts`
- `apps/web/app/lib/server/api-runtime/sandbox/unikraft.ts`
- `apps/web/app/lib/server/api-runtime/sandbox/unikraft.test.ts`
- `tests/e2e/infra/fake-gateway.ts`
- `tests/e2e/specs/automations/automation-runtime.spec.ts`
- `docs/specs/execution-workers-connectors.md`
- `docs/specs/security-model.md`
- `docs/self-hosting-setup.md`

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| ------------- | --------------- | --------------- | --------------- |
| Bundled gateway runs may not be able to export traces directly to the OpenAI tracing backend with the same credential used for model traffic. | Medium | High | Decouple model execution credentials from trace export, add an explicit trace-export pathway, and persist typed export status so the run path stays observable even when export fails. |
| Docker, Vercel, and Unikraft could drift if each provider materializes the runner differently. | Medium | High | Centralize the runner source and explicit runner-package contract so every provider launches the same repo-owned entrypoint. |
| Structured timeline quality could regress if Agents SDK stream events are mapped incompletely. | Medium | High | Add a dedicated event-mapper test suite and keep the existing Keppo event taxonomy as the compatibility target for the first migration. |
| Legacy Codex-specific storage and cleanup paths could leave stale fields or orphaned storage behind. | Medium | Medium | Replace session-artifact persistence in one coordinated change across schema, lifecycle storage, and admin deletion paths. |
| MCP tool-call behavior inside the Agents SDK runner may differ subtly from the current Codex CLI behavior and break `record_outcome` or memory-tool expectations. | Medium | High | Preserve the current prompt contract, add targeted fake-gateway/runtime tests around MCP tool calls, and keep Anthropic and non-automation scopes out of this change. |

## Definition of Done

- [ ] Sandboxed automation runs no longer invoke `codex exec` or depend on `.codex` bootstrap/session scanning.
- [ ] The sandbox runner is a repo-owned `openai-agents-js` implementation that connects to the existing Keppo MCP server and preserves the current automation prompt contract.
- [ ] Structured automation logs come from typed runner event mapping rather than Codex JSON parsing on the main path.
- [ ] Each automation run records OpenAI trace references and trace export status in Keppo for durable correlation.
- [ ] Docker, Vercel, and Unikraft automation sandboxes use the same runner contract and targeted regression tests pass.
- [ ] Specs and self-hosting docs are updated so runtime behavior and documentation stay aligned.

## Iteration Log

| Iteration | Timestamp | Summary | Commit | Errors/Issues |
| --------- | --------- | ------- | ------ | ------------- |
