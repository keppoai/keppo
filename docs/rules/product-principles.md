# Product Principles

These principles guide product-level decisions when resolving ambiguous or subjective PR feedback. When a review comment involves a judgment call, agents should consult these principles before flagging for human review.

## Principle #1: Security First

Security is non-negotiable. Always prefer the more secure option. Fail closed rather than open. Never expose secrets, tokens, or internal error details to end users. Consult `docs/rules/security.md` for specific guardrails.

## Principle #2: Convex-First Boundaries

Respect the Convex-first architecture. Keep business logic in Convex functions, not in API routes or the dashboard. Follow the boundary rules in `docs/specs/high-level-architecture.md`. Do not bypass Convex for direct database access.

## Principle #3: Safety Gate Integrity

The safety classification and gating system is a core product differentiator. Never weaken, bypass, or skip safety gates. When in doubt about whether an action should be gated, gate it. See `docs/specs/core-domain-model.md`.

## Principle #4: Operator Transparency

Operators (Keppo users) should always understand what their AI agents are doing. Prefer explicit audit trails, clear approval flows, and visible action logs over silent or implicit behavior. Never hide agent actions from the operator.

## Principle #5: Provider Fidelity

When integrating with external providers (Gmail, Stripe, Notion, etc.), faithfully implement the provider's SDK and API contracts. Do not invent abstractions that mask provider behavior. See `docs/rules/provider_sdk_fidelity.md`.

## Principle #6: Error Clarity

Error messages should be human-readable, actionable, and honest. Include stable machine-readable identifiers for programmatic handling. Collapse verbose operator details behind expandable sections. See `docs/rules/error-messaging.md`.

## Principle #7: Simple Over Clever

Prefer straightforward implementations over clever optimizations. Code should be readable by the next person. Avoid premature abstractions, unnecessary indirection, and "framework-itis." Three similar lines are better than one abstraction used three times.

## Principle #8: Test What Matters

Write tests that catch real bugs, not tests that assert implementation details. E2E tests should be deterministic and stable. Unit tests should cover business logic, not framework glue. See `docs/rules/e2e_testing.md` and `docs/rules/non_e2e_testing.md`.

## Principle #9: Spec-Code Sync

Specs and code must stay in sync. Any behavior change must update the relevant spec. Any spec change should be reflected in code. Never let drift accumulate. See the specs table of contents in `AGENTS.md`.

## Principle #10: UX Polish

UI changes should follow the UX rules for animations, forms, accessibility, typography, and visual consistency. Do not ship half-polished UI. See `docs/rules/ux.md`.
