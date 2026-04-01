#!/usr/bin/env bash
set -euo pipefail

test -n "${PROMPT_PATH:-}"
prompt="$(cat "${PROMPT_PATH}")"

log_file="$(mktemp "${RUNNER_TEMP:-/tmp}/claude-security-review.XXXXXX.log")"
cleanup() {
  rm -f "${log_file}"
}
trap cleanup EXIT

echo "Claude output suppressed. Session logs are uploaded separately."
if npx -y @anthropic-ai/claude-code \
  --dangerously-skip-permissions \
  --model claude-opus-4-6 \
  -p "$prompt" >"${log_file}" 2>&1; then
  echo "Claude completed successfully."
  exit 0
else
  status=$?
fi

echo "Claude exited with code ${status}. Full output follows."
cat "${log_file}"
exit "${status}"
