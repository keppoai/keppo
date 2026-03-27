#!/usr/bin/env bash
set -euo pipefail

args=(tests/e2e/specs/providers)

if [ -n "${KEPPO_E2E_PROVIDER:-}" ]; then
  args+=(--grep "${KEPPO_E2E_PROVIDER}")
fi

exec ./scripts/dotenvx-run.sh ./scripts/e2e-base.sh "${args[@]}"
