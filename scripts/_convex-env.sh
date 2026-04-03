#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_ENV_FILE="${SCRIPT_DIR}/../.env.local"
LOCAL_CONVEX_CONFIG_FILE="${SCRIPT_DIR}/../.convex/local/default/config.json"

ensure_local_env_file() {
  if [ -f "$LOCAL_ENV_FILE" ]; then
    return
  fi

  cat <<'EOF' >"$LOCAL_ENV_FILE"
# Machine-local overrides for Keppo development.
# This file is intentionally untracked; committed defaults live in .env.dev.
EOF
}

ensure_better_auth_secret() {
  export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-keppo-local-better-auth-secret-0123456789}"
  if [ ${#BETTER_AUTH_SECRET} -lt 32 ]; then
    export BETTER_AUTH_SECRET="keppo-local-better-auth-secret-0123456789"
  fi
}

setup_common_local_env_exports() {
  ensure_better_auth_secret
  export KEPPO_URL="${KEPPO_URL:-http://localhost:3000}"
  export VITE_KEPPO_URL="$KEPPO_URL"
  export ENABLE_EMAIL_PASSWORD="${ENABLE_EMAIL_PASSWORD:-true}"
}

setup_e2e_site_url_default() {
  if [ -n "${KEPPO_URL:-}" ]; then
    return
  fi

  local port_base
  local port_block_size
  local worker_index
  local dashboard_port
  port_base="${KEPPO_E2E_PORT_BASE:-9900}"
  port_block_size="${KEPPO_E2E_PORT_BLOCK_SIZE:-20}"
  worker_index="${KEPPO_E2E_SITE_URL_WORKER_INDEX:-0}"

  if ! [[ "${port_base}" =~ ^[0-9]+$ ]]; then
    port_base="9900"
  fi
  if ! [[ "${port_block_size}" =~ ^[0-9]+$ ]]; then
    port_block_size="20"
  fi
  if ! [[ "${worker_index}" =~ ^[0-9]+$ ]]; then
    worker_index="0"
  fi

  dashboard_port=$((port_base + port_block_size * worker_index + 3))
  export KEPPO_URL="http://localhost:${dashboard_port}"
}

use_local_test_env_fallback() {
  local key="$1"
  local fallback="$2"
  local current="${!key:-}"
  if [ -z "$current" ] || [[ "$current" == encrypted:* ]]; then
    export "${key}=${fallback}"
  fi
}

clear_local_convex_selection_env() {
  unset CONVEX_DEPLOYMENT
  unset CONVEX_URL
  unset CONVEX_SITE_URL
  unset KEPPO_CONVEX_ADMIN_KEY
  unset CONVEX_SELF_HOSTED_URL
  unset CONVEX_SELF_HOSTED_ADMIN_KEY
}

cleanup_local_convex_processes() {
  local port_base
  local port_block_size
  local max_workers
  local port_ceiling
  port_base="${KEPPO_E2E_PORT_BASE:-9900}"
  port_block_size="${KEPPO_E2E_PORT_BLOCK_SIZE:-20}"
  max_workers="${KEPPO_E2E_MAX_CLEANUP_WORKERS:-128}"
  port_ceiling=$((port_base + port_block_size * max_workers))

  for pid in $(
    lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null \
      | awk -v port_base="${port_base}" -v port_ceiling="${port_ceiling}" '
          {
            split($9, parts, ":");
            port = parts[length(parts)];
            if (port == "3210" || port == "3211" || port == "3212" || (port >= port_base && port <= port_ceiling)) {
              print $2;
            }
          }
        ' \
      | sort -u
  ); do
    if [ -n "${pid}" ]; then
      kill -9 "${pid}" 2>/dev/null || true
    fi
  done

  for pattern in \
    "convex dev --local --local-force-upgrade" \
    "tests/e2e/infra/fake-gateway.ts" \
    "tests/e2e/infra/local-queue-broker.ts" \
    "@playwright/test/cli.js test -c tests/e2e/playwright.config.ts" \
    "playwright/lib/common/process.js" \
    "@keppo/web exec vite.*--host 127.0.0.1 --port"
  do
    for pid in $(pgrep -f "${pattern}" 2>/dev/null || true); do
      kill -9 "${pid}" 2>/dev/null || true
    done
  done

  local wait_deadline
  wait_deadline=$((SECONDS + 10))
  while [ "${SECONDS}" -lt "${wait_deadline}" ]; do
    if ! lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null \
      | awk -v port_base="${port_base}" -v port_ceiling="${port_ceiling}" '
          {
            split($9, parts, ":");
            port = parts[length(parts)];
            if (port == "3210" || port == "3211" || port == "3212" || (port >= port_base && port <= port_ceiling)) {
              found = 1;
            }
          }
          END { exit found ? 0 : 1 }
        '; then
      break
    fi
    sleep 1
  done
}

update_env_file_value() {
  local file="$1"
  local key="$2"
  local value="$3"

  if [ ! -f "$file" ]; then
    return
  fi

node -e '
const fs = require("fs");
const [file, key, value] = process.argv.slice(1);
let source = fs.readFileSync(file, "utf8");
const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const line = `${key}=${value}`;
const lines = source
  .split(/\r?\n/)
  .filter((entry) => !new RegExp(`^${escaped}=`).test(entry));
lines.push(line);
const normalized = lines.filter((entry, index, all) => !(entry === "" && index === all.length - 1));
fs.writeFileSync(file, `${normalized.join("\n")}\n`);
' "$file" "$key" "$value"
}

create_convex_env_input_file() {
  mktemp -t keppo-convex-env.XXXXXX.env
}

append_convex_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"

  node -e '
const fs = require("node:fs");
const [file, key, value] = process.argv.slice(1);
fs.appendFileSync(file, `${key}=${JSON.stringify(value)}\n`);
' "$file" "$key" "$value"
}

append_optional_convex_env_value() {
  local file="$1"
  local key="$2"
  local value="${!key:-}"
  if [ -n "$value" ]; then
    append_convex_env_value "$file" "$key" "$value"
  fi
}

append_provider_runtime_env_target() {
  local file="$1"
  local target="$2"
  local key
  while IFS= read -r key; do
    if [ -n "$key" ]; then
      append_optional_convex_env_value "$file" "$key"
    fi
  done < <(pnpm exec tsx ./scripts/list-provider-runtime-env-keys.ts "$target")
}

append_managed_convex_env_target() {
  local file="$1"
  local target="$2"
  local key
  local value
  while IFS=$'\t' read -r key value; do
    if [ -n "$key" ]; then
      append_convex_env_value "$file" "$key" "$value"
    fi
  done < <(
    KEPPO_MANAGED_CONVEX_ENV_TARGET="$target" node --input-type=module -e '
import { collectManagedConvexEnvValues } from "./scripts/convex-managed-env.mjs";

const target = process.env.KEPPO_MANAGED_CONVEX_ENV_TARGET;
const values = collectManagedConvexEnvValues({ mode: target, env: process.env });
for (const [key, value] of Object.entries(values)) {
  process.stdout.write(`${key}\t${value}\n`);
}
'
  )
}

sync_local_convex_runtime_env() {
  if [ ! -f "$LOCAL_CONVEX_CONFIG_FILE" ]; then
    return
  fi

  ensure_local_env_file

  local config_json
  config_json="$(node -e '
const fs = require("fs");
const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const cloudPort = cfg?.ports?.cloud;
const sitePort = cfg?.ports?.site;
const adminKey = cfg?.adminKey;
const deploymentName = cfg?.deploymentName;
if (!cloudPort || !sitePort || !adminKey || !deploymentName) {
  process.exit(1);
}
process.stdout.write(JSON.stringify({
  convexUrl: `http://localhost:${cloudPort}`,
  convexSiteUrl: `http://localhost:${sitePort}`,
  adminKey,
  deploymentName,
}));
' "$LOCAL_CONVEX_CONFIG_FILE")" || return

  local convex_url
  local convex_site_url
  local admin_key
  local deployment_name
  convex_url="$(node -e 'const data = JSON.parse(process.argv[1]); process.stdout.write(data.convexUrl);' "$config_json")"
  convex_site_url="$(node -e 'const data = JSON.parse(process.argv[1]); process.stdout.write(data.convexSiteUrl);' "$config_json")"
  admin_key="$(node -e 'const data = JSON.parse(process.argv[1]); process.stdout.write(data.adminKey);' "$config_json")"
  deployment_name="$(node -e 'const data = JSON.parse(process.argv[1]); process.stdout.write(data.deploymentName);' "$config_json")"

  export VITE_CONVEX_URL="$convex_url"
  export VITE_CONVEX_SITE_URL="$convex_site_url"
  export VITE_KEPPO_URL="$KEPPO_URL"
  export CONVEX_URL="$convex_url"
  export CONVEX_SITE_URL="$convex_site_url"
  export CONVEX_DEPLOYMENT="local:${deployment_name}"
  export KEPPO_CONVEX_ADMIN_KEY="$admin_key"
  export CONVEX_SELF_HOSTED_URL="$convex_url"
  export CONVEX_SELF_HOSTED_ADMIN_KEY="$admin_key"

  update_env_file_value "$LOCAL_ENV_FILE" "VITE_CONVEX_URL" "$convex_url"
  update_env_file_value "$LOCAL_ENV_FILE" "VITE_CONVEX_SITE_URL" "$convex_site_url"
  update_env_file_value "$LOCAL_ENV_FILE" "VITE_KEPPO_URL" "$KEPPO_URL"
  update_env_file_value "$LOCAL_ENV_FILE" "CONVEX_URL" "$convex_url"
  update_env_file_value "$LOCAL_ENV_FILE" "CONVEX_SITE_URL" "$convex_site_url"
  update_env_file_value "$LOCAL_ENV_FILE" "CONVEX_DEPLOYMENT" "local:${deployment_name}"
  update_env_file_value "$LOCAL_ENV_FILE" "KEPPO_CONVEX_ADMIN_KEY" "$admin_key"
  update_env_file_value "$LOCAL_ENV_FILE" "KEPPO_URL" "$KEPPO_URL"
}

convex_set_env_file() {
  local input_file="$1"
  local label="${2:-env batch}"
  local attempt=1
  local max_attempts=5
  local convex_args=()
  local selection_args=()
  local convex_url="${CONVEX_SELF_HOSTED_URL:-${CONVEX_URL:-}}"
  local convex_admin_key="${CONVEX_SELF_HOSTED_ADMIN_KEY:-${KEPPO_CONVEX_ADMIN_KEY:-}}"
  local self_hosted_env_file=""
  local errexit_was_on=0
  if [[ $- == *e* ]]; then
    errexit_was_on=1
  fi

  if [ -z "$convex_url" ] || [ -z "$convex_admin_key" ]; then
    if [ -f "$LOCAL_ENV_FILE" ]; then
      convex_args+=(--env-file "$LOCAL_ENV_FILE")
    fi
  else
    self_hosted_env_file="$(mktemp -t keppo-convex-self-hosted.XXXXXX.env)"
    printf 'CONVEX_SELF_HOSTED_URL=%s\nCONVEX_SELF_HOSTED_ADMIN_KEY=%s\n' \
      "$convex_url" \
      "$convex_admin_key" >"$self_hosted_env_file"
    convex_args=(--env-file "$self_hosted_env_file")
  fi

  if [ -n "${CONVEX_ENV_SET_PREVIEW_NAME:-}" ]; then
    selection_args+=(--preview-name "$CONVEX_ENV_SET_PREVIEW_NAME")
  elif [ -n "${CONVEX_ENV_SET_DEPLOYMENT_NAME:-}" ]; then
    selection_args+=(--deployment-name "$CONVEX_ENV_SET_DEPLOYMENT_NAME")
  fi

  if [ ! -s "$input_file" ]; then
    if [ -n "$self_hosted_env_file" ] && [ -f "$self_hosted_env_file" ]; then
      rm -f "$self_hosted_env_file"
    fi
    return 0
  fi

  while true; do
    local output
    local status

    local command=(pnpm exec convex env set)
    if [ "${#convex_args[@]}" -gt 0 ]; then
      command+=("${convex_args[@]}")
    fi
    if [ "${#selection_args[@]}" -gt 0 ]; then
      command+=("${selection_args[@]}")
    fi
    command+=(--force --from-file "$input_file")
    set +e
    output="$("${command[@]}" 2>&1)"
    status=$?
    if [ "${errexit_was_on}" -eq 1 ]; then
      set -e
    fi

    if [ "${status}" -eq 0 ]; then
      if [ -n "$output" ]; then
        printf 'Synced Convex env batch: %s\n' "$label"
      fi
      if [ -n "$self_hosted_env_file" ] && [ -f "$self_hosted_env_file" ]; then
        rm -f "$self_hosted_env_file"
      fi
      return 0
    fi

    if [ -n "$output" ]; then
      printf '%s\n' "$output"
    fi

    if printf '%s' "$output" | grep -Eq "OptimisticConcurrencyControlFailure|/api/update_environment_variables 503 Service Unavailable"; then
      if [ "${attempt}" -lt "${max_attempts}" ]; then
        echo "Transient Convex env sync failure for ${label}; retrying (${attempt}/${max_attempts})..."
        attempt=$((attempt + 1))
        sleep 1
        continue
      fi
    fi

    if [ -n "$self_hosted_env_file" ] && [ -f "$self_hosted_env_file" ]; then
      rm -f "$self_hosted_env_file"
      self_hosted_env_file=""
    fi
    return "${status}"
  done
}

convex_set_env() {
  local key="$1"
  local value="$2"
  local input_file
  input_file="$(create_convex_env_input_file)"
  append_convex_env_value "$input_file" "$key" "$value"
  convex_set_env_file "$input_file" "$key"
  local status=$?
  rm -f "$input_file"
  return "${status}"
}

convex_set_optional_env() {
  local key="$1"
  local value="${!key:-}"
  if [ -n "$value" ]; then
    convex_set_env "$key" "$value"
  fi
}

sync_provider_runtime_env_target() {
  local target="$1"
  local input_file
  input_file="$(create_convex_env_input_file)"
  append_provider_runtime_env_target "$input_file" "$target"
  convex_set_env_file "$input_file" "provider runtime env (${target})"
  local status=$?
  rm -f "$input_file"
  return "${status}"
}

setup_common_convex_env() {
  setup_common_local_env_exports
  local input_file
  input_file="$(create_convex_env_input_file)"
  append_managed_convex_env_target "$input_file" "local"
  append_provider_runtime_env_target "$input_file" "local"
  convex_set_env_file "$input_file" "local runtime env"
  local status=$?
  rm -f "$input_file"
  return "${status}"
}

setup_e2e_convex_env() {
  local input_file
  input_file="$(create_convex_env_input_file)"
  append_convex_env_value "$input_file" "NODE_ENV" "test"
  append_convex_env_value "$input_file" "KEPPO_E2E_MODE" "${KEPPO_E2E_MODE:-true}"
  append_convex_env_value "$input_file" "KEPPO_E2E_RUNTIME_SIGNAL" "local"
  if [ "${KEPPO_E2E_OPENAI_RESPONSES_FAKE:-}" = "1" ]; then
    append_convex_env_value "$input_file" "KEPPO_LLM_GATEWAY_URL" ""
  fi
  append_provider_runtime_env_target "$input_file" "e2e"
  append_convex_env_value "$input_file" "KEPPO_FAKE_GMAIL_ACCESS_TOKEN" "${KEPPO_FAKE_GMAIL_ACCESS_TOKEN}"
  append_convex_env_value "$input_file" "KEPPO_FAKE_STRIPE_ACCESS_TOKEN" "${KEPPO_FAKE_STRIPE_ACCESS_TOKEN}"
  append_convex_env_value "$input_file" "KEPPO_FAKE_GITHUB_ACCESS_TOKEN" "${KEPPO_FAKE_GITHUB_ACCESS_TOKEN}"
  append_convex_env_value "$input_file" "KEPPO_FAKE_SLACK_ACCESS_TOKEN" "${KEPPO_FAKE_SLACK_ACCESS_TOKEN}"
  append_convex_env_value "$input_file" "KEPPO_FAKE_NOTION_ACCESS_TOKEN" "${KEPPO_FAKE_NOTION_ACCESS_TOKEN}"
  append_convex_env_value "$input_file" "KEPPO_FAKE_REDDIT_ACCESS_TOKEN" "${KEPPO_FAKE_REDDIT_ACCESS_TOKEN}"
  append_convex_env_value "$input_file" "KEPPO_FAKE_X_ACCESS_TOKEN" "${KEPPO_FAKE_X_ACCESS_TOKEN}"
  append_convex_env_value "$input_file" "KEPPO_EXTERNAL_FETCH_ALLOWLIST" "${KEPPO_EXTERNAL_FETCH_ALLOWLIST}"
  convex_set_env_file "$input_file" "e2e runtime env"
  local status=$?
  rm -f "$input_file"
  return "${status}"
}
