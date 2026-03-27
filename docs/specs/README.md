# Keppo Specs

This directory is the concise canonical spec for the implemented product.

Code remains the source of truth when drift is found. Operator setup and deployment steps live in `docs/setup.md`, while change guardrails live in `docs/rules/*`.

## Maintenance Rules

- Keep these docs aligned to shipped behavior in the repo.
- Prefer source-of-truth file references over speculative prose.
- Remove roadmap, example, or open-question content instead of letting it drift.
- Update this index and the matching table in `AGENTS.md` whenever files change.

## Table of Contents

| File                                         | Section                                   |
| -------------------------------------------- | ----------------------------------------- |
| `docs/specs/high-level-architecture.md`      | High-level architecture                   |
| `docs/specs/core-domain-model.md`            | Core domain model                         |
| `docs/specs/mcp-protocol-handling.md`        | MCP surface and protocol handling         |
| `docs/specs/control-plane-api.md`            | Control-plane API                         |
| `docs/specs/execution-workers-connectors.md` | Execution workers, queues, and connectors |
| `docs/specs/dashboard-ux.md`                 | Dashboard UX                              |
| `docs/specs/security-model.md`               | Security model                            |
| `docs/specs/testing-strategy.md`             | Testing strategy                          |
| `docs/specs/pr-workflow.md`                  | PR workflow automated state machine       |
