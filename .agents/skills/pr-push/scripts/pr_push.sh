#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   pr_push.sh "<pr title>" "<summary>" "<rationale>"
#   pr_push.sh --title-file <path> --summary-file <path> --rationale-file <path>
# Pushes the current non-main branch and creates or updates a PR.
# When a PR already exists, outputs the existing title and body so the caller
# can synthesize updated content, then updates the PR with new metadata.

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository." >&2
  exit 1
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
remote_name="origin"

if [[ "${current_branch}" == "HEAD" ]]; then
  echo "Detached HEAD is not supported for PR creation." >&2
  exit 1
fi

if [[ "${current_branch}" == "main" || "${current_branch}" == "master" ]]; then
  echo "Refusing to push or open a PR from '${current_branch}'. Switch to a feature branch first." >&2
  exit 1
fi

if ! git remote get-url "${remote_name}" >/dev/null 2>&1; then
  echo "Remote '${remote_name}' not found." >&2
  exit 1
fi

usage() {
  cat >&2 <<'EOF'
Usage:
  pr_push.sh "<pr title>" "<summary>" "<rationale>"
  pr_push.sh --title-file <path> --summary-file <path> --rationale-file <path>
EOF
  exit 1
}

read_required_file() {
  local path="$1"
  if [[ -z "${path}" || ! -f "${path}" ]]; then
    echo "Required file not found: ${path}" >&2
    exit 1
  fi
  cat "${path}"
}

title_file=""
summary_file=""
rationale_file=""

if [[ $# -eq 3 ]]; then
  pr_title="$1"
  summary="$2"
  rationale="$3"
else
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --title-file)
        title_file="${2:-}"
        shift 2
        ;;
      --summary-file)
        summary_file="${2:-}"
        shift 2
        ;;
      --rationale-file)
        rationale_file="${2:-}"
        shift 2
        ;;
      *)
        usage
        ;;
    esac
  done

  if [[ -z "${title_file}" || -z "${summary_file}" || -z "${rationale_file}" ]]; then
    usage
  fi

  pr_title="$(read_required_file "${title_file}")"
  summary="$(read_required_file "${summary_file}")"
  rationale="$(read_required_file "${rationale_file}")"
fi

if [[ -z "${pr_title}" || -z "${summary}" || -z "${rationale}" ]]; then
  echo "PR title, summary, and rationale are all required." >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "GitHub CLI 'gh' is required to create a pull request." >&2
  exit 1
fi

resolve_existing_open_pr_url() {
  local branch="$1"
  local repo_owner_with_name
  repo_owner_with_name="$(gh repo view --json owner,name --jq '.owner.login + ":" + .name' 2>/dev/null || true)"

  # Only match open PRs — merged/closed PRs should not be edited.
  gh pr view --head "${branch}" --json url,state --jq 'select(.state == "OPEN") | .url' 2>/dev/null ||
    gh pr list --head "${branch}" --state open --json url --jq '.[0].url // ""' 2>/dev/null ||
    {
      if [[ -n "${repo_owner_with_name}" ]]; then
        gh pr list --head "${repo_owner_with_name%:*}:${branch}" --state open --json url --jq '.[0].url // ""' 2>/dev/null
      fi
    } ||
    true
}

if git rev-parse --abbrev-ref "${current_branch}@{upstream}" >/dev/null 2>&1; then
  git push --force-with-lease
else
  git push -u "${remote_name}" "${current_branch}"
fi

body_file="$(mktemp)"
trap 'rm -f "${body_file}"' EXIT

cat >"${body_file}" <<EOF
${summary}

<details>
<summary>Rationale</summary>

${rationale}
</details>
EOF

# Check if a PR already exists for this branch.
existing_pr_url="$(resolve_existing_open_pr_url "${current_branch}")"
if [[ -n "${existing_pr_url}" ]]; then
  # Update the existing PR with the synthesized title and body.
  gh pr edit "${existing_pr_url}" --title "${pr_title}" --body-file "${body_file}"
  echo "Updated PR: ${existing_pr_url}"
  exit 0
fi

pr_create_output="$(
  gh pr create --head "${current_branch}" --title "${pr_title}" --body-file "${body_file}" 2>&1
)" || {
  existing_pr_url="$(resolve_existing_open_pr_url "${current_branch}")"
  if [[ -n "${existing_pr_url}" ]]; then
    gh pr edit "${existing_pr_url}" --title "${pr_title}" --body-file "${body_file}"
    echo "Updated PR: ${existing_pr_url}"
    exit 0
  fi

  printf '%s\n' "${pr_create_output}" >&2
  exit 1
}

pr_url="${pr_create_output}"
echo "Created PR: ${pr_url}"
