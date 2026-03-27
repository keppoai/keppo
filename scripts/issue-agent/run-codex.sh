#!/usr/bin/env bash
set -euo pipefail

test -n "${PROMPT_PATH:-}"

log_file="$(mktemp "${RUNNER_TEMP:-/tmp}/codex-issue-agent.XXXXXX.log")"
cleanup() {
  rm -f "${log_file}"
}
trap cleanup EXIT

echo "Codex output suppressed. Session logs are uploaded separately."
if codex exec --dangerously-bypass-approvals-and-sandbox - \
  <"${PROMPT_PATH}" >"${log_file}" 2>&1; then
  echo "Codex completed successfully."
  exit 0
else
  status=$?
fi

echo "Codex failed with exit code ${status}."

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

echo "--- Codex output ---"
cat "${log_file}"
exit "${status}"
