---
name: pr-rebase
description: Rebase the current branch on the latest upstream changes, resolve conflicts, and push.
---

# PR Rebase

Rebase the current branch on the latest upstream changes, resolve conflicts, and push.

## Instructions

1. **Determine the PR base branch and git remote setup:**

   If an argument was provided, treat it as the PR number or URL. Otherwise use the current branch's PR.

   ```
   if [ -n "${ARGUMENTS:-}" ]; then
     gh pr view "${ARGUMENTS}" --json number,baseRefName,url --jq '.'
   else
     gh pr view --json number,baseRefName,url --jq '.'
   fi
   git remote -v
   git branch -vv
   ```

   Capture the PR base branch from `baseRefName`, store it in `BASE_BRANCH`, and use it for every fetch/rebase step below.

   In GitHub Actions for cross-repo PRs:
   - `origin` points to the **head repo** (fork) - this is where you push
   - `upstream` points to the **base repo** - this is what you rebase onto

   For same-repo PRs, `origin` points to the main repo and there may be no `upstream`.

2. **Fetch the latest changes:**

   ```
   git fetch --all
   ```

3. **Rebase onto the PR base branch:**

   Use an explicit `if`/`else`. Do not use `A && B || C` for this step because a merge-conflict exit code must not start a second rebase command.

   ```
   if git remote get-url upstream >/dev/null 2>&1; then
     git rebase "upstream/${BASE_BRANCH}"
   else
     git rebase "origin/${BASE_BRANCH}"
   fi
   ```

4. **If there are merge conflicts:**
   - Identify the conflicting files from the rebase output
   - Read each conflicting file and understand both versions of the changes
   - Resolve the conflicts by editing the files to combine changes appropriately
   - Stage the resolved files:

     ```
     git add <resolved-file>
     ```

   - Continue the rebase:

     ```
     git rebase --continue
     ```

   - Repeat until all conflicts are resolved and the rebase completes

5. **Run checks and push the rebased branch:**

   Run the full check suite to make sure nothing is broken, then push the rebased branch with `--force-with-lease` because rebasing rewrites history:

   ```
   npm run check
   git push --force-with-lease origin HEAD
   ```

   If `npm run check` fails, diagnose and fix the issues before pushing. Do not push a broken branch.

6. **Summarize the results:**
   - Report that the rebase was successful
   - List any conflicts that were resolved
   - Note that checks passed
   - Confirm the branch was force-pushed with lease protection
