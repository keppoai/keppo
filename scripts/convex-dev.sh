#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/_convex-env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_convex-env.sh"

kill_stale_local_convex() {
  local port="$1"
  local pids
  pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    return
  fi

  echo "Stopping stale local backend process on port ${port}: ${pids}"
  # Intentional word splitting for multiple PIDs.
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
}

kill_stale_local_convex 3210
kill_stale_local_convex 3211
kill_stale_local_convex 3212

setup_common_local_env_exports
clear_local_convex_selection_env
pnpm exec convex dev --local --local-force-upgrade &
convex_pid=$!

while [ ! -f "$LOCAL_CONVEX_CONFIG_FILE" ]; do
  if ! kill -0 "$convex_pid" 2>/dev/null; then
    wait "$convex_pid"
    exit $?
  fi
  sleep 1
done

sync_local_convex_runtime_env

cloud_port="$(node -e 'const fs = require("fs"); const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(cfg.ports.cloud));' "$LOCAL_CONVEX_CONFIG_FILE")"
while ! lsof -ti "tcp:${cloud_port}" >/dev/null 2>&1; do
  if ! kill -0 "$convex_pid" 2>/dev/null; then
    wait "$convex_pid"
    exit $?
  fi
  sleep 1
done

setup_common_convex_env
wait "$convex_pid"
