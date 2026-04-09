#!/usr/bin/env bash
set -euo pipefail

test -n "${PR_NUMBER:-}"
test -n "${DEMO_SUMMARY:-}"
test -n "${DEMO_VIDEO_PATH:-}"
test -n "${GITHUB_REPOSITORY:-}"
test -n "${VERCEL_DEMO_BLOB_READ_WRITE_TOKEN:-}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
normalized_demo_path="$(
  DEMO_VIDEO_PATH="${DEMO_VIDEO_PATH}" node "${script_dir}/demo-video-path.mjs"
)"

if [[ ! -f "${normalized_demo_path}" ]]; then
  echo "Demo video file not found: ${DEMO_VIDEO_PATH}" >&2
  exit 1
fi

if [[ -L "ux-artifacts" ]] || [[ -L "ux-artifacts/video-demos" ]]; then
  echo "Demo upload directories must not be symlinks." >&2
  exit 1
fi

path_cursor="${normalized_demo_path}"
while [[ "${path_cursor}" != "." && "${path_cursor}" != "/" ]]; do
  if [[ -L "${path_cursor}" ]]; then
    echo "Symlinks are not allowed for demo uploads: ${DEMO_VIDEO_PATH}" >&2
    exit 1
  fi
  path_cursor="$(dirname "${path_cursor}")"
done

allowed_demo_dir="$(realpath "ux-artifacts/video-demos")"
resolved_demo_path="$(realpath "${normalized_demo_path}")"
case "${resolved_demo_path}" in
  "${allowed_demo_dir}"/*) ;;
  *)
    echo "Demo video path resolves outside ux-artifacts/video-demos/: ${DEMO_VIDEO_PATH}" >&2
    exit 1
    ;;
esac

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

commit_hash="$(git rev-parse --short HEAD)"
safe_name="$(basename "${normalized_demo_path}")"
blob_path="pr-demos/${GITHUB_REPOSITORY}/pr-${PR_NUMBER}/${commit_hash}-${safe_name}"

content_type="video/webm"
case "${normalized_demo_path##*.}" in
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
trap 'rm -f "${comment_file:-}" "${log_file}"' EXIT
encoded_blob_path="$(jq -rn --arg value "${blob_path}" '$value | @uri')"
upload_url="https://vercel.com/api/blob?pathname=${encoded_blob_path}"

set +e
curl --silent --show-error --fail-with-body \
  --request PUT \
  --url "${upload_url}" \
  --header "Authorization: Bearer ${VERCEL_DEMO_BLOB_READ_WRITE_TOKEN}" \
  --header "x-api-version: 12" \
  --header "x-access: public" \
  --header "x-add-random-suffix: 0" \
  --header "x-allow-overwrite: 1" \
  --header "x-content-type: ${content_type}" \
  --data-binary "@${normalized_demo_path}" >"${log_file}" 2>&1
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

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    printf '### PR demo video\n\n'
    printf 'Demo at commit `%s`.\n\n' "${commit_hash}"
    printf -- '- Summary: %s\n' "${DEMO_SUMMARY}"
    printf -- '- URL: %s\n' "${uploaded_url}"
  } >> "${GITHUB_STEP_SUMMARY}"
fi

comment_file="$(mktemp)"

cat > "${comment_file}" <<EOF
Demo at commit \`${commit_hash}\`

${DEMO_SUMMARY}

${uploaded_url}
EOF

set +e
gh pr comment "${PR_NUMBER}" --repo "${GITHUB_REPOSITORY}" --body-file "${comment_file}"
comment_status=$?
set -e

if [[ ${comment_status} -ne 0 ]]; then
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      printf '\nPR comment failed to post automatically. Reviewers can use this URL directly:\n'
      printf -- '- %s\n' "${uploaded_url}"
    } >> "${GITHUB_STEP_SUMMARY}"
  fi
  exit "${comment_status}"
fi
