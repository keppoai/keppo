#!/usr/bin/env bash
set -euo pipefail

commit_hash=""
summary=""
video_url=""
output_path=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --commit)
      commit_hash="${2:-}"
      shift 2
      ;;
    --summary)
      summary="${2:-}"
      shift 2
      ;;
    --video-url)
      video_url="${2:-}"
      shift 2
      ;;
    --output)
      output_path="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${commit_hash}" || -z "${summary}" ]]; then
  echo "Usage: $0 --commit <hash> --summary <text> [--video-url <url>] [--output <file>]" >&2
  exit 1
fi

body="Demo at commit \`${commit_hash}\`

${summary}

${video_url:-<PASTE_GITHUB_VIDEO_ATTACHMENT_URL_HERE>}"

if [[ -n "${output_path}" ]]; then
  mkdir -p "$(dirname "${output_path}")"
  printf '%s\n' "${body}" >"${output_path}"
else
  printf '%s\n' "${body}"
fi
