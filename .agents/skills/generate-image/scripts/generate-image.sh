#!/usr/bin/env bash
set -euo pipefail

# Generate an image via the Dyad engine API.
# Usage: bash generate-image.sh "<prompt>"

PROMPT="${1:?Usage: generate-image.sh \"<prompt>\"}"

if [[ -z "${DYAD_PRO_KEY:-}" ]]; then
  echo "Error: DYAD_PRO_KEY environment variable is not set." >&2
  exit 1
fi

ENGINE_URL="${DYAD_ENGINE_URL:-https://engine.dyad.sh/v1}"
ENDPOINT="${ENGINE_URL}/images/generations"

OUT_DIR="ux-artifacts/generated"
mkdir -p "$OUT_DIR"

TIMESTAMP="$(date +%s)"
HASH="$(openssl rand -hex 8)"
FILENAME="generated-${TIMESTAMP}-${HASH}.png"
FILEPATH="${OUT_DIR}/${FILENAME}"

# Call the engine endpoint
RESPONSE="$(curl -sf "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${DYAD_PRO_KEY}" \
  -d "$(jq -n --arg prompt "$PROMPT" '{prompt: $prompt, model: "gpt-image-1.5"}')")"

# Extract base64 image data (prefer b64_json, fall back to url)
B64="$(echo "$RESPONSE" | jq -r '.data[0].b64_json // empty')"

if [[ -n "$B64" ]]; then
  echo "$B64" | base64 -d > "$FILEPATH"
else
  IMG_URL="$(echo "$RESPONSE" | jq -r '.data[0].url // empty')"
  if [[ -n "$IMG_URL" ]]; then
    curl -sf -o "$FILEPATH" "$IMG_URL"
  else
    echo "Error: No image data in response." >&2
    echo "$RESPONSE" >&2
    exit 1
  fi
fi

echo "$FILEPATH"
