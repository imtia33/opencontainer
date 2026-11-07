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

echo "[opencontainer] embedding preview shim into the service worker..."
python3 - <<'PYEOF'
import json, re
root = '.'
sw = open(f'{root}/public/opencontainer/preview-sw.js').read()
shim = open(f'{root}/public/opencontainer/preview-shim.js').read()
# The shim must survive being embedded inside a <script> tag: split any
# closing-script sequences the SW will inject it with.
shim = shim.replace('</script', '<\\/script')
# IDEMPOTENT embed: replace the whole `var OC_PREVIEW_SHIM = ...;` assignment
# (or the fresh-tree placeholder '%OC_PREVIEW_SHIM%') with the current shim.
# The old one-shot `.replace("'%OC_PREVIEW_SHIM%'", ...)` silently no-op'd on
# rebuilds once the placeholder was consumed — a stale (even corrupted) shim
# then survived every rebuild (found via a syntax-broken shim still served
# after the source was fixed).
embedded = 'var OC_PREVIEW_SHIM = ' + json.dumps(shim) + ';'
new_sw, n = re.subn(
    r"var OC_PREVIEW_SHIM = (?:'%OC_PREVIEW_SHIM%'|\"(?:[^\"\\]|\\.)*\");",
    lambda m: embedded,
    sw,
    count=1,
)
if n == 0:
    raise SystemExit('build: no OC_PREVIEW_SHIM assignment/placeholder found in preview-sw.js')
assert '%OC_PREVIEW_SHIM%' not in new_sw.replace(embedded, ''), 'placeholder not replaced'
open(f'{root}/public/opencontainer/preview-sw.js', 'w').write(new_sw)
print(f'[opencontainer]   shim {len(shim)} chars embedded (idempotent)')
PYEOF

echo "[opencontainer] packing runtime blob..."
bun run scripts/pack-runtime.ts

echo "[opencontainer] done."
ls -la public/opencontainer/ | head -6
ls -la public/opencontainer/runtime/ | head -6
