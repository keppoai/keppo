#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=scripts/_convex-env.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_convex-env.sh"

setup_common_local_env_exports
pnpm exec convex dev --once --local --local-force-upgrade
sync_local_convex_runtime_env
setup_common_convex_env
