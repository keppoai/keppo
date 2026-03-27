#!/usr/bin/env bash
set -euo pipefail

test -n "${CODEX_AUTH_JSON:-}"
codex_home="${CODEX_HOME:-${HOME}/.codex}"
mkdir -p "${codex_home}"
(umask 077 && printf '%s' "${CODEX_AUTH_JSON}" > "${codex_home}/auth.json")
