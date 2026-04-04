# GitHub Label Workflows

This document defines the naming scheme for GitHub issue and pull request labels that trigger or track workflow automation.

## Naming Rules

- `/...` means a human-applied trigger label that starts automation.
- `?agent:...` means a human-applied routing label that selects which agent should run.
- `<workflow>:pending|done|failed` means a workflow-owned status label.
- `needs-human:*` means automation stopped and a maintainer needs to intervene.
- Safety labels may use a standalone descriptive name when they are not part of a broader workflow-state family.

## Current Scheme

### Trigger labels

- `/do-issue`
- `/plan-issue`
- `/fix-pr`
- `/sync-pr`

### Agent selection labels

- `?agent:claude`
- `?agent:codex`
- `?agent:gh-copilot` (issues only)

### Issue workflow state labels

- `do-issue:pending`
- `do-issue:done`
- `do-issue:failed`
- `plan-issue:pending`
- `plan-issue:done`
- `plan-issue:failed`

### PR-fix labels

- `fix-pr:pending`
- `fix-pr:done`
- `fix-pr:failed`

### PR-rebase labels

- `sync-pr:pending`
- `sync-pr:failed`

### Human-attention labels

- `needs-human:review-issue`
- `needs-human:final-check`

### Safety label

- `prompt-injection-risk`

## Notes

- The `/...` prefix is reserved for labels a human intentionally applies to start a workflow.
- Workflow-owned labels should not use the `/` prefix.
- `/fix-pr` is single-shot. If a maintainer wants another automated pass after CI updates, they re-apply `/fix-pr` manually.
- `sync-pr` currently has `pending` and `failed` labels but no `done` label. Success is represented by clearing the workflow-owned rebase labels.
- Legacy trigger labels are no longer supported. Use only the current workflow labels documented here.
