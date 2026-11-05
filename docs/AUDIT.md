# OpenContainer Repository Audit — A/B/C/D/E Classification

> Audit date: 2026-11-06. Method: **source code only** — every entry below
> was verified against the working tree at commit `b2454ba` by reading the
> file (or running its gate where a gate exists). Prior reports and claims
> were NOT trusted; where a past claim could not be reproduced in source, it
> is listed at its real state.
>
> Classification:
> - **A — Native/Genuine upstream**: unmodified upstream code, executed as-is.
> - **B — Emulated/Adapted**: real upstream code running on a browser-backed
>   reimplementation of its native layer (C++ binding → browser JS).
> - **C — DIY**: first-party reimplementation (works, but is OUR code, not
>   upstream's).
> - **D — Stubbed**: present with honest, descriptive errors (no silent
>   fakes).
> - **E — Missing**: not implemented (may be documented as a boundary).

## 1. Node.js runtime

| Component | Class | Evidence |
|---|---|---|
| `lib/*.js` + `lib/internal/**` (node v26.13.0) | **A** | `src/packages/opencontainer/vendor/node-v26.13.0/lib/` — 70 top-level lib modules + 96 internal dirs (511 modules in the OCRT core blob); booted by `kernel/boot.ts` mirroring node's own bootstrap sequence |
| Bootstrap path (is_main_thread, per_thread, switches) | **A** | vendored `internal/bootstrap/switches/is_main_thread.js` runs unmodified (boot.ts:399) |
| `internalBinding` layer (43 bindings) | **B** | `kernel/natives/*.ts` — browser JS standing in for node's C++ (buffer verified byte-identical 53/53; fs/tcp/pipe/timers/zlib/http2/… adapted) |
| zlib | **B** | fflate-backed handle protocol, all 7 modes, gate `test-zlib.ts` 23/23; Brotli/Zstd = **D** (ENOSYS, zlib.ts:378-383) |
| crypto | **B/D** | md5/sha1/2/256/384/512 Hash+Hmac (pure JS, FIPS vectors), PBKDF2, randomFill, timingSafeEqual = real; public-key/ciphers/X509/TLS = **D** descriptive throws (crypto.ts header) |
| Timers/nextTick/queueMicrotask | **B** | vendored timers.js on browser-scheduler-backed binding; ref/unref via loop census |
| Buffer | **B** | natives/buffer.ts — parity harness byte-identical vs real node 53/53 |
| `process` object | **B** | boot.ts:204+ node-exact surface (versions/platform/argv/…), wrapped methods from vendored per_thread.js |
| V8 binding (heap stats, profiler) | **B/D** | heap stats real-ish; sampling profiler/getHeapSnapshot = **D** (v8.ts:166-171) |
| ESM loader (`ModuleWrap`) | **E** | natives/module_wrap.ts throws on construct — "ESM lands in S5"; static ESM handled by **C** transform instead (§4) |
| Worker threads | **B** | in-process worker_threads (worker.ts): message passing/workerData/exit events real; no parallelism, `receiveMessageOnPort` = **D** |

## 2. Package managers (the directive's centerpiece)

| Component | Class | Evidence |
|---|---|---|
| npm 12.2.1 | **A** | `vendor/npm-12.2.1/` — upstream tarball, sha256 provenance, 1941 mounted files; real CLI executes: `test-npm-real.ts` **12/12** (init → real-registry install lodash → ls → fresh-process require), browser E2E green through commit 694510d |
| pnpm 10.34.9 | **A** | `vendor/pnpm-10.34.9/` — unmodified upstream (provenance.json: "modified": false; 10.x = last pure-JS line, ≥11 is a native binary no browser container can exec); browser E2E "downloaded 1, added 1, done" (commit f5ab4a7) + bun harness re-verified this session |
| npx | **A** | npm's own `libnpmexec` through the vendored npm CLI (`npx --yes cowsay` child-process E2E in 694510d; `_npx` cache + isolation probe in S6 driver) |
| `npx create-vite`-class generators | **A→E boundary** | install phase real (105 pkgs); generator crashes at the ESM boundary → **E** (module_wrap, §4) — honest exit 1, documented |
| corepack | **D** | stub shim (labeled) |
| npm-oc / pnpm-oc (legacy DIY) | **C** | first-party fallbacks, demoted to rollback-only (not on default PATH) |
| Registry network path | **B/C** | `/api/oc-net` CORS bridge (C, allowlist registry.npmjs.org) + fetch-backed http client (B, node http API semantics, 32/32 gate) |

## 3. Shell & coreutils

| Component | Class | Evidence |
|---|---|---|
| oc-sh (sh + coreutils) | **C** | `vendor/node-v26.13.0/oc-sh/sh.js` — ls/mkdir/rmdir/touch/cat/rm/mv/cp/head/tail/wc/which + `;`/`&&`/`\|\|` chains + redirects; S9 session verified live |
| jsh-parity interactive shell (prompt/cwd/history) | **C** | harness `app.js` + runtime `spawn` |
| Real bash | **E** | never claimed; `bash` maps to oc-sh |

## 4. ESM

| Component | Class | Evidence |
|---|---|---|
| Static import/export of ESM (npm deps) | **C** | `kernel/esm-to-cjs.ts`: acorn byte-exact import/export surgery → real CJS pipeline; live bindings/TDA/re-exports; powers npm's own ESM deps + `require(esm)` |
| Dynamic `import()` graph | **C** | `kernel/esm-graph.ts` (edges, TLA, CJS interop) — E2E 17/17 (S3.1) |
| `import.meta` | **C** | inline meta object (esm-to-cjs) |
| Native `ModuleWrap` synchronous instantiation | **E** | browser JS has no sync module instantiation — the fundamental boundary; `create-vite` generator, Vite dev/HMR, Next.js dev blocked here (documented COMPATIBILITY.md §4) |

## 5. Filesystem

| Component | Class | Evidence |
|---|---|---|
| In-memory VFS (POSIX semantics) | **C** | `kernel/vfs.ts` — full errno matrix incl. this session's rename(2) semantics matrix; Dirents, symlinks, realpath, stat modes |
| OPFS persistence | **B/C** | browser OPFS via shell-keeper process (B: real Origin Private FS API; C: our snapshot format) |
| Ephemeral node_modules | **C** | persist-time exclusion: source files + `.npm/_cacache` persist, `node_modules` dropped per session (WebContainer-parity behavior, browser-verified in 694510d reload phase) |
| fs binding (fs.js on VFS) | **B** | vendored fs.js; natives/fs.ts dual(sync/callback) with ErrnoException conversion (session-13 fixes verified by real npm) |
| fs.watch | **B** | real change/rename events (S6); rename filename may be null — documented divergence |

## 6. Networking

| Component | Class | Evidence |
|---|---|---|
| Virtual TCP (loopback) | **C** | runtime port/conn tables + kernel tcp_wrap; local pairs between guest processes; verified by express E2E + EADDRINUSE crash parity |
| Dev-server preview (ServiceWorker) | **C** | `public/opencontainer/preview-sw.js` + runtime `connectPreview` (initial-bytes delivery); HTTP 200 through SW bridge in E2E |
| Outbound HTTP(S) | **B/C** | node http API over fetch (`http-fetch-client.ts`, 1173 lines, 32/32) + `/api/oc-net` registry CORS bridge |
| DNS | **D/C** | local-only resolution (documented) |
| External TCP (arbitrary hosts) | **D** | ENOSYS honestly, never faked (tcp_wrap.ts:127) |
| WebSockets (HMR) | **E** | SW cannot intercept WS; S4 injected-transport shim not built |
| TLS server / certs | **E** | no OpenSSL (crypto §1) |

## 7. Process manager

| Component | Class | Evidence |
|---|---|---|
| One-kernel-per-process model | **C** | runtime.ts process table, pid/ppid, children |
| child_process spawn/exec | **B** | natives/process_wrap.ts: node's own child_process.js on our async spawn; `spawn_sync` = **D** ENOSYS (documented why); fork()/stdio:'ipc' = **D** descriptive |
| Pipes/stdio routing | **B/C** | pipe_wrap + runtime pipe table (this session: HandleWrap.close(cb) → Socket 'close' → ChildProcess 'close' chain completed) |
| Signals/kill | **C** | SIGINT/SIGTERM/SIGHUP dispositions, kill + port release E2E |
| Process limit | **C** | 8 live processes, EAGAIN beyond (documented; create-vite probe hit it) |

## 8. Public API

| Component | Class | Evidence |
|---|---|---|
| `OpenContainerRuntime` (terminal-oriented) | **C** | runtime.ts — boot/spawn(teardown)/cwd/preview/connectPreview/events |
| `OpenContainerIDE` | **C** | ide/container.ts — projects, imports, watchers |
| WebContainer-compatible facade (`WebContainer.boot/mount/spawn/fs/…`) | **E → built this session** | types.ts declared the surface; the class did not exist — see `webcontainer-api.ts` (added by this initiative) |

## 9. Legacy / dead code

| Component | Class | Evidence |
|---|---|---|
| `engine/` (QuickJS-era engine) | **dead** | no importer outside engine/ itself |
| `node-std/` (preludes) | **dead** | superseded by vendored node tree; not on any boot path |

## 10. Summary counts (source-verified)

- **A**: node lib tree (511 modules), npm 12.2.1 (1941 files), pnpm 10.34.9
  (1058 modules), npx (libnpmexec via npm), amaro, acorn — all upstream,
  provenance-hashed.
- **B**: 43 native bindings + http client + OPFS + worker_threads
  in-process + fs/timers/pipe/tcp streaming layers.
- **C**: VFS, oc-sh, esm-to-cjs/esm-graph, process manager, preview
  networking, oc-net bridge, ephemeral node_modules, runtime/IDE API.
- **D**: brotli/zstd, public-key crypto, TLS, external TCP, DNS (local
  only), spawn_sync, fork/ipc channels, receiveMessageOnPort, v8 profilers,
  corepack — all fail loudly with descriptive errors.
- **E**: native ModuleWrap sync ESM (the create-* generator boundary),
  WebSockets/HMR transport, PTY, bash, multi-node-version selection
  (WebContainer offers engines.node/.nvmrc pinning; we pin v26.13.0).
