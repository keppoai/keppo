#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/_convex-env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_convex-env.sh"

playwright_args=("$@")
if [ "${playwright_args[0]:-}" = "--" ]; then
  playwright_args=("${playwright_args[@]:1}")
fi

export KEPPO_E2E_MODE="${KEPPO_E2E_MODE:-true}"
export KEPPO_E2E_RUNTIME_MODE="${KEPPO_E2E_RUNTIME_MODE:-prebuilt}"
export KEPPO_CODE_MODE_TIMEOUT_MS="${KEPPO_CODE_MODE_TIMEOUT_MS:-5000}"
export KEPPO_E2E_CONVEX_DEPLOYMENT="${KEPPO_E2E_CONVEX_DEPLOYMENT:-anonymous-keppo-e2e}"
export VITE_API_BASE="/"
export VITE_VAPID_PUBLIC_KEY="${VITE_VAPID_PUBLIC_KEY:-dGVzdA}"
export KEPPO_FAKE_EXTERNAL_BASE_URL="http://127.0.0.1:${KEPPO_E2E_FAKE_EXTERNAL_PORT:-9901}"
export KEPPO_LLM_GATEWAY_URL="${KEPPO_LLM_GATEWAY_URL:-${KEPPO_FAKE_EXTERNAL_BASE_URL}}"
export GMAIL_API_BASE_URL="${KEPPO_FAKE_EXTERNAL_BASE_URL}/gmail/v1"
export KEPPO_FAKE_GMAIL_ACCESS_TOKEN="fake_gmail_access_token"
export KEPPO_FAKE_STRIPE_ACCESS_TOKEN="fake_stripe_access_token"
export KEPPO_FAKE_GITHUB_ACCESS_TOKEN="fake_github_access_token"
export KEPPO_FAKE_SLACK_ACCESS_TOKEN="fake_slack_access_token"
export KEPPO_FAKE_NOTION_ACCESS_TOKEN="fake_notion_access_token"
export KEPPO_FAKE_REDDIT_ACCESS_TOKEN="fake_reddit_access_token"
export KEPPO_FAKE_X_ACCESS_TOKEN="fake_x_access_token"
export KEPPO_EXTERNAL_FETCH_ALLOWLIST="127.0.0.1:${KEPPO_E2E_FAKE_EXTERNAL_PORT:-9901},accounts.google.com:443,gmail.googleapis.com:443,oauth2.googleapis.com:443,api.stripe.com:443,api.github.com:443,github.com:443,slack.com:443,api.notion.com:443,oauth.reddit.com:443,api.x.com:443"
export PLAYWRIGHT_JSON_OUTPUT_DIR="${PLAYWRIGHT_JSON_OUTPUT_DIR:-test-results}"
export PLAYWRIGHT_JSON_OUTPUT_NAME="${PLAYWRIGHT_JSON_OUTPUT_NAME:-e2e-report.json}"
use_local_test_env_fallback "STRIPE_SECRET_KEY" "sk_test_e2e_billing"
use_local_test_env_fallback "STRIPE_WEBHOOK_SECRET" "whsec_e2e_billing"
use_local_test_env_fallback "STRIPE_STARTER_PRICE_ID" "price_e2e_starter"
use_local_test_env_fallback "STRIPE_PRO_PRICE_ID" "price_e2e_pro"
use_local_test_env_fallback "GOOGLE_CLIENT_SECRET" "fake-google-client-secret"
use_local_test_env_fallback "REDDIT_CLIENT_SECRET" "fake-reddit-client-secret"

setup_e2e_site_url_default
export VITE_KEPPO_URL="${VITE_KEPPO_URL:-${KEPPO_URL}}"

e2e_port_base="${KEPPO_E2E_PORT_BASE:-9900}"
e2e_port_block_size="${KEPPO_E2E_PORT_BLOCK_SIZE:-20}"
e2e_site_worker_index="${KEPPO_E2E_SITE_URL_WORKER_INDEX:-0}"
if ! [[ "${e2e_port_base}" =~ ^[0-9]+$ ]]; then
  e2e_port_base="9900"
fi
if ! [[ "${e2e_port_block_size}" =~ ^[0-9]+$ ]]; then
  e2e_port_block_size="20"
fi
if ! [[ "${e2e_site_worker_index}" =~ ^[0-9]+$ ]]; then
  e2e_site_worker_index="0"
fi
e2e_dashboard_port=$((e2e_port_base + e2e_port_block_size * e2e_site_worker_index + 3))

# Local Convex env sync must target the actual E2E dashboard/runtime origin instead of the
# generic dev fallback from .env files, or dispatch actions will keep calling localhost:3000.
export KEPPO_URL="http://localhost:${e2e_dashboard_port}"
export KEPPO_API_INTERNAL_BASE_URL="http://127.0.0.1:${e2e_dashboard_port}/api"
export KEPPO_CRON_SECRET="e2e-cron-token-${e2e_site_worker_index}"
export KEPPO_LOCAL_QUEUE_CONSUMER_URL="http://127.0.0.1:${e2e_dashboard_port}/internal/queue/approved-action"
export KEPPO_LOCAL_QUEUE_CONSUMER_AUTH_HEADER="Bearer ${KEPPO_CRON_SECRET}"
export VITE_KEPPO_URL="${KEPPO_URL}"

cleanup_local_convex() {
  cleanup_local_convex_processes
}

wait_for_e2e_convex_helpers() {
  local convex_pid="$1"
  local convex_url="$2"
  local max_attempts="${3:-60}"
  local attempt=1
  local probe_output=""

  while true; do
    if probe_output="$(
      CONVEX_URL="${convex_url}" pnpm exec tsx <<'TS' 2>&1
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const convexUrl = process.env.CONVEX_URL;
if (!convexUrl) {
  throw new Error("Missing CONVEX_URL for E2E helper readiness probe.");
}

const client = new ConvexHttpClient(convexUrl);
const adminKey = process.env.KEPPO_CONVEX_ADMIN_KEY;
if (adminKey) {
  client.setAdminAuth(adminKey);
}

const ref = makeFunctionReference("e2e:countNamespaceRecords");
await client.query(ref, { namespace: "bootstrap" });
TS
    )"; then
      return 0
    fi

    if ! kill -0 "${convex_pid}" 2>/dev/null; then
      wait "${convex_pid}"
      return $?
    fi

    if [ "${attempt}" -ge "${max_attempts}" ]; then
      echo "Timed out waiting for Convex e2e helpers to become callable."
      if [ -n "${probe_output}" ]; then
        printf '%s\n' "${probe_output}" >&2
      fi
      return 1
    fi

    attempt=$((attempt + 1))
    sleep 1
  done
}

run_convex_e2e_once() {
  local playwright_args=("$@")
  local log_file
  log_file="$(mktemp -t keppo-e2e-convex.XXXXXX.log)"
  local retryable_pattern
  local nested_failure_pattern
  local success_pattern
  local reported_failure_pattern
  retryable_pattern="OptimisticConcurrencyControlFailure|Command was killed with SIGKILL|A local backend is still running on port 3210|Local backend isn't running|Local backend did not start on port 3210 within 30 seconds|Hit an error while running local deployment"
  nested_failure_pattern="Failed to run command \`\\./scripts/e2e-convex-run\\.sh\`|Command failed with exit code 1: .*scripts/e2e-base\\.sh|Timed out waiting for Convex e2e helpers to become callable\\."
  success_pattern="[0-9]+ passed"
  reported_failure_pattern="(^|[^0-9])[1-9][0-9]* failed([[:space:]]|$)"

  set +e
  (
    set -euo pipefail
    exec > >(tee -a "${log_file}") 2>&1
    setup_common_local_env_exports
    clear_local_convex_selection_env
    export CONVEX_AGENT_MODE="anonymous"
    export CONVEX_DEPLOYMENT="${KEPPO_E2E_CONVEX_DEPLOYMENT}"
    pnpm exec convex dev --local --local-force-upgrade --typecheck disable --tail-logs disable &
    local convex_pid=$!

    cleanup_backend() {
      if kill -0 "${convex_pid}" 2>/dev/null; then
        kill "${convex_pid}" 2>/dev/null || true
        wait "${convex_pid}" 2>/dev/null || true
      fi
      return 0
    }

    trap 'cleanup_backend || true' EXIT

    while [ ! -f "$LOCAL_CONVEX_CONFIG_FILE" ]; do
      if ! kill -0 "${convex_pid}" 2>/dev/null; then
        wait "${convex_pid}"
        exit $?
      fi
      sleep 1
    done

    sync_local_convex_runtime_env
    setup_common_convex_env
    setup_e2e_convex_env

    local cloud_port
    cloud_port="$(node -e 'const fs = require("fs"); const cfg = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(cfg.ports.cloud));' "$LOCAL_CONVEX_CONFIG_FILE")"
    local convex_url
    convex_url="${CONVEX_URL:-}"

    while ! lsof -ti "tcp:${cloud_port}" >/dev/null 2>&1; do
      if ! kill -0 "${convex_pid}" 2>/dev/null; then
        wait "${convex_pid}"
        exit $?
      fi
      sleep 1
    done

    wait_for_e2e_convex_helpers "${convex_pid}" "${convex_url}"
    ./scripts/e2e-convex-run.sh "${playwright_args[@]}"
  )
  local command_status=$?

  cat "${log_file}"

  if [ "${command_status}" -eq 0 ] \
    && grep -Eq "${success_pattern}" "${log_file}" \
    && ! grep -Eq "${nested_failure_pattern}" "${log_file}"; then
    rm -f "${log_file}"
    return 0
  fi

  if grep -Eq "${success_pattern}" "${log_file}" \
    && ! grep -Eq "${reported_failure_pattern}" "${log_file}" \
    && ! grep -Eq "${nested_failure_pattern}" "${log_file}"; then
    rm -f "${log_file}"
    return 0
  fi

  if grep -Eq "${reported_failure_pattern}" "${log_file}"; then
    rm -f "${log_file}"
    return 1
  fi

  if [ "${command_status}" -eq 137 ] || [ "${command_status}" -eq 143 ]; then
    rm -f "${log_file}"
    return 75
  fi

  if grep -Eq "${retryable_pattern}" "${log_file}"; then
    rm -f "${log_file}"
    return 75
  fi

  if [ "${command_status}" -eq 0 ]; then
    rm -f "${log_file}"
    return 75
  fi

  if grep -Eq "${nested_failure_pattern}" "${log_file}"; then
    rm -f "${log_file}"
    return 1
  fi

  rm -f "${log_file}"
  return "${command_status}"
}

cleanup_local_convex

pnpm install

if ! pnpm exec node scripts/e2e-prepare.mjs --build; then
  exit 1
fi

attempt="${attempt:-1}"
max_attempts="${max_attempts:-5}"

while true; do
  : "${attempt:=1}"
  : "${max_attempts:=5}"
  cleanup_local_convex
  set +e
  run_convex_e2e_once "${playwright_args[@]}"
  status=$?
  set -e

  if [ "${status}" -eq 0 ]; then
    break
  fi

  if [ "${status}" -ne 75 ] || [ "${attempt}" -ge "${max_attempts}" ]; then
    exit "${status}"
  fi

  echo "Transient local Convex E2E bootstrap failure; retrying (${attempt}/${max_attempts})..."
  attempt=$((attempt + 1))
  sleep 2
done
