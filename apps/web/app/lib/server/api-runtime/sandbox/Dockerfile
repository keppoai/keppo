FROM node:22-bookworm

WORKDIR /sandbox

# Pin the repo-owned Agents SDK runner dependencies in the sandbox image so
# local and image-based automation sandboxes match the remote bootstrap path.
RUN mkdir -p /sandbox/.keppo-automation-runner && \
  npm install --no-audit --no-fund --prefix /sandbox/.keppo-automation-runner @openai/agents@0.8.2

RUN cat <<'EOF' >/usr/local/bin/automation-sandbox-entrypoint.sh
#!/usr/bin/env bash
set -euo pipefail

if [ -n "${KEPPO_RUNNER_SOURCE_BASE64:-}" ]; then
  if [ -z "${KEPPO_RUNNER_ENTRYPOINT_PATH:-}" ]; then
    echo "KEPPO_RUNNER_ENTRYPOINT_PATH is required when KEPPO_RUNNER_SOURCE_BASE64 is set" >&2
    exit 1
  fi

  mkdir -p "$(dirname "${KEPPO_RUNNER_ENTRYPOINT_PATH}")"
  printf '%s' "${KEPPO_RUNNER_SOURCE_BASE64}" | base64 -d > "${KEPPO_RUNNER_ENTRYPOINT_PATH}"
fi

if [ -z "${KEPPO_RUNNER_COMMAND:-}" ]; then
  echo "KEPPO_RUNNER_COMMAND is required" >&2
  exit 1
fi

exec sh -lc "${KEPPO_RUNNER_COMMAND}"
EOF

RUN chmod +x /usr/local/bin/automation-sandbox-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/automation-sandbox-entrypoint.sh"]
