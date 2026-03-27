#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <output-path> [search-root]" >&2
  exit 1
fi

output_path="$1"
search_root="${2:-test-results}"

if [[ ! -d "${search_root}" ]]; then
  echo "Search root does not exist: ${search_root}" >&2
  exit 1
fi

latest_video=""
while IFS= read -r file; do
  if [[ -z "${latest_video}" || "${file}" -nt "${latest_video}" ]]; then
    latest_video="${file}"
  fi
done < <(find "${search_root}" -type f \( -name 'video.webm' -o -name '*.webm' -o -name '*.mp4' \))

if [[ -z "${latest_video}" ]]; then
  echo "No Playwright video files found under ${search_root}" >&2
  exit 1
fi

mkdir -p "$(dirname "${output_path}")"
cp "${latest_video}" "${output_path}"
printf '%s\n' "${output_path}"
