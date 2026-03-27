#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_web-build-env.sh"

environment="${KEPPO_ENVIRONMENT:-}"

case "${environment}" in
  staging | production)
    load_hosted_web_build_env_file "${SCRIPT_DIR}/../.env.${environment}"
    export VITE_KEPPO_ENVIRONMENT="${VITE_KEPPO_ENVIRONMENT:-${environment}}"
    ;;
  *)
    echo "Hosted Convex web builds require KEPPO_ENVIRONMENT=staging|production." >&2
    exit 1
    ;;
esac

ensure_hosted_web_build_env

exec pnpm run build:web
