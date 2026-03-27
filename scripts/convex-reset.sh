#!/usr/bin/env bash
set -euo pipefail

# Drop all data from the local Convex deployment by importing an empty snapshot.

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

# Create a valid empty zip file
python3 -c "
import zipfile, sys
with zipfile.ZipFile(sys.argv[1], 'w') as zf:
    pass
" "$tmpdir/empty.zip"

pnpm exec convex import --replace-all --yes "$tmpdir/empty.zip"

echo "All Convex data has been dropped."
