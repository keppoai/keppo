# Keppo

**Open-source AI automation with human-in-the-loop controls.**

Keppo helps teams connect tools, run automations, and gate risky actions behind approvals or rules — so operators stay in control of what AI systems are allowed to do.

## Quick Start

```bash
pnpm install
pnpm run dev          # Convex + TanStack Start app on :3000
```

See [`docs/setup.md`](docs/setup.md) for prerequisites, environment variables, and full setup details.

## Documentation

| Resource | Description |
| --- | --- |
| [Product docs](https://keppo.ai/docs) | End-user and product documentation |
| [`docs/setup.md`](docs/setup.md) | Local development and self-hosted setup |
| [`docs/specs/`](docs/specs/README.md) | Architecture and design specs |
| [`docs/rules/`](docs/rules) | Engineering rules and guardrails |

## Repository Layout

| Directory | Purpose |
| --- | --- |
| `apps/web/` | TanStack Start dashboard and API surface |
| `convex/` | Convex backend — schema, functions, and queries |
| `cloud/` | Managed runtime modules (billing, scheduling, gating) |
| `packages/shared/` | Shared domain logic used across workspaces |

## License

Most of the repository is licensed under **Apache 2.0**. The `cloud/` directory uses the **Functional Source License 1.1** with an Apache 2.0 future license. See [`LICENSE.md`](LICENSE.md) for full details.
