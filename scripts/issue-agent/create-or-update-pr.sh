#!/usr/bin/env bash
set -euo pipefail

test -n "${ISSUE_BRANCH:-}"
test -n "${PR_TITLE:-}"
test -n "${PR_BODY:-}"

existing_pr="$(gh pr list --head "${ISSUE_BRANCH}" --json url --jq '.[0].url' 2>/dev/null || true)"
if [ -n "${existing_pr}" ] && [ "${existing_pr}" != "null" ]; then
  gh pr edit "${existing_pr}" --title "${PR_TITLE}" --body "${PR_BODY}"
  pr_url="${existing_pr}"
else
  pr_url="$(gh pr create --head "${ISSUE_BRANCH}" --title "${PR_TITLE}" --body "${PR_BODY}")"
fi

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  pr_number="$(gh pr view "${pr_url}" --json number --jq '.number')"
  {
    printf 'pr_url=%s\n' "${pr_url}"
    printf 'pr_number=%s\n' "${pr_number}"
  } >> "${GITHUB_OUTPUT}"
fi
