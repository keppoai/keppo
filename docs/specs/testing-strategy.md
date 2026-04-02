# Testing strategy

This spec defines the canonical ownership of test layers. Operational commands, runtime budgets, and authoring guardrails live in `docs/setup.md`, `docs/rules/non_e2e_testing.md`, and `docs/rules/e2e_testing.md`.

## Main layers

- Web-app rendered and server-runtime Vitest coverage in `apps/web`
- Focused Convex tests in `tests/convex/*`
- Local-Convex backend integration tests in `tests/local-convex/*`
- Shared package and provider conformance coverage in `packages/shared` and `tests/provider-conformance/*`
- Browser and cross-stack E2E in `tests/e2e/*`
- Nightly real-provider integration coverage for selected connectors

## Ownership rules

- Deterministic domain logic defaults to Vitest.
- Web-app React behavior should render through the shared `jsdom` harness with real route and context providers instead of mocking React internals.
- `apps/web` keeps separate Vitest project ownership: `src/**/*.test.{ts,tsx}` for rendered `jsdom` coverage and `app/**/*.test.{ts,tsx}` for clean node server-runtime coverage.
- Public docs route rendering, page resolution, and docs search indexing belong in `apps/web` Vitest so docs regressions are caught before browser E2E.
- API request/response and auth-boundary behavior should exercise the real owning runtime before Playwright is added.
- Local-Convex suites own backend flows that need API + Convex + fake-gateway wiring but not a browser.
- Provider behavior is covered first by shared conformance scenarios, then by targeted E2E only when UI or MCP transport behavior is part of the risk.
- Playwright is reserved for cross-stack risks that genuinely need browser, API, Convex, auth, MCP, or sandbox wiring together.
- Nightly suites, not PR-time suites, own real third-party provider verification.

## Guardrails

- `pnpm run typecheck`, `pnpm check:security`, and the relevant targeted test layers are the default local validation path.
- `pnpm run check:barrels` stays green for boundary refactors that touch package or runtime seams.
- Shared boundary-contract changes should ship with malformed-payload regression tests before browser E2E is considered sufficient.
- Provider work must keep the shared action catalog, registry snapshot, generated provider docs, and SDK compatibility checks aligned with the code.
- Changes under `packages/shared/src/**` that feed subpath exports should rebuild `@keppo/shared` before dependent tests rely on `dist/`.
- ARIA and backend goldens are the stable snapshot surfaces. Screenshots and traces are for debugging and visual review, not pass/fail assertions.

## Local browser policy

- Do not run the full E2E suite locally. Use the smallest targeted Playwright spec needed for the change and validate the full suite on GitHub Actions.
- Local browser E2E uses same-site auth through the dashboard `/api/auth/*` proxy.
- Docs changes use `pnpm run test:e2e:base -- tests/e2e/specs/docs/public-docs.spec.ts`.
- Automation-trigger changes use `pnpm run test:e2e:base -- tests/e2e/specs/automations/provider-event-triggers.spec.ts`.
- Automation authoring/editing changes should cover the guided creation/edit questions flow, reviewed diff state, and Mermaid stale/regenerate behavior in targeted Vitest and the smallest relevant Playwright automation spec.
- Code Mode browser verification is explicit: set `KEPPO_E2E_REQUIRE_CODE_MODE_SANDBOX=1` when sandbox availability should become a hard failure instead of a skip. PR and `main` CI browser lanes do this by default alongside explicit Docker sandbox-provider env so the shared E2E workflow verifies the real Docker-backed execution path.

## Canonical browser flows

- Browser E2E remains responsible for login/logout, workspace switching, approval flows, provider connect flows, automation run flows, custom MCP UI transport, notification badging/preferences, public docs navigation/search, and representative public-safe error UX.
- Deterministic route validation, malformed payload handling, provider webhook/signature contracts, provider detail rendering, and most billing/rules helper logic should stay in faster Vitest or local-Convex coverage.
