FROM node:22-bookworm

WORKDIR /sandbox

# Pin Codex in the sandbox image so local and image-based automation runners
# use the same CLI build as the remote bootstrap path.
RUN npm install -g @openai/codex@0.118.0 || true

RUN cat <<'EOF' >/usr/local/bin/automation-sandbox-entrypoint.sh
#!/usr/bin/env bash
set -euo pipefail

if [ -z "${KEPPO_RUNNER_COMMAND:-}" ]; then
  echo "KEPPO_RUNNER_COMMAND is required" >&2
  exit 1
fi

exec sh -lc "${KEPPO_RUNNER_COMMAND}"
EOF

RUN chmod +x /usr/local/bin/automation-sandbox-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/automation-sandbox-entrypoint.sh"]
