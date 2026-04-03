# Plan: Automation Memory

## Status: Draft

## Goal

Add one mutable memory blob per automation that is reused across future runs, editable from both automation-only MCP tools and the automation detail/edit page. When an automation run starts, Keppo should inject the current memory into the system prompt inside `<memory>` and `</memory>` tags, while enforcing a shared 20,000-character limit across runtime and UI edit paths.

## Problem

Automations currently have no durable, automation-scoped memory. Agents cannot accumulate reusable operational context across runs, the runtime cannot expose prior learned context in the system prompt, and operators cannot inspect or correct that memory from the dashboard. Without a bounded shared implementation, adding memory would also risk prompt bloat, inconsistent validation, and drift between UI edits and MCP-tool edits.

## Non-Goals

- Per-run memory or transcript summarization.
- Versioning memory alongside `automation_config_versions`.
- Exposing memory in automation create/build flows.
- Token-aware or model-specific memory budgeting beyond the agreed character cap.
- Rich memory editing semantics beyond append and literal replace.

## Implementation Plan

### Phase 1: Persist automation-scoped memory and expose it in contracts

**Files changed:**

- `convex/schema.ts`
- `convex/automations.ts`
- `convex/automations_shared.ts`
- `convex/automation_runs.ts`
- `apps/web/src/lib/automations-view-model.ts`
- `packages/shared/src/automations.ts`

**Steps:**

- [ ] Add an optional bounded `memory` field to `automations` storage and public automation view contracts, using a shared `20_000` character constant exported from shared automation helpers.
- [ ] Extend automation create/read/update paths so memory defaults to empty, is returned in `getAutomation` and list/detail public views, and can be updated without creating a new config version.
- [ ] Extend automation run dispatch context payloads so runtime dispatch can read the current automation memory alongside automation identity and config.
- [ ] Add shared normalization/validation helpers so all memory mutations trim consistently, preserve intentional interior formatting, and reject values above the cap.

**Verification:** Run targeted Convex contract tests for automation public views and local fixture coverage to confirm the new `memory` field appears only where intended and remains bounded.

### Phase 2: Inject memory into runtime prompts and add automation-only MCP memory tools

**Files changed:**

- `packages/shared/src/tool-definitions/keppo.ts`
- `convex/mcp_node/internal_tools.ts`
- `convex/mcp_node.ts`
- `apps/web/app/lib/server/api-runtime/routes/mcp.ts`
- `apps/web/app/lib/server/api-runtime/routes/mcp.request-dispatch.test.ts`
- `apps/web/app/lib/server/api-runtime/routes/automations.ts`
- `apps/web/app/lib/server/automation-runtime.ts`
- `apps/web/app/lib/server/automation-runtime.test.ts`

**Steps:**

- [ ] Add `add_memory` and `edit_memory` to Keppo internal tool definitions with schemas that match the agreed runtime semantics, including `replace_all`.
- [ ] Implement internal-tool handlers that operate only inside automation-authenticated sessions, append memory with blank-line separation, and enforce exact-once replacement behavior when `replace_all !== true`.
- [ ] Reuse the existing automation-only tool injection path in the MCP route so `record_outcome`, `add_memory`, and `edit_memory` are hidden from non-automation sessions and callable only when `automation_run_id` is present.
- [ ] Extend the automation runner prompt builder so non-empty memory is injected at dispatch time inside `<memory>` and `</memory>` before the automation task instructions.
- [ ] Return clear overflow and ambiguous-edit errors that instruct the agent to shrink or disambiguate memory before retrying.

**Verification:** Run targeted MCP route tests for tool listing and call authorization, plus runtime prompt unit tests that assert correct memory block injection and omission when memory is empty.

### Phase 3: Add memory editing to the automation detail/edit page

**Files changed:**

- `apps/web/src/components/automations/automation-config-editor.tsx`
- `apps/web/src/components/automations/automation-form-schema.ts`
- `apps/web/src/routes/automations.$automationId.lazy.tsx`
- `apps/web/src/lib/automations-view-model.ts`
- `apps/web/src/components/ui/textarea.tsx`
- `apps/web/src/components/ui/help-text.tsx`

**Steps:**

- [ ] Extend the automation detail/edit form model to carry automation memory separately from config-version fields so edits save through the existing automation meta mutation path instead of creating a new config version.
- [ ] Add a dedicated memory section to `AutomationConfigEditor` with textarea, live character count, explicit 20,000-character cap messaging, and pending/error states that match the existing dashboard form UX.
- [ ] Ensure loading/reset behavior on the automation detail route hydrates current memory correctly and does not leak memory controls into create/build flows.
- [ ] Keep the UI contract aligned with backend normalization so operators see consistent saved values after refresh.

**Verification:** Run targeted component/view-model tests for the detail editor parsing and form behavior. If the UI layout changes materially, capture a screenshot artifact from the automation detail page and run the required design critique flow before final commit.

### Phase 4: Update specs, docs, and regression coverage

**Files changed:**

- `docs/specs/core-domain-model.md`
- `docs/specs/mcp-protocol-handling.md`
- `docs/specs/dashboard-ux.md`
- `tests/convex/automation-public-views.test.ts`
- `tests/local-convex/automations.test.ts`
- `apps/web/app/lib/server/api-runtime/routes/mcp.request-dispatch.test.ts`
- `apps/web/app/lib/server/automation-runtime.test.ts`
- `apps/web/src/lib/automations-view-model.test.ts`

**Steps:**

- [ ] Update the relevant specs to document automation-scoped memory storage, automation-only MCP memory tools, runtime prompt injection behavior, and the dashboard detail-page editing surface.
- [ ] Add or update targeted tests covering public automation view shapes, local fixture contracts, memory-tool listing/calls, prompt injection, and client parsing.
- [ ] Capture any reusable validation lesson as a rule update if implementation reveals a stable engineering pattern worth codifying.

**Verification:** Run the targeted non-E2E test files covering the touched areas and confirm spec text matches the final behavior without drift.

## Files Changed

- `plans/automation-memory.md`
- `convex/schema.ts`
- `convex/automations.ts`
- `convex/automations_shared.ts`
- `convex/automation_runs.ts`
- `convex/mcp_node/internal_tools.ts`
- `convex/mcp_node.ts`
- `packages/shared/src/automations.ts`
- `packages/shared/src/tool-definitions/keppo.ts`
- `apps/web/app/lib/server/api-runtime/routes/mcp.ts`
- `apps/web/app/lib/server/api-runtime/routes/mcp.request-dispatch.test.ts`
- `apps/web/app/lib/server/api-runtime/routes/automations.ts`
- `apps/web/app/lib/server/automation-runtime.ts`
- `apps/web/app/lib/server/automation-runtime.test.ts`
- `apps/web/src/components/automations/automation-config-editor.tsx`
- `apps/web/src/components/automations/automation-form-schema.ts`
- `apps/web/src/routes/automations.$automationId.lazy.tsx`
- `apps/web/src/lib/automations-view-model.ts`
- `apps/web/src/lib/automations-view-model.test.ts`
- `tests/convex/automation-public-views.test.ts`
- `tests/local-convex/automations.test.ts`
- `docs/specs/core-domain-model.md`
- `docs/specs/mcp-protocol-handling.md`
- `docs/specs/dashboard-ux.md`

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| ------------- | --------------- | --------------- | --------------- |
| Memory inflates every automation prompt and degrades runtime quality or cost. | Medium | High | Enforce a hard 20,000-character cap, omit empty memory blocks, and return explicit overflow feedback that pushes agents to compact memory before appending more. |
| UI edits and MCP tool edits drift in normalization or limits. | Medium | High | Centralize memory validation and normalization in shared helpers reused by both mutation and internal-tool paths. |
| Ambiguous `edit_memory` replacements silently corrupt stored memory. | Medium | High | Require exact one-match semantics when `replace_all !== true` and fail loudly on zero or multiple matches. |
| Adding `memory` to public automation views breaks exact-key contract tests and downstream parsing. | High | Medium | Update shared view-field lists, parser tests, and all exact-key contract tests together in one change. |
| Automation-only tools leak into normal MCP sessions. | Low | High | Reuse the existing `record_outcome` automation-session gating path and add explicit list/call regression tests for non-automation sessions. |

## Definition of Done

- [ ] Every automation has one mutable bounded `memory` field stored on the automation row and exposed to runtime dispatch.
- [ ] Automation runs inject non-empty memory into the system prompt inside `<memory>` and `</memory>`.
- [ ] Automation-authenticated MCP sessions expose `add_memory` and `edit_memory`, and non-automation sessions do not.
- [ ] The automation detail/edit page lets operators inspect and update memory with clear limit feedback.
- [ ] Specs and targeted regression tests are updated so code, contracts, and docs stay aligned.

## Iteration Log

| Iteration | Timestamp | Summary | Commit | Errors/Issues |
| --------- | --------- | ------- | ------ | ------------- |
