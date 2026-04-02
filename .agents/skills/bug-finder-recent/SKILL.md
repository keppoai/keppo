---
name: bug-finder:recent
description: Review the last 7 days of recent commits for critical and high severity bugs that break user experience. Use when the agent needs to clear `./out-bug-finder`, select 25 non-doc, non-test files from recent commits across different parts of the repo, spawn one bug-review sub-agent per starting file, persist each candidate finding to `./out-bug-finder/<starting_filename>_<timestamp>.md` using a filename-safe UTC ISO 8601 basic timestamp like `20260331T214512Z`, re-verify every candidate with fresh sub-agents, and emit final confirmed findings for issue filing.
---

# Bug Finder Recent

Run this skill to find critical and high severity bugs in recent commits that severely hurt user experience or lead to a broken experience. Focus strictly on real bugs. Ignore security vulnerabilities (handled separately), style issues, documentation gaps, and minor inconveniences.

Do NOT look for security issues. All findings will be reported on a public issue tracker. Do not report anything that constitutes a security vulnerability or could lead to an exploit.

## Bug Categories

Look for these categories of bugs:

- **Data loss / data corruption** - Mutations that silently drop writes, overwrite user data, or leave the database in an inconsistent state.
- **Race conditions / OCC failures** - Concurrent operations that surface as broken UX (lost updates, stale reads shown to users, phantom errors).
- **Unhandled error paths** - Missing error handling that causes crashes, blank screens, infinite spinners, or swallowed errors that hide failures from users.
- **Logic errors** - Wrong state transitions, incorrect calculations, broken filters, inverted conditionals, off-by-one errors, impossible states that the UI cannot recover from.
- **UI bugs** - Broken layouts, missing loading/error states, dead clicks, unresponsive controls, render loops, flash of wrong content.
- **Performance regressions** - N+1 queries, missing pagination on unbounded lists, unbounded loops, unnecessary re-renders, blocking operations on hot paths.
- **Integration / connector bugs** - MCP protocol handling errors, provider SDK misuse, incorrect API request construction, missing retries on transient failures, broken webhook processing.

## Workflow

1. Inspect `./out-bug-finder`.
   - If the directory exists and is non-empty, remove it before starting.
   - Recreate it as an empty workspace.

2. Build the recent file set.
   - Review commits from the last 7 days.
   - Ignore `.md`, `.mdx`, docs-only files, generated files, snapshots, and test files.
   - Prefer bug-prone surfaces: mutations, queries, UI components, API routes, forms, state management, data fetching, error boundaries, webhooks, connectors, and workers.
   - Select exactly 25 starting files spread across different parts of the codebase.
   - Use `scripts/select_recent_files.mjs 7 25` to produce the default candidate list, then adjust manually if the spread is poor.
   - Save the final list to `./out-bug-finder/selected-files.txt`.

3. Launch one sub-agent per starting file.
   - Use an `explorer` sub-agent unless the environment requires a different agent type.
   - Tell each sub-agent it is reviewing code for bugs that break user experience.
   - Give it one starting file and ask it to explore outward from that file into the surrounding call graph, imports, adjacent components, shared utilities, data flow, and error handling paths.
   - Ask for only real critical/high severity bugs. Do NOT report security vulnerabilities.
   - Respect the platform's live-agent limit. Run the 25 reviewers in bounded batches instead of trying to keep all 25 alive simultaneously. Default to at most 6 concurrent reviewer agents unless the environment clearly supports more.
   - Require JSON output:

```json
[
  {
    "title": "Short title",
    "severity": "critical",
    "category": "data-loss|race-condition|unhandled-error|logic-error|ui-bug|performance|integration",
    "description": "Concrete bug description: what breaks, when, and what the user experiences",
    "starting_file": "path/to/file.ts",
    "evidence": [
      "path/to/file.ts:12",
      "other/file.ts:88"
    ]
  }
]
```

   - If no qualifying issue is found, the agent must return `[]`.

4. Persist candidate findings.
   - For each returned finding, write one markdown file to `./out-bug-finder/<starting_filename>_<timestamp>.md`.
   - Use a UTC ISO 8601 basic timestamp that is safe in filenames: `YYYYMMDDTHHMMSSZ`.
   - Do not use colons, spaces, or timezone offsets in the filename timestamp.
   - Examples:
     - `dashboard.tsx_20260331T214512Z.md`
     - `convex_mutations_projects.ts_20260331T214734Z.md`
   - Use a stable format:

```md
# <title>

- Severity: critical|high
- Category: data-loss|race-condition|unhandled-error|logic-error|ui-bug|performance|integration
- Starting file: path/to/file.ts
- Status: candidate

## Description

<full description>

## Evidence

- path/to/file.ts:12
- other/file.ts:88
```

5. Re-verify every candidate with a fresh sub-agent.
   - Use one fresh sub-agent per candidate finding file.
   - Give the verifier only the markdown finding file path plus normal repository access.
   - Run verifier agents in bounded batches as well. Do not exceed the live-agent limit.
   - Require the verifier to independently confirm:
     - the bug is real and reproducible from the code,
     - the broken behavior actually affects users (not just theoretical),
     - the impact is still critical/high after scrutiny,
     - the finding is not merely a test helper, local-only affordance, intentional behavior, or already-handled path,
     - the finding is NOT a security vulnerability.
   - Require strict JSON output:

```json
{
  "confirmed": true,
  "title": "Short title",
  "severity": "high",
  "category": "logic-error",
  "description": "Verified description"
}
```

   - If the candidate does not survive review, require:

```json
{
  "confirmed": false,
  "reason": "Why the candidate is not a real critical/high bug"
}
```

6. Emit confirmed findings as individual markdown files.
   - Keep only confirmed findings with severity `critical` or `high`.
   - Write one `.md` file per confirmed finding to `./out-bug-finder/findings/`, using the naming convention `<short-slug>.md` (e.g. `stale-project-list.md`, `missing-error-boundary.md`).
   - If no qualifying bugs are confirmed, leave `./out-bug-finder/findings/` empty.
   - Do not speculate beyond the code and evidence you verified.
   - Do not inflate severity.
   - Focus only on real bugs with a concrete broken user experience.
   - Write like a human engineer filing a bug report, not like a generic scanner.
   - Each finding file must use this exact structure:

```md
# <Title>

- Severity: critical|high
- Category: data-loss|race-condition|unhandled-error|logic-error|ui-bug|performance|integration
```

   - After the frontmatter, write the full description as Markdown with these exact sections, in this order:

```md
### Summary
Briefly explain what the bug is and what user-visible behavior it causes.

### Affected Files
- path/to/file.ts:12
- other/file.ts:88

### Reproduction Path
Describe how the bug manifests as a concrete step-by-step narrative:
- what user action or system event triggers the bug
- what code path is entered
- what check is missing, what state is wrong, or what operation fails
- what the user sees or experiences as a result

### Impact
Explain the real consequence in product terms:
- what breaks for the user
- how frequently this is likely to occur (common flow vs edge case)
- whether data is lost, corrupted, or just temporarily wrong
- why the severity is `high` or `critical`

### Suggested Fix
Give concrete remediation steps:
- where to add the missing check, guard, or error handling
- what state or data flow needs to change
- what regression tests should be added
```

   - Style rules for the description:
     - Be specific to the codebase.
     - Mention exact function names, components, mutations, queries, and data objects when known.
     - Prefer concrete nouns over vague language.
     - Avoid filler, marketing tone, and generic advice.
     - Do not say "may cause" when the bug path is already confirmed.
     - Do not include unsupported claims.
     - Do not refer to yourself or the review process.
     - Do NOT describe security vulnerabilities or exploits.
   - Severity rules:
     - `critical` is for bugs that cause data loss, data corruption, complete feature breakage affecting all users, or crashes/blank screens on core flows.
     - `high` is for bugs that cause significant UX degradation, broken flows for a subset of users, silent failures that hide errors, or performance issues that make features unusable.
     - If the issue does not clearly meet `high` or `critical`, drop it instead of stretching it.

## Review Prompt

Use this structure for the per-file reviewer prompt:

```text
Review this codebase for critical and high severity bugs that break user experience.

Start from: <path>

Look for real bugs by exploring the codebase outward from this file. Prioritize data loss, data corruption, race conditions, unhandled errors that crash or show blank screens, logic errors in state transitions or calculations, broken UI flows, dead clicks, missing error/loading states, N+1 queries, unbounded loops, integration/connector bugs, and broken webhook processing.

Do NOT report security vulnerabilities. Ignore medium/low issues, docs, style, and tests. Do not speculate. Only report bugs with a concrete broken user experience.

Return JSON only:
[{"title":"...","severity":"critical|high","category":"...","description":"...","starting_file":"...","evidence":["path:line"]}]
```

## Verification Prompt

Use this structure for the per-finding verifier prompt:

```text
Verify the candidate bug report recorded in: <out-bug-finder/file.md>

Independently inspect the codebase and determine whether the bug is real, affects users, and still deserves critical/high severity. Drop anything speculative, local-only, already-handled, intentional behavior, lower-severity, or that constitutes a security vulnerability rather than a bug.

Return JSON only:
{"confirmed":true,"title":"...","severity":"critical|high","category":"...","description":"..."}
```
