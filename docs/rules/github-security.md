# GitHub Workflow Security Rules

## Scope

Consult this file before changing GitHub Actions workflows that run Claude, Codex, or any other coding agent, especially when those workflows can comment, label, push branches, edit pull requests, or otherwise mutate GitHub state.

## Core model

- Treat the workflow definition on the base repository revision as the trusted control plane.
- Treat PR branches, issue bodies, PR comments, review comments, and any files the agent can edit as untrusted runtime data.
- Keep the trusted control plane and the agent-writable workspace separate. If they must share a workspace, rehydrate trusted workflow assets immediately before any privileged post-agent step.
- Fail closed when a workflow cannot prove that a post-agent helper script, prompt template, or policy file still comes from the trusted base revision.

## Trust boundaries

- Never execute privileged post-agent scripts from a path the agent may have modified earlier in the same job.
- Privileged post-agent steps include validation, action parsing, comment posting, thread resolution, label changes, branch pushes, PR creation or edits, and any step that uses scoped GitHub credentials.
- Prefer keeping workflow-owned helper scripts in a dedicated trusted checkout that is separate from the PR or issue workspace.
- When a separate trusted checkout is not practical, refresh that trusted checkout from the base repository revision after the agent runs and before any privileged helper executes.
- Do not rely on `git status` alone to prove helper scripts are trustworthy. Committed agent changes leave a clean worktree.

## Agent execution rules

- Agents should receive only the minimum inputs required to do local reasoning and code edits: prefetched context files, prompt files, and a repository checkout.
- If an agent can edit a launcher script during its run, execute that launcher from the trusted workflow checkout rather than the mutable workspace so the process cannot rewrite the file Bash is still reading.
- Agent launcher scripts must never stream full agent transcripts to workflow logs, even when GitHub Actions debug logging (`RUNNER_DEBUG`, `ACTIONS_STEP_DEBUG`) is enabled. Agent transcripts can contain sensitive information and session logs are always uploaded separately. On failures, they should still surface the captured transcript so deterministic post-agent triage remains possible.
- Every `anthropics/claude-code-action` invocation must set `show_full_output: false` explicitly so transcript suppression does not depend on action defaults.
- Always pass an explicit `github_token` with minimal permissions (e.g. `contents: read`) to `claude-code-action`. If `github_token` is omitted, the action falls back to OIDC token exchange and fails with `Could not fetch an OIDC token. Did you remember to add 'id-token: write' to your workflow permissions?` — granting `id-token: write` is the wrong fix because it widens permissions. Instead, mint a separate GitHub App token scoped to `contents: read` and pass it.
- The explicit `github_token` given to the agent must never carry write permissions. Let deterministic post-agent steps perform GitHub mutations with their own scoped tokens.
- Treat prompt templates and workflow-owned validation/export scripts as trusted assets, not agent-authored content.

## Checkout rules

- `actions/checkout` for PR or issue workspaces should use `persist-credentials: false` unless the workflow explicitly reconfigures a scoped push remote afterward.
- If a job needs both an untrusted workspace checkout and trusted workflow assets, be explicit about checkout order and cleanup behavior so the trusted checkout remains authoritative.
- Do not assume a checkout in one step survives unchanged through later agent execution.
- If a later checkout can overwrite or remove trusted assets, either refresh the trusted checkout afterward or restructure the job so the trusted checkout is isolated.

## Deterministic post-agent rules

- Keep privileged validation in simple inline workflow logic where possible: verify expected files exist, expected commits were created, and the worktree is clean before invoking helper scripts.
- When validation enforces multiple invariants, emit explicit failure messages for each invariant instead of relying on bare `test` commands so operators can identify the broken contract from the workflow log.
- Run metadata validation, action parsing, push helpers, PR creation helpers, and issue or PR comment helpers from a freshly trusted checkout when those steps happen after the agent.
- Do not reuse GitHub App installation tokens minted before a long agent run for deterministic post-agent steps. Mint fresh scoped tokens after the agent step for post-agent checkouts, comments, thread actions, label updates, push-remote reconfiguration, branch pushes, and other privileged GitHub mutations.
- Exclude workflow-owned trusted checkout directories from generic PR worktree dirtiness checks only when those directories are rehydrated from the trusted base revision before privileged execution.
- When post-agent cleanup needs to stage leftover changes while a trusted helper checkout lives inside the repo, do not use blanket `git add .` or `git add -A .` patterns. Stage tracked changes with `git add -u -- .` and stage untracked non-helper paths separately so ignored helper directories such as `.workflow-base` cannot break validation.
- If a workflow reports preview or deployment URLs back to GitHub, derive those URLs from trusted step outputs or platform APIs rather than mutable files in the PR workspace.
- If a workflow temporarily keeps a trusted helper checkout inside the mutable repo, fail closed before any push or privileged post-agent step when:
  - `.gitmodules` changed while that checkout existed
  - `git ls-files --stage` contains any `160000` gitlink entries
  - the helper checkout path appears in `git diff --cached --name-only`
  - `.gitignore` changed to mention the helper checkout path
- Any machine-readable agent output that drives privileged steps should be validated against trusted context generated before the agent ran.

## Context generation rules

- Generate trusted context before the agent runs using scoped GitHub credentials in deterministic steps.
- Store untrusted issue, PR, and review content in files and treat those files as reference material for the agent, not executable instructions.
- When later privileged steps depend on trusted context, either validate it with hashes or regenerate the trusted helper scripts that consume it before execution.

## Artifact handling rules

- Keppo is an open-source project. Treat anything uploaded through `actions/upload-artifact` as potentially accessible to people outside the intended reviewer set, and never use GitHub Actions artifacts for sensitive data.
- Never upload security findings, responsible-disclosure material, agent session logs, prompt/context files, private analysis outputs, or any other sensitive workflow byproducts with `actions/upload-artifact`.
- For security-sensitive or otherwise non-public workflow outputs, use the dedicated trusted upload path (for example `upload-session-logs.sh`) or keep the data within the same job and process it locally without a GitHub artifact hop.
- When a trusted upload helper scans an agent home directory for session logs, scope discovery to the known session-log subtree or filename pattern. Never treat "all newly written JSON files under agent home" as session logs; agent homes also contain auth, plugin, config, and other unrelated machine files.
- When a post-agent workflow only needs small agent-authored text that is meant to become a GitHub comment, prefer passing that text through job outputs into a separate trusted comment-posting job instead of keeping write-scoped comment steps on the agent runner. Do not use job outputs for prompt/context files, session logs, or other sensitive byproducts.
- When a workflow must persist sensitive intermediate data across jobs, use a deterministic trusted upload id plus an authenticated upload-record lookup. The trusted job must choose artifacts from that stored manifest, not from mutable workspace files or untrusted job outputs.
- Trusted cross-job artifact restores must verify the download route's artifact identity and digest headers plus the actual byte size and SHA-256 before using the file.
- If a workflow cannot complete without persisting sensitive intermediate data across jobs through a dedicated trusted channel, redesign the workflow instead of falling back to `actions/upload-artifact`.

## Permissions rules

- Scope GitHub App tokens and job permissions to the minimum repository and permission set each deterministic step needs.
- Do not add `workflows` under workflow-level or job-level `permissions:`. That key is not a valid `GITHUB_TOKEN` permission in GitHub Actions workflow syntax. When an automation needs permission to push workflow-file changes, request `permission-workflows: write` on the GitHub App token that performs the push instead.
- Add `checks: read` or similar scopes only when the deterministic context-generation step actually calls those APIs.
- Reusable workflow callers must grant permissions that match the callee’s declared needs.

## Verification

- After hardening a workflow, validate that:
  - the agent cannot influence privileged helper code used after the agent step
  - the workflow still works for older PR branches that do not contain newly added helper scripts
  - trusted checkout paths are not wiped or shadowed by later checkouts
  - worktree cleanliness checks do not accidentally treat trusted workflow infrastructure as agent-authored dirt
- Record any reusable lesson from a workflow trust-boundary fix in this file or a closely related rules file.
