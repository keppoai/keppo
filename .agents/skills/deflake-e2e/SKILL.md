---
name: deflake-e2e
description: Triage and fix targeted E2E failures or flakes using CI artifacts, traces, local repros, and the smallest real product, fixture, or harness change.
---

# Deflake E2E

Use this skill when a specific Playwright E2E failure or flake needs investigation and a real fix.

## Scope

- Prefer targeted inputs:
  - spec paths
  - failing test titles
  - GitHub Actions run or job URLs
  - Playwright traces, screenshots, or report artifacts
- If the user gives no scope, ask for a specific failing area. Do not default to the full suite locally.

## Workflow

1. Confirm the repo is on a working branch, not `main`, before making changes.
2. Read the local repo guidance first:
   - [AGENTS.md](../../../AGENTS.md)
   - [docs/rules/e2e_testing.md](../../../docs/rules/e2e_testing.md)
3. Start from evidence, not reruns:
   - inspect failing CI output, traces, screenshots, and merged Playwright reports when available
   - cluster repeated failures by stable symptom before changing code
   - separate deterministic regressions from intermittent flakes
4. Reproduce only the targeted scope locally:
   - never run the full E2E suite locally
   - use `pnpm run test:e2e:base -- tests/e2e/specs/foo.spec.ts`
   - add `--retries=0` when measuring flakiness so Playwright retries do not hide the problem
   - only use `--repeat-each` after an initial targeted run proves the area is worth repeating
5. If application code changes, rerun `pnpm e2e:prepare` before the next browser verification. Test-only edits do not require a rebuild unless the harness says otherwise.
6. Prefer root-cause fixes over test hacks. Valid fix locations include:
   - product code
   - route logic
   - fixtures and seeded backend state
   - shared E2E helpers and teardown
   - deterministic waiting strategy
   - environment and runtime contract
7. Do not paper over flakes with:
   - blanket retries
   - arbitrary sleeps
   - looser assertions that stop checking the operator-visible behavior
   - document-level `page.route()` mocks for TanStack Start pages when the real failure is in a server function or backend state
8. For flaky behavior, use the smallest repeat loop that proves the signature:
   - start with one targeted repro
   - if needed, escalate to `--repeat-each=3` or `--repeat-each=5`
   - only push to `--repeat-each=10` when the failure is rare or the user explicitly wants stronger confidence
9. Common failure patterns to look for:
   - remount or StrictMode races losing in-flight async work
   - TanStack Start server-function requests replacing older `/api/...` browser calls
   - Better Auth same-site flows where browser cookies are present but an explicit cookie header is optional
   - stale prebuilt artifacts after app code changes
   - backend persistence completing before the page refreshes its table or query state
   - transient Convex server errors or teardown timeouts that should be retried within a bounded budget
   - selector expectations that assert too early on the wrong surface
10. Validate at the right level:
   - rerun the targeted spec after the fix
   - rerun nearby specs only when they cover the same helper, route, or fixture boundary
   - use CI for the full suite or broad shard confirmation instead of a local full run
11. When the fix exposes a reusable testing lesson, update the relevant rule in `docs/rules/` in the same change.
12. Summarize:
   - what failed
   - whether it was deterministic or flaky
   - what evidence proved the root cause
   - what changed
   - what local validation ran
   - what still needs CI confirmation, if anything

## Useful Commands

```bash
# Targeted local repro
pnpm run test:e2e:base -- tests/e2e/specs/foo.spec.ts --retries=0

# Repeat a targeted spec to measure flakiness
pnpm run test:e2e:base -- tests/e2e/specs/foo.spec.ts --repeat-each=5 --retries=0

# Refresh prebuilt artifacts after app-code changes
pnpm e2e:prepare

# Open a Playwright trace
pnpm exec playwright show-trace path/to/trace.zip

# Download GitHub Actions artifacts when CI evidence matters
gh run view <run-id>
gh run download <run-id> --dir /tmp/e2e-<run-id>
```

## Output Expectations

Report the investigation like an engineering triage, not a changelog:

- failure signature
- root cause
- chosen fix and why
- validation completed
- residual risk or CI follow-up
