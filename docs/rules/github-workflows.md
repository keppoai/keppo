# GitHub Workflow Rules

## Scope

Consult this file before changing GitHub Actions workflow structure, runner selection, reusable workflow defaults, or the label/selection contract for agent-driven issue and PR workflows.

## Runner selection rules

- Default non-E2E GitHub Actions Linux jobs to `ubuntu-latest`, including lightweight control-plane work like labeling, commenting, prompt/context generation, metadata inspection, short-lived agent runs, and other orchestration work.
- In `e2e-shared.yml`, use `ubuntu-latest` for the Checks and Report jobs; use `namespace-profile-linux-medium` for Local Convex and Playwright E2E shard jobs. Use `namespace-profile-linux-medium` for `claude-deflake-e2e.yml`.
- Keep E2E meta coverage folded into `e2e-shared.yml`: browser meta specs belong in the normal Playwright lane, and non-browser E2E infra/authoring checks belong in the shared Checks job. Do not reintroduce a standalone `e2e-meta.yml` workflow.
- Use `ubicloud-standard-2` for other workflows that orchestrate, gate, or accompany E2E (e.g. `ci-pr.yml` check/result jobs, `fix-pr.yml`, `get-main-to-green.yml`, `issue-agent-issue-to-pr.yml`, `codex-commit-review.yml`).
- Keep runner selection explicit when a job needs a different platform or image family, and document the reason in the same change.

## Unified web deployment rules

- When CI validates the hosted web deployable, build the repo-root unified artifact with `pnpm run build:web` instead of treating dashboard and API builds as separate hosted units.
- Treat the unified `apps/web` build output as the deployable web artifact boundary for the Vercel web project; workspace export `dist/` directories may be uploaded alongside it as build inputs, not as independent deployables.
- Keep reusable workflow step names and artifact names explicit about that boundary so operators can tell whether a failure came from the unified web build, the non-E2E checks, or a browser shard.

## Coding-agent workflow contract

- `issue-agent.yml` and `fix-pr.yml` run in the `ai-bots` environment and require the repo/app credentials documented in `docs/dev-setup.md`.
- `fix-pr.yml` must treat failing E2E checks as "fix only when PR-related": the agent still investigates them, but failures that are clearly unrelated to the PR diff should be reported in the PR summary comment instead of forcing speculative code changes.
- `CODEX_AUTH_JSON` must contain a full working Codex CLI auth file, not a partial token fragment.
- Codex workflows may optionally accept a two-secret rotation pool through `CODEX_AUTH_JSON_1` and `CODEX_AUTH_JSON_2`; each populated secret must also contain a full working auth file, and the workflow helper should randomly choose one non-empty unique entry per run.
- `gh-copilot` issue-agent runs require a fine-grained PAT with the `Copilot Requests` permission exposed to the workflow as `COPILOT_GITHUB_TOKEN`.
- `VERCEL_DEMO_BLOB_READ_WRITE_TOKEN` is only required when agent-driven PRs are expected to publish reviewer-facing demo videos.
- For workflow-authored PR or issue comments, prefer a scoped GitHub App token over user PAT secrets. When the workflow writes PR conversation comments through the issues API, mint the token with `issues: write` explicitly instead of assuming `pull-requests: write` is sufficient.

## Label and agent-selection rules

- Issue labels: `/do-issue`, `/plan-issue`, `?agent:claude`, `?agent:codex`, `?agent:gh-copilot`, `do-issue:pending|done|failed`, `plan-issue:pending|done|failed`, `prompt-injection-risk`.
- PR labels: `/fix-pr`, `?agent:claude`, `?agent:codex`, `fix-pr:pending|done|failed`, `/sync-pr`, `sync-pr:pending|failed`, `needs-human:review-issue`, `needs-human:final-check`.
- PR terminal labels (applied by pr-watcher): `pr=ready-to-merge`, `pr=needs-human-review`, `pr=max-auto-fix`. See `docs/specs/pr-workflow.md` for the full state machine.
- `no-pr-watcher` label opts a PR out of automated evaluation entirely.
- `pr-watcher.yml` runs in the `ai-bots` environment and requires `CLAUDE_CODE_OAUTH_TOKEN` for the Claude evaluation step.
- Issues default to Codex when no issue agent label is present.
- If multiple issue agent labels are present, `/do-issue` creates one branch and PR per selected agent, while `/plan-issue` posts one plan comment per selected agent.
- PRs default to Codex when neither agent label is present.
- If both PR agent labels are present, `/fix-pr` fails closed because both agents cannot safely mutate the same PR branch at once.
