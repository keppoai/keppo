# Non-E2E Testing Rules

## Layer ownership

- Default deterministic behavior to the fastest layer that still exercises the real boundary under test.
- Pure data shaping, parsing, and domain helpers belong in small Vitest unit tests.
- Web-app rendering, route context, and hook behavior that is visible through rendered output belongs in `apps/web` `jsdom` tests with the shared DOM harness.
- API contract behavior belongs in in-process server-route tests in the owning runtime (`apps/web` for live Start-owned routes and `apps/web/app/lib/server/api-runtime` for the remaining shared boundary helpers), not Playwright.
- Bounded ingestion or batch-accepting API routes must have server-route tests that cover overflow behavior explicitly; accepted payloads may be capped, but tests must verify the caller receives truncation/rejection metadata so the route never drops accepted items silently.
- API tests that exercise `execute_code` should stub the sandbox provider and drive `toolCallHandler` directly unless the test is explicitly about sandbox infrastructure behavior.
- MCP API/Vitest tests that send multiple requests in one Streamable HTTP session must use a fresh JSON-RPC `id` for each POST; duplicate ids can cause the transport layer to reuse or misroute responses.
- Convex module/schema behavior belongs in `tests/convex/*`.
- `tests/convex/*` suites that rely on the shared `convex-test` harness must run with Vitest file parallelism disabled; the harness keeps process-global transaction state and can deadlock or throw `test began while previous transaction was still open` when files execute concurrently.
- Root-level Vitest commands that target `tests/convex/*` must use the dedicated config (`--config tests/convex/vitest.config.ts`) and explicit `./tests/...` paths so mirrored files under `.workflow-base/` cannot be picked up by Vitest's path matching.
- Backend flows that need API + Convex + fake gateway wiring but not a browser belong in `test:local-convex`.
- `test:local-convex` should bootstrap the shared local Convex/API/fake-gateway runtime for the Vitest suites; do not require operators to hand-start that stack.
- Local-Convex runners must honor explicit test-file arguments when a caller targets a single spec; do not silently prepend the whole `tests/local-convex/` suite and reintroduce cross-test interference from unrelated resets.
- `tests/local-convex/*` must run through the dedicated config (`--config tests/local-convex/vitest.config.ts`) with Vitest file parallelism disabled; the shared runtime harness now performs full runtime reset before/after namespace-scoped cases, so concurrent files would erase each other's state.
- Provider connector and conformance behavior belongs in shared/provider harness tests before any browser coverage is added.
- The repo-owned broader non-E2E CI lane must run the full `@keppo/shared` Vitest suite (`pnpm test:shared`), not just narrow conformance/parity slices, so shared domain and connector regressions are covered on every PR/main change.
- Shared connector transport tests should use the reusable provider transport harness instead of per-test fetch switchboards or inline allowlist mutation.
- Clean CI runners that execute Vitest or typecheck against workspace package subpath exports (for example `@keppo/shared/*` or `@keppo/cloud/*`) must build those export packages first; do not assume checked-in or previously built `dist/` output exists on the runner.
- Package-local Vitest configs must explicitly exclude generated `dist/**` output so compiled test artifacts never double-run after build steps in the same CI lane.

## Web-app rendered tests

- Use `Vitest + jsdom + @testing-library/react + @testing-library/user-event + @testing-library/jest-dom + MSW` as the default web-app rendering stack.
- Render through `apps/web/src/test/render-dashboard.tsx` so tests get real route context, theme context, auth context, workspace context, and approved runtime seams.
- Keep `apps/web` Vitest projects path-scoped: rendered `src/**/*.test.{ts,tsx}` suites run in `jsdom` with the shared setup file, while `app/**/*.test.{ts,tsx}` server-runtime suites stay in a clean node project without the browser/MSW harness.
- When the shared web runtime imports Vite env at module load, seed required `VITE_*` values in `apps/web/src/test/setup.ts` so jsdom helpers can import the default runtime without silently depending on developer-local env files.
- Prefer faking the unified web runtime boundary over mocking `react`, `convex/react`, router internals, or global browser primitives directly.
- Keep assertions on observable state, rendered copy, navigation intent, and mutation payloads that matter to the operator experience.
- Route components with async query-backed loading states must keep hook order stable across loading-to-data transitions; declare derived hooks before early loading returns, and add a rendered test that starts with `undefined` query data before rerendering with the loaded state when that transition is part of the bug surface.

## Authoring guardrails

- Do not use `vi.mock("react")` in `apps/web` tests.
- Do not hand-roll hook slot cursors, synthetic state arrays, or implementation-detail render loops.
- Do not monkeypatch `globalThis.fetch` inside individual tests when the shared runtime harness or MSW can model the same behavior.
- Run `pnpm test:non-e2e:authoring` when adding or refactoring non-E2E suites; CI should fail on banned patterns instead of relying on reviewer memory.
- If a deterministic scenario only needs dashboard/API/Convex/local-Convex coverage, move it out of Playwright and update the ownership docs in the same change.

## Commands

- `pnpm test:web`
- `pnpm test:convex`
- `pnpm test:local-convex`
- `pnpm test:shared`
- `pnpm test:conformance`
- `pnpm test:non-e2e:authoring`
- `pnpm test:non-e2e`
