#!/usr/bin/env bash
set -euo pipefail

test -n "${ISSUE_NUMBER:-}"
test -n "${GITHUB_REPOSITORY:-}"
test -n "${COMMENT_PATH:-}"
test -f "${COMMENT_PATH}"

gh issue comment "${ISSUE_NUMBER}" --repo "${GITHUB_REPOSITORY}" --body-file "${COMMENT_PATH}"
