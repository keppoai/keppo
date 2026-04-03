---
name: code-architect:recent
description: Review the last 7 days of recent commits for large architecture improvements that dramatically improve maintainability. Use when the agent needs to clear `./out-code-architect`, select 25 non-doc, non-test files from recent commits across different parts of the repo, spawn one architecture-review sub-agent per starting file, persist each candidate finding to `./out-code-architect/<starting_filename>_<timestamp>.md` using a filename-safe UTC ISO 8601 basic timestamp like `20260331T214512Z`, re-verify every candidate with fresh sub-agents, and emit final confirmed findings for issue filing.
---

# Code Architect Recent

Run this skill to find large architecture improvements in recent commits that would materially reduce maintenance cost, coupling, and drift. Focus strictly on structural refactors with clear repository-wide or subsystem-wide payoff. Ignore small cleanups, naming tweaks, style issues, isolated code smells, and speculative rewrites.

## Architecture Categories

Look for these categories of structural maintainability work:

- **boundary-leakage** - Business rules, persistence concerns, UI concerns, or workflow orchestration leaking across module boundaries and forcing cross-layer edits.
- **duplication** - The same flow, policy, mapping, or state machine reimplemented in multiple places with drift risk.
- **over-coupling** - A core module knows too much about adjacent systems, so ordinary changes fan out across unrelated files.
- **dead-abstraction** - An abstraction adds indirection without simplifying ownership, or multiple abstractions overlap with unclear authority.
- **workflow-fragmentation** - Operational or product workflows are split across scripts, configs, or services in ways that make changes brittle.
- **state-scatter** - A feature's state, schema, or invariants are spread across too many modules to evolve safely.
- **module-sprawl** - A subsystem lacks a clear home for shared policy or orchestration, so contributors keep adding ad hoc entry points.

## Workflow

1. Inspect `./out-code-architect`.
   - If the directory exists and is non-empty, remove it before starting.
   - Recreate it as an empty workspace.

2. Build the recent file set.
   - Review commits from the last 7 days.
   - Ignore `.md`, `.mdx`, docs-only files, generated files, snapshots, and test files.
   - Prefer architecture-shaping surfaces: shared packages, Convex/server boundaries, dashboard domain modules, provider connectors, workers, queues, schema/model definitions, orchestration helpers, and GitHub workflow tooling.
   - Select exactly 25 starting files spread across different parts of the codebase.
   - Use `.workflow-base/.agents/skills/code-architect-recent/scripts/select_recent_files.mjs 7 25` to produce the default candidate list, then adjust manually if the spread is poor.
   - Save the final list to `./out-code-architect/selected-files.txt`.

3. Launch one sub-agent per starting file.
   - Use an `explorer` sub-agent unless the environment requires a different agent type.
   - Tell each sub-agent it is reviewing the codebase for large architecture improvements that dramatically improve maintainability.
   - Give it one starting file and ask it to explore outward into surrounding modules, ownership boundaries, duplicated flows, shared utilities, workflow entry points, and adjacent schema or state management code.
   - Ask for only real `high` or `critical` architecture findings. Do not report bug fixes, security issues, or medium/low maintainability cleanups.
   - Respect the platform's live-agent limit. Run the 25 reviewers in bounded batches instead of trying to keep all 25 alive simultaneously. Default to at most 6 concurrent reviewer agents unless the environment clearly supports more.
   - Require JSON output:

```json
[
  {
    "title": "Short title",
    "severity": "high",
    "category": "boundary-leakage|duplication|over-coupling|dead-abstraction|workflow-fragmentation|state-scatter|module-sprawl",
    "description": "Concrete architectural problem and why fixing it would materially improve maintainability",
    "starting_file": "path/to/file.ts",
    "evidence": ["path/to/file.ts:12", "other/file.ts:88"]
  }
]
```

- If no qualifying issue is found, the agent must return `[]`.

4. Persist candidate findings.
   - For each returned finding, write one markdown file to `./out-code-architect/<starting_filename>_<timestamp>.md`.
   - Use a UTC ISO 8601 basic timestamp that is safe in filenames: `YYYYMMDDTHHMMSSZ`.
   - Do not use colons, spaces, or timezone offsets in the filename timestamp.
   - Examples:
     - `projectService.ts_20260331T214512Z.md`
     - `apps_web_src_lib_workflows_dispatch.ts_20260331T214734Z.md`
   - Use a stable format:

```md
# <title>

- Severity: critical|high
- Category: boundary-leakage|duplication|over-coupling|dead-abstraction|workflow-fragmentation|state-scatter|module-sprawl
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
     - the architecture problem is real and structural,
     - the proposed refactor would materially reduce change cost or drift,
     - the impact is still `high` or `critical` after scrutiny,
     - the finding is not just a localized cleanup, style preference, or feature request,
     - the finding is not primarily a security issue or a product bug report.
   - Require strict JSON output:

```json
{
  "confirmed": true,
  "title": "Short title",
  "severity": "high",
  "category": "duplication",
  "description": "Verified architectural problem and why it matters"
}
```

- If the candidate does not survive review, require:

```json
{
  "confirmed": false,
  "reason": "Why the candidate is not a real high-impact architecture improvement"
}
```

6. Emit confirmed findings as individual markdown files.
   - Keep only confirmed findings with severity `critical` or `high`.
   - Write one `.md` file per confirmed finding to `./out-code-architect/findings/`, using the naming convention `<short-slug>.md` (e.g. `unify-notification-dispatch.md`, `split-connector-runtime-boundaries.md`).
   - If no qualifying findings are confirmed, leave `./out-code-architect/findings/` empty.
   - Do not speculate beyond the code and evidence you verified.
   - Do not inflate severity.
   - Focus only on large maintainability improvements with clear payoff.
   - Write like a staff engineer proposing a structural fix, not like a generic scanner.
   - Each finding file must use this exact structure:

```md
# <Title>

- Severity: critical|high
- Category: boundary-leakage|duplication|over-coupling|dead-abstraction|workflow-fragmentation|state-scatter|module-sprawl
- Dedup Key: stable-kebab-case-key
```

- After the frontmatter, write the full description as Markdown with these exact sections, in this order:

```md
### Summary

Briefly explain the structural problem and the architectural direction that would fix it.

### Affected Files

- path/to/file.ts:12
- other/file.ts:88

### Current Pain

Describe the concrete maintenance burden today:

- where contributors have to touch too many files
- where behavior can drift because logic is duplicated
- where ownership boundaries are unclear

### Why This Is Structural

Explain why this is an architecture issue rather than a one-off cleanup:

- what boundary or abstraction is missing or wrong
- which subsystems are coupled together
- why the problem will keep recurring if left as-is

### Recommended Refactor

Give concrete remediation steps:

- what module or abstraction should become the source of truth
- what code should move, merge, split, or be deleted
- what interfaces or ownership boundaries should change
- what regression tests or migration steps should accompany the refactor

### Expected Payoff

Explain the maintainability win in product-engineering terms:

- what classes of edits become local instead of cross-cutting
- what duplicate logic or workflow branches disappear
- why this deserves `high` or `critical` priority
```

- Style rules for the description:
  - Be specific to the codebase.
  - The dedup key must be deterministic across reruns for the same architecture issue. Base it on the subsystem and failure mode, not on wording.
  - Mention exact modules, packages, functions, workflows, components, mutations, or services when known.
  - Prefer concrete nouns over vague language.
  - Avoid filler, marketing tone, and generic refactoring advice.
  - Do not include unsupported claims about performance or reliability unless the code clearly supports them.
  - Do not refer to yourself or the review process.
- Severity rules:
  - `critical` is for structural debt in a core boundary that materially slows or destabilizes work across multiple major product areas.
  - `high` is for a major subsystem whose current architecture creates repeated drift, high edit fan-out, or chronic duplication that meaningfully raises the cost of change.
  - If the issue does not clearly meet `high` or `critical`, drop it instead of stretching it.

## Review Prompt

Use this structure for the per-file reviewer prompt:

```text
Review this codebase for large architecture improvements that would dramatically improve maintainability.

Start from: <path>

Look for structural problems by exploring outward from this file. Prioritize leaked boundaries, duplicated orchestration, over-coupled modules, dead abstractions, fragmented workflows, scattered state ownership, and subsystems with no clear source of truth.

Ignore bug fixes, security issues, docs, style, and medium/low cleanups. Do not speculate. Only report high-impact architecture improvements with concrete evidence in the code.

Return JSON only:
[{"title":"...","severity":"high|critical","category":"...","description":"...","starting_file":"...","evidence":["path:line"]}]
```

## Verification Prompt

Use this structure for the per-finding verifier prompt:

```text
Verify the candidate architecture finding recorded in: <out-code-architect/file.md>

Independently inspect the codebase and determine whether the problem is real, structural, and still deserves high/critical priority. Drop anything speculative, local-only, style-driven, bug-oriented, security-oriented, or lower-impact than advertised.

Return JSON only:
{"confirmed":true,"title":"...","severity":"high|critical","category":"...","description":"..."}
```
