#!/usr/bin/env bash
set -euo pipefail

test -n "${UPLOAD_ID:-}"
test -n "${KEPPO_SESSION_LOG_UPLOAD_URL:-}"
test -n "${KEPPO_SESSION_LOG_UPLOAD_TOKEN:-}"
test -n "${DOWNLOAD_DESTINATION_ROOT:-}"

UPLOAD_TIMEOUT_SECONDS="${UPLOAD_TIMEOUT_SECONDS:-120}"
upload_record_output_path="${UPLOAD_RECORD_PATH:-}"
root_labels_json="[]"

if [[ -n "${DOWNLOAD_ROOT_LABELS:-}" ]]; then
  root_labels_json="$(
    printf '%s\n' "${DOWNLOAD_ROOT_LABELS}" \
      | jq -R 'select(length > 0)' \
      | jq -s '.'
  )"
fi

cleanup_paths=()
cleanup() {
  local path
  for path in "${cleanup_paths[@]:-}"; do
    rm -rf "${path}"
  done
}
trap cleanup EXIT

tmp_dir="$(mktemp -d)"
cleanup_paths+=("${tmp_dir}")
upload_record_path="${tmp_dir}/upload-record.json"
headers_path="${tmp_dir}/headers.txt"
download_path="${tmp_dir}/download.bin"

service_base_url="${KEPPO_SESSION_LOG_UPLOAD_URL%/complete}"
service_base_url="${service_base_url%/upload}"
upload_record_url="${service_base_url}/uploads/${UPLOAD_ID}"

redact_output() {
  sed -E \
    -e 's/(KEPPO_SESSION_LOG_UPLOAD_TOKEN=)[^[:space:]]+/\1[REDACTED]/g' \
    -e 's/(Authorization:[[:space:]]*Bearer[[:space:]]+)[^[:space:]]+/\1[REDACTED]/Ig'
}

set +e
curl \
  --silent \
  --show-error \
  --fail-with-body \
  --max-time "${UPLOAD_TIMEOUT_SECONDS}" \
  --request GET \
  --url "${upload_record_url}" \
  --header "Authorization: Bearer ${KEPPO_SESSION_LOG_UPLOAD_TOKEN}" \
  > "${upload_record_path}" 2> "${headers_path}"
fetch_status=$?
set -e

if [[ ${fetch_status} -ne 0 ]]; then
  cat "${headers_path}" | redact_output >&2
  cat "${upload_record_path}" 2>/dev/null | redact_output >&2 || true
  echo "Failed to fetch upload record ${UPLOAD_ID}." >&2
  exit 1
fi

if ! jq -e . >/dev/null 2>&1 < "${upload_record_path}"; then
  echo "Upload record endpoint returned non-JSON output." >&2
  cat "${upload_record_path}" | redact_output >&2
  exit 1
fi

validation_error="$(
  jq -r --arg upload_id "${UPLOAD_ID}" '
    . as $record
    | if (.upload_id // "") != $upload_id then
      "upload_id mismatch"
    elif (.manifest.files | type) != "array" or (.manifest.files | length) == 0 then
      "missing manifest files"
    elif (.response.status // "") != "accepted" then
      "upload response was not accepted"
    elif (.response.files | type) != "array" or (.response.files | length) == 0 then
      "missing response files"
    else
      (
        $record.manifest.files
        | map(
            .part_name as $part_name
            | .relative_path as $relative_path
            | (
                $relative_path | startswith("/") or startswith("\\") or contains("..")
              ) as $unsafe
            | if $unsafe then
                "unsafe relative_path for " + $part_name
              elif (($record.response.files | map(select(.part_name == $part_name)) | length) == 0) then
                "missing response entry for " + $part_name
              else
                empty
              end
          )
        | first
      ) // ""
    end
  ' "${upload_record_path}"
)"
if [[ -n "${validation_error}" ]]; then
  echo "Upload record validation failed: ${validation_error}" >&2
  cat "${upload_record_path}" | redact_output >&2
  exit 1
fi

if [[ -n "${upload_record_output_path}" ]]; then
  mkdir -p "$(dirname "${upload_record_output_path}")"
  cp "${upload_record_path}" "${upload_record_output_path}"
fi

mkdir -p "${DOWNLOAD_DESTINATION_ROOT}"

download_count=0
while IFS=$'\t' read -r root_label relative_path size_bytes sha256_hex content_type artifact_id download_url status; do
  if [[ -z "${artifact_id}" || -z "${download_url}" ]]; then
    echo "Upload record entry for ${relative_path} is missing artifact_id or download_url." >&2
    exit 1
  fi
  if [[ "${status}" != "stored" && "${status}" != "duplicate" ]]; then
    echo "Upload record entry for ${relative_path} has unsupported status ${status}." >&2
    exit 1
  fi
  if [[ "${relative_path}" = /* ]] || [[ "${relative_path}" = \\* ]] || [[ "${relative_path}" == *".."* ]]; then
    echo "Refusing unsafe relative path: ${relative_path}" >&2
    exit 1
  fi

  destination_path="${DOWNLOAD_DESTINATION_ROOT}/${root_label}/${relative_path}"
  mkdir -p "$(dirname "${destination_path}")"
  : > "${headers_path}"
  rm -f "${download_path}"

  set +e
  curl \
    --silent \
    --show-error \
    --fail-with-body \
    --max-time "${UPLOAD_TIMEOUT_SECONDS}" \
    --request GET \
    --url "${download_url}" \
    --header "Authorization: Bearer ${KEPPO_SESSION_LOG_UPLOAD_TOKEN}" \
    --dump-header "${headers_path}" \
    --output "${download_path}" \
    2>> "${headers_path}"
  download_status=$?
  set -e

  if [[ ${download_status} -ne 0 ]]; then
    cat "${headers_path}" | redact_output >&2
    echo "Failed to download artifact ${artifact_id}." >&2
    exit 1
  fi

  response_content_type="$(
    awk -F': ' 'tolower($1) == "content-type" { sub(/\r$/, "", $2); print $2; exit }' "${headers_path}"
  )"
  if [[ -z "${response_content_type}" ]]; then
    echo "Download response for ${artifact_id} did not include Content-Type." >&2
    exit 1
  fi
  if [[ "${response_content_type}" != "${content_type}" ]]; then
    echo "Downloaded artifact ${artifact_id} content type mismatch: ${response_content_type} != ${content_type}" >&2
    exit 1
  fi

  response_artifact_id="$(
    awk -F': ' 'tolower($1) == "x-keppo-artifact-id" { sub(/\r$/, "", $2); print $2; exit }' "${headers_path}"
  )"
  if [[ -z "${response_artifact_id}" ]]; then
    echo "Download response for ${artifact_id} did not include X-Keppo-Artifact-Id." >&2
    exit 1
  fi
  if [[ "${response_artifact_id}" != "${artifact_id}" ]]; then
    echo "Downloaded artifact id mismatch: ${response_artifact_id} != ${artifact_id}" >&2
    exit 1
  fi

  response_sha256="$(
    awk -F': ' 'tolower($1) == "x-keppo-artifact-sha256" { sub(/\r$/, "", $2); print $2; exit }' "${headers_path}"
  )"
  if [[ -z "${response_sha256}" ]]; then
    echo "Download response for ${artifact_id} did not include X-Keppo-Artifact-Sha256." >&2
    exit 1
  fi
  if [[ "${response_sha256}" != "${sha256_hex}" ]]; then
    echo "Downloaded artifact ${artifact_id} sha256 header mismatch." >&2
    exit 1
  fi

  actual_size="$(wc -c < "${download_path}" | tr -d '[:space:]')"
  if [[ "${actual_size}" != "${size_bytes}" ]]; then
    echo "Downloaded artifact ${artifact_id} size mismatch: ${actual_size} != ${size_bytes}" >&2
    exit 1
  fi

  actual_sha256="$(shasum -a 256 "${download_path}" | cut -d ' ' -f 1)"
  if [[ "${actual_sha256}" != "${sha256_hex}" ]]; then
    echo "Downloaded artifact ${artifact_id} sha256 mismatch." >&2
    exit 1
  fi

  mv "${download_path}" "${destination_path}"
  download_count=$((download_count + 1))
done < <(
  jq -r \
    --argjson root_labels "${root_labels_json}" '
      . as $record
      | $record.manifest.files[]
      | .root_label as $root_label
      | select(
          ($root_labels | length) == 0
          or (($root_labels | index($root_label)) != null)
        )
      | . as $manifest_file
      | ($record.response.files[] | select(.part_name == $manifest_file.part_name)) as $response_file
      | [
          $manifest_file.root_label,
          $manifest_file.relative_path,
          ($manifest_file.size_bytes | tostring),
          $manifest_file.sha256_hex,
          $manifest_file.content_type,
          ($response_file.artifact_id // ""),
          ($response_file.download_url // ""),
          ($response_file.status // "")
        ]
      | @tsv
    ' "${upload_record_path}"
)

if [[ ${download_count} -eq 0 ]]; then
  echo "No uploaded artifacts matched DOWNLOAD_ROOT_LABELS for ${UPLOAD_ID}." >&2
  exit 1
fi
