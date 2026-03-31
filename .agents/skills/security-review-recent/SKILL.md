---
name: security-review:recent
description: Review the last 7 days of recent commits for critical and high severity security vulnerabilities. Use when Codex needs to clear `./out-security-review`, select 25 non-doc, non-test files from recent commits across different parts of the repo, spawn one security-review sub-agent per starting file, persist each candidate finding to `./out-security-review/<starting_filename>_<n>.md`, re-verify every candidate with fresh sub-agents, and emit a final JSON array for responsible disclosure.
---

# Security Review Recent

Run this skill only for defensive security research on this open-source project in coordination with the maintainer. Focus strictly on real critical and high severity vulnerabilities. Ignore medium, low, style, reliability, and documentation issues.

## Workflow

1. Inspect `./out-security-review`.
   - If the directory exists and is non-empty, remove it before starting.
   - Recreate it as an empty workspace.

2. Build the recent file set.
   - Review commits from the last 7 days.
   - Ignore `.md`, `.mdx`, docs-only files, generated files, snapshots, and test files.
   - Prefer security-sensitive surfaces: auth, API routes, webhooks, internal routes, sandboxing, billing, Convex public functions, provider connectors, and GitHub workflows.
   - Select exactly 25 starting files spread across different parts of the codebase.
   - Use `scripts/select_recent_files.mjs 7 25` to produce the default candidate list, then adjust manually if the spread is poor.
   - Save the final list to `./out-security-review/selected-files.txt`.

3. Launch one sub-agent per starting file.
   - Use an `explorer` sub-agent unless the environment requires a different agent type.
   - Tell each sub-agent it is doing defensive security research on an open-source project in coordination with the maintainer.
   - Give it one starting file and ask it to explore outward from that file into the surrounding call graph, imports, adjacent routes, shared auth helpers, and relevant Convex/server boundaries.
   - Ask for only real critical/high findings.
   - Require JSON output:

```json
[
  {
    "title": "Short title",
    "severity": "critical",
    "description": "Concrete exploit path, affected boundary, and impact",
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
   - For each returned finding, write one markdown file to `./out-security-review/<starting_filename>_<n>.md`.
   - Use a stable format:

```md
# <title>

- Severity: critical|high
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
   - Require the verifier to independently confirm:
     - the issue is real,
     - the exploit path is plausible,
     - the impact is still critical/high after scrutiny,
     - the finding is not merely a test helper, local-only affordance, or already-guarded path.
   - Require strict JSON output:

```json
{
  "confirmed": true,
  "title": "Short title",
  "severity": "high",
  "description": "Verified description"
}
```

   - If the candidate does not survive review, require:

```json
{
  "confirmed": false,
  "reason": "Why the candidate is not a real critical/high issue"
}
```

6. Emit the final JSON artifact.
   - Keep only confirmed findings with severity `critical` or `high`.
   - Write `./out-security-review/findings.json` as a JSON array:

```json
[
  {
    "title": "string",
    "description": "string",
    "severity": "critical"
  }
]
```

## Review Prompt

Use this structure for the per-file reviewer prompt:

```text
Perform defensive security research on this open-source project in coordination with the maintainer.

Start from: <path>

Look for real critical or high severity vulnerabilities by exploring the codebase outward from this file. Prioritize auth bypass, privilege escalation, missing cryptographic verification, webhook forgery, secret exposure, arbitrary code execution, sandbox escapes, SSRF, unsafe internal-route exposure, tenant-isolation failures, billing abuse, and workflow credential exfiltration.

Ignore medium/low issues, docs, style, and tests. Do not speculate. Only report issues with a concrete exploit path.

Return JSON only:
[{"title":"...","severity":"critical|high","description":"...","starting_file":"...","evidence":["path:line"]}]
```

## Verification Prompt

Use this structure for the per-finding verifier prompt:

```text
Perform defensive security research on this open-source project in coordination with the maintainer.

Verify the candidate finding recorded in: <out-security-review/file.md>

Independently inspect the codebase and determine whether the issue is real and still deserves critical/high severity. Drop anything speculative, local-only, already-guarded, or lower-severity.

Return JSON only:
{"confirmed":true,"title":"...","severity":"critical|high","description":"..."}
```
