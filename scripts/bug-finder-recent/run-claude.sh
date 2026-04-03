#!/usr/bin/env bash
set -euo pipefail

test -n "${PROMPT_PATH:-}"
test -n "${CLAUDE_CODE_VERSION:-}"
prompt="$(cat "${PROMPT_PATH}")"

log_dir="out-bug-finder"
mkdir -p "${log_dir}"
timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
log_file="${log_dir}/claude-session-${timestamp}.log"

echo "Claude output suppressed. Session logs are uploaded separately."
if npx -y "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
  --permission-mode acceptEdits \
  --allowedTools \
  Read \
  Write \
  Edit \
  MultiEdit \
  Glob \
  Grep \
  LS \
  "Bash(cat:*)" \
  "Bash(find:*)" \
  "Bash(git diff:*)" \
  "Bash(git log:*)" \
  "Bash(git rev-list:*)" \
  "Bash(git show:*)" \
  "Bash(git status:*)" \
  "Bash(head:*)" \
  "Bash(ls:*)" \
  "Bash(node .agents/skills/bug-finder-recent/scripts/select_recent_files.mjs:*)" \
  "Bash(pwd:*)" \
  "Bash(rg:*)" \
  "Bash(sort:*)" \
  "Bash(tail:*)" \
  "Bash(wc:*)" \
  --model claude-opus-4-6 \
  --effort max \
  -p "$prompt" >"${log_file}" 2>&1; then
  echo "Claude completed successfully."
  echo "Claude session log saved to ${log_file}."
  exit 0
else
  status=$?
fi

echo "Claude exited with code ${status}. Full output follows."
cat "${log_file}"
exit "${status}"
