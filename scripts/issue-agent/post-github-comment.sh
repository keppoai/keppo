#!/usr/bin/env bash
set -euo pipefail

test -n "${COMMENT_NUMBER:-}"
test -n "${GITHUB_REPOSITORY:-}"
test -n "${COMMENT_PATH:-}"
test -f "${COMMENT_PATH}"

gh issue comment "${COMMENT_NUMBER}" --repo "${GITHUB_REPOSITORY}" --body-file "${COMMENT_PATH}"
