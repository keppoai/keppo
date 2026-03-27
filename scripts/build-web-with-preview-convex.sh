#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_web-build-env.sh"

ensure_hosted_web_build_env
write_preview_runtime_env_file "${SCRIPT_DIR}/../.env.preview"
trap 'rm -f "${SCRIPT_DIR}/../.env.preview"' EXIT

export ENABLE_EMAIL_PASSWORD="${ENABLE_EMAIL_PASSWORD:-true}"
export VITE_KEPPO_ENVIRONMENT="${VITE_KEPPO_ENVIRONMENT:-preview}"

exec pnpm run build:web
