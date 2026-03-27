#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_web-build-env.sh"

environment="${KEPPO_ENVIRONMENT:-}"

export_hosted_convex_env_for_build() {
  local mode="$1"
  local env_file="$2"

  while IFS=$'\t' read -r key value; do
    [ -n "${key}" ] || continue
    [ -n "${value}" ] || continue
    export "${key}=${value}"
  done < <(
    node --input-type=module - <<'EOF' "$mode" "$env_file"
import { buildHostedConvexEnvValues } from "./scripts/hosted-convex-env.mjs";

const [, , mode, envFile] = process.argv;
const values = buildHostedConvexEnvValues({
  mode,
  envFile,
  env: process.env,
});

for (const key of [
  "KEPPO_URL",
  "KEPPO_DASHBOARD_ORIGIN",
  "KEPPO_API_INTERNAL_BASE_URL",
  "BETTER_AUTH_TRUSTED_ORIGINS",
  "CORS_ALLOWED_ORIGINS",
  "ENABLE_EMAIL_PASSWORD",
]) {
  const value = typeof values[key] === "string" ? values[key].trim() : "";
  if (value) {
    process.stdout.write(`${key}\t${value}\n`);
  }
}
EOF
  )
}

case "${environment}" in
  preview)
    export CONVEX_DEPLOY_KEY="${CONVEX_DEPLOY_KEY:-${KEPPO_CONVEX_ADMIN_KEY:-}}"
    if [ -z "${CONVEX_DEPLOY_KEY//[[:space:]]/}" ]; then
      echo "Preview Vercel builds require CONVEX_DEPLOY_KEY or KEPPO_CONVEX_ADMIN_KEY." >&2
      exit 1
    fi

    export_hosted_convex_env_for_build preview ""
    pnpm exec convex deploy --cmd "./scripts/build-web-with-preview-convex.sh"
    ./scripts/convex-sync-hosted-env.sh
    ;;
  staging | production)
    load_hosted_web_build_env_file "${SCRIPT_DIR}/../.env.${environment}"
    export VITE_KEPPO_ENVIRONMENT="${VITE_KEPPO_ENVIRONMENT:-${environment}}"
    ./scripts/convex-sync-hosted-env.sh
    export CONVEX_DEPLOY_KEY="${CONVEX_DEPLOY_KEY:-${KEPPO_CONVEX_ADMIN_KEY:-}}"
    if [ -z "${CONVEX_DEPLOY_KEY//[[:space:]]/}" ]; then
      echo "${environment^} Vercel builds require CONVEX_DEPLOY_KEY or KEPPO_CONVEX_ADMIN_KEY." >&2
      exit 1
    fi

    pnpm exec convex deploy --cmd "./scripts/build-web-with-hosted-convex.sh"
    ;;
  *)
    echo "Vercel builds require KEPPO_ENVIRONMENT=preview|staging|production." >&2
    exit 1
    ;;
esac
