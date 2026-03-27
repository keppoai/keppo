---
name: commit
description: Commit all working-tree and untracked changes in git using an automatically generated Conventional Commit message.
---

# Commit Changes

Use this skill when the user asks for a one-step git commit of current changes.

## Workflow

1. Confirm we are in a git repository.
2. Stage all changes (`git add -A`) and stop if there is nothing to commit.
3. Read the staged diff to understand what changed:
   ```bash
   git diff --cached --stat
   git diff --cached
   ```
4. **Generate the commit message yourself (the AI agent).** Do NOT rely on the script to generate it. Analyze the diff semantically and write a Conventional Commit message following the rules below.
5. Pass the message to the script:
   ```bash
   bash .agents/skills/commit/scripts/commit.sh "<message>"
   ```
6. If the commit fails due to a pre-commit hook:
   a. Read the hook's error output carefully.
   b. If the failure is about a real code issue (lint error, type error, formatting), fix the code, re-stage, and retry the commit.
   c. If the hook is unreasonably strict (blocking on trivial style nits, outdated rules, or things unrelated to your changes), update the hook configuration to be more reasonable, then re-stage and retry.
   d. Never use `--no-verify` to bypass hooks.

## Commit Message Rules

Format: `type(scope): subject`

**Type** — choose based on the semantic intent of the changes:
- `feat` — new feature or capability
- `fix` — bug fix
- `refactor` — restructuring without behavior change
- `docs` — documentation only
- `test` — adding or updating tests
- `chore` — maintenance, deps, config
- `ci` — CI/CD pipeline changes
- `perf` — performance improvement
- `style` — formatting, whitespace (no logic change)

**Scope** — a short token identifying the area of the codebase affected (e.g. `auth`, `dashboard`, `convex`, `mcp`, `billing`). Use the most specific meaningful scope, not just the top-level directory.

**Subject** — a concise imperative description of *what* the change does and *why* it matters. Be specific and meaningful. Bad: "update 5 files". Good: "add rate limiting to webhook endpoint".

**Multi-line body** — for larger changes, add a blank line after the subject and include a body explaining the motivation and key details. Use `git commit -m "subject" -m "body"` format when passing to the script.

**Examples of good messages:**
- `feat(auth): add OAuth2 PKCE flow for ChatGPT provider`
- `fix(mcp): handle missing tool annotations in protocol response`
- `refactor(billing): extract subscription tier logic into shared helper`
- `test(e2e): add settings page dark mode screenshot tests`
- `chore(deps): bump convex to 1.17.2`
