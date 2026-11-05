#!/usr/bin/env bash
# OpenContainer — build the kernel worker + pack the runtime blob into public/.
#
# The kernel worker is bundled standalone (bun build → plain ESM) so the app
# can spawn it with `new Worker('/opencontainer/kernel-worker.js')` without
# depending on the app bundler's worker support.
#
# The vendored Node sources are packed into ONE gzip'd .ocrt blob per
# scripts/pack-runtime.ts (content-addressed; served from
# /opencontainer/runtime/). amaro (TypeScript) is a separate lazy blob.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[opencontainer] bundling kernel worker..."
bun build src/packages/opencontainer/kernel/worker-entry.ts \
  --target=browser \
  --format=esm \
  --outfile=public/opencontainer/kernel-worker.js

echo "[opencontainer] packing runtime blob..."
bun run scripts/pack-runtime.ts

echo "[opencontainer] done."
ls -la public/opencontainer/ | head -6
ls -la public/opencontainer/runtime/ | head -6
