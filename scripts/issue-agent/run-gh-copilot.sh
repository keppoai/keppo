#!/usr/bin/env bash
set -euo pipefail

test -n "${PROMPT_PATH:-}"
test -n "${COPILOT_GITHUB_TOKEN:-}"
test -n "${COPILOT_HOME:-}"
test -n "${COPILOT_SESSION_SHARE_PATH:-}"

copilot_model="${COPILOT_MODEL:-gpt-5.4}"
copilot_reasoning_effort="${COPILOT_REASONING_EFFORT:-high}"
copilot_max_autopilot_continues="${COPILOT_MAX_AUTOPILOT_CONTINUES:-50}"
copilot_allowed_tools="${COPILOT_ALLOWED_TOOLS:-shell,write}"

config_path="${COPILOT_HOME}/config.json"
legacy_config_path="${COPILOT_HOME}/.copilot/config.json"

mkdir -p "${COPILOT_HOME}" "$(dirname "${COPILOT_SESSION_SHARE_PATH}")" "$(dirname "${legacy_config_path}")"

config_json='{
  "model": "'"${copilot_model}"'",
  "reasoning_effort": "'"${copilot_reasoning_effort}"'"
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
  --model="${copilot_model}" \
  --autopilot \
  --allow-tool="${copilot_allowed_tools}" \
  --max-autopilot-continues="${copilot_max_autopilot_continues}" \
  --no-ask-user \
  --no-auto-update \
  --share="${COPILOT_SESSION_SHARE_PATH}" \
  -p "$(cat "${PROMPT_PATH}")" >"${log_file}" 2>&1; then
  echo "GitHub Copilot completed successfully."
  exit 0
else
  status=$?
fi

echo "GitHub Copilot failed with exit code ${status}."

# Decode signal kills: exit 137 = SIGKILL (OOM), 143 = SIGTERM, etc.
if (( status > 128 )); then
  sig=$(( status - 128 ))
  echo "Exit code ${status} indicates process was killed by signal ${sig} ($(kill -l "${sig}" 2>/dev/null || echo unknown))."
  if [[ "${sig}" -eq 9 ]]; then
    echo "SIGKILL — likely OOM killer or runner resource limit."
  fi
fi

echo "--- disk usage ---"
df -h 2>/dev/null || true

echo "--- memory ---"
free -h 2>/dev/null || cat /proc/meminfo 2>/dev/null | grep -E "^(MemTotal|MemFree|MemAvailable|SwapTotal|SwapFree):" || true

echo "--- OOM / kill events (dmesg) ---"
dmesg -T 2>/dev/null | grep -iE "oom|killed process|out of memory|memory cgroup" | tail -30 || \
  dmesg 2>/dev/null | grep -iE "oom|killed process|out of memory" | tail -30 || true

echo "--- GitHub Copilot output ---"
cat "${log_file}"
exit "${status}"
