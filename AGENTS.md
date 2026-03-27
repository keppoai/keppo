# Agent Guidelines

## Rules

- [Convex rules](docs/rules/convex_rules.md) — Convex development guidelines. These rules come directly from Convex https://docs.convex.dev/ai#convex-ai-rules. Do NOT modify this file.
- [Additional Convex rules](docs/rules/additional_convex_rules.md) — reserved index names, naming conventions. These are additional rules that we have developed to supplement Convex rules. It is OK to modify this file.
- [E2E testing rules](docs/rules/e2e_testing.md) — deterministic end-to-end testing and snapshot stability guidance.
- [Non-E2E testing rules](docs/rules/non_e2e_testing.md) — fast-layer ownership, rendered dashboard harness rules, and authoring guardrails for Vitest/API/Convex/local-Convex tests.
- [Provider SDK fidelity rules](docs/rules/provider_sdk_fidelity.md) — migration checklist and contract requirements for SDK-backed provider connectors and fakes.
- [Billing rules](docs/rules/billing.md) — subscription tier, Stripe lifecycle, and usage metering guardrails.
- [Notification rules](docs/rules/notifications.md) — notification event dedup, delivery lifecycle, endpoint preferences, and unread badge behavior.
- [Environment/runtime rules](docs/rules/env_runtime.md) — local Convex env sync, dotenvx secret handling, Better Auth vs integration env, and provider configuration visibility rules.
- [Security rules](docs/rules/security.md) — fail-closed auth, secret handling, proxy/header trust, request limits, public diagnostics, outbound networking, sandbox isolation, and security verification guardrails. **Must be consulted before any auth, API boundary, webhook, sandbox, billing, or runtime-security change**.
- [GitHub workflow rules](docs/rules/github-workflows.md) — runner selection, workflow structure defaults, and reusable workflow guidance for GitHub Actions changes.
- [GitHub workflow security rules](docs/rules/github-security.md) — trusted-vs-untrusted workflow boundaries, agent-writable workspace isolation, post-agent helper refresh rules, and GitHub credential scoping for agent-running workflows. **Must be consulted before changing any GitHub Actions workflow that runs Claude, Codex, or other coding agents**.
- [Error messaging rules](docs/rules/error-messaging.md) — human-first error copy, stable machine-readable identifiers, collapsed operator details, and public-route sanitization policy.
- [UX rules](docs/rules/ux.md) — animations, forms, touch/accessibility, typography, visual polish, and performance best practices. **Must be consulted before any frontend/UI/UX change** — read the full file, not just the section you think applies.
- [Product principles](docs/rules/product-principles.md) — high-level product decision-making principles used by the PR review responder to autonomously resolve ambiguous or subjective feedback.
- [docs/setup.md](docs/setup.md) — authoritative, self-hosted setup and deployment reference for this app. Any change that affects required runtime behavior (OAuth providers, ports, environment variables, callbacks, auth flow, database/runtime dependencies, or external integrations) must be reflected here immediately so others can run Keppo independently.

### E2E Testing

- **Do NOT run the full E2E test suite locally.** It takes 25+ minutes locally but <10 minutes on GitHub Actions thanks to sharding.
- To validate E2E: push your branch to a PR using the `$pr-push` skill, then monitor the GitHub Actions checks. Use **Monitoring CI** intervals below to poll for results.
- **Targeted local runs only:** If you need to debug or fix a specific test failure, run only the relevant test file(s) locally by forwarding Playwright CLI args (e.g. `pnpm run test:e2e:base -- tests/e2e/specs/foo.spec.ts`). You can also pass additional Playwright CLI flags this way (e.g. `pnpm run test:e2e:base -- tests/e2e/specs/foo.spec.ts --headed`). Never run the entire suite.
- NEVER run E2E tests inside the Codex sandbox. Run them unsandboxed or with the required escalation because the local E2E stack does not behave correctly in the sandbox.

### Committing Changes

- Use the `$commit` skill to save work whenever meaningful changes are made and are known to be good.
- Before any commit, verify you are not on the `main` branch. If you are on `main`, create and switch to a feature branch before committing.
- Do not let good work sit uncommitted. Commit early and often at natural checkpoints.
- **Always commit Convex generated files.** `convex/_generated/` is checked into the repo and required for type-checking (`pnpm check`) and CI to pass. When these files change, stage and commit the updated outputs alongside your source changes.

### Skipping automated review

Add `#skip-bugbot` or `#skip-bb` to the PR description for trivial PRs that won't affect end-users, such as:

- Claude settings, commands, or agent configuration
- Linting or test setup changes

### Monitoring CI

- When polling GitHub Actions, never sleep more than **3 minutes** between checks. Prefer shorter intervals (60–90 seconds) so you can react to failures quickly.

### UX Validation

- When making UI/UX changes, validate them visually by taking a screenshot via the relevant E2E test (create a disposable E2E test if needed).
- Store screenshots in `ux-artifacts/` with a descriptive name (e.g. `ux-artifacts/settings-dark-mode.png`).
- Screenshots are for visual verification only — do NOT use them as test assertions.
- After capturing the screenshot, spin up a background agent to critique it using the `$design-critique` skill. Provide the agent with:
  1. **Screenshot path** — the `ux-artifacts/` file to read.
  2. **Context** — what screen/component this is, who the user is, and what task they're performing.
  3. **Focus/goal** — what specifically changed and what you want validated (e.g. "added empty state illustration", "redesigned the settings form layout").
- Act on ALL issues the critique surfaces — structural, behavioral, and visual — before committing. Do not defer visual polish.

### PR Demo Videos

- Before creating or updating any PR demo video, check the `KEPPO_SKIP_DEMO_VIDEO` environment variable. If it is `true`, do not create the demo video and do not leave the demo comment.
- When a PR includes significant UI or product behavior changes, create a short demo video with the `$create-video-demo` skill for the initial PR and for any later push that materially changes the demonstrated behavior.
- Prefer recording an existing targeted Playwright spec. If no existing spec cleanly shows the change, create a disposable one-off Playwright spec just for the demo.
- Keep the recorded demo under **60 seconds** and store the exported file under `ux-artifacts/video-demos/`.
- Upload reviewer-facing demo videos to Vercel Blob using `VERCEL_DEMO_BLOB_READ_WRITE_TOKEN`. Treat them as public artifacts and do not upload sensitive recordings.
- After pushing the branch or updating the PR, leave a top-level PR comment with the hosted demo URL. The comment must start with `Demo at commit {hash}` and include a 1-2 sentence summary of what the video shows.
- If the PR does not include significant UI or product-facing changes, skip the demo comment.

### Handling Review Feedback

- **Fix all reasonable suggestions, regardless of severity.** Do not dismiss MEDIUM or LOW issues as "informational" to avoid work. If a reviewer points out a real bug, missing edge case, performance issue, or code quality problem — fix it. The only valid reasons to skip a suggestion are: (1) it's factually wrong, (2) it conflicts with project requirements, or (3) it's a pure feature request that belongs in a separate PR.
- **Do not resolve review threads without addressing them.** Resolving a thread means the issue is handled — either with a code change or a substantive explanation of why the suggestion doesn't apply. "MEDIUM doesn't block merge" is not a reason to skip fixing a valid issue.
- **Complete all related work in the same change.** When making a change, update all affected files: rules, specs, AGENTS.md indexes, doc cross-references, and tests. Do not leave loose ends for follow-up. If you add a new rules file, add the AGENTS.md entry in the same commit. If you add a new spec, update both spec indexes.
- **Do not narrate what you plan to do — just do it.** If the fix is straightforward, make it. Do not explain why you're going to skip it, defer it, or treat it as a future enhancement when it can be done now.

### Rule Capture

- When a bug fix reveals a reusable engineering/testing lesson, add or update a rule in `docs/rules/` in the same change.
- Prefer a focused rules file per domain (for example `e2e_testing.md`) and keep `AGENTS.md` Rules list in sync.
- Never modify generated `dist/` artifacts directly. Implement changes in source files and run the appropriate build/recompile steps to regenerate outputs.
- After changing files under `packages/shared/src/` that are consumed via `@keppo/shared` package exports, rebuild the package with `cd packages/shared && pnpm build` before relying on downstream app or Convex tests. This avoids stale `packages/shared/dist/` artifacts masking or invalidating local verification.

## Specs

- Keep implementation and specs in sync. Any behavior, architecture, API, schema, integration, security, or runtime change must update relevant spec file(s) in the same change.
- Keep the spec tables of contents in `AGENTS.md` and `docs/specs/README.md` up to date whenever `docs/specs/` files are added, removed, renamed, or reordered.
- Do not leave spec drift. If code and spec conflict, resolve the conflict immediately as part of the same task.

### Specs Table of Contents

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
