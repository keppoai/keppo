# GitHub Workflow Rules

## Scope

Consult this file before changing GitHub Actions workflow structure, runner selection, reusable workflow defaults, or the label/selection contract for agent-driven issue and PR workflows.

## Runner selection rules

- Default GitHub Actions Linux jobs to `ubicloud-standard-2`, including lightweight control-plane work like labeling, commenting, prompt/context generation, metadata inspection, short-lived agent runs, and other orchestration work.
- Keep runner selection explicit when a job needs a different platform or image family, and document the reason in the same change.
- When a reusable workflow does not run E2E or another proven heavy path, keep `ubicloud-standard-2` unless the same change documents a concrete reason to use a different runner.

## Unified web deployment rules

- When CI validates the hosted web deployable, build the repo-root unified artifact with `pnpm run build:web` instead of treating dashboard and API builds as separate hosted units.
- Treat the unified `apps/web` build output as the deployable web artifact boundary for the Vercel web project; workspace export `dist/` directories may be uploaded alongside it as build inputs, not as independent deployables.
- Keep reusable workflow step names and artifact names explicit about that boundary so operators can tell whether a failure came from the unified web build, the non-E2E checks, or a browser shard.

## Coding-agent workflow contract

- `issue-agent.yml` and `fix-pr.yml` run in the `ai-bots` environment and require the repo/app credentials documented in `docs/setup.md`.
- `CODEX_AUTH_JSON` must contain a full working Codex CLI auth file, not a partial token fragment.
- `VERCEL_DEMO_BLOB_READ_WRITE_TOKEN` is only required when agent-driven PRs are expected to publish reviewer-facing demo videos.

## Label and agent-selection rules

- Issue labels: `/do-issue`, `/plan-issue`, `?agent:claude`, `?agent:codex`, `do-issue:pending|done|failed`, `plan-issue:pending|done|failed`, `prompt-injection-risk`.
- PR labels: `/fix-pr`, `?agent:claude`, `?agent:codex`, `fix-pr:pending|done|failed`, `/sync-pr`, `sync-pr:pending|failed`, `needs-human:review-issue`, `needs-human:final-check`.
- PR terminal labels (applied by pr-watcher): `pr=ready-to-merge`, `pr=needs-human-review`, `pr=max-auto-fix`. See `docs/specs/pr-workflow.md` for the full state machine.
- `no-pr-watcher` label opts a PR out of automated evaluation entirely.
- `pr-watcher.yml` runs in the `ai-bots` environment and requires `CLAUDE_CODE_OAUTH_TOKEN` for the Claude evaluation step.
- Issues default to Codex when neither agent label is present.
- If both issue agent labels are present, `/do-issue` creates two branches and two PRs, while `/plan-issue` posts two separate plan comments.
- PRs default to Codex when neither agent label is present.
- If both PR agent labels are present, `/fix-pr` fails closed because both agents cannot safely mutate the same PR branch at once.
