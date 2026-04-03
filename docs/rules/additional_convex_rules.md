# Additional Convex Rules

## Schema and indexes

- Do not use Convex-reserved index names: `by_id`, `by_creation_time`, or anything starting with `_`.
- For app-defined string IDs, use `by_custom_id`.
- Keep provider and enum validators explicit in `convex/schema.ts` and `convex/validators.ts`; do not make schema evaluation depend on runtime env.
- Convex-imported module filenames must use only alphanumerics, underscores, and periods.

## Runtime boundaries

- Files without `"use node"` must stay V8-safe and must not import Node-only dependencies.
- Keep browser-safe shared code and Convex-safe shared code on dedicated entrypoints; do not runtime-import the `@keppo/shared` package root from the dashboard.
- Keep `@keppo/shared` cross-package imports on explicit exported subpaths that map to concrete modules; keep guardrails aligned to the package export map rather than a stale barrel-era shortlist.
- Do not add passive barrel files or imports that resolve through passive barrels. Prefer concrete leaf modules, and only keep composition modules that build real runtime structures instead of re-exporting symbols.
- If Convex code in subdirectories needs shared helpers, prefer a `convex/*_shared.ts` bridge over deep relative imports into `packages/shared/src`.
- Keep Convex fixed-path files as wrappers only when Convex requires the filename; canonical runtime logic must live outside the wrapper.
- When a test or dashboard caller uses a fixed-path Convex reference like `"mcp:foo"` or `"e2e:bar"`, export that function from the top-level fixed-path module in the same change; helpers left only in submodules will fail at runtime even if TypeScript compiles.
- Test-only Convex helpers that mutate auth/session state must stay `internalQuery`/`internalMutation`; do not expose them as public functions guarded only by local or E2E env checks.
- In React code, do not create `makeFunctionReference(...)` objects inside hook dependency chains. Hoist stable Convex references to module scope when they are used in `useEffect`, `useCallback`, or `useMemo` dependencies.

## Boundary contracts

- Keep validators, public field mappers, and parse schemas close together and reuse them across API, Convex, and dashboard boundaries.
- Parse ingress payloads at the edge with the shared contract helpers (`parseApiBoundary`, `parseConvexPayload`, `parseWorkerPayload`, `parseJsonValue`) instead of open-coding `JSON.parse(...)` plus casts.
- Parse schemas must match the exact Convex return shape. Do not reuse a broader schema that requires fields the function does not return.
- When a Convex function declares a strict `returns` validator, return plain mapped objects rather than raw `ctx.db` documents.
- High-risk internal Convex boundaries must expose one canonical `*_shared.ts` arg contract surface with shared validators and builder helpers; do not duplicate scheduler/action payload object literals across `convex/` and `cloud/convex/`.
- Internal Convex function args stay camelCase (`runId`) even when adjacent HTTP payloads, audit payloads, or database fields intentionally remain snake_case (`automation_run_id`).
- Narrow casts that only bridge upstream SDK typing gaps are acceptable in provider adapters; do not spend the handwritten runtime debt budget on third-party client limitations when a shared boundary parser can remove the risk elsewhere.
- Keep idempotency checks and the guarded insert/update in the same Convex mutation transaction. Do not split a read-only existence check and the write across separate `runQuery`/`runMutation` calls.

## Client-visible errors

- Never throw plain `Error` from mutations/actions when the client needs to read the payload. Convex strips `Error.message` before it reaches the client, so structured data (error codes, counts, tiers) is lost.
- Use `ConvexError` from `convex/values` for any error the client must parse or display, such as tier limit errors (`AUTOMATION_LIMIT_REACHED`, `WORKSPACE_LIMIT_REACHED`, `MEMBER_LIMIT_REACHED`). `ConvexError` preserves its `.data` on the client.
- Plain `Error` is still fine for truly internal failures that the client should treat as opaque server errors.

## Scale and cleanup

- Multi-tenant maintenance and admin paths must use indexes plus explicit scan budgets.
- Avoid unbounded `.collect()` on hot or background paths when `.take(limit)` or pagination is possible.
- Never call `.paginate()` more than once in a single Convex query or mutation. Convex allows only one paginated query per invocation; bounded scans should use indexed `.take(limit)`, and full-table walks should carry cursors across separate function calls.
- If a query needs to filter by a field often enough to page or scan for it, denormalize that field into a first-class indexed column instead of filtering inside JSON payloads.
- Maintenance sweeps must process a bounded batch per invocation and requeue continuation work with `ctx.scheduler.runAfter(...)`; do not serialize multiple large backlogs into one cron/action tick and expect it to drain them inside a single 1s query/mutation budget.
- If a bounded maintenance sweep can skip rows inside a batch, continuation must advance with an indexed cursor or only requeue after confirmed progress; never reschedule solely because the batch filled.
- Parent deletes must explicitly cascade child rows; do not leave orphaned descendants.

## Provider registry guardrails

- Canonical provider IDs only. Do not reintroduce runtime aliases in control-plane code paths.
- Keep `providers` Convex-safe and `providers-ui` browser-safe.
- Do not eagerly read the provider registry at module top level in shared boundary code.
- When provider metadata changes, run `pnpm run check:provider-guardrails` and `pnpm run check:provider-registry-snapshot`.

## Type-safety gate

- Do not introduce `any` in TypeScript source code. Use `unknown`, specific types, or narrowly scoped `as unknown as T` casts instead.
- Keep `convex/e2e_*.ts` outside the production type-check gate, but still type-check them through the full Convex `tsgo` project; use a dedicated gate tsconfig instead of weakening the base Convex config.
- Handwritten runtime code must keep `ctx: any` / `c: any` at zero and keep high-risk boundary files free of `JSON.parse(...) as ...`.
