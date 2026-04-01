---
name: keppo:check-workflows
description: Review recent GitHub Actions workflow runs, separate expected noise from actionable failures, and write a machine-readable workflow health report for deterministic post-agent issue handling.
---

# Check Workflows

Review recent GitHub Actions workflow runs from the last N hours and write a JSON report to the path in `$WORKFLOW_HEALTH_REPORT_PATH`.

## Arguments

- `$ARGUMENTS`: optional lookback window in hours. Default to `24` when it is missing or invalid.

## Rules

- Use `gh run list` and `gh run view` with the provided read-only GitHub token. Do not create issues, comments, labels, or any other GitHub mutations directly.
- Ignore expected failures:
  - cancelled runs from concurrency
  - `action_required` or `neutral` conclusions
  - CI failures on non-`main` branches
  - CLA failures
  - downstream artifact/report workflows that only failed because CI failed first
  - one-off transient failures that clearly passed on retry
- Flag actionable failures:
  - permission or auth problems
  - repeated configuration errors
  - repeated infrastructure failures
  - repeated rate limiting
  - 2 or more consecutive `main` branch CI failures with the same root cause
  - failing scheduled workflows that look systemic
- Base the result on concrete evidence from failed logs. Quote short error fragments only when needed.

## Required process

1. List recent runs:

```bash
gh run list --limit 100 --json workflowName,status,conclusion,event,headBranch,createdAt,databaseId,url,name
```

2. Keep only runs inside the lookback window. Group them by workflow name.
3. For each potentially actionable failure, inspect details:

```bash
gh run view <run_id> --log-failed
```

4. Decide whether the repo is healthy.

## Output contract

Always write exactly one JSON object to `$WORKFLOW_HEALTH_REPORT_PATH`.

If no actionable issue exists:

```json
{
  "status": "healthy",
  "summary": "Markdown summary of what was checked and why no issue is needed."
}
```

If an actionable issue exists:

```json
{
  "status": "action_required",
  "summary": "Markdown summary of the actionable problems.",
  "issue": {
    "dedupeKey": "stable-kebab-case-key-for-this-problem-cluster",
    "title": "Concise issue title naming the workflow problem",
    "body": "Markdown issue body for a newly created issue.",
    "updateComment": "Markdown comment to post when an open issue with the same dedupe key already exists."
  }
}
```

## Report guidance

- `dedupeKey` must stay stable for the same underlying problem cluster.
- `summary` should state:
  - time window checked
  - number of runs reviewed
  - expected failures ignored
  - actionable failures found, if any
- `body` and `updateComment` should include:
  - affected workflows
  - failed run links
  - the most likely root cause
  - why it is actionable
  - suggested next step
