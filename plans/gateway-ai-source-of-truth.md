# Plan: Make Dyad Gateway the Source of Truth for Bundled AI Credits

## Status: Draft
<!-- When completed: change to "## Status: Done", add [PLAN HAS BEEN COMPLETED] and [PLAN DONE AT COMMIT <hash>] here -->

## Goal

Make Dyad Gateway budget and spend the canonical source of truth for all bundled AI usage in Keppo, including clarification-question generation, prompt generation, Mermaid regeneration, and bundled automation runtime. When complete, bundled AI balance, exhaustion checks, purchase top-ups, monthly resets, and UI billing copy will all derive from gateway-backed spend plus Keppo-managed entitlements instead of from a separate decrementing Convex ledger.

## Problem

Keppo currently keeps two independent billing systems for bundled AI:

- Convex decrements native AI credits for prompt generation and bundled runtime.
- Dyad Gateway enforces a separate per-org USD budget derived from tier allowance.

That split creates drift and contradictory semantics:

- bundled prompt generation bypasses the gateway entirely today
- bundled runtime pre-deducts credits before sandbox dispatch
- prompt-builder contracts still claim fixed-price behavior such as “questions are free” and “the final draft costs 1 credit”
- purchased credit packs update Convex, but not the gateway max budget
- gateway spend and Keppo-visible remaining credits can diverge

If the gateway is the canonical spend system, Keppo needs to stop pretending that fixed per-action credits are authoritative and instead treat product-facing credits as a derived view over gateway budget and spend.

## Non-Goals

- Repricing plan tiers, AI credit packs, or automation run top-up packages.
- Changing self-managed / BYOK billing semantics outside bundled-mode flows.
- Reworking automation run top-up accounting in the same change.
- Depending on new external Dyad Gateway APIs beyond per-user budget, spend, key, and reset operations already implied by the current integration model.
- Building compatibility layers, shadow reads, or backfill tooling for legacy production data.

## Assumptions

- Convex may hold the Dyad Gateway management secret, but only inside internal actions/mutations and server-side env validation paths. Public Convex functions, dashboard clients, and sandbox env must still never receive that secret.
- All bundled AI usage becomes gateway-metered. This includes clarification-question generation as well as final prompt generation, Mermaid regeneration, and bundled automation runtime.
- Product-facing “AI credits” remain in the UI, but they become derived budget units backed by gateway spend rather than fixed per-request debits.
- Keppo continues to own entitlements and lifecycle rules such as free-trial grants, monthly included credits, purchased credit packs, oldest-active purchase consumption, and 90-day purchase expiry.
- Because the system has no meaningful production usage, the implementation can replace the old bundled-credit write path directly instead of carrying migration-only compatibility code.

## Implementation Plan

### Phase 1: Redefine the canonical accounting and trust boundary

**Files changed:**

- `packages/shared/src/automations.ts`
- `packages/shared/src/automations.test.ts`
- `apps/web/app/lib/server/automation-api.ts`
- `docs/rules/billing.md`
- `docs/rules/security.md`
- `docs/rules/env_runtime.md`
- `docs/specs/control-plane-api.md`
- `docs/specs/core-domain-model.md`
- `docs/specs/dashboard-ux.md`
- `docs/specs/security-model.md`

**Steps:**

- [ ] Add the missing reverse conversion helpers and canonical rounding rules so Keppo can convert gateway `max_budget` and `spend` into product-facing credits without ad hoc math scattered across server, Convex, and UI code.
- [ ] Replace the current fixed-charge automation billing contract in `automation-api.ts` with a gateway-backed billing payload that can report actual post-call `charged_credits`, raw budget spend metadata, and a synced remaining-balance snapshot.
- [ ] Remove the documented “questions are free” and “the final draft costs 1 credit” assumptions from shared contracts and specs, and replace them with explicit spend-based bundled billing semantics.
- [ ] Update the security and env-runtime rules/specs so the Dyad Gateway management secret is allowed inside Convex internal code only, while remaining forbidden to public Convex functions, clients, and sandbox runtime env.

**Verification:** Run `pnpm run typecheck`, `pnpm check:security`, and the shared conversion/unit tests. Confirm docs/spec text no longer claims fixed one-credit bundled generation behavior.

### Phase 2: Replace Convex bundled-credit accounting with synchronized gateway state

**Files changed:**

- `convex/schema.ts`
- `convex/ai_credits.ts`
- `convex/auth.ts`
- `convex/admin.ts`
- `convex/onboarding.ts`
- `convex/cron_heartbeats.ts`
- `convex/crons.ts`
- `apps/web/app/lib/server/api-runtime/convex-client/refs.ts`
- `apps/web/app/lib/server/api-runtime/convex-client/automation-ai.ts`
- `apps/web/app/lib/server/api-runtime/convex.ts`
- `tests/convex/ai-credits.test.ts`
- `tests/convex/billing.test.ts`
- `tests/local-convex/automations.test.ts`

**Steps:**

- [ ] Extend the Convex credit schema so current-period credit rows store gateway sync metadata such as last synced spend/budget, reset anchor, and sync timestamp, while preserving entitlement fields needed for free-trial, monthly allowance, and purchased-credit lifecycle logic.
- [ ] Stop using `deductAiCredit` as the authoritative write path for bundled spend. Replace it with internal reconciliation operations that consume gateway spend deltas and materialize derived `allowance_used`, `allowance_remaining`, `purchased_remaining`, `total_available`, and per-purchase `credits_remaining`.
- [ ] Keep oldest-active purchased-pack consumption and 90-day expiry behavior by reconciling aggregate gateway spend into `ai_credit_purchases` in deterministic order rather than decrementing purchase balances during request dispatch.
- [ ] Update org bootstrap, onboarding, and admin reporting to read gateway-synchronized balances and usage instead of treating `allowance_used` as the canonical source.
- [ ] Remove or rewrite legacy bundled-credit helpers, tests, and call sites that assume direct per-request decrements so the codebase has one canonical accounting model after the cutover.
- [ ] Add heartbeat/cron support for allowance resets, purchased-credit expiry, and drift repair so the derived Convex state can recover cleanly after missed syncs or partial failures.

**Verification:** Run targeted Convex and local-Convex suites covering monthly resets, free-trial rows, purchased credit ordering, expiry, and idempotent spend-delta reconciliation. Confirm repeated syncs do not double-consume credits.

### Phase 3: Move Dyad Gateway management into Convex internal actions

**Files changed:**

- `convex/dyad_gateway.ts`
- `convex/ai_credits.ts`
- `convex/cron_heartbeats.ts`
- `apps/web/app/lib/server/api-runtime/dyad-gateway.ts`
- `apps/web/app/lib/server/api-runtime/env-schema.ts`
- `apps/web/app/lib/server/api-runtime/env.ts`
- `apps/web/app/lib/server/api-runtime/convex-client/refs.ts`
- `apps/web/app/lib/server/api-runtime/convex.ts`
- `apps/web/app/lib/server/api-runtime/dyad-gateway.test.ts`
- `scripts/check-security-invariants.mjs`

**Steps:**

- [ ] Introduce a Convex-owned Dyad Gateway client module for internal actions/mutations, including user lookup, user create/update, key generation, budget reset, and sanitized error mapping.
- [ ] Refactor existing Start-runtime gateway management code so app-server callers go through Convex internal actions instead of keeping a competing gateway client in `apps/web`.
- [ ] Tighten env parsing and security invariants so Convex-only gateway secret access is explicit, validated, and still fails closed for any public surface.
- [ ] Ensure the gateway client exposes the exact primitives needed for balance sync, purchase top-ups, free-trial provisioning, paid-tier provisioning, and subscription-period resets without leaking raw secret-bearing responses into logs.

**Verification:** Run targeted gateway-client tests plus `pnpm check:security`. Confirm public runtime code no longer needs direct access to the management secret and that gateway errors remain redacted.

### Phase 4: Route every bundled AI execution path through gateway-backed accounting

**Files changed:**

- `apps/web/app/lib/server/automation-api.ts`
- `apps/web/app/lib/server/automation-runtime.ts`
- `apps/web/app/lib/server/automation-runtime.test.ts`
- `apps/web/src/lib/automation-api.test.ts`
- `apps/web/app/lib/server/api-runtime/routes/automations.ts`

**Steps:**

- [ ] Update clarification-question generation, final prompt generation, and Mermaid regeneration so bundled-mode calls use gateway-backed OpenAI access and synchronize observed spend back into Convex immediately after each successful or failed provider call.
- [ ] Remove bundled runtime’s pre-dispatch native credit deduction and replace it with gateway-backed readiness checks plus post-run or post-failure synchronization from the completion path.
- [ ] Make gateway exhaustion and budget errors the canonical bundled `ai_credit_limit_reached` path, while ensuring infrastructure failures before model execution no longer burn credits.
- [ ] Persist post-call balance snapshots after each bundled AI operation so downstream UI reads and retry flows see the synchronized balance without relying on stale decrement logic.

**Verification:** Run targeted server-runtime tests for question generation, prompt generation, Mermaid regeneration, runtime dispatch failure, runtime completion, and bundled-limit handling. Confirm dispatch failures before gateway model usage do not reduce remaining credits.

### Phase 5: Synchronize billing events, credit-pack purchases, and gateway budget resets

**Files changed:**

- `cloud/api/billing.ts`
- `convex/ai_credits.ts`
- `convex/cron_heartbeats.ts`
- `tests/convex/billing.test.ts`
- `apps/web/src/lib/billing-api.test.ts`

**Steps:**

- [ ] Update Stripe billing webhook handling so recurring tier changes, free-trial eligibility, payment failures, subscription deletion, and AI credit-pack purchases all adjust gateway `max_budget` and reset state in the same flow that mutates Keppo entitlements.
- [ ] Add reconciliation logic for purchased-credit expiry and billing-period resets so gateway budget stays aligned with active entitlements, including one-time free-trial credits and 90-day purchased packs.
- [ ] Ensure credit-pack fulfillment continues to be idempotent while also synchronizing the corresponding gateway budget increase exactly once.
- [ ] Delete any remaining billing-side assumptions that purchased credits only live in Convex and not in the gateway-backed budget model.
- [ ] Add targeted regression coverage for plan changes, credit-pack purchases, expiry handling, and retry-safe gateway provisioning/update failures.

**Verification:** Run the billing webhook test suite and the Convex AI-credit tests. Confirm credit-pack fulfillment and subscription transitions update both entitlements and gateway budget exactly once.

### Phase 6: Update dashboard, admin, and setup surfaces for spend-based credits

**Files changed:**

- `apps/web/src/routes/billing.lazy.tsx`
- `apps/web/src/routes/billing.lazy.test.tsx`
- `apps/web/src/routes/automations.lazy.tsx`
- `apps/web/src/routes/automations.$automationId.lazy.tsx`
- `apps/web/src/routes/_admin.usage.lazy.tsx`
- `apps/web/src/components/layout/breadcrumb-header.tsx`
- `apps/web/src/components/automations/automation-prompt-box.tsx`
- `apps/web/src/components/automations/automation-prompt-box.test.tsx`
- `apps/web/src/components/automations/automation-config-editor.tsx`
- `apps/web/src/components/automations/create-automation-dialog.tsx`
- `apps/web/src/components/automations/ai-key-manager.tsx`
- `apps/web/src/hooks/use-admin.ts`
- `apps/web/src/lib/automations-view-model.ts`
- `apps/web/src/lib/automations-view-model.test.ts`
- `tests/e2e/specs/automations/automation-builder.spec.ts`
- `docs/specs/testing-strategy.md`
- `docs/self-hosting-setup.md`
- `docs/dev-setup.md`

**Steps:**

- [ ] Replace fixed-price bundled AI copy across billing, builder, settings, and automation detail screens with spend-based copy that explains credits are derived from gateway-backed budget usage.
- [ ] Update admin usage views and hooks so org credit usage is derived from synchronized gateway spend instead of `allowance_used` alone.
- [ ] Keep the product-facing remaining-credit UX understandable by applying the shared rounding rules consistently in billing cards, breadcrumbs, prompt-builder balance callouts, and admin reporting.
- [ ] Add or update targeted web and E2E coverage for the changed billing copy, balance snapshots, and builder question/draft billing behavior.
- [ ] Update setup docs so local/self-hosted operators know the Convex runtime now needs the gateway management env and understand the resulting bundled-credit behavior.

**Verification:** Run targeted web tests plus the smallest relevant Playwright automation-builder spec. Manually review billing/settings/builder surfaces to confirm the old “single credit” semantics are gone.

## Files Changed

- `plans/gateway-ai-source-of-truth.md`
- `packages/shared/src/automations.ts`
- `packages/shared/src/automations.test.ts`
- `convex/schema.ts`
- `convex/ai_credits.ts`
- `convex/auth.ts`
- `convex/admin.ts`
- `convex/onboarding.ts`
- `convex/cron_heartbeats.ts`
- `convex/crons.ts`
- `convex/dyad_gateway.ts`
- `apps/web/app/lib/server/api-runtime/convex-client/refs.ts`
- `apps/web/app/lib/server/api-runtime/convex-client/automation-ai.ts`
- `apps/web/app/lib/server/api-runtime/convex.ts`
- `apps/web/app/lib/server/api-runtime/dyad-gateway.ts`
- `apps/web/app/lib/server/api-runtime/dyad-gateway.test.ts`
- `apps/web/app/lib/server/api-runtime/env-schema.ts`
- `apps/web/app/lib/server/api-runtime/env.ts`
- `apps/web/app/lib/server/api-runtime/routes/automations.ts`
- `apps/web/app/lib/server/automation-api.ts`
- `apps/web/app/lib/server/automation-runtime.ts`
- `apps/web/app/lib/server/automation-runtime.test.ts`
- `cloud/api/billing.ts`
- `apps/web/src/lib/automation-api.test.ts`
- `apps/web/src/routes/billing.lazy.tsx`
- `apps/web/src/routes/billing.lazy.test.tsx`
- `apps/web/src/routes/automations.lazy.tsx`
- `apps/web/src/routes/automations.$automationId.lazy.tsx`
- `apps/web/src/routes/_admin.usage.lazy.tsx`
- `apps/web/src/components/layout/breadcrumb-header.tsx`
- `apps/web/src/components/automations/automation-prompt-box.tsx`
- `apps/web/src/components/automations/automation-prompt-box.test.tsx`
- `apps/web/src/components/automations/automation-config-editor.tsx`
- `apps/web/src/components/automations/create-automation-dialog.tsx`
- `apps/web/src/components/automations/ai-key-manager.tsx`
- `apps/web/src/hooks/use-admin.ts`
- `apps/web/src/lib/automations-view-model.ts`
- `apps/web/src/lib/automations-view-model.test.ts`
- `tests/convex/ai-credits.test.ts`
- `tests/convex/billing.test.ts`
- `tests/local-convex/automations.test.ts`
- `tests/e2e/specs/automations/automation-builder.spec.ts`
- `scripts/check-security-invariants.mjs`
- `docs/rules/billing.md`
- `docs/rules/security.md`
- `docs/rules/env_runtime.md`
- `docs/specs/control-plane-api.md`
- `docs/specs/core-domain-model.md`
- `docs/specs/dashboard-ux.md`
- `docs/specs/security-model.md`
- `docs/specs/testing-strategy.md`
- `docs/self-hosting-setup.md`
- `docs/dev-setup.md`

## Cutover Notes

- This plan assumes a direct cutover rather than a staged migration.
- Old bundled-credit decrement paths, legacy compatibility helpers, and shadow-comparison code should be removed rather than preserved once the new gateway-backed accounting path is in place.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Gateway aggregate spend is coarser than the old per-request debit model, which can make purchase-consumption reconciliation tricky | Medium | High | Reconcile spend deltas at deterministic lifecycle points, keep entitlement ordering in Convex, and add idempotent tests for repeated syncs and concurrent usage |
| Moving the gateway management secret into Convex broadens the trust boundary | Medium | High | Restrict all gateway operations to internal actions/mutations, update security docs and invariants, and keep public Convex queries/actions secret-free |
| Existing prompt-builder and billing UX assumes fixed one-credit behavior | High | High | Remove the fixed-price contract explicitly, update all copy/tests in the same change, and validate the builder and billing screens together |
| Credit-pack expiry and monthly allowance resets can desynchronize gateway budget from active entitlements | Medium | High | Drive budget updates from billing webhooks plus Convex heartbeat reconciliation, and cover expiry/reset paths with focused tests |
| Direct cutover can leave dead legacy helpers or tests pointing at removed decrement paths | Medium | Medium | Delete or rewrite legacy helpers in the same change and keep the verification focused on one canonical accounting model |
| Runtime dispatch or gateway failures could still leave stale balance snapshots | Medium | Medium | Persist sync cursors, retry reconciliation idempotently, and keep maintenance/heartbeat repair paths for missed updates |

## Definition of Done

- [ ] All bundled AI flows use gateway-backed spend, including clarification questions, prompt generation, Mermaid regeneration, and bundled runtime.
- [ ] Convex no longer treats `deductAiCredit` or dispatch-time decrements as the source of truth for bundled spend.
- [ ] Credit-pack purchases, monthly resets, and purchased-credit expiry update gateway budget and synchronized Convex balance state consistently.
- [ ] Billing, admin, and automation-builder surfaces no longer claim fixed “1 credit” bundled behavior and instead display derived gateway-backed balances.
- [ ] Security, runtime, billing, and setup docs are updated to reflect the new Convex-owned gateway secret boundary and bundled-credit model.

## Iteration Log

| Iteration | Timestamp | Summary | Commit | Errors/Issues |
| --------- | --------- | ------- | ------ | ------------- |
