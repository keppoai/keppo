# Plan: Simplify AI Configuration and Free Trial

## Status: Draft
<!-- When completed: change to "## Status: Done", add [PLAN HAS BEEN COMPLETED] and [PLAN DONE AT COMMIT <hash>] here -->

## Goal

Simplify Keppo's AI and billing model by removing exposed runner-harness choice, replacing direct model picking with four stable model classes, disabling BYO keys when the LLM gateway is configured, and changing the free plan into a clearer `Free trial` with a one-time 20-credit grant for new orgs. When complete, automation authoring and pricing copy should reflect the simpler product surface, runtime model selection should resolve from environment-backed classes at execution time, and all existing automations should migrate safely to `auto`.

## Problem

Keppo currently exposes too much low-level AI configuration. Operators choose runner harnesses and concrete model IDs directly, the product still advertises free-tier recurring monthly credits, and BYO remains available even when the hosted gateway is present. These choices make the product harder to understand, complicate pricing copy, and couple stored automation configs too tightly to concrete runtime models.

## Non-Goals

- Reworking paid plan prices, seat limits, workspace limits, or automation run limits beyond the requested copy and free-trial credit semantics.
- Introducing a real per-run complexity router for `auto` in this change. For now, `auto` resolves to the same concrete model as `balanced`.
- Migrating existing free org credit ledgers to the new one-time 20-credit allowance.
- Adding new providers or changing non-AI integration behavior.
- Replacing the existing runner implementation enums in one step if compatibility layers are sufficient.

## Implementation Plan

### Phase 1: Redefine billing and free-trial credit semantics

**Files changed:**

- `packages/shared/src/automations.ts`
- `packages/shared/src/subscriptions.ts`
- `packages/shared/src/contracts/defaults/billing-defaults.ts`
- `convex/auth.ts`
- `convex/ai_credits.ts`
- `convex/admin.ts`
- `apps/web/src/lib/billing-view-model.ts`
- `apps/web/src/routes/billing.lazy.tsx`
- `tests/convex/ai-credits.test.ts`
- `packages/shared/src/subscriptions.test.ts`
- `apps/web/src/lib/billing-view-model.test.ts`
- `apps/web/src/routes/billing.lazy.test.tsx`

**Steps:**

- [ ] Split the free tier's included-credit behavior from the current recurring monthly allowance model so the domain can represent `Free trial` as a one-time included credit grant for new orgs while keeping Starter and Pro monthly behavior unchanged.
- [ ] Update shared subscription tier labels and billing defaults so every product surface uses `Free trial` instead of `Free`.
- [ ] Change new-org bootstrap in `convex/auth.ts` so newly created orgs receive the new free-trial allowance semantics without retroactively changing existing free orgs.
- [ ] Update AI credit balance and billing read models to describe free-trial credits as one-time credits, while still keeping bundled runtime disabled unless the gateway-backed policy says it is available.
- [ ] Remove or rewrite billing copy that currently says free credits renew every billing cycle or are generation-only in all cases.

**Verification:** Run the shared subscription tests, targeted Convex AI-credit tests, and billing view-model/dashboard tests. Confirm new-org setup still creates a valid subscription and billing state, and confirm billing UI strings no longer claim free monthly recurring credits.

### Phase 2: Add model classes and runtime resolution

**Files changed:**

- `packages/shared/src/automations.ts`
- `packages/shared/src/ai_generation.ts`
- `convex/schema.ts`
- `convex/validators.ts`
- `convex/automations_shared.ts`
- `convex/automations.ts`
- `convex/automation_runs.ts`
- `convex/e2e_automations.ts`
- `convex/config_version_migrations.ts`
- `apps/web/app/lib/server/api-runtime/env-schema.ts`
- `apps/web/app/lib/server/api-runtime/env.ts`
- `apps/web/app/lib/server/automation-runtime.ts`
- `apps/web/app/lib/server/api-runtime/convex-client/automation-ai.ts`
- `apps/web/app/lib/server/automation-runtime.test.ts`
- `tests/local-convex/automations.test.ts`
- `tests/convex/automation-lifecycle.test.ts`
- `tests/convex/automation-public-views.test.ts`

**Steps:**

- [ ] Introduce a persisted `model_class` enum with `auto | frontier | balanced | value` in shared contracts, Convex validators, schema, and read models.
- [ ] Add server env configuration for the concrete model behind each class, using explicit env vars such as `KEPPO_AUTOMATION_MODEL_FRONTIER`, `KEPPO_AUTOMATION_MODEL_BALANCED`, `KEPPO_AUTOMATION_MODEL_VALUE`, and `KEPPO_AUTOMATION_MODEL_AUTO`, with the initial deployment values set to GPT-5.4 family models and `auto` resolving to the same concrete target as `balanced`.
- [ ] Centralize runtime model resolution so automation dispatch resolves `model_class` into `ai_model_provider`, `ai_model_name`, and inferred `runner_type` at run time instead of trusting saved concrete model fields from the editor.
- [ ] Keep compatibility fields only where needed during the migration window, but ensure new writes and runtime behavior treat `model_class` as the source of truth.
- [ ] Add a config migration that defaults every existing automation config version to `model_class = "auto"` rather than attempting heuristic mapping from old model names.
- [ ] Update AI generation prompts and parsing so generated automation drafts return `model_class` instead of raw model/provider picks where possible, or are normalized into `model_class` immediately after parsing.

**Verification:** Run targeted Convex and runtime tests around config reads, run dispatch context, and runtime execution. Confirm migrated configs get `auto`, and confirm dispatch resolves `auto` to the configured balanced-class model.

### Phase 3: Remove runner selection and direct model picking from product UI

**Files changed:**

- `apps/web/src/components/automations/automation-form-schema.ts`
- `apps/web/src/components/automations/automation-config-editor.tsx`
- `apps/web/src/routes/automations.create.lazy.tsx`
- `apps/web/src/components/automations/automation-prompt-box.tsx`
- `apps/web/src/components/automations/automation-edit-diff.tsx`
- `apps/web/src/components/automations/automation-home-tab.tsx`
- `apps/web/src/components/automations/automation-list.tsx`
- `apps/web/src/lib/automations-view-model.ts`
- `apps/web/src/components/automations/automation-form-schema.test.ts`
- `apps/web/src/components/automations/automation-builder-questions-step.test.tsx`
- `apps/web/src/components/automations/automation-prompt-box.test.tsx`
- `apps/web/src/lib/automations-view-model.test.ts`

**Steps:**

- [ ] Replace form-level `runner_type`, `ai_model_provider`, and `ai_model_name` controls with a single `model_class` control that presents `Auto`, `Frontier`, `Balanced`, and `Value`, with `Auto` selected by default and marked recommended.
- [ ] Remove runner-harness selection from the manual create flow, automation config editor, and AI prompt-builder flow.
- [ ] Update automation summaries, diffs, detail views, and list rows to display the model class rather than the raw runner/model pair, while still exposing resolved model details only where they are truly operationally necessary.
- [ ] Preserve network-access controls and other configuration surfaces that remain in scope, but rewrite helper copy so the user no longer has to understand harness/provider internals.
- [ ] Add or update client tests to cover the new default `Auto` selection and the absence of runner/model pickers.

**Verification:** Run targeted web tests for the automation editor, prompt box, and view-model parsing. Manually inspect the authoring flows to confirm only the four model classes are exposed and runner selection is gone.

### Phase 4: Disable BYO when the LLM gateway is configured

**Files changed:**

- `apps/web/app/lib/server/api-runtime/dyad-gateway.ts`
- `apps/web/src/components/automations/ai-key-manager.tsx`
- `apps/web/src/lib/automations-view-model.ts`
- `apps/web/src/routes/automations.$automationId.lazy.tsx`
- `apps/web/src/routes/automations.build.lazy.tsx`
- `convex/automations.ts`
- `convex/automation_runs.ts`
- `tests/convex/automation-run-topups.test.ts`
- `apps/web/app/lib/server/automation-runtime.test.ts`

**Steps:**

- [ ] Define one canonical gateway-enabled check based on `KEPPO_LLM_GATEWAY_URL` presence and reuse it across runtime, settings, and authoring surfaces.
- [ ] Fully disable BYO key management UI and related guidance when the gateway is configured, not just for OpenAI but across the product surface as requested.
- [ ] Update execution-readiness logic so free-trial and paid bundled execution is only available when the gateway is configured; otherwise the app should fail closed and communicate the unavailable runtime clearly.
- [ ] Remove stale billing and authoring copy that suggests BYO is available as a fallback when gateway-backed bundled execution is enabled.
- [ ] Add targeted tests that cover gateway-enabled and gateway-disabled behavior so the product does not regress into partially enabled BYO states.

**Verification:** Run targeted runtime and web tests with and without gateway env values. Confirm BYO controls disappear when `KEPPO_LLM_GATEWAY_URL` is set and that runtime readiness behaves correctly for free-trial and paid orgs.

### Phase 5: Update landing page, billing UX, specs, and setup docs

**Files changed:**

- `apps/web/src/components/landing/landing-page.tsx`
- `apps/web/src/routes/billing.lazy.tsx`
- `docs/rules/billing.md`
- `docs/rules/env_runtime.md`
- `docs/rules/ux.md`
- `docs/specs/core-domain-model.md`
- `docs/specs/control-plane-api.md`
- `docs/specs/dashboard-ux.md`
- `docs/setup.md`

**Steps:**

- [ ] Update the landing page pricing section and surrounding marketing copy to explain `Free trial`, one-time 20 credits, bundled execution availability, and the simplified four-tier AI choice model.
- [ ] Update billing/settings/dashboard copy across all authenticated surfaces to use `Free trial` consistently and describe the new credit semantics accurately.
- [ ] Document the new model-class env vars and the gateway-dependent BYO behavior in `docs/setup.md`.
- [ ] Update relevant rules and specs so they describe the new billing semantics, automation config domain shape, dashboard UX, and runtime env contract without leaving spec drift.
- [ ] If UI copy or structure changes meaningfully in pricing or automation authoring, include the required screenshot-based UX validation and critique workflow during implementation.

**Verification:** Review landing and billing screens locally, run targeted web tests, and verify docs/spec wording matches the implemented behavior. If UI changes are material, capture the required screenshot artifact and critique before considering the plan complete.

## Files Changed

- `plans/simplify-ai.md`
- `packages/shared/src/automations.ts`
- `packages/shared/src/subscriptions.ts`
- `packages/shared/src/contracts/defaults/billing-defaults.ts`
- `packages/shared/src/ai_generation.ts`
- `packages/shared/src/subscriptions.test.ts`
- `convex/schema.ts`
- `convex/validators.ts`
- `convex/auth.ts`
- `convex/ai_credits.ts`
- `convex/admin.ts`
- `convex/automations_shared.ts`
- `convex/automations.ts`
- `convex/automation_runs.ts`
- `convex/e2e_automations.ts`
- `convex/config_version_migrations.ts`
- `apps/web/app/lib/server/api-runtime/env-schema.ts`
- `apps/web/app/lib/server/api-runtime/env.ts`
- `apps/web/app/lib/server/api-runtime/dyad-gateway.ts`
- `apps/web/app/lib/server/api-runtime/convex-client/automation-ai.ts`
- `apps/web/app/lib/server/automation-runtime.ts`
- `apps/web/app/lib/server/automation-runtime.test.ts`
- `apps/web/src/lib/automations-view-model.ts`
- `apps/web/src/lib/billing-view-model.ts`
- `apps/web/src/lib/billing-view-model.test.ts`
- `apps/web/src/routes/billing.lazy.tsx`
- `apps/web/src/routes/billing.lazy.test.tsx`
- `apps/web/src/routes/automations.create.lazy.tsx`
- `apps/web/src/routes/automations.$automationId.lazy.tsx`
- `apps/web/src/routes/automations.build.lazy.tsx`
- `apps/web/src/components/automations/automation-form-schema.ts`
- `apps/web/src/components/automations/automation-form-schema.test.ts`
- `apps/web/src/components/automations/automation-config-editor.tsx`
- `apps/web/src/components/automations/automation-prompt-box.tsx`
- `apps/web/src/components/automations/automation-prompt-box.test.tsx`
- `apps/web/src/components/automations/automation-edit-diff.tsx`
- `apps/web/src/components/automations/automation-home-tab.tsx`
- `apps/web/src/components/automations/automation-list.tsx`
- `apps/web/src/components/automations/ai-key-manager.tsx`
- `apps/web/src/components/landing/landing-page.tsx`
- `tests/convex/ai-credits.test.ts`
- `tests/convex/automation-lifecycle.test.ts`
- `tests/convex/automation-public-views.test.ts`
- `tests/convex/automation-run-topups.test.ts`
- `tests/local-convex/automations.test.ts`
- `docs/rules/billing.md`
- `docs/rules/env_runtime.md`
- `docs/rules/ux.md`
- `docs/specs/core-domain-model.md`
- `docs/specs/control-plane-api.md`
- `docs/specs/dashboard-ux.md`
- `docs/setup.md`

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Free-trial credit logic accidentally changes existing free org behavior | Medium | High | Gate the one-time 20-credit behavior at new-org creation time only, add targeted regression tests, and avoid retroactive ledger rewrites in this change |
| Runtime/model-class migration breaks existing automation execution | Medium | High | Migrate all existing configs to `auto`, keep compatibility fields during rollout, and add dispatch-context plus execution tests before removing old assumptions |
| UI copy and billing surfaces remain inconsistent after the rename | High | Medium | Search all `Free` and credit-related strings, update shared label helpers, and cover billing/landing tests with the new wording |
| Disabling BYO creates dead-end flows when gateway env is absent or incomplete | Medium | High | Use one canonical gateway-enabled check, fail closed on partial config, and keep explicit unavailable-state messaging in billing and automation flows |
| `Auto` semantics drift from the documented behavior | Medium | Medium | Centralize model-class resolution in one runtime helper, document that `auto` currently maps to `balanced`, and test the resolution contract directly |

## Definition of Done

- [ ] New orgs receive `Free trial` semantics with a one-time 20-credit allowance, while existing free orgs are unchanged.
- [ ] Automation configs persist `model_class`, existing configs are migrated to `auto`, and runtime resolves concrete model/provider/runner from env-backed classes.
- [ ] Runner harness selection and direct model picking are removed from product UI, and all surfaces use `Free trial` naming consistently.
- [ ] BYO is fully disabled when `KEPPO_LLM_GATEWAY_URL` is set, with correct runtime gating and updated copy.
- [ ] Landing page, billing/dashboard copy, tests, rules, specs, and `docs/setup.md` are updated to match the shipped behavior.

## Iteration Log

| Iteration | Timestamp | Summary | Commit | Errors/Issues |
| --------- | --------- | ------- | ------ | ------------- |
