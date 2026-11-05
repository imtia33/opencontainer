# OpenContainer — The Aim (Contract)

> **What we are building:** An open-source (MIT), commercially-usable, drop-in alternative to
> StackBlitz WebContainers that runs **real Node.js projects in the browser**.
>
> **The engine strategy (decided 2026-11-02, evidence-based):** the same architecture class as
> the incumbent, built from scratch:
>
> 1. **Node.js's real `lib/*.js`** (vendored unmodified from nodejs.org, currently **v26.13.0 LTS**,
>    MIT) executed on the **browser's own JS engine** (V8/JSC) → real Node semantics at JIT speed.
> 2. **The ~25 C++ `internalBinding` natives implemented in browser JS** (fs → virtual FS,
>    uv → browser event loop, zlib → fflate, crypto → WebCrypto + pure JS, http_parser → JS
>    parser, tcp_wrap/pipe_wrap → virtual sockets bridged to fetch/ServiceWorker).
>    StackBlitz compiled these to WASM with Emscripten; we implement them on browser primitives —
>    no C++ toolchain needed.
> 3. **The real npm CLI** (vendored from Node's `deps/npm`, Artistic-2.0) running on top of that
>    runtime → real `npm init`, `npm install` from the real registry over the fetch bridge.
> 4. A **WebContainer-compatible facade** published as `@open-webcontainer/api`.
>
> Evidence base: teardown-verified WebContainers architecture (Node lib + browser engine + WASM
> natives); Vivari (MIT) proves the class runs real npm installs in-browser; our v86 research
> proves the fallback (full x86 Linux) but at 30–50× slowdown — kept as a documented fidelity
> tier in ROADMAP, not the default engine.
>
> **Honesty policy (non-negotiable):** `process.version` reports the vendored Node version and
> IS that Node (its libraries). `process.platform: 'browser'`, `process.arch: 'wasm32'` — same
> observable behavior as the incumbent, which also reports wasm32 and sets `REQUIRES_WASM`.
> Every divergence is documented in COMPATIBILITY.md. We never claim to be a Linux binary.

## Non-negotiable acceptance criteria

1. `node -v` → `v26.13.0` (derived from vendored source, never a hardcoded fake).
2. `npm -v` / `npx -v` → real values from the vendored npm CLI.
3. `node -e "console.log(process.version)"` executes with real Node internals
   (real `util.format`, real `Buffer`, real `path`, real `events`…).
4. `npm init -y` writes a real package.json via the real npm CLI.
5. `npm install express` performs a REAL network install from registry.npmjs.org
   (fetch bridge; registry CORS is open — verified) writing real `node_modules`.
6. `node server.js` runs the real Express server on port 3000; the preview URL
   serves `OpenContainer is working!` through the Service Worker bridge.
7. Drop-in facade: `import { WebContainer } from '@open-webcontainer/api'` with
   `boot / fs / mount / spawn / spawnJSH / on('server-ready'|'port'|'preview-message'|'error') / teardown`.
8. Amplify integration contract satisfied (OSC 654 jsh, `internal.watchPaths`,
   `internal.textSearch`, `setPreviewScript`, Dirents, ENOENT error shapes — see
   docs/AMPLIFY_CONTRACT.md).

## Architecture (target)

```
Main thread                     Kernel Worker (no SAB, no COOP/COEP required)
┌─────────────────┐             ┌───────────────────────────────────────────┐
│ App (any SPA /  │  RPC        │  bootstrap: primordials + internalBinding  │
│ Next.js / Vue)  │◄───────────►│  registry + module loader                  │
│                 │ (postMsg)   │                                            │
│ @open-          │             │  Node lib/*.js (vendored, unmodified)      │
│  webcontainer/  │             │    ├─ CJS loader (real internal/modules)   │
│  api facade     │             │    ├─ real npm CLI (deps/npm)              │
│                 │             │    └─ user code                            │
│ Service Worker  │  preview    │  natives (JS): fs(memory+OPFS sync),       │
│ /__oc/preview/  │◄───────────►│    uv(timers), net(virtual TCP), zlib,    │
│   :port/*       │ MessageCh.  │    crypto, http_parser, child_process      │
└─────────────────┘             │  process manager: PIDs, exit codes, kill,  │
                                │    PTY resize, stdio streams               │
                                │  outbound net → fetch bridge (CORS-shaped) │
                                └───────────────────────────────────────────┘
```

- **No SharedArrayBuffer** in the default engine → no COOP/COEP headers → runs on any host.
  (The incumbent cannot say this.) Persistence via OPFS sync access handles inside the worker.
- **Fidelity tier (ROADMAP):** optional v86 (BSD-2) x86 Linux engine for native addons;
  not the default (30–50× slower, needs a built image).

## Stage plan (build order)

- **S0** Vendoring + inventory ✅ (node v26.13.0 lib + npm CLI in `src/packages/opencontainer/vendor/`)
- **S1** Kernel bootstrap: primordials, internalBinding registry, memory FS, uv/timers, CJS
  loader → `node -e` with real internals. Cold, honest smoke test.
- **S2** Native bindings for npm: fs (full), path/child_process/spawn, tty, readline →
  real `npm init -y`, then `npm install express` over the fetch bridge (net/tcp → fetch).
  S2.5 (done): `pnpm add` with pnpm's symlinked `.pnpm` layout, per-range version
  resolution and strict resolution (pnpm-oc) — same scenario-A boundaries as npm-oc;
  both real CLIs land together in S5.
- **S3** ✅ **http_parser + net server + SW preview bridge → `node server.js` (Express :3000) →
  preview URL serves real responses; `server-ready` events.** Verified end-to-end in real
  Chromium (driver 23/23): npm run dev (script → sh → node), preview fetches (JSON/HTML/
  concurrent) through the Service Worker bridge, multiple simultaneous servers, EADDRINUSE
  (sync mirror + async crash path), in-guest loopback clients, npx + pnpm dlx/exec with
  cache isolation, kill/restart, OPFS persistence across reloads (zero-network hydration),
  `cd`/`pwd` shell navigation, `fs.watch` events. ESM remains the S5 boundary — see
  COMPATIBILITY.md §4 and docs/adr-001-preview-networking.md.
- **S4** Process manager hardening (kill trees, resize, combined output stream), jsh shell with
  OSC 654 protocol, watchPaths (+buffers), textSearch, setPreviewScript, preview-message,
  WebSocket transport for HMR (SW cannot intercept WS — ADR-001), origin isolation.
- **S5** User-land ESM (`module_wrap`) → unblocks Vite/create-vite/Next.js dev and the real
  npm/pnpm CLIs. Then `@open-webcontainer/api` facade typed from the real
  `@webcontainer/api` .d.ts, demo IDE UI (terminal/file tree/editor/preview/templates),
  docs (ARCHITECTURE, COMPATIBILITY, SECURITY, LICENSING, ROADMAP, THIRD_PARTY_LICENSES).
- **S6** agent-browser end-to-end acceptance run of criteria 1–7.

## What we are explicitly NOT doing

- No QuickJS engine claiming to be Node (superseded; the old prototype's process-manager/RPC
  patterns may be adapted, the engine is retired).
- No remote/cloud execution for ordinary workloads (browser-native only).
- No fake package manager, no fake `node -v`, no hardcoded version strings.
- No proprietary dependencies (NodeBox EULA, CheerpX, hosted StackBlitz services — all rejected
  by research).
