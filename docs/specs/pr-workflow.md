# PR Workflow — Automated State Machine

The **PR Watcher** (`pr-watcher.yml`) evaluates every open PR after reviews and CI complete, then drives it toward one of three terminal states. The goal is to get PRs into a mergeable state with minimal human intervention.

## Terminal Labels

| Label                   | Meaning                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `pr=ready-to-merge`     | All reviews pass, CI green, no unresolved threads. Ready for merge. |
| `pr=needs-human-review` | Has issues requiring human judgment that an agent cannot resolve.   |
| `pr=max-auto-fix`       | Exceeded 5 `/fix-pr` cycles without reaching a clean state.         |

## Architecture: Two-Pass Evaluation

The watcher uses a **two-pass** architecture:

1. **Pass 1 (deterministic):** `collect.mjs` collects all PR signals via GitHub APIs and handles clear-cut cases (draft, closed, terminal label already applied, fix-pr:failed, max attempts). For anything requiring judgment, it writes a context file and exits with `action=needs-evaluation`.

2. **Claude evaluation:** The workflow invokes Claude (via `claude-code-action`) with the context file. Claude reads the full review comments, CI status, and unresolved thread content, then classifies severity and decides the action. Claude is the **sole decision-maker** — there is no heuristic or regex-based parsing.

3. **Pass 2 (deterministic):** `apply-decision.mjs` reads Claude's decision file, validates it against an allowlist of actions/labels, and outputs the final action/label.

**Only HIGH severity issues block merge.** MEDIUM and LOW are informational — they are flagged but do not prevent merging or trigger auto-fix.

## Review Recommendations

Both Claude and Codex reviews emit a structured `**Recommendation:**` line in their comments:

| Value          | Meaning                                                 |
| -------------- | ------------------------------------------------------- |
| `ready`        | No HIGH issues. PR is ready to merge.                   |
| `auto-fix`     | All HIGH issues are mechanical — an agent can fix them. |
| `human-review` | At least one HIGH issue requires human judgment.        |

These are informational signals that Claude reads when making its decision. If missing (e.g. old prompt format), `validate-review.mjs` injects a `**Recommendation: human-review (default)**` fallback.

## Inputs

The evaluate script collects these signals into a context file for Claude:

| Signal                     | Source                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------- |
| Claude review comment body | Comment with `<!-- pr-review:claude -->` marker, authored by keppo-bot                |
| Codex review comment body  | Comment with `<!-- pr-review:codex -->` marker, authored by keppo-bot                 |
| CI / E2E status            | GraphQL `statusCheckRollup` for HEAD SHA                                              |
| Unresolved review threads  | GraphQL `pullRequest.reviewThreads` (paginated, filtered: not resolved, not outdated) |
| Fix-pr attempt count       | Timeline API: count of historical `/fix-pr` label additions                           |
| Fix-pr failure             | `fix-pr:failed` label                                                                 |

## State Machine

```
  PR opened / synchronize / ready_for_review
                    |
                    v
        +---------------------------+
        |  workflow_run triggers     |  PR Review + CI (PR)
        |  pr-watcher for each      |  complete for this SHA
        +-------------+-------------+
                      |
                      v
        +---------------------------+
        |  Guard: skip if           |
        |  - draft / closed         |
        |  - terminal label exists  |
        |  - /fix-pr or             |
        |    fix-pr:pending active  |
        |  - sibling workflow not   |
        |    yet complete           |
        +-------------+-------------+
                      |
                      v
        +---------------------------+
        |  1. fix-pr:failed?        |---YES---> pr=needs-human-review
        +-------------+-------------+           (escalate failed fix)
                      | NO
                      v
        +---------------------------+
        |  2. fix-pr count >= 5?    |---YES---> pr=max-auto-fix
        +-------------+-------------+
                      | NO
                      v
        +---------------------------+
        |  3. Collect & classify    |
        |     all signals           |
        +-------------+-------------+
                      |
                      v
        +---------------------------+
        |  4. Any auto-fixable?     |---YES---> /fix-pr
        |  (review=auto-fix OR      |
        |   CI failing OR           |
        |   unresolved bot threads) |
        +-------------+-------------+
                      | NO
                      v
        +---------------------------+
        |  5. Any human-review?     |---YES---> pr=needs-human-review
        |  (review=human-review OR  |
        |   unresolved human        |
        |   threads)                |
        +-------------+-------------+
                      | NO
                      v
                pr=ready-to-merge
```

## The Auto-Fix Loop

```
/fix-pr applied by pr-watcher
    |
    v
fix-pr.yml runs agent --> pushes commit for PR-related fixes
    |
    v
synchronize event --> re-triggers PR Review + CI
    |
    v
PR Review + CI complete --> re-triggers pr-watcher
    |
    v
pr-watcher re-evaluates with fresh signals
    |
    +-- mechanical issues remain + count < 5  --> /fix-pr again
    +-- only human issues remain              --> pr=needs-human-review
    +-- all clean                             --> pr=ready-to-merge
    +-- count hit 5                           --> pr=max-auto-fix
    +-- fix-pr:failed                         --> pr=needs-human-review
```

Within a `/fix-pr` pass, non-E2E CI failures remain mandatory fixes. Failing E2E checks are investigated first and only auto-fixed when they are plausibly caused by the PR. If an E2E failure is clearly unrelated to the PR diff, the responder should leave code unchanged for that failure and call it out in the summary PR comment instead of forcing a speculative fix.

When both mechanical and human-judgment issues exist, the watcher applies `/fix-pr` first. After the agent fixes the mechanical issues and a new review runs, only the human-judgment issues remain, and the next evaluation labels `pr=needs-human-review`.

## Decision Table

| Claude Rec   | Codex Rec    | CI   | Human Threads | Bot Threads | fix-pr count | Action                           |
| ------------ | ------------ | ---- | ------------- | ----------- | ------------ | -------------------------------- |
| ready        | ready        | pass | 0             | 0           | any          | `pr=ready-to-merge`              |
| ready        | ready        | pass | >0            | any         | any          | `pr=needs-human-review`          |
| ready        | ready        | fail | any           | any         | <5           | `/fix-pr`                        |
| auto-fix     | any          | any  | any           | any         | <5           | `/fix-pr`                        |
| any          | auto-fix     | any  | any           | any         | <5           | `/fix-pr`                        |
| human-review | human-review | pass | any           | 0           | any          | `pr=needs-human-review`          |
| human-review | any          | any  | any           | >0          | <5           | `/fix-pr` (fix bot issues first) |
| any          | any          | any  | any           | any         | >=5          | `pr=max-auto-fix`                |
| --           | --           | --   | --            | --          | failed       | `pr=needs-human-review`          |

**Priority order:** `fix-pr:failed` > `count >= 5` > `any auto-fixable` > `human-review only` > `ready-to-merge`

## Workflow Trigger Mechanics

`pr-watcher.yml` uses `workflow_run` triggered by both "PR Review" and "CI (PR)" completion. Since `workflow_run` fires per-workflow, the watcher runs twice per PR update. On the first trigger, it checks whether the sibling workflow has also completed for the same HEAD SHA — if not, it exits early. The second trigger finds both complete and evaluates.

## Skip Conditions

The watcher skips evaluation when:

- PR is draft or closed
- PR has the `no-pr-watcher` label (opt-out)
- PR already has a terminal label (`pr=ready-to-merge`, `pr=needs-human-review`, `pr=max-auto-fix`)
- `/fix-pr` or `fix-pr:pending` is active (let the current fix cycle finish)
- The sibling workflow (PR Review or CI) hasn't completed for this SHA yet
- PR author is not in the trusted allowlist
- No review comments with a valid `**Recommendation:**` line are found

## Relationship to Other Workflows

| Workflow               | Role                                                                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pr-review.yml`        | Runs Claude + Codex reviews, posts comments with verdict + recommendation                                                                                 |
| `ci-pr.yml`            | Runs lint, typecheck, build, E2E tests                                                                                                                    |
| `pr-watcher.yml`       | Reads review comments + CI status, applies terminal labels or `/fix-pr`                                                                                   |
| `fix-pr.yml`           | Triggered by `/fix-pr` label, runs agent to fix PR-related issues and notes clearly unrelated E2E failures in the summary comment instead of chasing them |
| `label-rebase-prs.yml` | Labels PRs with merge conflicts for rebase                                                                                                                |
| `codex-rebase.yml`     | Triggered by `/sync-pr` label, rebases PR onto main                                                                                                       |
