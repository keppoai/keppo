---
name: security-review:recent
description: Review the last 7 days of recent commits for critical and high severity security vulnerabilities. Use when Codex needs to clear `./out-security-review`, select 25 non-doc, non-test files from recent commits across different parts of the repo, group them into 5-8 review buckets, spawn one security-review sub-agent per review bucket, persist each candidate finding to `./out-security-review/<starting_filename>_<timestamp>.md` using a filename-safe UTC ISO 8601 basic timestamp like `20260331T214512Z`, re-verify every candidate with fresh sub-agents, and emit final confirmed findings for responsible disclosure.
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
   - Group the selected files into review buckets with `scripts/group_review_buckets.mjs ./out-security-review/selected-files.txt 8`.
   - Save the grouped output to `./out-security-review/review-buckets.json`.
   - Aim for 5-8 review buckets that each represent a coherent code area.

3. Launch one sub-agent per review bucket.
   - Use an `explorer` sub-agent unless the environment requires a different agent type.
   - Tell each sub-agent it is doing defensive security research on an open-source project in coordination with the maintainer.
   - Give it one review bucket and ask it to explore outward from the bucket's starting files into the surrounding call graph, imports, adjacent routes, shared auth helpers, and relevant Convex/server boundaries.
   - Ask for only real critical/high findings.
   - Keep related files together. A single reviewer should cover the combined area rather than splitting sibling files into separate agents.
   - Respect the platform's live-agent limit. Run the review buckets in bounded batches instead of trying to keep all reviewers alive simultaneously. Default to at most 4 concurrent reviewer agents unless the environment clearly supports more.
   - Require JSON output:

```json
[
  {
    "title": "Short title",
    "severity": "critical",
    "description": "Concrete exploit path, affected boundary, and impact",
    "review_bucket": "apps/web",
    "starting_files": [
      "apps/web/server/auth.ts",
      "apps/web/app/api/internal/route.ts"
    ],
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
   - For each returned finding, write one markdown file to `./out-security-review/<starting_filename>_<timestamp>.md`.
   - Use a UTC ISO 8601 basic timestamp that is safe in filenames: `YYYYMMDDTHHMMSSZ`.
   - Do not use colons, spaces, or timezone offsets in the filename timestamp.
   - Examples:
     - `auth.ts_20260331T214512Z.md`
     - `routes_api_webhooks_stripe.ts_20260331T214734Z.md`
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
   - Run verifier agents in bounded batches as well. Do not exceed the live-agent limit.
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

6. Emit confirmed findings as individual markdown files.
   - Keep only confirmed findings with severity `critical` or `high`.
   - Write one `.md` file per confirmed finding to `./out-security-review/findings/`, using the naming convention `<short-slug>.md` (e.g. `auth-bypass.md`, `webhook-forgery.md`).
   - If no qualifying vulnerabilities are confirmed, leave `./out-security-review/findings/` empty.
   - Do not speculate beyond the code and evidence you verified.
   - Do not inflate severity.
   - Focus only on real vulnerabilities with a concrete exploit path.
   - Write like a human security engineer, not like a generic scanner.
   - Each finding file must use this exact structure:

```md
# <Title>

- Severity: critical|high
```

   - After the frontmatter, write the full description as Markdown with these exact sections, in this order:

```md
### Summary
Briefly explain what the vulnerability is and why the boundary fails.

### Affected Files
- path/to/file.ts:12
- other/file.ts:88

### Preconditions
State exactly what the attacker needs:
- required role or access level
- deployment conditions or feature flags
- whether the issue is production-relevant or limited to certain environments

### Exploit Path
Describe the exploit as a concrete step-by-step narrative:
- which endpoint, route, mutation, callback, or code path is entered
- what check is missing or incorrectly scoped
- how attacker-controlled input reaches the vulnerable state change
- what object, credential, token, or record gets overwritten, created, exposed, or executed

### Impact
Explain the real consequence in product terms:
- what the attacker gains
- whose data or authority is affected
- whether the impact is same-tenant, cross-tenant, authenticated-only, or unauthenticated
- why the severity is `high` or `critical`

### Suggested Fix
Give concrete remediation steps:
- where to enforce the missing check
- what should be rebound, revoked, invalidated, or revalidated
- what defense-in-depth tests or regression tests should be added
- include credential/session rotation advice when relevant
```

   - Style rules for the description:
     - Be specific to the codebase.
     - Mention exact function names, routes, mutations, and data objects when known.
     - Prefer concrete nouns over vague language.
     - Avoid filler, marketing tone, and generic security advice.
     - Avoid CVSS scoring unless explicitly requested.
     - Do not say "may allow" when the exploit path is already confirmed.
     - Do not include unsupported claims.
     - Do not refer to yourself or the review process.
   - Severity rules:
     - `critical` is for severe compromise such as remote unauthenticated takeover, arbitrary code execution, or equivalent platform-wide compromise.
     - `high` is for serious authenticated privilege escalation, cross-tenant confidentiality or integrity failures, billing abuse with real financial control, or strong account-linking or credential-takeover issues.
     - If the issue does not clearly meet `high` or `critical`, drop it instead of stretching it.

## Review Prompt

Use this structure for the per-bucket reviewer prompt:

```text
Perform defensive security research on this open-source project in coordination with the maintainer.

Review bucket: <bucket-name>

Starting files:
- <path>
- <path>

Look for real critical or high severity vulnerabilities by exploring the codebase outward from these files as one related code area. Prioritize auth bypass, privilege escalation, missing cryptographic verification, webhook forgery, secret exposure, arbitrary code execution, sandbox escapes, SSRF, unsafe internal-route exposure, tenant-isolation failures, billing abuse, and workflow credential exfiltration.

Ignore medium/low issues, docs, style, and tests. Do not speculate. Only report issues with a concrete exploit path.

Return JSON only:
[{"title":"...","severity":"critical|high","description":"...","review_bucket":"...","starting_files":["..."],"starting_file":"...","evidence":["path:line"]}]
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
