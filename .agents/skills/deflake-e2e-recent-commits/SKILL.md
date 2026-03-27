---
name: deflake-e2e-recent-commits
description: Automatically gather flaky E2E tests from recent CI runs on the main branch and from recent PRs by wwwillchen/wwwillchen-bot/keppo-bot, then deflake them.
---

# Deflake E2E Tests from Recent Commits

Automatically gather flaky E2E tests from recent CI runs on the main branch and from recent PRs by wwwillchen/wwwillchen-bot/keppo-bot, then deflake them.

## Arguments

- `$ARGUMENTS`: (Optional) Number of recent commits to scan (default: 10)

## Task Tracking

**You MUST use the TodoWrite tool to track your progress.** At the start, create todos for each major step below. Mark each todo as `in_progress` when you start it and `completed` when you finish.

## Instructions

1. **Gather flaky tests from recent CI runs on main:**

   List recent CI workflow runs triggered by pushes to main. Keppo uses the "CI (main)" workflow which calls the shared E2E workflow:

   ```
   gh api "repos/{owner}/{repo}/actions/workflows/ci-main.yml/runs?branch=main&event=push&per_page=<COMMIT_COUNT * 3>&status=completed" --jq '.workflow_runs[] | select(.conclusion == "success" or .conclusion == "failure") | {id, head_sha, conclusion}'
   ```

   **Note:** We fetch 3x the desired commit count because many runs may be `cancelled` (due to concurrency groups). Filter to only `success` and `failure` conclusions to get runs that actually completed and have artifacts.

   Use `$ARGUMENTS` as the commit count, defaulting to 10 if not provided.

   For each completed run, download the `e2e-report` artifact which contains the merged Playwright JSON report:

   a. Find the e2e-report artifact for the run:

   ```
   gh api "repos/{owner}/{repo}/actions/runs/<run_id>/artifacts?per_page=30" --jq '.artifacts[] | select(.name == "e2e-report") | select(.expired == false) | .name'
   ```

   b. Download it using `gh run download`:

   ```
   gh run download <run_id> --name e2e-report --dir /tmp/e2e-report-<run_id>
   ```

   c. Parse `/tmp/e2e-report-<run_id>/test-results/e2e-report.json` to extract flaky tests. Write a Node.js script inside the `.claude/` directory to do this parsing. Flaky tests are those where the final result status is `"passed"` but a prior result has status `"failed"`, `"timedOut"`, or `"interrupted"`. The test title is built by joining parent suite titles (including the spec file path) and the test title, separated by ` > `.

   d. Clean up the downloaded artifact directory after parsing.

   **Note:** Some runs may not have an e2e-report artifact (e.g., if they were cancelled early, the merge-reports job didn't complete, or artifacts have expired). Skip these runs and continue to the next one.

2. **Gather flaky tests from recent PRs by wwwillchen, wwwillchen-bot, and keppo-bot:**

   In addition to main branch CI runs, scan recent open PRs authored by `wwwillchen`, `wwwillchen-bot`, or `keppo-bot` for flaky tests reported in Playwright report comments.

   a. List recent open PRs by these authors:

   ```
   gh pr list --author wwwillchen --state open --limit 10 --json number,title
   gh pr list --author wwwillchen-bot --state open --limit 10 --json number,title
   gh pr list --author keppo-bot --state open --limit 10 --json number,title
   ```

   b. For each PR, find the most recent Playwright Test Results comment (posted by a bot, containing "Playwright Test Results"):

   ```
   gh api "repos/{owner}/{repo}/issues/<pr_number>/comments" --jq '[.[] | select(.user.type == "Bot" and (.body | contains("Playwright Test Results")))] | last'
   ```

   c. Parse the comment body to extract flaky tests. The comment format includes a "Flaky Tests" section with test names in backticks:

   - Look for lines matching the pattern: `` - `<test_title>` (passed after N retries) ``
   - Extract the test title from within the backticks
   - The test title format is: `<spec_file.spec.ts> > <Suite Name> > <Test Name>`

   d. Add these flaky tests to the overall collection, noting they came from PR #N for the summary

3. **Deduplicate and rank by frequency:**

   Count how many times each test appears as flaky across all CI runs. Sort by frequency (most flaky first). Group tests by their spec file.

   Print a summary table:

   ```
   Flaky test summary:
   - login.spec.ts > Login Flow > redirects after login... (7 occurrences)
   - connect-google.spec.ts > Google OAuth > connects provider (5 occurrences)
   ...
   ```

4. **Skip if no flaky tests found:**

   If no flaky tests are found, report "No flaky tests found in recent commits or PRs" and stop.

5. **Install dependencies and prepare:**

   ```
   pnpm install --frozen-lockfile
   pnpm e2e:prepare
   ```

   **IMPORTANT:** `pnpm e2e:prepare` builds workspace exports and prepares the E2E runtime. If you make any changes to application code (anything outside of `tests/e2e/`), you MUST re-run `pnpm e2e:prepare`.

6. **Install Playwright browser:**

   ```
   pnpm exec playwright install --with-deps chromium
   ```

7. **Deflake each flaky test spec file (sequentially):**

   For each unique spec file that has flaky tests (ordered by total flaky occurrences, most flaky first):

   a. Run the spec file 10 times to confirm flakiness (note: `<spec_file>` already includes the `.spec.ts` extension from parsing):

   ```
   E2E_WORKERS=1 pnpm run test:e2e:base -- tests/e2e/specs/<spec_path> --repeat-each=10 --retries=0
   ```

   **IMPORTANT:** `--retries=0` is required to disable automatic retries. Without it, the default retry of 1 causes flaky tests to pass on retry and be incorrectly skipped.

   b. If the test passes all 10 runs, skip it (it may have been fixed already).

   c. If the test fails at least once, investigate with debug logs:

   ```
   DEBUG=pw:browser E2E_WORKERS=1 pnpm run test:e2e:base -- tests/e2e/specs/<spec_path> --retries=0
   ```

   d. Fix the flaky test following Playwright best practices and Keppo's E2E testing rules (`docs/rules/e2e_testing.md`):
   - Use `await expect(locator).toBeVisible()` before interacting with elements
   - Use `await page.waitForLoadState('domcontentloaded')` for page-load-dependent tests (prefer over `networkidle`)
   - Use stable selectors (data-testid, role, text) instead of fragile CSS selectors
   - Add explicit waits for animations: `await page.waitForTimeout(300)` (use sparingly)
   - Ensure proper test isolation (namespace includes repeat index and retry index)
   - Ensure namespace cleanup matches with boundaries (not raw substring includes)

   **IMPORTANT:** Do NOT change any application code. Only modify test files and snapshot baselines.

   e. Update snapshot baselines if needed:

   ```
   KEPPO_E2E_ALLOW_SNAPSHOT_UPDATE=1 E2E_WORKERS=1 pnpm run test:e2e:base -- tests/e2e/specs/<spec_path> --update-snapshots --retries=0
   ```

   f. Verify the fix by running 10 times again:

   ```
   E2E_WORKERS=1 pnpm run test:e2e:base -- tests/e2e/specs/<spec_path> --repeat-each=10 --retries=0
   ```

   g. If the test still fails after your fix attempt, revert any changes to that spec file and move on to the next one. Do not spend more than 2 attempts fixing a single spec file.

8. **Summarize results:**

   Report:
   - Total flaky tests found across main branch commits and PRs
   - Sources of flaky tests (main branch CI runs vs. PR comments from wwwillchen/wwwillchen-bot/keppo-bot)
   - Which tests were successfully deflaked
   - What fixes were applied to each
   - Which tests could not be fixed (and why)
   - Verification results

9. **Create PR with fixes:**

   If any fixes were made, run `/pr-push` to commit, lint, test, and push the changes as a PR.

   Use a branch name like `deflake-e2e-<date>` (e.g., `deflake-e2e-2026-03-10`).

   The PR title should be: `fix: deflake E2E tests (<list of spec files>)`
