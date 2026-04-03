#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/_convex-env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_convex-env.sh"

export KEPPO_E2E_MODE="${KEPPO_E2E_MODE:-true}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-keppo-local-better-auth-secret-0123456789}"
export ENABLE_EMAIL_PASSWORD="${ENABLE_EMAIL_PASSWORD:-true}"
export KEPPO_FAKE_EXTERNAL_BASE_URL="http://127.0.0.1:${KEPPO_E2E_FAKE_EXTERNAL_PORT:-9901}"
if [ "${KEPPO_E2E_OPENAI_RESPONSES_FAKE:-}" = "1" ]; then
  export KEPPO_LLM_GATEWAY_URL=""
else
  export KEPPO_LLM_GATEWAY_URL="${KEPPO_LLM_GATEWAY_URL:-${KEPPO_FAKE_EXTERNAL_BASE_URL}}"
fi
export GMAIL_API_BASE_URL="${KEPPO_FAKE_EXTERNAL_BASE_URL}/gmail/v1"
export KEPPO_FAKE_GMAIL_ACCESS_TOKEN="fake_gmail_access_token"
export KEPPO_FAKE_STRIPE_ACCESS_TOKEN="fake_stripe_access_token"
export KEPPO_FAKE_GITHUB_ACCESS_TOKEN="fake_github_access_token"
export KEPPO_FAKE_SLACK_ACCESS_TOKEN="fake_slack_access_token"
export KEPPO_FAKE_NOTION_ACCESS_TOKEN="fake_notion_access_token"
export KEPPO_FAKE_REDDIT_ACCESS_TOKEN="fake_reddit_access_token"
export KEPPO_FAKE_X_ACCESS_TOKEN="fake_x_access_token"
export KEPPO_EXTERNAL_FETCH_ALLOWLIST="127.0.0.1:${KEPPO_E2E_FAKE_EXTERNAL_PORT:-9901},accounts.google.com:443,gmail.googleapis.com:443,oauth2.googleapis.com:443,api.stripe.com:443,api.github.com:443,github.com:443,slack.com:443,api.notion.com:443,oauth.reddit.com:443,api.x.com:443"
use_local_test_env_fallback "STRIPE_SECRET_KEY" "sk_test_e2e_billing"
use_local_test_env_fallback "STRIPE_WEBHOOK_SECRET" "whsec_e2e_billing"
use_local_test_env_fallback "STRIPE_STARTER_PRICE_ID" "price_e2e_starter"
use_local_test_env_fallback "STRIPE_PRO_PRICE_ID" "price_e2e_pro"
use_local_test_env_fallback "GOOGLE_CLIENT_SECRET" "fake-google-client-secret"
use_local_test_env_fallback "REDDIT_CLIENT_SECRET" "fake-reddit-client-secret"

if [ ${#BETTER_AUTH_SECRET} -lt 32 ]; then
  export BETTER_AUTH_SECRET="keppo-local-better-auth-secret-0123456789"
fi

setup_e2e_site_url_default
export VITE_KEPPO_URL="${VITE_KEPPO_URL:-${KEPPO_URL}}"

cleanup_local_convex_processes

setup_common_local_env_exports
clear_local_convex_selection_env

pnpm exec convex dev --local --local-force-upgrade &
convex_pid=$!

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

wait_for_e2e_runtime_ready() {
  local attempts=30
  local attempt

  for attempt in $(seq 1 "$attempts"); do
    if pnpm exec tsx --eval '
      import { ConvexHttpClient } from "convex/browser";
      import { makeFunctionReference } from "convex/server";

      void (async () => {
        const url = process.env.CONVEX_URL;
        const adminKey = process.env.KEPPO_CONVEX_ADMIN_KEY;
        if (!url || !adminKey) {
          throw new Error("Missing CONVEX_URL or KEPPO_CONVEX_ADMIN_KEY.");
        }

        const client = new ConvexHttpClient(url);
        client.setAdminAuth(adminKey);
        const ref = makeFunctionReference("e2e_reliability:runtimeStatus");
        const status = await client.query(ref, {});
        if (!status.isLocalOrTestRuntime) {
          console.error(JSON.stringify(status));
          process.exit(1);
        }
      })().catch((error) => {
        console.error(error);
        process.exit(1);
      });
    ' >/dev/null; then
      return 0
    fi
    sleep 1
  done

  echo "Timed out waiting for local/test Convex runtime readiness." >&2
  return 1
}

wait_for_e2e_runtime_ready

pnpm exec tsx scripts/run-local-convex-tests.ts "$@"
