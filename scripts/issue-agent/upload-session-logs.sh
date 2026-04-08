#!/usr/bin/env bash
set -euo pipefail

test -n "${AGENT_KIND:-}"
test -n "${GITHUB_REPOSITORY:-}"
test -n "${GITHUB_RUN_ID:-}"
test -n "${GITHUB_RUN_ATTEMPT:-}"
test -n "${LOG_MARKER_PATH:-}"
if [[ ! -f "${LOG_MARKER_PATH}" ]]; then
  echo "Log marker file not found: ${LOG_MARKER_PATH}" >&2
  exit 1
fi

if [[ -z "${KEPPO_SESSION_LOG_UPLOAD_URL:-}" || -z "${KEPPO_SESSION_LOG_UPLOAD_TOKEN:-}" ]]; then
  echo "Skipping session log upload because KEPPO_SESSION_LOG_UPLOAD_URL or KEPPO_SESSION_LOG_UPLOAD_TOKEN is not set." >&2
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      printf '### %s session logs\n\n' "${AGENT_KIND}"
      printf 'Skipped upload because `KEPPO_SESSION_LOG_UPLOAD_URL` or `KEPPO_SESSION_LOG_UPLOAD_TOKEN` is not configured for this run.\n'
    } >> "${GITHUB_STEP_SUMMARY}"
  fi
  exit 0
fi

MAX_LOG_FILES="${MAX_LOG_FILES:-50}"
MAX_LOG_BYTES="${MAX_LOG_BYTES:-104857600}"
MAX_MANIFEST_BYTES="${MAX_MANIFEST_BYTES:-262144}"
UPLOAD_TIMEOUT_SECONDS="${UPLOAD_TIMEOUT_SECONDS:-120}"
SESSION_LOG_COMMENT_MAX_BYTES="${SESSION_LOG_COMMENT_MAX_BYTES:-24576}"

append_step_summary() {
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$1" >> "${GITHUB_STEP_SUMMARY}"
  fi
}

write_summary_error() {
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      printf '### %s session logs\n\n' "${AGENT_KIND}"
      printf ':x: %s\n' "$1"
    } >> "${GITHUB_STEP_SUMMARY}"
  fi
}

redact_upload_output() {
  local output
  output="$(cat)"

  if jq -e . >/dev/null 2>&1 <<< "${output}"; then
    output="$(
      printf '%s' "${output}" | jq '
        walk(
          if type == "object" and has("client_token") then
            .client_token = "[REDACTED_CLIENT_TOKEN]"
          else
            .
          end
        )
      ' 2>/dev/null || printf '%s' "${output}"
    )"
  fi

  printf '%s\n' "${output}" | sed -E \
    -e 's/(KEPPO_SESSION_LOG_UPLOAD_TOKEN=)[^[:space:]]+/\1[REDACTED]/g' \
    -e 's/(Authorization:[[:space:]]*Bearer[[:space:]]+)[^[:space:]]+/\1[REDACTED]/Ig' \
    -e 's/vercel_blob_client_[A-Za-z0-9_=-]+/[REDACTED_CLIENT_TOKEN]/g'
}

emit_upload_output() {
  local output="$1"
  local status="$2"
  if [[ "${RUNNER_DEBUG:-0}" == "1" || "${status}" -ne 0 ]]; then
    printf '%s\n' "${output}" | redact_upload_output >&2
  fi
}

cleanup_paths=()
cleanup() {
  local path
  for path in "${cleanup_paths[@]:-}"; do
    rm -rf "${path}"
  done
}
trap cleanup EXIT

should_include_file() {
  local root_label="$1"
  local root="$2"
  local file="$3"
  local relative_path

  relative_path="${file#${root}/}"
  case "${root_label}" in
    codex-home)
      [[ "${relative_path}" =~ ^sessions/.+\.(json|jsonl)$ ]]
      return
      ;;
    *)
      return 0
      ;;
  esac
}

declare -a roots=()
case "${AGENT_KIND}" in
  codex)
    if [[ -n "${CODEX_HOME:-}" ]]; then
      roots+=("codex-home:${CODEX_HOME}")
    else
      roots+=("codex-home:${HOME}/.codex")
    fi
    ;;
  claude)
    roots+=(
      "claude-home-projects:${HOME}/.claude/projects"
      "claude-config-projects:${HOME}/.config/claude/projects"
    )
    ;;
  gh-copilot)
    if [[ -n "${COPILOT_HOME:-}" ]]; then
      roots+=("copilot-logs:${COPILOT_HOME}/logs")
    fi
    if [[ -n "${COPILOT_SESSION_SHARE_PATH:-}" ]]; then
      roots+=("copilot-session:$(dirname "${COPILOT_SESSION_SHARE_PATH}")")
    fi
    ;;
  *)
    echo "Unsupported agent kind: ${AGENT_KIND}" >&2
    exit 1
    ;;
esac

if [[ -n "${EXTRA_UPLOAD_ROOTS:-}" ]]; then
  while IFS= read -r extra_root; do
    if [[ -z "${extra_root}" ]]; then
      continue
    fi
    if [[ "${extra_root}" != *:* ]]; then
      echo "Invalid EXTRA_UPLOAD_ROOTS entry: ${extra_root}" >&2
      exit 1
    fi
    roots+=("${extra_root}")
  done <<< "${EXTRA_UPLOAD_ROOTS}"
fi

tmp_dir="$(mktemp -d)"
cleanup_paths+=("${tmp_dir}")
manifest_entries_path="${tmp_dir}/manifest-files.jsonl"
manifest_path="${tmp_dir}/manifest.json"
response_path="${tmp_dir}/response.json"
prepare_response_path="${tmp_dir}/prepare-response.json"
complete_response_path="${tmp_dir}/complete-response.json"
prepare_curl_log_path="${tmp_dir}/prepare-curl.log"
complete_curl_log_path="${tmp_dir}/complete-curl.log"
curl_log_path="${tmp_dir}/curl.log"
session_log_comment_path="${SESSION_LOG_COMMENT_PATH:-}"
upload_record_path="${UPLOAD_RECORD_PATH:-}"
comment_root_labels_json="[]"

if [[ -n "${COMMENT_ROOT_LABELS:-}" ]]; then
  comment_root_labels_json="$(
    printf '%s\n' "${COMMENT_ROOT_LABELS}" \
      | jq -R 'select(length > 0)' \
      | jq -s '.'
  )"
fi

declare -a files=()
declare -a root_labels=()
skipped_due_to_cap=0
total_bytes=0
for root_entry in "${roots[@]}"; do
  root_label="${root_entry%%:*}"
  root="${root_entry#*:}"
  if [[ -d "${root}" ]]; then
    root_labels+=("${root_label}")
    case "${root_label}" in
      codex-home|claude-home-projects|claude-config-projects)
        find_args=( -type f \( -name '*.json' -o -name '*.jsonl' \) -newer "${LOG_MARKER_PATH}" )
        ;;
      *)
        find_args=( -type f -newer "${LOG_MARKER_PATH}" )
        ;;
    esac
    while IFS= read -r file; do
      if ! should_include_file "${root_label}" "${root}" "${file}"; then
        continue
      fi
      if [[ ${#files[@]} -ge ${MAX_LOG_FILES} ]]; then
        skipped_due_to_cap=$((skipped_due_to_cap + 1))
        continue
      fi
      file_bytes="$(wc -c < "${file}" | tr -d '[:space:]')"
      next_total_bytes=$((total_bytes + file_bytes))
      if (( next_total_bytes > MAX_LOG_BYTES )); then
        skipped_due_to_cap=$((skipped_due_to_cap + 1))
        continue
      fi
      total_bytes="${next_total_bytes}"
      files+=("${root_label}:${root}:${file}:${file_bytes}")
    done < <(find "${root}" "${find_args[@]}" | sort)
  fi
done

if [[ ${#files[@]} -eq 0 ]]; then
  echo "No new ${AGENT_KIND} session logs or extra upload files found after ${LOG_MARKER_PATH}." >&2
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      printf '### %s session logs\n\n' "${AGENT_KIND}"
      printf 'No new session logs or extra upload files were found for this run.\n'
    } >> "${GITHUB_STEP_SUMMARY}"
  fi
  exit 0
fi

if [[ -n "${SESSION_LOG_UPLOAD_ID:-}" ]]; then
  upload_id="${SESSION_LOG_UPLOAD_ID}"
elif command -v uuidgen >/dev/null 2>&1; then
  upload_id="$(uuidgen | tr '[:upper:]' '[:lower:]')"
else
  upload_id="$(node -e 'console.log(require("node:crypto").randomUUID())')"
fi
uploaded_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
workflow_name="${GITHUB_WORKFLOW:-}"
job_name="${GITHUB_JOB_NAME:-${GITHUB_JOB:-}}"
github_actor="${GITHUB_ACTOR:-}"
github_triggering_actor="${GITHUB_TRIGGERING_ACTOR:-${GITHUB_ACTOR:-}}"
github_event_name="${GITHUB_EVENT_NAME:-}"
github_ref="${GITHUB_REF:-}"
github_sha="${GITHUB_SHA:-}"
github_server_url="${GITHUB_SERVER_URL:-https://github.com}"
github_repository_url="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}"
github_run_number_value="${GITHUB_RUN_NUMBER:-0}"
issue_number_value="${ISSUE_NUMBER:-}"
pull_request_number_value="${PULL_REQUEST_NUMBER:-}"

for index in "${!files[@]}"; do
  file_entry="${files[$index]}"
  root_label="${file_entry%%:*}"
  remainder="${file_entry#*:}"
  root="${remainder%%:*}"
  remainder="${remainder#*:}"
  file="${remainder%:*}"
  file_bytes="${remainder##*:}"

  case "${file##*.}" in
    json)
      content_type="application/json"
      ;;
    jsonl)
      content_type="application/x-ndjson"
      ;;
    *)
      content_type="application/octet-stream"
      ;;
  esac

  relative_path="${file#${root}/}"
  filename="$(basename "${file}")"
  part_name="file_${index}"
  sha256_hex="$(shasum -a 256 "${file}" | cut -d ' ' -f 1)"

  jq -cn \
    --arg part_name "${part_name}" \
    --arg root_label "${root_label}" \
    --arg relative_path "${relative_path}" \
    --arg filename "${filename}" \
    --arg content_type "${content_type}" \
    --arg sha256_hex "${sha256_hex}" \
    --argjson size_bytes "${file_bytes}" \
    '{
      part_name: $part_name,
      root_label: $root_label,
      relative_path: $relative_path,
      filename: $filename,
      content_type: $content_type,
      size_bytes: $size_bytes,
      sha256_hex: $sha256_hex
    }' >> "${manifest_entries_path}"

done

jq -n \
  --arg schema_source "github_actions" \
  --arg upload_id "${upload_id}" \
  --arg uploaded_at "${uploaded_at}" \
  --arg agent_kind "${AGENT_KIND}" \
  --arg repository_full_name "${GITHUB_REPOSITORY}" \
  --arg repository_owner "${GITHUB_REPOSITORY%%/*}" \
  --arg repository_name "${GITHUB_REPOSITORY##*/}" \
  --arg github_workflow "${workflow_name}" \
  --arg github_job "${job_name}" \
  --arg github_run_id "${GITHUB_RUN_ID}" \
  --argjson github_run_attempt "${GITHUB_RUN_ATTEMPT}" \
  --argjson github_run_number "${github_run_number_value}" \
  --arg github_actor "${github_actor}" \
  --arg github_triggering_actor "${github_triggering_actor}" \
  --arg github_event_name "${github_event_name}" \
  --arg github_ref "${github_ref}" \
  --arg github_sha "${github_sha}" \
  --arg github_server_url "${github_server_url}" \
  --arg github_repository_url "${github_repository_url}" \
  --argjson max_files "${MAX_LOG_FILES}" \
  --argjson max_total_bytes "${MAX_LOG_BYTES}" \
  --argjson issue_number "${issue_number_value:-null}" \
  --argjson pull_request_number "${pull_request_number_value:-null}" \
  --slurpfile files "${manifest_entries_path}" \
  '{
    schema_version: 1,
    source: $schema_source,
    upload_id: $upload_id,
    uploaded_at: $uploaded_at,
    agent_kind: $agent_kind,
    repository: {
      owner: $repository_owner,
      name: $repository_name,
      full_name: $repository_full_name
    },
    github: {
      workflow: $github_workflow,
      job: $github_job,
      run_id: $github_run_id,
      run_attempt: $github_run_attempt,
      run_number: $github_run_number,
      actor: $github_actor,
      triggering_actor: $github_triggering_actor,
      event_name: $github_event_name,
      ref: $github_ref,
      sha: $github_sha,
      server_url: $github_server_url,
      repository_url: $github_repository_url
    },
    context: {
      issue_number: $issue_number,
      pull_request_number: $pull_request_number,
      root_paths: $ARGS.positional
    },
    limits: {
      max_files: $max_files,
      max_total_bytes: $max_total_bytes
    },
    files: $files
  }' \
  --args "${root_labels[@]}" > "${manifest_path}"

manifest_bytes="$(wc -c < "${manifest_path}" | tr -d '[:space:]')"
if (( manifest_bytes > MAX_MANIFEST_BYTES )); then
  error_message="Manifest exceeded MAX_MANIFEST_BYTES (${manifest_bytes} > ${MAX_MANIFEST_BYTES})."
  echo "${error_message}" >&2
  write_summary_error "${error_message}"
  exit 1
fi

prepare_request_path="${tmp_dir}/prepare-request.json"
jq -n \
  --slurpfile manifest "${manifest_path}" \
  '{ manifest: $manifest[0] }' > "${prepare_request_path}"

set +e
curl \
  --silent \
  --show-error \
  --fail-with-body \
  --max-time "${UPLOAD_TIMEOUT_SECONDS}" \
  --request POST \
  --url "${KEPPO_SESSION_LOG_UPLOAD_URL}" \
  --header "Authorization: Bearer ${KEPPO_SESSION_LOG_UPLOAD_TOKEN}" \
  --header "Content-Type: application/json" \
  --data-binary "@${prepare_request_path}" \
  > "${prepare_response_path}" 2> "${prepare_curl_log_path}"
prepare_status=$?
set -e

prepare_raw_output="$(cat "${prepare_response_path}" 2>/dev/null)"
prepare_curl_stderr="$(cat "${prepare_curl_log_path}" 2>/dev/null)"
emit_upload_output "${prepare_curl_stderr}" "${prepare_status}"

if [[ ${prepare_status} -ne 0 ]]; then
  error_message="Session log prepare request failed."
  echo "${error_message}" >&2
  write_summary_error "${error_message}"
  if [[ -n "${prepare_raw_output}" ]]; then
    emit_upload_output "${prepare_raw_output}" "${prepare_status}"
  fi
  exit 1
fi

if ! jq -e . >/dev/null 2>&1 < "${prepare_response_path}"; then
  error_message="Session log prepare returned non-JSON output."
  echo "${error_message}" >&2
  write_summary_error "${error_message}"
  emit_upload_output "${prepare_raw_output}" 1
  exit 1
fi

prepare_validation_error="$(
  jq -r '
    if (.status // "") == "accepted" then
      (
        if (.files | type) != "array" or (.files | length) == 0 then
          "missing files array"
        else
          (
            .files
            | map(
                if (.status != "stored" and .status != "duplicate") then
                  "unexpected file status " + (.status // "null") + " for " + (.part_name // .relative_path // "unknown part")
                elif ((.viewer_url // "") == "") then
                  "missing viewer_url for " + (.part_name // .relative_path // "unknown part")
                else
                  empty
                end
              )
            | first
          ) // ""
        end
      )
    elif (.status // "") != "prepared" then
      "missing prepared status"
    elif ((.complete_url // "") == "") then
      "missing complete_url"
    elif (.files | type) != "array" or (.files | length) == 0 then
      "missing files array"
    else
      (
        .files
        | map(
            if (.status != "upload_required" and .status != "duplicate") then
              "unexpected file status " + (.status // "null") + " for " + (.part_name // .relative_path // "unknown part")
            elif (.status == "upload_required" and ((.upload_path // "") == "" or (.client_token // "") == "")) then
              "missing upload details for " + (.part_name // .relative_path // "unknown part")
            elif (.status == "duplicate" and ((.viewer_url // "") == "")) then
              "missing viewer_url for " + (.part_name // .relative_path // "unknown part")
            else
              empty
            end
          )
        | first
      ) // ""
    end
  ' "${prepare_response_path}"
)"
if [[ -n "${prepare_validation_error}" ]]; then
  error_message="Session log prepare response validation failed: ${prepare_validation_error}"
  echo "${error_message}" >&2
  write_summary_error "${error_message}"
  emit_upload_output "${prepare_raw_output}" 1
  exit 1
fi

prepare_status_value="$(jq -r '.status // ""' "${prepare_response_path}")"

if [[ "${prepare_status_value}" == "accepted" ]]; then
  cp "${prepare_response_path}" "${response_path}"
else
  while IFS=$'\t' read -r part_name upload_path upload_token; do
    local_file=""
    entry_relative_path="$(
      jq -r --arg part_name "${part_name}" '
        .files[]
        | select(.part_name == $part_name)
        | .relative_path
      ' "${manifest_path}"
    )"
    upload_content_type="$(
      jq -r --arg part_name "${part_name}" '
        .files[]
        | select(.part_name == $part_name)
        | .content_type
      ' "${manifest_path}"
    )"

    if [[ -z "${entry_relative_path}" || "${entry_relative_path}" == "null" ]]; then
      error_message="Unable to resolve manifest metadata for ${part_name}."
      echo "${error_message}" >&2
      write_summary_error "${error_message}"
      emit_upload_output "${prepare_raw_output}" 1
      exit 1
    fi

    for file_entry in "${files[@]}"; do
      entry_remainder="${file_entry#*:}"
      entry_remainder="${entry_remainder#*:}"
      entry_file="${entry_remainder%:*}"
      file_root="${file_entry#*:}"
      file_root="${file_root%%:*}"
      if [[ "${entry_file#${file_root}/}" == "${entry_relative_path}" ]]; then
        local_file="${entry_file}"
        break
      fi
    done

    if [[ -z "${local_file}" ]]; then
      error_message="Unable to map upload response part ${part_name} to a local file."
      echo "${error_message}" >&2
      write_summary_error "${error_message}"
      emit_upload_output "${prepare_raw_output}" 1
      exit 1
    fi

    set +e
    curl \
      --silent \
      --show-error \
      --fail-with-body \
      --max-time "${UPLOAD_TIMEOUT_SECONDS}" \
      --request PUT \
      --url "https://vercel.com/api/blob?pathname=$(printf '%s' "${upload_path}" | jq -sRr @uri)" \
      --header "Authorization: Bearer ${upload_token}" \
      --header "x-api-version: 12" \
      --header "x-vercel-blob-access: private" \
      --header "x-access: private" \
      --header "x-add-random-suffix: 0" \
      --header "x-allow-overwrite: 1" \
      --header "x-content-type: ${upload_content_type}" \
      --data-binary "@${local_file}" \
      > /dev/null 2> "${curl_log_path}"
    upload_status=$?
    set -e

    curl_stderr="$(cat "${curl_log_path}" 2>/dev/null)"
    emit_upload_output "${curl_stderr}" "${upload_status}"
    if [[ ${upload_status} -ne 0 ]]; then
      error_message="Direct Blob upload failed for ${part_name}."
      echo "${error_message}" >&2
      write_summary_error "${error_message}"
      exit 1
    fi
  done < <(
    jq -r '
      .files[]
      | select(.status == "upload_required")
      | [
          (.part_name // ""),
          (.upload_path // ""),
          (.client_token // "")
        ]
      | @tsv
    ' "${prepare_response_path}"
  )

  complete_url="$(
    jq -r '
      if (.complete_url // "") != "" then
        .complete_url
      else
        empty
      end
    ' "${prepare_response_path}"
  )"
  if [[ -z "${complete_url}" ]]; then
    complete_url="${KEPPO_SESSION_LOG_UPLOAD_URL%/}/complete"
  fi

  set +e
  curl \
    --silent \
    --show-error \
    --fail-with-body \
    --max-time "${UPLOAD_TIMEOUT_SECONDS}" \
    --request POST \
    --url "${complete_url}" \
    --header "Authorization: Bearer ${KEPPO_SESSION_LOG_UPLOAD_TOKEN}" \
    --header "Content-Type: application/json" \
    --data-binary "@${prepare_request_path}" \
    > "${complete_response_path}" 2> "${complete_curl_log_path}"
  complete_status=$?
  set -e

  complete_raw_output="$(cat "${complete_response_path}" 2>/dev/null)"
  complete_curl_stderr="$(cat "${complete_curl_log_path}" 2>/dev/null)"
  emit_upload_output "${complete_curl_stderr}" "${complete_status}"

  if [[ ${complete_status} -ne 0 ]]; then
    error_message="Session log completion request failed."
    echo "${error_message}" >&2
    write_summary_error "${error_message}"
    if [[ -n "${complete_raw_output}" ]]; then
      emit_upload_output "${complete_raw_output}" "${complete_status}"
    fi
    exit 1
  fi

  if ! jq -e . >/dev/null 2>&1 < "${complete_response_path}"; then
    error_message="Session log completion returned non-JSON output."
    echo "${error_message}" >&2
    write_summary_error "${error_message}"
    emit_upload_output "${complete_raw_output}" 1
    exit 1
  fi

  cp "${complete_response_path}" "${response_path}"
fi

raw_output="$(cat "${response_path}" 2>/dev/null)"

response_validation_error="$(
  jq -r '
    if (.status // "") != "accepted" then
      "missing accepted status"
    elif (.files | type) != "array" or (.files | length) == 0 then
      "missing files array"
    else
      (
        .files
        | map(
            if (.status != "stored" and .status != "duplicate") then
              "unexpected file status " + (.status // "null") + " for " + (.part_name // .relative_path // "unknown part")
            elif ((.viewer_url // "") == "") then
              "missing viewer_url for " + (.part_name // .relative_path // "unknown part")
            else
              empty
            end
          )
        | first
      ) // ""
    end
  ' "${response_path}"
)"
if [[ -n "${response_validation_error}" ]]; then
  error_message="Session log upload response validation failed: ${response_validation_error}"
  echo "${error_message}" >&2
  write_summary_error "${error_message}"
  emit_upload_output "${raw_output}" 1
  exit 1
fi

if [[ -n "${upload_record_path}" ]]; then
  mkdir -p "$(dirname "${upload_record_path}")"
  jq -n \
    --slurpfile manifest "${manifest_path}" \
    --slurpfile response "${response_path}" \
    '{
      upload_id: $manifest[0].upload_id,
      manifest: $manifest[0],
      response: $response[0]
    }' > "${upload_record_path}"
fi

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    printf '### %s session logs\n\n' "${AGENT_KIND}"
    jq -r '
      .files[]
      | "- `" + (.relative_path // .part_name // "unknown") + "` (" + (.status // "unknown") + "): " + .viewer_url
    ' "${response_path}"
  } >> "${GITHUB_STEP_SUMMARY}"
fi

if [[ -n "${session_log_comment_path}" ]]; then
  comment_links="$(
    jq -r \
      --slurpfile manifest "${manifest_path}" \
      --argjson allowed_root_labels "${comment_root_labels_json}" '
        .files[]
        | . as $response_file
        | ($manifest[0].files[] | select(.part_name == $response_file.part_name)) as $manifest_file
        | select(
            ($allowed_root_labels | length) == 0
            or (($allowed_root_labels | index($manifest_file.root_label)) != null)
          )
        | "- `" + ($response_file.relative_path // $response_file.part_name // "unknown") + "`: " + $response_file.viewer_url
      ' "${response_path}"
  )"

  if [[ -n "${comment_links}" ]]; then
    mkdir -p "$(dirname "${session_log_comment_path}")"
    {
      printf '%s session logs for this run:\n\n' "$(printf '%s' "${AGENT_KIND}" | tr '[:lower:]' '[:upper:]')"
      printf '%s\n' "${comment_links}"
      printf '\nWorkflow run: %s/%s/actions/runs/%s\n' "${github_server_url}" "${GITHUB_REPOSITORY}" "${GITHUB_RUN_ID}"
    } > "${session_log_comment_path}"

    comment_bytes="$(wc -c < "${session_log_comment_path}" | tr -d '[:space:]')"
    if (( comment_bytes > SESSION_LOG_COMMENT_MAX_BYTES )); then
      truncation_notice=$'\n\n...(truncated to fit GitHub Actions job output limits)\n'
      max_prefix_bytes=$((SESSION_LOG_COMMENT_MAX_BYTES - ${#truncation_notice}))
      if (( max_prefix_bytes < 1 )); then
        max_prefix_bytes=1
      fi
      truncated_path="${session_log_comment_path}.truncated"
      head -c "${max_prefix_bytes}" "${session_log_comment_path}" > "${truncated_path}"
      printf '%s' "${truncation_notice}" >> "${truncated_path}"
      mv "${truncated_path}" "${session_log_comment_path}"
    fi
  fi
fi

if [[ ${skipped_due_to_cap} -gt 0 ]]; then
  message="Skipped ${skipped_due_to_cap} session log files because upload caps were reached."
  echo "${message}" >&2
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    append_step_summary ""
    append_step_summary "${message}"
  fi
fi
