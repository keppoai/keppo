#!/usr/bin/env bash
set -euo pipefail

test -n "${GITHUB_TOKEN:-}"
test -n "${ISSUE_BRANCH:-}"
test -n "${GITHUB_REPOSITORY:-}"

remote_url="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"

git config user.name "wwwillchen"
git config user.email "7344640+wwwillchen@users.noreply.github.com"

if git ls-remote --exit-code --heads "${remote_url}" "${ISSUE_BRANCH}" >/dev/null 2>&1; then
  git fetch "${remote_url}" "${ISSUE_BRANCH}:${ISSUE_BRANCH}"
  git switch "${ISSUE_BRANCH}"
else
  git switch -c "${ISSUE_BRANCH}"
fi
