FROM node:22-bookworm

WORKDIR /sandbox

# Runner CLIs are installed by name; pinning happens in package lock management
# in deployment automation for reproducible images.
RUN npm install -g @openai/codex @anthropic-ai/claude-code || true

COPY <<'EOF' /usr/local/bin/automation-sandbox-entrypoint.sh
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
