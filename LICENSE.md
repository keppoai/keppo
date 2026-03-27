# Licensing

Keppo uses a split-license model.

## Apache 2.0

Everything outside `cloud/` is licensed under the Apache License 2.0. This includes the dashboard, provider integrations, MCP transport, Convex schema, auth, local development tooling, and the fixed-path wrappers that bridge framework-owned entrypoints into the canonical runtime.

## FSL-1.1-Apache-2.0

The `cloud/` directory is licensed under the Functional Source License 1.1 with an Apache 2.0 future license ([`cloud/LICENSE`](cloud/LICENSE)). That directory is the canonical runtime source for metering, billing, managed execution, advanced gating, and remote sandbox orchestration.

## Runtime layout

- `cloud/` is imported through normal module boundaries at runtime. There is no filesystem overlay or copy step during build, dev, test, or deploy.
- `convex/` and `apps/web/app/lib/server/api-runtime/` keep stable filenames where Convex or routing expects them, but those files now stay thin wrappers around the canonical runtime modules.
- `packages/shared/src/` remains the canonical shared-domain surface used by both Apache and FSL codepaths.

See [docs/setup.md](docs/setup.md) for the normal build and deployment flow.
