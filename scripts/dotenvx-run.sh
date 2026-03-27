#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
ENV_KEYS_FILE="${ROOT_DIR}/.env.keys"
KEPPO_ENVIRONMENT="${KEPPO_ENVIRONMENT:-development}"

case "$KEPPO_ENVIRONMENT" in
  development)
    BASE_ENV_FILE="${ROOT_DIR}/.env.dev"
    LOCAL_ENV_FILE="${ROOT_DIR}/.env.local"
    ;;
  preview)
    BASE_ENV_FILE=""
    LOCAL_ENV_FILE=""
    ;;
  staging)
    BASE_ENV_FILE="${ROOT_DIR}/.env.staging"
    LOCAL_ENV_FILE=""
    ;;
  production)
    BASE_ENV_FILE="${ROOT_DIR}/.env.production"
    LOCAL_ENV_FILE=""
    ;;
  *)
    echo "Unsupported KEPPO_ENVIRONMENT: ${KEPPO_ENVIRONMENT}" >&2
    echo "Expected one of: development, preview, staging, production" >&2
    exit 1
    ;;
esac

dotenv_args=(run)

if [ -n "$BASE_ENV_FILE" ] && [ -f "$BASE_ENV_FILE" ]; then
  dotenv_args+=(-f "$BASE_ENV_FILE")
elif [ -n "$BASE_ENV_FILE" ] && [ "$KEPPO_ENVIRONMENT" != "production" ]; then
  echo "Missing env file for KEPPO_ENVIRONMENT=${KEPPO_ENVIRONMENT}: ${BASE_ENV_FILE}" >&2
  exit 1
fi

if [ -z "${DOTENV_PRIVATE_KEY_DEV:-}" ]; then
  if [ -f "$ENV_KEYS_FILE" ]; then
    dotenv_private_key_from_file="$(node -e '
const fs = require("fs");
const source = fs.readFileSync(process.argv[1], "utf8");
for (const key of [
  "DOTENV_PRIVATE_KEY_DEV",
  "DOTENV_PRIVATE_KEY_LOCAL",
  "DOTENV_PRIVATE_KEY",
]) {
  const match = source.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (match) {
    process.stdout.write(match[1].trim());
    process.exit(0);
  }
}
' "$ENV_KEYS_FILE" 2>/dev/null || true)"
    if [ -n "$dotenv_private_key_from_file" ]; then
      export DOTENV_PRIVATE_KEY_DEV="$dotenv_private_key_from_file"
    fi
  fi

  if [ -n "${DOTENV_PRIVATE_KEY_LOCAL:-}" ]; then
    export DOTENV_PRIVATE_KEY_DEV="${DOTENV_PRIVATE_KEY_LOCAL}"
  elif [ -n "${DOTENV_PRIVATE_KEY:-}" ]; then
    export DOTENV_PRIVATE_KEY_DEV="${DOTENV_PRIVATE_KEY}"
  fi
fi

if [ -n "$LOCAL_ENV_FILE" ] && [ -f "$LOCAL_ENV_FILE" ]; then
  dotenv_args+=(-f "$LOCAL_ENV_FILE")
fi

passthrough_keys=(
  BETTER_AUTH_SECRET
  KEPPO_CALLBACK_HMAC_SECRET
  KEPPO_CRON_SECRET
  KEPPO_MASTER_KEY
  KEPPO_MASTER_KEY_INTEGRATION
  KEPPO_MASTER_KEY_ACTION
  KEPPO_MASTER_KEY_BLOB
  KEPPO_OAUTH_STATE_SECRET
  OPENAI_API_KEY
  GOOGLE_CLIENT_SECRET
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
  GITHUB_CLIENT_SECRET
)

passthrough_args=()
for key in "${passthrough_keys[@]}"; do
  value="${!key:-}"
  if [ -n "$value" ]; then
    passthrough_args+=("${key}=${value}")
  fi
done

if [ "$KEPPO_ENVIRONMENT" = "preview" ] && [ ${#dotenv_args[@]} -eq 1 ]; then
  if [ ${#passthrough_args[@]} -gt 0 ]; then
    exec env "${passthrough_args[@]}" "$@"
  fi
  exec "$@"
fi

if [ ${#passthrough_args[@]} -gt 0 ]; then
  exec pnpm exec dotenvx "${dotenv_args[@]}" -- env "${passthrough_args[@]}" "$@"
fi

exec pnpm exec dotenvx "${dotenv_args[@]}" -- "$@"
