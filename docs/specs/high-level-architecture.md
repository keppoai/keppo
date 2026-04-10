# High-level architecture

Keppo is a safety-first, Convex-first control plane for workspace-scoped MCP access, provider actions, and sandboxed automations. Durable state, live queries, and most control-plane mutations live in `convex/`, while TanStack Start in `apps/web` owns the shipped browser and HTTP runtime boundary.

These specs summarize implemented behavior only. Code is the source of truth when drift is found.

## Goals and boundaries

- Give each org and workspace isolated credentials, policy, audit, and automation boundaries.
- Gate risky writes through deterministic rules, approvals, billing limits, and audit trails before execution.
- Keep the operator UI real-time by making Convex the primary application backend.
- Keep secret-bound, protocol-bound, and external ingress handling in the unified web runtime instead of duplicating business logic across REST layers.
- No legacy `/v1` API compatibility layer, no speculative roadmap prose in specs, and no flat-file runtime state outside Convex-backed application data.

## Convex-first decision

- Convex owns durable domain state, real-time reads, and most business mutations.
- `apps/web` owns the shipped HTTP/runtime boundary, browser shell, typed app-internal server functions, and the same-origin/root route families that bridge external protocols into Convex.
- `packages/shared` defines provider metadata, typed boundary contracts, connector helpers, billing/policy helpers, and Code Mode utilities consumed across runtimes.
- `cloud` contains canonical managed-runtime modules that framework-owned entrypoints import through fixed seams instead of source overlays.
- Business logic does not bypass Convex for direct database access from the browser or API routes.
- Cross-runtime imports must target explicit concrete modules or curated subpath exports. Passive `index.ts` and package-root barrel aggregation are not part of the supported boundary model.

## Main parts

- `apps/web`: TanStack Start application that owns the browser shell, route tree, public docs surface, typed app-internal server functions, and same-origin runtime boundary for approvals, rules, integrations, automations, billing, audit, health, settings, and custom MCP servers. The public marketing/docs surface lives on `/` and `/docs/**`, with built-in docs search served from `/api/search`.
- `convex/*`: schema, auth bootstrap, workspaces, integrations, rules, approvals, automations, billing, notifications, audit, cron, and feature flags.
- `apps/web/app/lib/server/api-runtime`: app-owned server/runtime helper library for request parsing, env/auth helpers, logging, rate limiting, sandbox helpers, and other transport-agnostic server utilities used by Start-owned handlers.
- `packages/shared`: provider registry, SDK adapters and fakes, domain enums, boundary contracts, billing/policy helpers, and Code Mode tooling.
- `cloud/*`: canonical managed-runtime modules for billing, scheduler, Vercel sandbox execution, and cloud-only adapters that fixed entrypoints import at runtime.

## Ownership model

- Browser to Convex: normal product data and real-time UI updates.
- Browser to Start server functions: typed same-origin app-internal operations for session-bound billing, invite, integration, automation, push, and admin health flows.
- Browser to Start server routes: same-origin `/api/*`, `/mcp/*`, `/oauth/*`, `/webhooks/*`, and `/internal/*` ingress directly owned by the unified web runtime.
- Provider-trigger automations are split across three seams: provider modules declare trigger schemas and lifecycle hooks, Convex persists trigger definitions and delivery history and runs reconciliation/dispatch, and the dashboard renders provider-owned authoring controls and diagnostics from those shared contracts.
- API to Convex: persistence, policy decisions, audit/notification writes, and workspace lookups.
- Convex/API to providers and sandboxes: external execution only after policy and billing checks.
- Hosted bundled AI generation and runtime flow through the Dyad gateway for canonical spend tracking; Convex mirrors the resulting credit consumption back into org-scoped allowance/purchased balances for UI and enforcement.
- Boundary parsing is shared-first: API ingress, Convex worker payloads, web-app read models, and cloud overlays decode JSON and validate payloads through the shared Zod contract layer in `packages/shared/src/contracts`.

## Repository ownership

| Area                                  | Owns                                                                                                                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                            | TanStack Start browser UI, route tree, typed server functions, and Start-owned same-origin/root routes                                                            |
| `apps/web/app/lib/server/api-runtime` | Shared server-only helpers, request/runtime utilities, and source-owned server seams still used by the unified web runtime                                        |
| `cloud`                               | Canonical managed-runtime modules for billing, scheduling, advanced policy/gating, and remote sandbox integrations                                                |
| `convex`                              | Schema, live queries/mutations/actions, cron jobs, auth bootstrap, audit/notification state, billing state, rules, approvals, automations, and tenant-scoped data |
| `packages/shared`                     | Canonical provider registry, SDK adapters/fakes, domain enums, typed boundary contracts, billing/policy helpers, and Code Mode utilities                          |
| `tests` and `scripts`                 | Cross-stack verification, provider conformance, E2E infrastructure, and guardrail checks                                                                          |

## Consequences

- Dashboard features can ship without parallel REST CRUD surfaces.
- Server routes stay focused on ingress validation, auth/session handling, and bridging external protocols into Convex.
- Shared contracts catch schema drift at runtime boundaries instead of ad hoc per-route parsing.
- Privileged operations stay server-side; the browser never receives provider secrets or internal keys.
- Dependency edges remain visible at runtime boundaries, which reduces accidental Node-only imports into browser-safe or Convex-safe modules.

## Source-of-truth files

- Schema: `convex/schema.ts`
- Start route registration: `apps/web/app/routes/**`
- Start server entry and protocol dispatch: `apps/web/src/server.ts`, `apps/web/src/lib/unified-protocol-boundary.ts`
- Public docs content and metadata: `apps/web/content/docs/**`, `apps/web/source.config.ts`
- Public docs source/layout wiring: `apps/web/src/lib/docs/source.ts`, `apps/web/src/lib/docs/layout.tsx`
- Provider registry: `packages/shared/src/providers/modules/index.ts`
- Provider inventory snapshot: `packages/shared/provider-registry.snapshot.json`
