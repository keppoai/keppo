#!/usr/bin/env bash
set -euo pipefail

file_path=""
pathname=""
rw_token="${VERCEL_DEMO_BLOB_READ_WRITE_TOKEN:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)
      file_path="${2:-}"
      shift 2
      ;;
    --pathname)
      pathname="${2:-}"
      shift 2
      ;;
    --rw-token)
      rw_token="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${file_path}" || -z "${pathname}" ]]; then
  echo "Usage: $0 --file <path> --pathname <blob-path> [--rw-token <token>]" >&2
  exit 1
fi

if [[ ! -f "${file_path}" ]]; then
  echo "Video file not found: ${file_path}" >&2
  exit 1
fi

if [[ -L "${file_path}" ]]; then
  echo "Symlinks are not allowed for demo uploads: ${file_path}" >&2
  exit 1
fi

if [[ -z "${rw_token}" ]]; then
  echo "VERCEL_DEMO_BLOB_READ_WRITE_TOKEN is required." >&2
  exit 1
fi

redact_upload_output() {
  sed -E \
    -e 's/(BLOB_READ_WRITE_TOKEN=)[^[:space:]]+/\1[REDACTED]/g' \
    -e 's/(Authorization:[[:space:]]*Bearer[[:space:]]+)[^[:space:]]+/\1[REDACTED]/Ig'
}

emit_upload_output() {
  local output="$1"
  local status="$2"
  if [[ "${RUNNER_DEBUG:-0}" == "1" || "${status}" -ne 0 ]]; then
    printf '%s\n' "${output}" | redact_upload_output >&2
  fi
}

content_type="video/webm"
case "${file_path##*.}" in
  mp4)
    content_type="video/mp4"
    ;;
  mov)
    content_type="video/quicktime"
    ;;
  webm)
    content_type="video/webm"
    ;;
esac

log_file="$(mktemp)"
trap 'rm -f "${log_file}"' EXIT
encoded_pathname="$(jq -rn --arg value "${pathname}" '$value | @uri')"
upload_url="https://vercel.com/api/blob?pathname=${encoded_pathname}"

set +e
curl --silent --show-error --fail-with-body \
  --request PUT \
  --url "${upload_url}" \
  --header "Authorization: Bearer ${rw_token}" \
  --header "x-api-version: 12" \
  --header "x-access: public" \
  --header "x-add-random-suffix: 0" \
  --header "x-allow-overwrite: 1" \
  --header "x-content-type: ${content_type}" \
  --data-binary "@${file_path}" >"${log_file}" 2>&1
status=$?
set -e

raw_output="$(cat "${log_file}")"
emit_upload_output "${raw_output}" "${status}"

if [[ ${status} -ne 0 ]]; then
  exit "${status}"
fi

uploaded_url="$(printf '%s\n' "${raw_output}" | jq -r '.url // empty' 2>/dev/null)"

if [[ -z "${uploaded_url}" ]]; then
  echo "Failed to parse uploaded blob URL from Vercel Blob API response." >&2
  exit 1
fi

printf '%s\n' "${uploaded_url}"
