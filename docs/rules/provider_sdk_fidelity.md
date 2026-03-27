# Provider SDK Fidelity Rules

## Scope

Use these rules when a provider connector depends on the SDK boundary in `packages/shared/src/provider-sdk/**`.

## Required contract

- Connector modules call SDK adapter methods only; raw provider HTTP belongs in the SDK layer.
- Official-SDK providers (`google`, `stripe`, `github`, `slack`, `notion`) should instantiate their real SDK clients in `provider-sdk/<provider>/real.ts`.
- Real SDK adapters must normalize provider failures into the shared SDK error shape used by runtime policy and metrics logic.
- OAuth exchange and refresh flows must normalize provider-returned scopes into the same canonical app scope strings before connector/runtime checks.
- Fakes must preserve the same method names, request shapes, and response envelopes as the real adapters for covered operations.
- If a write method accepts idempotency keys, connectors must pass deterministic keys into that call.
- E2E and conformance coverage should assert SDK call logs for migrated providers, not just final business outcomes.
- Shared connector contract tests should exercise provider HTTP through the shared transport harness so allowlists, request recording, and fixtures stay aligned across suites.

## Guardrails

- Do not fall back to raw `fetch`, `axios`, or `safeFetchWithRetry` inside a real adapter for an SDK-migrated provider.
- Preserve explicit request options that fake clients can observe, especially idempotency and test-namespace headers.
- Preserve pagination and filter request options across adapter layers (`pageToken`, `historyTypes`, cursor params, etc.); dropping them can turn bounded SDK loops into infinite fake-only behavior.
- Keep optional fields compatible with `exactOptionalPropertyTypes`; omit unset fields instead of passing `undefined`.
- Do not hand-roll per-test provider fetch switchboards in connector contract suites; extend the shared provider transport harness instead.
- Provider metadata changes must refresh both the committed registry snapshot and the generated provider docs so rollout, UI, and guardrail views stay aligned:
  - `pnpm run update:provider-registry-snapshot`
  - `pnpm run update:provider-docs`
  - `pnpm run check:provider-registry-snapshot`
  - `pnpm run check:provider-docs`

## Migration checklist

- Matching real and fake method coverage
- Normalized error mapping for auth, validation, rate limit, timeout, and transient failures
- Deterministic idempotent write behavior
- Contract coverage in conformance tests and at least one end-to-end path
- Shared transport harness fixtures aligned with connector contract tests
