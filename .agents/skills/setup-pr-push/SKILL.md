---
name: setup-pr-push
description: Print the full host-side `scripts/pr.sh` command needed to create or switch to a feature branch, commit current changes, push, and open or update a PR outside the Docker sandbox using explicit flag-style inputs.
---

# Setup PR Push

Use this skill when the user wants the exact host-side command for the full git handoff flow: branch setup, commit, push, and PR creation or update.

## Workflow

1. Use the checked-in host-side entrypoint:
   ```bash
   bash scripts/pr.sh \
     --branch-name "<branch name>" \
     --commit-message "<commit message>" \
     --title-file /absolute/path/to/pr-title.txt \
     --summary-file /absolute/path/to/pr-summary.txt \
     --rationale-file /absolute/path/to/pr-rationale.txt
   ```
2. Print the full command for the user instead of creating a local wrapper file.
3. Tell the user to run that command outside the Docker sandbox when they need GitHub host credentials.

## Command Format

```bash
bash scripts/pr.sh \
  --branch-name "<branch name>" \
  --commit-message "<commit message>" \
  --title-file /absolute/path/to/pr-title.txt \
  --summary-file /absolute/path/to/pr-summary.txt \
  --rationale-file /absolute/path/to/pr-rationale.txt
```

If invoked from `main` or `master`, the script creates or switches to the branch named by `--branch-name` before committing.

## Notes

- The script uses the explicit `--branch-name` flag for branch creation or branch switching.
- The script stages and commits via the existing [commit.sh](../commit/scripts/commit.sh) helper, then delegates push and PR creation to the existing [pr_push.sh](../pr-push/scripts/pr_push.sh) helper.
- The skill should print the final command with the user's actual paths and message values filled in.
