# Plan: Add LinkedIn Provider

## Status: Draft

## Goal

Add LinkedIn as a canonical Keppo provider with managed OAuth and low-level request/response tools that can access approved LinkedIn API surfaces through one provider contract. When complete, LinkedIn appears in the provider registry and dashboard, can be connected through the existing OAuth flow, and supports authenticated read/write API calls through provider-scoped tools.

## Problem

Keppo currently has no LinkedIn provider, so users cannot connect LinkedIn through the canonical provider registry or route approved actions through LinkedIn-owned credentials. A full hand-modeled tool catalog for every LinkedIn product family is too large for a single in-repo change, but a breadth-first LinkedIn provider that exposes typed low-level request/response tools can still unlock all approved LinkedIn APIs now while preserving room for later first-class typed tools.

## Non-Goals

- LinkedIn Learning APIs.
- Webhook verification or automation triggers for LinkedIn.
- External LinkedIn product approval, partner onboarding, or app-review workflows.
- A bespoke typed tool for every LinkedIn endpoint in this change.

## Implementation Plan

### Phase 1: Canonical Provider Registration

**Files changed:**

- `packages/shared/src/provider-ids.ts`
- `packages/shared/src/provider-default-scopes.ts`
- `packages/shared/src/provider-catalog.ts`
- `packages/shared/src/providers/action-catalog.ts`

**Steps:**

- [x] Add `linkedin` to the canonical provider ID list so shared provider enums, validators, and feature gates derive the new provider automatically.
- [x] Define LinkedIn default OAuth scopes for the breadth-first provider contract, using identity/profile defaults and a small default social-write surface rather than attempting every partner-gated permission by default.
- [x] Add LinkedIn configuration requirements to the provider catalog.
- [x] Update shared provider action-catalog metadata maps and lifecycle sets so LinkedIn participates correctly in provider inventory, scope metadata, and docs generation.

**Verification:** `pnpm run typecheck` passes and shared provider helpers resolve `linkedin` as a canonical provider.

### Phase 2: OAuth and SDK Boundary

**Files changed:**

- `packages/shared/src/providers/boundaries/common.ts`
- `packages/shared/src/provider-facet-loader.ts`
- `packages/shared/src/provider-runtime-secrets.ts`
- `packages/shared/src/provider-sdk/linkedin/types.ts`
- `packages/shared/src/provider-sdk/linkedin/client-interface.ts`
- `packages/shared/src/provider-sdk/linkedin/client.ts`
- `packages/shared/src/provider-sdk/linkedin/errors.ts`
- `packages/shared/src/provider-sdk/linkedin/sdk-runtime.ts`
- `packages/shared/src/provider-sdk/linkedin/real.ts`
- `packages/shared/src/provider-sdk/linkedin/fake-client-runtime.ts`
- `packages/shared/src/provider-sdk/linkedin/fake.ts`

**Steps:**

- [x] Extend the managed OAuth provider boundary lists and lazy facet loader so the existing Start-owned OAuth routes can connect LinkedIn.
- [x] Add LinkedIn runtime-secret sync keys for OAuth and API base URLs plus client credentials.
- [x] Implement a LinkedIn SDK boundary that owns all protocol calls and exposes two core operations:
  - `getProfile` for durable external-account lookup and simple reads.
  - `requestJson` for generic authenticated API requests against approved LinkedIn paths.
- [x] Add fake SDK support with deterministic profile, organization, and post responses so shared tests can exercise the provider without live LinkedIn access.

**Verification:** Targeted shared tests for LinkedIn auth and fake SDK pass, and the OAuth boundary recognizes `linkedin` as a managed provider.

### Phase 3: Provider Module and Tools

**Files changed:**

- `packages/shared/src/tool-definitions/linkedin.ts`
- `packages/shared/src/tool-definitions.ts`
- `packages/shared/src/tooling.ts`
- `packages/shared/src/providers/modules/linkedin/metadata.ts`
- `packages/shared/src/providers/modules/linkedin/auth.ts`
- `packages/shared/src/providers/modules/linkedin/connector-runtime.ts`
- `packages/shared/src/providers/modules/linkedin/connector.ts`
- `packages/shared/src/providers/modules/linkedin/tools.ts`
- `packages/shared/src/providers/modules/linkedin/schemas.ts`
- `packages/shared/src/providers/modules/linkedin/ui.ts`
- `packages/shared/src/providers/modules/linkedin/index.ts`
- `packages/shared/src/providers/modules/index.ts`

**Steps:**

- [x] Add LinkedIn tool definitions for:
  - `linkedin.getProfile`
  - `linkedin.readApi`
  - `linkedin.writeApi`
- [x] Implement the LinkedIn provider module with managed OAuth metadata, generic read/write dispatch, idempotent write preparation, and provider-scoped response redaction.
- [x] Register the LinkedIn provider module in the shared module registry and tool surfaces so it becomes available everywhere canonical providers are enumerated.

**Verification:** `pnpm test:shared -- providers.test.ts` and targeted LinkedIn connector tests pass; the provider registry loads LinkedIn and exposes the new tools.

### Phase 4: UI, Runtime Env, and Network Plumbing

**Files changed:**

- `packages/shared/src/providers-ui.ts`
- `apps/web/src/components/integrations/provider-icons.tsx`
- `apps/web/src/lib/docs/source-static.tsx`
- `apps/web/app/lib/server/api-runtime/env-schema.ts`
- `packages/shared/src/network.ts`
- `.env.example`
- `scripts/convex-managed-env.mjs`

**Steps:**

- [x] Add LinkedIn provider UI metadata, generic detail-page form defaults, display copy, and icon support.
- [x] Add LinkedIn env keys to the API runtime schema and local env template.
- [x] Add LinkedIn API and OAuth hosts to the derived outbound allowlist logic so OAuth exchange and API execution work through the shared safe-fetch boundary.

**Verification:** `pnpm test:web` and targeted shared UI/env tests pass; LinkedIn renders in the integrations UI metadata layer.

### Phase 5: Docs, Specs, and Generated Artifacts

**Files changed:**

- `docs/specs/execution-workers-connectors.md`
- `docs/self-hosting-setup.md`
- `docs/providers/linkedin.md`
- `apps/web/content/docs/self-hosted/providers.mdx`
- `apps/web/content/docs/user-guide/integrations/index.mdx`
- `apps/web/content/docs/user-guide/integrations/meta.json`
- `apps/web/content/docs/user-guide/integrations/linkedin.mdx`
- `packages/shared/provider-registry.snapshot.json`
- `docs/providers.md`

**Steps:**

- [x] Update the execution-workers/connectors spec to include LinkedIn in the canonical provider inventory and describe the low-level LinkedIn request/response surface.
- [x] Document LinkedIn env variables, callback expectations, and scope/product-approval caveats in self-hosting docs.
- [x] Add user-facing integration docs for LinkedIn.
- [x] Regenerate the provider registry snapshot and generated provider docs.

**Verification:** `pnpm run update:provider-registry-snapshot`, `pnpm run update:provider-docs`, `pnpm run check:provider-registry-snapshot`, and `pnpm run check:provider-docs` all pass.

### Phase 6: Targeted Regression Coverage

**Files changed:**

- `packages/shared/src/providers.test.ts`
- `packages/shared/src/providers-ui.test.ts`
- `packages/shared/src/provider-runtime-secrets.test.ts`
- `packages/shared/src/network.test.ts`
- `apps/web/src/lib/oauth-api.test.ts`

**Steps:**

- [x] Add LinkedIn coverage for provider registration and fail-closed OAuth profile lookup.
- [x] Add LinkedIn coverage for provider UI metadata and icon/color wiring.
- [x] Add runtime-secret and outbound-allowlist assertions for LinkedIn env keys.
- [x] Add Start-owned OAuth route coverage showing LinkedIn connect/callback flows are wired through the managed-provider boundary.

**Verification:** `pnpm test:shared` and `pnpm test:web` pass for the targeted suites touched by the new provider.

## Files Changed

- `plans/add-linkedin-provider.md`
- `packages/shared/src/provider-ids.ts`
- `packages/shared/src/provider-default-scopes.ts`
- `packages/shared/src/provider-catalog.ts`
- `packages/shared/src/providers/action-catalog.ts`
- `packages/shared/src/providers/boundaries/common.ts`
- `packages/shared/src/provider-facet-loader.ts`
- `packages/shared/src/provider-runtime-secrets.ts`
- `packages/shared/src/provider-runtime-secrets.test.ts`
- `packages/shared/src/tool-definitions/linkedin.ts`
- `packages/shared/src/tool-definitions.ts`
- `packages/shared/src/tooling.ts`
- `packages/shared/src/provider-sdk/linkedin/types.ts`
- `packages/shared/src/provider-sdk/linkedin/client-interface.ts`
- `packages/shared/src/provider-sdk/linkedin/client.ts`
- `packages/shared/src/provider-sdk/linkedin/errors.ts`
- `packages/shared/src/provider-sdk/linkedin/sdk-runtime.ts`
- `packages/shared/src/provider-sdk/linkedin/real.ts`
- `packages/shared/src/provider-sdk/linkedin/fake-client-runtime.ts`
- `packages/shared/src/provider-sdk/linkedin/fake.ts`
- `packages/shared/src/provider-sdk/migration.ts`
- `packages/shared/src/providers/modules/linkedin/metadata.ts`
- `packages/shared/src/providers/modules/linkedin/auth.ts`
- `packages/shared/src/providers/modules/linkedin/connector-runtime.ts`
- `packages/shared/src/providers/modules/linkedin/connector.ts`
- `packages/shared/src/providers/modules/linkedin/tools.ts`
- `packages/shared/src/providers/modules/linkedin/schemas.ts`
- `packages/shared/src/providers/modules/linkedin/ui.ts`
- `packages/shared/src/providers/modules/linkedin/index.ts`
- `packages/shared/src/providers/modules/index.ts`
- `packages/shared/src/providers-ui.ts`
- `packages/shared/src/providers-ui.test.ts`
- `apps/web/src/components/integrations/provider-icons.tsx`
- `apps/web/src/lib/docs/source-static.tsx`
- `apps/web/app/lib/server/api-runtime/env-schema.ts`
- `packages/shared/src/network.ts`
- `packages/shared/src/network.test.ts`
- `.env.example`
- `docs/specs/execution-workers-connectors.md`
- `docs/self-hosting-setup.md`
- `docs/providers/linkedin.md`
- `apps/web/content/docs/self-hosted/providers.mdx`
- `apps/web/content/docs/user-guide/integrations/index.mdx`
- `apps/web/content/docs/user-guide/integrations/meta.json`
- `apps/web/content/docs/user-guide/integrations/linkedin.mdx`
- `packages/shared/provider-registry.snapshot.json`
- `docs/providers.md`
- `packages/shared/src/providers.test.ts`
- `packages/shared/src/test-utils/connector-harness.ts`
- `apps/web/src/lib/oauth-api.test.ts`
- `scripts/convex-managed-env.mjs`

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| LinkedIn scope and product access differs per app and can make default OAuth requests fail | High | High | Keep default scopes conservative, document custom-scope override expectations, and treat partner/product approval as an external prerequisite |
| Generic request tools could allow unsafe header or path usage | Medium | High | Keep all traffic on the LinkedIn API base URL, block auth-header overrides, and redact request bodies/headers in previews |
| OAuth profile lookup may vary between OIDC-style and legacy LinkedIn APIs | Medium | Medium | Probe supported profile endpoints in order and fail closed when no durable external account id is returned |
| Generated provider docs and snapshot drift from source metadata | Medium | Medium | Regenerate snapshot/docs in the same change and keep guardrail checks in verification |

## Definition of Done

- [x] `linkedin` is a canonical provider registered in the shared provider/module/runtime surfaces
- [x] LinkedIn can be connected through the existing managed OAuth API routes
- [x] LinkedIn exposes working low-level request/response tools for authenticated API reads and writes
- [x] LinkedIn appears in the dashboard integrations UI with provider metadata and iconography
- [x] Relevant specs, self-hosting docs, and user docs are updated
- [x] Provider registry snapshot and generated provider docs are refreshed
- [x] Targeted shared and web tests for the new provider pass

## Iteration Log

| Iteration | Timestamp | Summary | Commit | Errors/Issues |
| --------- | --------- | ------- | ------ | ------------- |
