#!/usr/bin/env bash
set -euo pipefail

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
current_branch="$(git rev-parse --abbrev-ref HEAD)"

usage() {
  cat >&2 <<'USAGE'
Usage:
  bash scripts/pr.sh \
    --branch-name "<branch name>" \
    --commit-message "<commit message>" \
    --title-file <path> \
    --summary-file <path> \
    --rationale-file <path>
USAGE
  exit 1
}

branch_name=""
commit_message=""
title_file=""
summary_file=""
rationale_file=""

read_required_file() {
  local path="$1"
  if [[ -z "${path}" || ! -f "${path}" ]]; then
    echo "Required file not found: ${path}" >&2
    exit 1
  fi
  cat "${path}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --branch-name)
      branch_name="${2:-}"
      shift 2
      ;;
    --commit-message)
      commit_message="${2:-}"
      shift 2
      ;;
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

if [[ -z "${branch_name}" || -z "${commit_message}" || -z "${title_file}" || -z "${summary_file}" || -z "${rationale_file}" ]]; then
  usage
fi

pr_title="$(read_required_file "${title_file}")"
summary="$(read_required_file "${summary_file}")"
rationale="$(read_required_file "${rationale_file}")"

if [[ -z "${pr_title}" || -z "${summary}" || -z "${rationale}" ]]; then
  echo "PR title, summary, and rationale must not be empty." >&2
  exit 1
fi

ensure_feature_branch() {
  case "${current_branch}" in
    main|master)
      if git show-ref --verify --quiet "refs/heads/${branch_name}"; then
        git switch "${branch_name}"
      else
        git switch -c "${branch_name}"
      fi
      ;;
  esac
}

ensure_feature_branch

bash "${repo_root}/.agents/skills/commit/scripts/commit.sh" "${commit_message}"

exec bash "${repo_root}/.agents/skills/pr-push/scripts/pr_push.sh" \
  --title-file "${title_file}" \
  --summary-file "${summary_file}" \
  --rationale-file "${rationale_file}"
