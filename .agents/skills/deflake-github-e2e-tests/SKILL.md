---
name: deflake-github-e2e-tests
description: Investigate flaky GitHub Actions end-to-end test runs for the "E2E main" workflow on push events to main, cluster warnings, errors, and failures across runs, identify the dominant root causes, implement fixes in application or test infrastructure code, validate the result, and then hand off the ready branch to the pr-push skill when that skill is available.
---

# Deflake GitHub E2E Tests

1. Confirm the repository is on a working branch, not directly on `main`, before making changes.
2. Inspect recent GitHub Actions runs for the `E2E main` workflow limited to `event=push` and `branch=main`.
3. Pull enough history to separate one-off failures from recurring flakes. Prefer a recent window large enough to see repetition, such as the last 20-50 runs unless the workflow volume demands more.
4. For each failed or warning-heavy run, collect:
   - run conclusion and timestamp
   - failing job and step names
   - warnings, errors, retries, timeouts, and aborted states
   - screenshots, traces, artifacts, and logs when available
5. Cluster runs by failure signature instead of treating each run independently. Group by the smallest stable symptom that explains multiple runs, such as:
   - same test title or spec file
   - same step timeout or selector failure
   - same backend error, HTTP status, or exception
   - same infrastructure symptom such as port binding, boot timeout, or missing fixture data
6. Distinguish flaky tests from deterministic regressions:
   - Treat a signature as flaky when it appears intermittently across otherwise successful runs.
   - Treat it as deterministic when the same signature fails consistently until a code change lands.
   - Call out ambiguous cases explicitly instead of forcing a conclusion.
7. Prefer fixing the product, fixtures, harness, waiting strategy, isolation, or environment contract before changing assertions. Do not paper over flakes with blanket retries, arbitrary sleeps, or looser assertions unless the evidence shows that is the correct design.
8. Use the clustered evidence to form a concrete hypothesis for the highest-value fix first. State what symptom is being fixed and why that change should remove the flake.
9. Implement the fix in code, then run the smallest meaningful verification locally first. Expand verification as confidence grows.
10. When a reusable testing lesson is exposed, update the relevant rule in `docs/rules/`, especially [docs/rules/e2e_testing.md](/Users/mini/keppo/docs/rules/e2e_testing.md), in the same change.
11. Summarize the evidence behind the fix:
    - how many runs matched the signature
    - what made it flaky or deterministic
    - what code changed
    - what validation was completed
12. If a usable `pr-push` skill exists in the environment, invoke it to commit, push, and prepare the branch for review.
13. Treat `pr-push` as unusable when it is missing or still contains template TODO placeholders. In that case, stop after validation and report that the implementation is ready for the later `pr-push` handoff.

## Useful Commands

Use the GitHub CLI when available. Prefer non-interactive commands that can be repeated and compared.

```bash
gh run list --workflow "E2E main" --branch main --event push --limit 50
gh run view <run-id>
gh run view <run-id> --log
gh run view <run-id> --job <job-id> --log
gh run download <run-id> --dir /tmp/e2e-main-<run-id>
```

## Output Expectations

Provide a concise triage summary before or alongside the fix:

- dominant failure signatures
- approximate frequency across inspected runs
- suspected root cause for each important signature
- chosen fix and why it is the best next move
- validation performed
- whether `pr-push` was invoked or is still missing or incomplete
