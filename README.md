# Keppo

Keppo is an open-source AI automation platform built for workflows that need clear controls, human review, and auditability.

It helps teams connect tools, run automations, gate risky actions behind approvals or rules, and keep operators in control of what AI systems are allowed to do.

## What Keppo does

Keppo acts as a **control plane** for workspace-scoped automation: integrations with external tools, policy and approvals before side effects, billing limits where relevant, and audit trails so teams can see what ran and why. The product emphasizes **safety and governance**—deterministic rules, human-in-the-loop gates for risky operations, and boundaries between orgs and workspaces so credentials and policy stay isolated.

At a high level, durable application state and real-time UI updates live on **Convex**; the shipped **TanStack Start** app in `apps/web` owns the dashboard, public docs, and the same-origin HTTP surface for MCP, OAuth, webhooks, and other ingress. Shared contracts and provider metadata live in **`packages/shared`**; managed-runtime modules for hosted scenarios live under **`cloud/`**. For a precise map of components and boundaries, see [`docs/specs/high-level-architecture.md`](docs/specs/high-level-architecture.md).

## Repository layout

| Path | Role |
| --- | --- |
| [`apps/web`](apps/web) | Browser UI, routes, typed server functions, and unified HTTP/runtime boundary (API, MCP, OAuth, webhooks, docs). |
| [`convex`](convex) | Schema, queries/mutations, cron, auth, workspaces, rules, approvals, automations, billing, notifications, audit. |
| [`packages/shared`](packages/shared) | Provider registry, SDK adapters, boundary contracts, billing/policy helpers, Code Mode utilities. |
| [`cloud`](cloud) | Canonical modules for billing, scheduling, advanced gating, and hosted sandbox integrations (see licensing below). |
| [`docs`](docs) | Setup, specs, and engineering rules for contributors. |

## Learn more

- Product docs: [keppo.ai/docs](https://keppo.ai/docs)
- Local setup and development: [`docs/setup.md`](docs/setup.md)
- Repository specs: [`docs/specs/README.md`](docs/specs/README.md)
- Engineering rules and guardrails: [`docs/rules/`](docs/rules)

## Quick start (local)

From the repo root, after configuring env (see [`docs/setup.md`](docs/setup.md)):

```bash
pnpm install
pnpm run dev
```

The app and docs are served on port **3000** by default (e.g. dashboard at `/`, docs at `/docs`).

## What you’ll find here

- The Keppo application code (web app, Convex backend, shared packages)
- Self-hosted and local-development setup in [`docs/setup.md`](docs/setup.md)
- Contributor documentation for architecture, testing, security, and workflow rules

## License

- Repository default license: Apache License 2.0 (`LICENSE`)
- Web app license: Apache License 2.0 (`apps/web/package.json`)
- Cloud runtime license: Functional Source License 1.1 with Apache 2.0 future license (`cloud/LICENSE`)
- [`LICENSE.md`](LICENSE.md) describes the Apache-licensed repo surface and the canonical FSL runtime modules under `cloud/`
