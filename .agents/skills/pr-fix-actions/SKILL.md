---
name: keppo:pr-fix:actions
description: Fix failing CI checks and GitHub Actions on a Pull Request.
---

# PR Fix: Actions

Fix failing CI checks and GitHub Actions on a Pull Request.

## Arguments

- `$ARGUMENTS`: Optional PR number or URL. If not provided, uses the current branch's PR.

## Task Tracking

**You MUST use the TaskCreate and TaskUpdate tools to track your progress.** At the start, create tasks for each step below. Mark each task as `in_progress` when you start it and `completed` when you finish. This ensures you complete ALL steps.

## Instructions

1. **Determine the PR to work on:**
   - If `$ARGUMENTS` contains a PR number or URL, use that
   - Otherwise, get the current branch's PR using `gh pr view --json number,url,title,body --jq '.'`
   - If no PR is found, inform the user and stop

2. **Check for failing CI checks:**

   ```
   gh pr checks <PR_NUMBER>
   ```

   Identify which checks are failing:
   - Lint/formatting checks
   - Type checks
   - Unit tests
   - E2E/Playwright tests
   - Build checks
   - Security checks

3. **For failing lint/formatting checks:**
   - Run `pnpm run lint` to identify lint issues
   - Run `pnpm run fmt` to fix formatting
   - Review the changes made

4. **For failing type checks:**
   - Run `pnpm run typecheck` to identify type errors
   - Read the relevant files and fix the type issues
   - Re-run type checks to verify fixes

5. **For failing unit tests:**
   - Run the failing tests locally to reproduce:
     ```
     pnpm run test:non-e2e -- <test-file-pattern>
     ```
   - Investigate the test failures
   - Fix the underlying code issues or update tests if the behavior change is intentional

6. **For failing Playwright/E2E tests:**
   - Check if the failures are snapshot-related by examining the CI logs or PR comments
   - If the failures are not snapshot-related:
     - **IMPORTANT:** First build workspace export packages before running E2E tests:
       ```
       pnpm run build:workspace-exports
       ```
     - Run the failing tests locally with debug output:
       ```
       pnpm run test:e2e -- <test-file>
       ```
     - Investigate and fix the underlying issues

7. **For failing build checks:**
   - Run the build locally:
     ```
     pnpm run build
     ```
   - Fix any build errors that appear

8. **For failing security checks:**
   - Run the security check suite:
     ```
     pnpm run check:security
     ```
   - Fix any security violations, consulting `docs/rules/security.md` for guidance

9. **After making all fixes, verify:**
   - Run the full lint check: `pnpm run lint`
   - Run type checks: `pnpm run typecheck`
   - Run relevant unit tests: `pnpm run test:non-e2e`
   - Optionally run E2E tests locally if they were failing

10. **Commit and push the changes:**

    If any changes were made:

    ```
    git add -A
    git commit -m "fix(ci): address failing CI checks

    - <summary of fix 1>
    - <summary of fix 2>
    ...

    Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
    ```

    Then run `/pr-push` to push the changes.

11. **Provide a summary to the user:**
    - List which checks were failing
    - Describe what was fixed for each
    - Note any checks that could not be fixed and require human attention
