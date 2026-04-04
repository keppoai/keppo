#!/usr/bin/env bash
set -euo pipefail

test -n "${PROMPT_PATH:-}"
test -n "${COPILOT_GITHUB_TOKEN:-}"
test -n "${COPILOT_HOME:-}"
test -n "${COPILOT_SESSION_SHARE_PATH:-}"

config_path="${COPILOT_HOME}/config.json"
legacy_config_path="${COPILOT_HOME}/.copilot/config.json"

mkdir -p "${COPILOT_HOME}" "$(dirname "${COPILOT_SESSION_SHARE_PATH}")" "$(dirname "${legacy_config_path}")"

config_json='{
  "model": "gpt-5.4",
  "reasoning_effort": "xhigh"
}'
printf '%s\n' "${config_json}" > "${config_path}"
printf '%s\n' "${config_json}" > "${legacy_config_path}"

log_file="$(mktemp "${RUNNER_TEMP:-/tmp}/gh-copilot-issue-agent.XXXXXX.log")"
cleanup() {
  rm -f "${log_file}"
}
trap cleanup EXIT

echo "GitHub Copilot output suppressed. Session logs are uploaded separately."
if copilot \
  --silent \
  --model=gpt-5.4 \
  --autopilot \
  --allow-all \
  --max-autopilot-continues=500 \
  --no-ask-user \
  --no-auto-update \
  --share="${COPILOT_SESSION_SHARE_PATH}" \
  <"${PROMPT_PATH}" >"${log_file}" 2>&1; then
  echo "GitHub Copilot completed successfully."
  exit 0
else
  status=$?
fi

echo "GitHub Copilot failed with exit code ${status}."
echo "--- GitHub Copilot output ---"
cat "${log_file}"
exit "${status}"
