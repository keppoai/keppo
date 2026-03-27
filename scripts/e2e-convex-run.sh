#!/usr/bin/env bash
set -euo pipefail

pnpm exec playwright test -c tests/e2e/playwright.config.ts --reporter=line,json "$@"
