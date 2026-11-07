# OpenContainer — Compatibility Matrix

> **What OpenContainer is:** Node.js's real JavaScript sources (vendored, unmodified
> except the two documented patches below) executing on the browser's own JS engine,
> with the ~25 C++ `internalBinding` natives reimplemented in TypeScript over browser
> primitives. It is NOT a Linux machine and never claims to be.
>
> **Honesty policy (non-negotiable):** a feature is listed here exactly as verified.
> "Fully implemented and tested" means an end-to-end test in real Chromium exercised
> it this milestone. "Loadable but behaviorally unverified" means it imports and
> satisfies destructuring — nothing more. Nothing is claimed because a module loads.

**Engine identity:**
- `process.version` → `v26.13.0` (derived from the vendored source; never hardcoded)
- `process.platform` → `linux` · `process.arch` → `wasm32` (same observable class as the incumbent)
- Genuine Node.js JS source execution: `lib/**` from nodejs.org (MIT), loaded by the real CJS loader
- Reimplemented native bindings: all `internalBinding` surfaces (TypeScript)
- Browser API substitutions: fetch (outbound HTTP), in-memory VFS (disk), WebCrypto (crypto), DecompressionStream/fflate (zlib), MessageChannel (IPC)
- Unsupported operating-system capabilities: real TCP sockets to external hosts, unix signals from other OS processes, native addons, threads — see the unsupported table

**Vendored-source patches (documented, minimal):**
1. `lib/fs.js` — `vfsState` handler hooks (the upstream-identical interception point node uses for its own SEA VFS) + `rmSync` honors `force` at the binding boundary (node's C++ rimraf tolerates a missing root when JS skipped the pre-check; ours did not, fixed 2026-11-03).
2. `--require-module false` boot option (node v26 adds `module-sync` to CJS resolution conditions → dual packages resolve to `.mjs` → `require(esm)`, which needs ESM. Disabling it routes dual packages to their legacy CJS entries — a documented divergence until S5).

---

## 0. Embedding & hosting model (vs WebContainer)

| Aspect | WebContainer | OpenContainer |
|---|---|---|
| Install | `npm i @webcontainer/api` | `npm i opencontainer` — swap the import, same API surface (boot/mount/spawn/fs/on/teardown/setPreviewScript) |
| Runtime assets | fetched at boot from StackBlitz's origin | fetched at boot from jsDelivr, pinned to the installed version (`assetsBase` overrides; same-origin path = self-hosted) |
| Cross-origin isolation | **required** (SharedArrayBuffer for the WASM thread → COOP+COEP headers on your page) | **not required** (no WASM thread, no SAB anywhere: worker↔host is postMessage, sync fs never crosses threads) — `coep` boot option is an accepted no-op |
| Registry networking | their infra | browser → registry.npmjs.org directly (see §3 outbound HTTP) |
| Preview URLs | their origin | `/opencontainer/p/<port>/` via a ServiceWorker that must sit on your origin (browser spec); auto-registered at boot, `cp -r node_modules/opencontainer/public/opencontainer ./public/` is the only setup step |
| License | commercial for production | MIT |

## 1. Developer commands

| Command | Status | Evidence (real Chromium, this milestone) |
|---|---|---|
| `node -v` | **Fully implemented and tested** | prints `v26.13.0` from the vendored source |
| `node -e "…"` | **Fully implemented and tested** | real internals (Buffer/path/util/events); uncaught exceptions print the real stack + `Node.js v26.13.0` banner and exit 1 |
| `node file.js` | **Fully implemented and tested** | relative to the shell cwd; `process.cwd()` correct; express servers run |
| `node` (REPL) | **Fully implemented and tested** | multiline input, history, `.help`, tab-completion, Ctrl+C → SIGINT, `.exit` |
| `node -p` | **Fully implemented and tested** | print mode through the real eval flow |
| `npm init -y` | **Fully implemented and tested** | writes a real package.json via npm-oc |
| `npm install <pkg>` | **Fully implemented and tested (scenario A)** | real registry fetch, corgi packuments, sha512/sha1 SRI via real crypto, ustar/GNU/pax tar extraction, flat-hoisted tree, `.bin` links. Cold express: 68 pkgs ≈ 16 s |
| `npm run <script>` | **Fully implemented and tested** | pre/post scripts, `npm_lifecycle_*` env, `&&`/`\|\|`/`;`/`>`/`>>`/`2>&1` through sh; exit codes propagate (`exit 3` → "exited with code 3") |
| `npm run dev` (server) | **Fully implemented and tested** | script → sh → `node server.js`; real listen event; preview bridge serves real responses |
| `npm ls` / `npm -v` | **Fully implemented and tested** | tree listing; honest banner |
| `npx <pkg>` / `npx -y pkg@ver` | **Fully implemented and tested** | local `.bin` wins; otherwise `_npx` cache install (real registry) + bin exec via sh; scoped/version specs supported |
| `npm exec -- <cmd>` | **Fully implemented and tested** | same engine as npx (`npm-oc/exec.js`) |
| `pnpm install / add` | **Fully implemented and tested** | symlinked `.pnpm` virtual store, per-range resolution, strict dependency semantics |
| `pnpm run` | **Fully implemented and tested** | same script engine |
| `pnpm exec <cmd>` | **Fully implemented and tested** | **node_modules/.bin only** — never installs, never falls back to `_npx` (verified isolation probe) |
| `pnpm dlx <pkg>` | **Fully implemented and tested** | dlx cache at `/home/node/.cache/pnpm/dlx/…`; does not touch project deps (verified) |
| `pnpm remove / why / ls / store path` | **Fully implemented and tested** | S2.5 milestone + regression suites (30/30) |
| `sh` (oc-sh) | **Fully implemented and tested** | POSIX subset: `;` `\|\|` `&&` `>` `>>` `2>&1`, env prefix, `$VAR` expansion, shebang dispatch, PATH lookup, ENOENT → 127 with message |
| `cd <dir>` / `pwd` | **Fully implemented and tested** | shell cwd tracked; relative script resolution; prompt shows cwd; honest ENOENT |
| `<cmd> &`, `jobs`, `ps`, `kill <pid> [SIG]` | **Fully implemented and tested** | background processes; listen state in jobs; SIGTERM/SIGINT semantics |
| `corepack` | **Unsupported with descriptive error** | honest banner: not distributed (real corepack lands with the real npm CLI in S5) |
| `npx create-vite@latest …` | **Fully implemented and tested (real Chromium)** | ESM generator runs end-to-end; scaffolded tree + file contents verified in the VFS through the facade fs API (package.json, index.html, src/main.js, src/counter.js, public/*.svg) |
| `npx create-expo-app@latest …` | **Fully implemented and tested (real Chromium)** | binary-exact template extraction; App.js/app.json/assets verified in the VFS |
| `vite` dev server | **Blocked on esbuild, not ESM** | ESM machinery runs vite's CLI graph, but vite hard-depends on the esbuild NATIVE binary (ELF) for dep-optimization/transforms — a browser container cannot exec it. Same class of block in WebContainer is solved by their vendored esbuild-wasm; an equivalent shim is roadmap |
| Yarn Classic / Yarn Berry | **Unsupported (roadmap S6+)** | not implemented; honest "command not found" |
| Git dependencies (`npm i user/repo`) | **Unsupported** | no git client in the browser; honest error at install |

## 2. Runtime & process model

| Feature | Status | Notes |
|---|---|---|
| Process manager (pid table, parent/children) | **Fully implemented and tested** | one kernel worker per process; nested children via guest `child_process` (pid 8 → 8001 → 8001001) |
| `child_process.spawn` | **Fully implemented and tested** | piped stdio (stdin round-trip), exit codes, ENOENT → error event, argv[1] resolved `.bin` path |
| `child_process.exec/execFile` | **Partially implemented** | routed through the same engine; string-buffer semantics covered by sh tests; full option surface not exhaustively tested |
| `child_process.spawnSync/execSync` | **Unsupported with descriptive error** | honest ENOSYS (never a silent no-op) |
| Exit codes & signals | **Fully implemented and tested** | SIGINT → JS listener or 130; SIGTERM/SIGKILL → worker terminate; `kill <pid>` from the shell |
| Foreground/background, job messages | **Fully implemented and tested** | bash-style prompt redraw after background output (job messages, listen events) |
| stdin/stdout/stderr | **Fully implemented and tested** | tty passthrough, pipes between guest processes, ignore. Terminal (tty) output carries the kernel line discipline: NL is translated to CR-NL (termios OPOST/ONLCR) exactly like a real TTY, so hosts run xterm with `convertEol:false` and multi-line guest output renders flush-left; piped/programmatic stdio (`spawnProgram` output streams) stays byte-exact |
| Process limits | **Partial (documented)** | max 8 live processes per session; child spawn beyond → EAGAIN (surfaced as `spawn … EAGAIN`) |

## 3. Networking (the S3 milestone)

| Feature | Status | Evidence |
|---|---|---|
| `http.createServer` / `net.Server.listen` | **Fully implemented and tested** | node's real http stack on virtual TCP; express 5 serves real requests |
| Preview URLs `/opencontainer/p/<port>/<path>` | **Fully implemented and tested** | Service Worker synthesizes real HTTP/1.1 wire bytes → MessageChannel → virtual TCP → node's real parser; response bytes parsed back into a browser Response. JSON + HTML + concurrent fetches verified |
| Preview routing (multi-tab) | **Implemented (ownership protocol)** | runtimes announce port ownership (oc-port-owner) and answer a pull broadcast (oc-who-owns/oc-claim), so the SW routes each preview request to the page whose runtime owns the port — restart-safe. Known edge: cross-tab previews while the OWNING tab's ServiceWorker instance is mid-restart can transiently answer 'upstream closed'; retry recovers |
| Runtime asset serving | **Self-hosting requirement** | `.ocrt` blobs must be served as-is (application/octet-stream, NO `Content-Encoding: gzip`). The kernel sniffs OCRT/gzip magic and survives transparently-decoded bodies, but hosts that stamp `Content-Encoding: gzip` on `.gz`-suffixed files (vite dev/sirv precompressed, serve-static precompressed, GitHub Pages) made worker-context fetches fail outright — hence the `.ocrt` rename |
| Multiple simultaneous servers | **Fully implemented and tested** | express :3000 + raw http :4173 concurrently; independent previews; kill A does not affect B; A restarts on the same port |
| EADDRINUSE | **Fully implemented and tested** | synchronous port mirror in `bind()` + async `emitErrorNT` path; crash prints the real stack, exit 1 |
| In-guest loopback client (`http.get('http://localhost:3000')`) | **Fully implemented and tested** | virtual connection pairs between processes |
| Outbound HTTP to external hosts | **Partially implemented** | `fetch`-bridged where tools use it (registry.npmjs.org verified: packuments, tarballs, integrity); raw `net.connect`/`http.request` to non-local hosts fails ENOSYS honestly |
| Cross-origin request headers | **Documented divergence** | cross-origin requests are reduced to CORS-simple requests: non-safelisted request headers (`npm-*` advisory telemetry, `referer`, `user-agent`, `authorization`, …) are silently dropped — registry.npmjs.org answers `Access-Control-Allow-Origin: *` on simple requests but 404s preflights; npm's advisory headers are telemetry, not protocol. Etag revalidation survives (`if-none-match` is spec-safelisted). An embedder `outboundRewrite` hook remains for private-registry setups |
| `npm audit` | **Off by default (documented divergence)** | audit's bulk-advisories POST has a JSON content-type (never CORS-simple → would preflight → registry 404s OPTIONS); it is optional telemetry, not install correctness. Override per-process: spawn with env `{ npm_config_audit: 'true' }` behind your own bridge |
| DNS (`dns.lookup`) | **Partial (documented divergence)** | local names resolve for the loopback path; external names are NOT resolved — never a fake IP (the S2 "lying stub" was scoped to localhost) |
| WebSockets | **Unsupported (platform limit, documented)** | a Service Worker cannot intercept WebSocket upgrades; HMR sockets need an injected client shim (roadmap S4) |
| Vite dev server / HMR | **Unsupported — blocked on ESM (S5)** | vite is ESM-only; see §4 |
| TLS / https server | **Unsupported** | honest errors |
| UDP / dgram | **Unsupported** | honest errors |

## 4. Module systems

| Feature | Status |
|---|---|
| CommonJS (`require`, real loader, package.json resolution, `.bin` shebangs) | **Fully implemented and tested** |
| ESM entry points (`import` statements, `export`, top-level await) | **Implemented (esm-graph)** — real V8 module linking: resolve + acorn parse + minimal rewrite, modules served as in-worker blob: URLs, linked/evaluated by the engine. Verified by real Chromium E2E: `npx create-vite` and `npx create-expo-app` end-to-end, npm 12's `import('chalk')` (ESM-only dep) |
| Dynamic `import()` (literal AND computed specifiers) | **Implemented and tested** — rewritten to the importer, resolved at EVALUATION time (node's optional-peer semantics: unresolvable specifiers reject inside the guest's own catch) |
| `require(esm)` | **🚧 In progress** — the ESM→CJS transform is wired through the real loader, but crashes on real-world graphs (e.g. chalk's `#imports` package specifiers) — repro: `scripts/test-req-esm.ts`. The ESM ENTRY and dynamic-import() paths are the verified ones |
| Cyclic ESM graphs | **Partial (documented divergence)** — cycle back-edges route through a dynamic-import shim: the edge gets SNAPSHOT bindings instead of live bindings (names from `export * from` are missing on the shimmed edge). Acyclic graphs link statically with full live-binding semantics |
| `import.meta.url` | `file://<encoded-vfs-path>` (path-derived; `fileURLToPath` round-trips) |
| data:/file: URL specifiers | **Unsupported with descriptive error** |

## 5. Node API surface (by module)

**Fully implemented and tested:** `fs` (roundtrips, streams via fd, mkdir recursive, rm force, symlink/readlink/lstat, watch — see partial note, stat family, realpath, copyFile), `path`, `util` (inspect, format, promisify basics), `events`, `buffer`, `url`/`URL`, `querystring`, `assert`, `string_decoder`, `timers` (+promises), `stream` (+consumers/web used paths), `console`, `repl`, `readline` (tty paths), `crypto` (Hash/HMAC/PBKDF2/random: 212/212 FIPS vectors; WebCrypto substitution), `zlib` (CRC-32 real; gzip/gunzip used by tar extraction; streaming handles = fflate where exercised), `http` (server + client over virtual TCP), `net` (server + loopback client), `tty` (cooked mode, ETX→SIGINT, resize), `os` (browser-honest values), `process` (exit codes, signals, chdir/umask/initCwd wired 2026-11-03, env, title), `child_process` (spawn family), `vm` (ContextifyScript eval paths used by the loader), `module` (CJS loader is node's own).

**Partially implemented:**
- `fs.watch` — real events fire through the fs_event binding (`change` with filename; `rename` may report `null` filename — divergence)
- `zlib` streaming API — loadable; compression/decompression exercised through tarball extraction and the host gunzip bridge; full option surface unverified
- `http_parser` — real parser wired into server and client paths; exercised for GET/POST/keep-alive/chunked/pipelined responses (33/33 harness); exotic edge cases unverified
- `dns` — see §3

**Loadable but behaviorally unverified:** `v8` (heap-stat buffers), `async_wrap`/`async_hooks` (ASL documented divergence), `diagnostics_channel`, `inspector` loadable, `perf_hooks` surface, `worker_threads` module shell, `sqlite` (throws on open — honest), `cluster` (loads, non-functional), `https` (loads; TLS unsupported).

**Unsupported with descriptive errors (never silent):** ESM `module_wrap`; `spawn_sync`; external TCP (`ENOSYS`); `tls`/`https` server; `dgram`; `http2`; native addons (`node-gyp` — needs a real toolchain; documented out of scope); `process.execve`; `getLinkedBinding`.

## 6. Persistence & storage

**Product contract (2026-11-07): the guest environment is TEMPORARY.** Nothing
about the guest filesystem, installed dependencies, or process state survives a
reload — the host application supplies project files again for every fresh
session (the upstream WebContainers no-persistence model). The former OPFS
guest-VFS keeper was removed for violating this contract; losing
`node_modules` after a reload is expected behavior, not a bug.

| Feature | Status | Evidence |
|---|---|---|
| Cross-reload persistence of guest files | **Removed by design** | temporary-environment contract; enforced by the temp-env E2E driver |
| Cross-process file visibility (in-session) | **Fully implemented and tested** | file written in process A visible in process B (harness 33/33) |
| Immutable runtime-asset cache | **Implemented** | Cache API (not OPFS): `.ocrt` blobs cached per content hash so re-boots skip the ~7 MB download; never restores guest state |
| Storage | Cache API for immutable runtime assets only; no guest-state storage | not a node API — browser substitution |

## 7. Security model (consumer-facing summary)

- **Dependency lifecycle scripts are blocked by default** (pnpm 10 precedent): an untrusted `postinstall` runs with the page's origin — same-origin authenticated fetch is the threat. Root-project scripts always run; per-project allowlist via `"opencontainer": { "allowScripts": [...] }` or `--allow-scripts`.
- Guest = dedicated worker: no DOM/localStorage access; same-origin Cache access for immutable runtime assets only (origin isolation architecture is the S4 milestone).
- Process limit (8) bounds CPU/worker exhaustion; `kill`/teardown terminate workers hard.

## 8. Platform divergences (complete list)

1. `process.platform: 'browser'`, `process.arch: 'wasm32'`, `os.type()` browser-honest.
2. No real kernel: signals are JS-dispatched; SIGTERM/SIGKILL terminate the worker.
3. TCP is virtual: listen/connect only within the OpenContainer origin; external hosts fail ENOSYS.
4. Previews route through a Service Worker at root scope (`Service-Worker-Allowed: /`); WS not interceptable (§3).
5. `--require-module false` (dual-package routing, §4).
6. `fs.rmSync` force honored at the JS/binding boundary (patch #1).
7. Ephemeral listen ports pick from 40000–60000 (uv's bind would ask the OS).
8. `dns.lookup` resolves local names only; external DNS is not faked.
9. No threads, no fork of the host, no execve.

---

*Verification record: harness suites 33/33 (multi-process/TCP/http), 21/21 (tar), 12/12 (npm install), 30/30 (pnpm install); browser E2E driver 23/23 (`public/oc-s6-driver.js`, real Chromium, fresh-project scenario); persistence + multi-server + restart flows tested live 2026-11-03. Screenshots: `download/opencontainer-s3-preview-express.png`.*
