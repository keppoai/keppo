#!/usr/bin/env bash
set -euo pipefail

args=("$@")
if [ "${args[0]:-}" = "--" ]; then
  args=("${args[@]:1}")
fi

pnpm exec node scripts/measure-e2e-runtime.mjs "${args[@]}"
pnpm exec node scripts/report-e2e-trends.mjs
pnpm run test:e2e:noise:check
