#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="${SCRIPT_DIR}/.."
TEMP_ENV_FILE="${ROOT_DIR}/.env.vercel"
LOCAL_ENV_FILE="${ROOT_DIR}/.env.local"

ensure_local_env_file() {
  if [ -f "$LOCAL_ENV_FILE" ]; then
    return
  fi

  cat <<'EOF' >"$LOCAL_ENV_FILE"
# Machine-local overrides for Keppo development.
# This file is intentionally untracked; committed defaults live in .env.dev.
EOF
}

cleanup() {
  rm -f "$TEMP_ENV_FILE"
}

trap cleanup EXIT

cd "$ROOT_DIR"

if ! command -v dotenvx >/dev/null 2>&1 && ! pnpm exec dotenvx --version >/dev/null 2>&1; then
  echo "dotenvx is required for pnpm vercel-refresh" >&2
  exit 1
fi

vercel env pull "$TEMP_ENV_FILE"

vercel_oidc_token="$(node -e '
const fs = require("fs");
const path = process.argv[1];
const source = fs.readFileSync(path, "utf8");
const match = source.match(/^(?:export\s+)?VERCEL_OIDC_TOKEN=(.*)$/m);
if (!match) {
  process.exit(1);
}
let value = match[1].trim();
if (
  (value.startsWith("\"") && value.endsWith("\"")) ||
  (value.startsWith("\x27") && value.endsWith("\x27"))
) {
  value = value.slice(1, -1);
}
process.stdout.write(value);
' "$TEMP_ENV_FILE")" || {
  echo "VERCEL_OIDC_TOKEN was not found in ${TEMP_ENV_FILE}" >&2
  exit 1
}

ensure_local_env_file
pnpm exec dotenvx set VERCEL_OIDC_TOKEN "$vercel_oidc_token" --env-file "$LOCAL_ENV_FILE" --encrypt >/dev/null

echo "Updated ${LOCAL_ENV_FILE} with VERCEL_OIDC_TOKEN"
