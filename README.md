# OpenContainer

**A browser-native Node.js runtime.** Run real Node.js projects, the real `npm` CLI, and real servers — entirely inside the browser, with no remote development VM in the loop. An open-source, MIT-licensed alternative to StackBlitz WebContainers.

> Status: **1.0.0-beta** — milestone P1 ("npm is npm") reached in the development sandbox. See [Status](#status) below for the honest, verified state of every subsystem.

---

## What it is

OpenContainer executes the **actual Node.js JavaScript standard library** (vendored, unmodified, currently `v26.13.0`) inside a Web Worker, on the browser's own JS engine:

- **Real Node, not a look-alike.** Node's own `lib/*.js` (511 modules) runs on a thin native-binding shim that implements the ~40 C++ `internalBinding` surfaces (fs → virtual filesystem, uv → browser event loop, zlib, http_parser, tcp/pipe wraps → virtual sockets) on browser primitives. No Node binary, no WASM Node, no code interpreter faking it.
- **Real npm.** The unmodified upstream npm CLI (`12.2.1`, vendored from Node's `deps/npm`, 1,941 files) runs as a guest process. `npm install express` talks to the real registry, downloads the real tarball, verifies integrity, and extracts into the guest `node_modules`.
- **A real filesystem.** OPFS-backed virtual filesystem with Node semantics (wx/EEXIST, atomic rename, symlinks for npm bin-links, watchers) and persistence across reloads.
- **Real child processes and servers.** `child_process.spawn` between guest processes, `http` servers in the guest, and a ServiceWorker-based preview bridge so guest servers are reachable from the page.
- **Honest by design.** Every intentional divergence from Node.js is documented in [COMPATIBILITY.md](./COMPATIBILITY.md). `process.platform: 'linux'`, `process.arch: 'wasm32'` — same observable shape as the incumbent. Nothing is mocked to make a demo pass.

## Architecture (60 seconds)

```
main thread                    worker (kernel)                 browser platform
──────────────                 ───────────────                 ─────────────────
OpenContainerRuntime  ⇄ postMessage ⇄  node lib/*.js (v26.13)        OPFS (VFS persistence)
  terminal (xterm.js)               │   ├─ natives: fs/uv/zlib/…    Cache API (runtime blobs)
  editor bridge                     │   ├─ VFS (in-memory + OPFS)   fetch() (registry, CORS bridge)
  preview SW bridge                 │   └─ process manager          ServiceWorker (preview URLs)
                                     └─ npm 12.2.1 (vendored)       IndexedDB (IDE metadata)
```

The vendored Node sources and the npm tree are packed into content-addressed `.ocrt.gz` blobs (served from `public/opencontainer/runtime/`, cached via the Cache API) — warm kernel boot is ~220 ms.

## Quick start (embedding)

```bash
npm install opencontainer
```

1. Copy the runtime assets so the browser can fetch them:

```bash
cp -r node_modules/opencontainer/public/opencontainer ./public/
```

2. Boot and use it:

```ts
import { OpenContainerRuntime } from 'opencontainer';

const rt = new OpenContainerRuntime();
await rt.boot();                    // fetches + caches the runtime blobs

const proc = await rt.runCommand('npm --version');
// → "12.2.1" (the vendored upstream CLI)

await rt.write('/home/project/server.js`, `...`);   // VFS write
const server = await rt.runCommand('node server.js'); // guest process
```

3. Serve the **registry bridge** (see [bridge/](./bridge/)) from your host app. The guest's npm networking runs on worker `fetch()`; the registry allow-list bridge provides the same-origin hop that browser CORS requires for npm's preflighted registry calls. It is npm-registry-scoped by construction (no general proxy, no credential forwarding, https-only, SSRF-safe).

4. Register the preview ServiceWorker (`public/opencontainer/preview-sw.js`) to expose guest servers under preview URLs.

A full working embedding is a standard SPA page + terminal component; see [docs/](./docs/) for the API surface and the compatibility contract.

## Status

Verified in real Chromium (E2E drivers, evidence logs in the development sandbox):

| Capability | State |
|---|---|
| `node -v` (vendored Node v26.13.0 lib tree) | ✅ |
| `npm -v` → 12.2.1 (upstream CLI, unmodified) | ✅ |
| `npm init -y` / `npm view <pkg> version` | ✅ |
| `npm install express` from the real registry | ✅ 65 pkgs, ~16 s cold, integrity-checked |
| Express 5 serving through preview bridge | ✅ `200 P1-GATE-OK` |
| `npx create-expo-app` (interactive, end-to-end) | ✅ binary-exact extraction |
| Buffer binding parity vs native Node | ✅ 53/53 byte-identical cases |
| HTTP client (make-fetch-happen path) | ✅ 32/32 tests |
| OPFS persistence + reload hydration | ✅ |
| `require(esm)` (module_wrap shim) | 🚧 in progress (design in docs/reality-initiative) |
| pnpm / Yarn (genuine CLIs) | 🚧 P2 |
| Lifecycle scripts | 🔒 blocked by default (permission model pending) |

## Repository layout

```
src/packages/opencontainer/   the package source
  kernel/                     worker entry, VFS, natives, ESM graph, HTTP client
  ide/                        IDE glue (project store, import pipeline)
  node-std/                   main-thread node std shapes
  vendor/node-v26.13.0/       vendored Node lib tree (+ oc-sh shell, shims)
  runtime.ts                  OpenContainerRuntime — the public runtime class
  types.ts                    WebContainer-compatible public types
public/opencontainer/         served assets: kernel-worker.js, runtime blobs, preview-sw.js
vendor/npm-12.2.1/            vendored upstream npm CLI (unmodified; Artistic-2.0)
bridge/                       host-side server routes (registry CORS bridge, tarball import proxy)
scripts/                      build, pack, harness, drivers, parity tests
docs/                         architecture, ADRs, compatibility matrix
```

## Legal

- OpenContainer's own code: **MIT** (see [LICENSE](./LICENSE)).
- The vendored Node.js library tree: Node's license (see `src/packages/opencontainer/vendor/node-v26.13.0/LICENSE.node`).
- The vendored npm CLI: **Artistic-2.0** (see `vendor/npm-12.2.1/LICENSE`), redistributed unmodified with provenance recorded in `vendor/npm-12.2.1/.provenance.json`.

## Development

```bash
bun install
npm run build          # kernel worker + runtime blobs + dist bundles
npm run test:harness   # boots the vendored npm CLI in the kernel harness
```

The kernel harness (`scripts/npm-harness.ts`) runs the exact worker code path under Bun, which is the fastest way to debug binding-surface gaps ("crash-driven porting").
