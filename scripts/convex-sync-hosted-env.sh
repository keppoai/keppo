#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Reuse the existing Convex CLI wrappers and retry behavior.
source "${SCRIPT_DIR}/_convex-env.sh"

require_non_empty_env() {
  local key="$1"
  local value="${!key:-}"
  if [ -z "${value//[[:space:]]/}" ]; then
    echo "Missing required hosted Convex env: ${key}" >&2
    exit 1
  fi
}

resolve_env_file_path() {
  case "${KEPPO_ENVIRONMENT:-}" in
    preview)
      printf '%s\n' ""
      ;;
    staging)
      printf '%s\n' "${SCRIPT_DIR}/../.env.staging"
      ;;
    production)
      printf '%s\n' "${SCRIPT_DIR}/../.env.production"
      ;;
    *)
      return 1
      ;;
  esac
}

resolve_preview_name() {
  local candidate=""
  for candidate in \
    "${CONVEX_ENV_SET_PREVIEW_NAME:-}" \
    "${VERCEL_GIT_COMMIT_REF:-}" \
    "${VERCEL_BRANCH_URL:+${VERCEL_GIT_COMMIT_REF:-}}" \
    "${VERCEL_GIT_PULL_REQUEST_ID:+pr-${VERCEL_GIT_PULL_REQUEST_ID:-}}" \
    "${GITHUB_HEAD_REF:-}" \
    "${GITHUB_REF_NAME:-}"
  do
    if [ -n "${candidate//[[:space:]]/}" ]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

run_convex_set_with_preview_retry() {
  local input_file="$1"
  local label="$2"
  local max_attempts=4
  local attempt=1
  local delay_seconds=2

  while true; do
    if [ "${KEPPO_ENVIRONMENT:-}" = "preview" ]; then
      echo "Preview Convex env sync: setting ${label} (attempt ${attempt}/${max_attempts})"
    fi

    if convex_set_env_file "$input_file" "$label"; then
      return 0
    fi

    if [ "${KEPPO_ENVIRONMENT:-}" != "preview" ] || [ "${attempt}" -ge "${max_attempts}" ]; then
      echo "Convex env sync failed for ${label}; no more retries." >&2
      return 1
    fi

    echo \
      "Preview Convex env sync failed for ${label}; waiting ${delay_seconds}s before retry in case preview provisioning is still settling." \
      >&2
    sleep "${delay_seconds}"
    attempt=$((attempt + 1))
    delay_seconds=$((delay_seconds * 2))
  done
}

build_sync_values() {
  local mode="$1"
  local env_file="$2"
  shift 2

  node --input-type=module - <<'EOF' "$mode" "$env_file" "$@"
import { buildHostedConvexEnvValues } from "./scripts/convex-managed-env.mjs";

const [, , mode, envFile, ...keys] = process.argv;
const values = buildHostedConvexEnvValues({
  mode,
  envFile,
  env: process.env,
});

for (const key of keys) {
  const value = typeof values[key] === "string" ? values[key].trim() : "";
  if (value) {
    process.stdout.write(`${key}\t${value}\n`);
  }
}
EOF
}

read_base_sync_keys() {
  node --input-type=module - <<'EOF'
import { listManagedConvexEnvKeys } from "./scripts/convex-managed-env.mjs";

for (const key of listManagedConvexEnvKeys("hosted")) {
  process.stdout.write(`${key}\n`);
}
EOF
}

log_preview_sync_values() {
  local env_file="$1"

  node --input-type=module - <<'EOF' "${KEPPO_ENVIRONMENT:-}" "$env_file"
import { buildHostedConvexEnvValues } from "./scripts/convex-managed-env.mjs";

const [, , mode, envFile] = process.argv;
const values = buildHostedConvexEnvValues({
  mode,
  envFile,
  env: process.env,
});

const lines = [
  `Preview/Vercel source VERCEL_BRANCH_URL: ${process.env.VERCEL_BRANCH_URL?.trim() || "<unset>"}`,
  `Preview/Vercel source VERCEL_URL: ${process.env.VERCEL_URL?.trim() || "<unset>"}`,
  `Derived KEPPO_URL: ${values.KEPPO_URL?.trim() || "<unset>"}`,
  `Derived KEPPO_DASHBOARD_ORIGIN: ${values.KEPPO_DASHBOARD_ORIGIN?.trim() || "<unset>"}`,
  `Derived KEPPO_API_INTERNAL_BASE_URL: ${values.KEPPO_API_INTERNAL_BASE_URL?.trim() || "<unset>"}`,
  `Derived BETTER_AUTH_TRUSTED_ORIGINS: ${values.BETTER_AUTH_TRUSTED_ORIGINS?.trim() || "<unset>"}`,
];

for (const line of lines) {
  process.stdout.write(`${line}\n`);
}
EOF
}

main() {
  case "${KEPPO_ENVIRONMENT:-}" in
    preview | staging | production) ;;
    *)
      echo "Hosted Convex env sync requires KEPPO_ENVIRONMENT=preview|staging|production." >&2
      exit 1
      ;;
  esac

  export CONVEX_DEPLOY_KEY="${CONVEX_DEPLOY_KEY:-${KEPPO_CONVEX_ADMIN_KEY:-}}"
  require_non_empty_env "CONVEX_DEPLOY_KEY"
  if [ "${KEPPO_ENVIRONMENT:-}" = "preview" ]; then
    local preview_name=""
    preview_name="$(resolve_preview_name || true)"
    export CONVEX_ENV_SET_PREVIEW_NAME="${preview_name}"
    require_non_empty_env "CONVEX_ENV_SET_PREVIEW_NAME"
    echo "Preview Convex env sync targeting preview name: ${CONVEX_ENV_SET_PREVIEW_NAME}"
  else
    unset CONVEX_ENV_SET_PREVIEW_NAME
  fi
  local env_file
  env_file="$(resolve_env_file_path)"
  if [ -n "${env_file}" ] && [ ! -f "${env_file}" ]; then
    echo "No env file found for hosted Convex sync at ${env_file}; skipping."
    exit 0
  fi

  if [ "${KEPPO_ENVIRONMENT:-}" = "preview" ]; then
    log_preview_sync_values "${env_file}"
  fi

  local sync_candidates=()
  local key
  while IFS= read -r key; do
    if [ -n "$key" ]; then
      sync_candidates+=("$key")
    fi
  done < <(read_base_sync_keys)

  local provider_keys_output
  provider_keys_output="$(pnpm exec tsx ./scripts/list-provider-runtime-env-keys.ts hosted)"
  while IFS= read -r key; do
    if [ -n "$key" ]; then
      sync_candidates+=("$key")
    fi
  done <<<"${provider_keys_output}"

  local input_file
  input_file="$(create_convex_env_input_file)"
  while IFS=$'\t' read -r key value; do
    [ -n "$key" ] || continue
    append_convex_env_value "$input_file" "$key" "$value"
  done < <(build_sync_values "${KEPPO_ENVIRONMENT}" "${env_file}" "${sync_candidates[@]}")

  local label="hosted runtime env (${KEPPO_ENVIRONMENT})"
  run_convex_set_with_preview_retry "$input_file" "$label"
  local status=$?
  rm -f "$input_file"
  return "${status}"
}

main "$@"
