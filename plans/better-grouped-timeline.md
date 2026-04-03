# Plan: Better Grouped Timeline Tool Cards

## Status: Completed

## Goal

Make the automation run `Grouped timeline` view useful for real Codex runs by recognizing `search_tools` and `execute_code` from actual `mcp: keppo/...` log lines, collapsing MCP lifecycle noise into operator-facing tool cards, and showing the real `search_tools` query plus returned matches in an intuitive collapsed-by-default presentation.

## Problem

The current grouped timeline handles legacy structured `tool_call` events and gives `execute_code` a dedicated UI, but real Codex automation logs still surface many `mcp: keppo/execute_code started`, `mcp: keppo/execute_code (completed)`, `mcp: keppo/search_tools started`, and `mcp: keppo/search_tools (completed)` lines as generic system chatter. That leaves operators reading transport noise instead of the actual tool intent and results. The gap is most visible for `search_tools`, where the query and returned tools are not summarized in a compact, scannable way.

## Non-Goals

- Redesign the full run detail page outside the `Grouped timeline` tab.
- Generalize the parser and card system for every possible `mcp: keppo/<tool>` line in this change.
- Change raw log retention, archival, or the `Raw logs` tab presentation.
- Run the full local E2E suite.
- Introduce a persistent live-OpenAI regression test that always runs in CI.

## Implementation Plan

### Phase 1: Capture Real Codex Log Shapes And Classify Them Correctly

**Files changed:**

- `apps/web/app/lib/server/api-runtime/routes/automations.ts`
- `apps/web/app/lib/server/api-runtime/routes/mcp.ts`
- `apps/web/app/lib/server/api-runtime/routes/mcp.request-dispatch.test.ts`
- `apps/web/app/lib/server/automation-runtime.test.ts`
- `apps/web/src/lib/automations-view-model.test.ts`

**Steps:**

- [x] Run a targeted automation repro with a live `OPENAI_API_KEY` and record the exact `stderr`/`stdout` sequences Codex emits around `mcp: keppo/search_tools` and `mcp: keppo/execute_code`.
- [x] Update `classifyLogLine()` in `apps/web/app/lib/server/api-runtime/routes/automations.ts` so those real `mcp:` lifecycle lines map to structured `tool_call` events instead of falling back to generic `system` events.
- [x] If the captured raw lines do not include enough request/result detail for `search_tools` or `execute_code`, add narrow automation-only structured log writes at the MCP route source for those two tools and cover that logging contract with route-dispatch tests.
- [x] Preserve compatibility with the existing legacy `tool foo(...)` / `foo(...) success in Nms:` parsing so historical runs keep rendering.
- [x] Add regression coverage using the captured real-line shapes so future parser changes do not revert `search_tools` and `execute_code` back to system noise.

**Verification:** Run focused Vitest coverage for the log classifier and grouped-event parser, then manually confirm that a fresh live Codex run produces structured `tool_call` events for both targeted tools in the grouped timeline.

### Phase 2: Merge Tool Lifecycle, Request, And Result Data Into One Event Model

**Files changed:**

- `apps/web/src/lib/automations-view-model.ts`
- `apps/web/src/lib/automations-view-model.test.ts`

**Steps:**

- [x] Extend `toRunEvents()` so the newly classified Codex `search_tools` and `execute_code` start/completion lines merge into the existing grouped `tool_call` flow instead of fragmenting into separate bubbles.
- [x] Make sure `search_tools` request payloads keep the real search query and any provider/capability filters when those values are present in the classified log data.
- [x] Attach the tool result payload to the initiating `tool_call` event, including adjacent `stdout` JSON output when Codex emits the result as a separate line after a completion marker.
- [x] Keep the `execute_code` event shape compatible with the existing dedicated card contract so the current summary/code UI path does not regress.

**Verification:** Run targeted view-model tests that cover live-style `mcp:` sequences for both tools, including success, missing-result, and output-attached cases.

### Phase 3: Add A First-Class Collapsed `search_tools` Card

**Files changed:**

- `apps/web/src/components/automations/run-chat-bubble.tsx`
- `apps/web/src/components/automations/run-chat-bubble.test.tsx`
- `apps/web/src/components/automations/run-chat-viewer.tsx`
- `tests/e2e/specs/automations/automation-lifecycle.spec.ts`

**Steps:**

- [x] Add a dedicated `search_tools` bubble that shows a compact closed-state summary, including the search query and a short preview of top returned matches.
- [x] Keep the `search_tools` request and full result details behind a disclosure that is collapsed by default, with the result rendered in a readable format rather than a raw generic JSON dump.
- [x] Leave `execute_code` on its dedicated card path and update any grouped-timeline helper copy so it describes both specialized tool cards accurately.
- [x] Update the targeted automation lifecycle E2E flow to assert the new `search_tools` card behavior and capture a screenshot artifact for visual review.

**Verification:** Run component tests for the collapsed/expanded `search_tools` card and the targeted Playwright automation lifecycle spec that exercises the grouped timeline UI.

### Phase 4: Validate Against Live Codex Output And Document The UX Contract

**Files changed:**

- `docs/specs/dashboard-ux.md`
- `plans/better-grouped-timeline.md`

**Steps:**

- [x] Run a targeted local automation with a live `OPENAI_API_KEY` to verify that the grouped timeline now renders real Codex `search_tools` and `execute_code` runs as meaningful cards rather than `mcp:` lifecycle noise.
- [x] Capture an updated screenshot under `ux-artifacts/automation-run-chat-grouped-search-tools.png` showing the collapsed `search_tools` card and the dedicated `execute_code` card in the same run.
- [x] Review the screenshot artifact and address any structural or visual issues before calling the work done.
- [x] Update the dashboard UX spec to document the dedicated `search_tools` card behavior, the collapsed-by-default request/result disclosure, and the expectation that structured Codex tool lifecycle logs bind back to one grouped tool event.
- [x] Record implementation progress and commit hashes back into this plan’s iteration log as execution proceeds.

**Verification:** Manually review the live run detail page and screenshot artifact, run the relevant targeted tests, and confirm the spec text matches the shipped grouped-timeline behavior.

## Files Changed

- `plans/better-grouped-timeline.md`
- `apps/web/app/lib/server/api-runtime/routes/automations.ts`
- `apps/web/app/lib/server/api-runtime/routes/mcp.ts`
- `apps/web/app/lib/server/api-runtime/routes/mcp.request-dispatch.test.ts`
- `apps/web/app/lib/server/automation-runtime.test.ts`
- `apps/web/src/lib/automations-view-model.ts`
- `apps/web/src/lib/automations-view-model.test.ts`
- `apps/web/src/components/automations/run-chat-bubble.tsx`
- `apps/web/src/components/automations/run-chat-bubble.test.tsx`
- `apps/web/src/components/automations/run-chat-viewer.tsx`
- `tests/e2e/specs/automations/automation-lifecycle.spec.ts`
- `docs/specs/dashboard-ux.md`
- `ux-artifacts/automation-run-chat-grouped-search-tools.png`

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Real Codex `mcp:` lines do not include enough request/result detail to show the actual `search_tools` query and matches from parsing alone | Medium | High | Capture live traces first; if the raw lines are insufficient, augment automation-session logging at the MCP route/source instead of fabricating UI summaries. |
| New `mcp:` parsing accidentally steals unrelated system lines or regresses legacy grouped-event behavior | Medium | High | Keep the parser narrowly scoped to `search_tools` and `execute_code`, preserve existing legacy patterns, and add regression tests for both live-style and historical line formats. |
| `search_tools` results become too verbose and make the grouped timeline harder to scan | High | Medium | Default the card to collapsed, show only a short closed-state preview, and push full request/result payloads behind explicit disclosure. |
| UI changes look correct in mocked tests but still miss the actual live Codex output format | Medium | High | Include a targeted live `OPENAI_API_KEY` validation pass and a screenshot-based design critique before considering the work complete. |

## Definition of Done

- [x] Real Codex `mcp: keppo/search_tools` and `mcp: keppo/execute_code` lines render as grouped tool cards instead of generic system events.
- [x] The `search_tools` card shows the actual search query and an intuitive preview of returned matches, with full details collapsed by default.
- [x] The existing dedicated `execute_code` card still works for both legacy and live Codex runs.
- [x] Targeted parser, component, and Playwright coverage lock the behavior.
- [x] Live validation with `OPENAI_API_KEY`, a screenshot artifact, and dashboard UX spec updates are completed in the same change.

## Iteration Log

| Iteration | Timestamp | Summary | Commit | Errors/Issues |
| --------- | --------- | ------- | ------ | ------------- |
| 1 | 2026-04-02 | Captured live Codex `mcp:` lifecycle lines, confirmed they do not include the `search_tools` query/result payload directly, and implemented automation-only structured MCP logs plus grouped timeline parsing/UI updates for `search_tools` and `execute_code`. | Pending | Raw Codex lifecycle lines carried start/completed markers only, so source-side structured logging was required for an operator-useful grouped card. |
| 2 | 2026-04-03 | Added focused Vitest coverage, updated the targeted automation lifecycle Playwright spec, and captured `ux-artifacts/automation-run-chat-grouped-search-tools.png` after verifying the grouped timeline UI. | Pending | The Playwright spec needed one final exact-text selector fix for the `summary` JSON key before the run passed. |
