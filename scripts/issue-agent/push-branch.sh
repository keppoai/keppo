#!/usr/bin/env bash
set -euo pipefail

test -n "${GITHUB_TOKEN:-}"
test -n "${ISSUE_BRANCH:-}"
test -n "${GITHUB_REPOSITORY:-}"

git remote set-url --push origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
git push --set-upstream origin "${ISSUE_BRANCH}"
