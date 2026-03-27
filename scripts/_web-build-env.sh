#!/usr/bin/env bash

trim_env_value() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

load_hosted_web_build_env_file() {
  local env_file="${1:-}"
  if [ -z "$env_file" ] || [ ! -f "$env_file" ]; then
    return 0
  fi

  while IFS=$'\t' read -r key encoded_value; do
    [ -n "$key" ] || continue
    if [ -n "$(trim_env_value "${!key:-}")" ]; then
      continue
    fi

    local decoded_value
    decoded_value="$(
      ENCODED_ENV_VALUE="$encoded_value" node - <<'EOF'
const encoded = process.env.ENCODED_ENV_VALUE ?? "";
if (!encoded) {
  process.exit(0);
}
process.stdout.write(Buffer.from(encoded, "base64").toString("utf8"));
EOF
    )"
    export "${key}=${decoded_value}"
  done < <(
    ENV_FILE_PATH="$env_file" node - <<'EOF'
const { readFileSync } = require("node:fs");
const { parseEnv } = require("node:util");

const envFile = process.env.ENV_FILE_PATH;
if (!envFile) {
  process.exit(0);
}

const parsed = parseEnv(readFileSync(envFile, "utf8"));
for (const [key, value] of Object.entries(parsed)) {
  process.stdout.write(`${key}\t${Buffer.from(value, "utf8").toString("base64")}\n`);
}
EOF
  )

  echo "Loaded hosted build env from ${env_file}."
}

derive_convex_site_url() {
  local convex_url
  convex_url="$(trim_env_value "${1:-}")"
  if [ -z "$convex_url" ]; then
    return 0
  fi

  CONVEX_URL_FOR_DERIVE="$convex_url" node - <<'EOF'
const raw = process.env.CONVEX_URL_FOR_DERIVE ?? "";
if (!raw) {
  process.exit(0);
}
const parsed = new URL(raw);
parsed.hostname = parsed.hostname.replace(/\.convex\.cloud$/u, ".convex.site");
process.stdout.write(parsed.toString().replace(/\/$/, ""));
EOF
}

ensure_hosted_web_build_env() {
  local candidate_key=""
  local candidate_value=""

  if [ -z "$(trim_env_value "${VITE_CONVEX_URL:-}")" ]; then
    candidate_value="$(trim_env_value "${CONVEX_URL:-}")"
    if [ -n "$candidate_value" ]; then
      export VITE_CONVEX_URL="$candidate_value"
      echo "Mapped CONVEX_URL to VITE_CONVEX_URL for hosted build."
    fi
  fi

  if [ -z "$(trim_env_value "${VITE_CONVEX_SITE_URL:-}")" ]; then
    candidate_value="$(trim_env_value "${CONVEX_SITE_URL:-}")"
    if [ -n "$candidate_value" ]; then
      export VITE_CONVEX_SITE_URL="$candidate_value"
      echo "Mapped CONVEX_SITE_URL to VITE_CONVEX_SITE_URL for hosted build."
    fi
  fi

  if [ -n "$(trim_env_value "${VITE_CONVEX_URL:-}")" ] && \
    [ -z "$(trim_env_value "${VITE_CONVEX_SITE_URL:-}")" ]; then
    candidate_value="$(derive_convex_site_url "${VITE_CONVEX_URL:-}")"
    if [ -n "$candidate_value" ]; then
      export VITE_CONVEX_SITE_URL="$candidate_value"
      echo "Derived VITE_CONVEX_SITE_URL from VITE_CONVEX_URL for hosted build."
    fi
  fi
}

write_preview_runtime_env_file() {
  local output_file="${1:-}"
  if [ -z "$output_file" ]; then
    echo "write_preview_runtime_env_file requires an output path." >&2
    return 1
  fi

  PREVIEW_RUNTIME_ENV_OUTPUT="$output_file" node --input-type=module - <<'EOF'
import { writeFileSync } from "node:fs";

const trim = (value) => (typeof value === "string" ? value.trim() : "");

const entries = [
  ["CONVEX_URL", trim(process.env.CONVEX_URL) || trim(process.env.VITE_CONVEX_URL)],
  [
    "VITE_CONVEX_URL",
    trim(process.env.VITE_CONVEX_URL) || trim(process.env.CONVEX_URL),
  ],
  [
    "CONVEX_SITE_URL",
    trim(process.env.CONVEX_SITE_URL) || trim(process.env.VITE_CONVEX_SITE_URL),
  ],
  [
    "VITE_CONVEX_SITE_URL",
    trim(process.env.VITE_CONVEX_SITE_URL) || trim(process.env.CONVEX_SITE_URL),
  ],
].filter(([, value]) => value.length > 0);

if (entries.length === 0) {
  throw new Error(
    "Preview build is missing Convex runtime URLs. Expected CONVEX_URL or VITE_CONVEX_URL.",
  );
}

const contents = entries
  .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
  .join("\n");
writeFileSync(process.env.PREVIEW_RUNTIME_ENV_OUTPUT, `${contents}\n`, "utf8");
EOF

  echo "Wrote preview runtime env asset to ${output_file}."
}
