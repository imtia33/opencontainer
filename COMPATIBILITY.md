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
- `process.platform` → `browser` · `process.arch` → `wasm32` (same observable class as the incumbent)
- Genuine Node.js JS source execution: `lib/**` from nodejs.org (MIT), loaded by the real CJS loader
- Reimplemented native bindings: all `internalBinding` surfaces (TypeScript)
- Browser API substitutions: fetch (outbound HTTP), OPFS (disk), WebCrypto (crypto), DecompressionStream/fflate (zlib), MessageChannel (IPC)
- Unsupported operating-system capabilities: real TCP sockets to external hosts, unix signals from other OS processes, native addons, threads — see the unsupported table

**Vendored-source patches (documented, minimal):**
1. `lib/fs.js` — `vfsState` handler hooks (the upstream-identical interception point node uses for its own SEA VFS) + `rmSync` honors `force` at the binding boundary (node's C++ rimraf tolerates a missing root when JS skipped the pre-check; ours did not, fixed 2026-11-03).
2. `--require-module false` boot option (node v26 adds `module-sync` to CJS resolution conditions → dual packages resolve to `.mjs` → `require(esm)`, which needs ESM. Disabling it routes dual packages to their legacy CJS entries — a documented divergence until S5).

---

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
| `npx create-vite@latest …` | **Unsupported at the tool level** | the package *installs* (105 deps, real registry) but the generator is ESM-first and crashes at the ESM boundary with a descriptive internal error — see §4 |
| `pnpm create vite …` | **Unsupported at the tool level** | same boundary (routes to the same create-* packages) |
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
| stdin/stdout/stderr | **Fully implemented and tested** | tty passthrough, pipes between guest processes, ignore |
| Process limits | **Partial (documented)** | max 8 live processes per session; child spawn beyond → EAGAIN (surfaced as `spawn … EAGAIN`) |

## 3. Networking (the S3 milestone)

| Feature | Status | Evidence |
|---|---|---|
| `http.createServer` / `net.Server.listen` | **Fully implemented and tested** | node's real http stack on virtual TCP; express 5 serves real requests |
| Preview URLs `/opencontainer/p/<port>/<path>` | **Fully implemented and tested** | Service Worker synthesizes real HTTP/1.1 wire bytes → MessageChannel → virtual TCP → node's real parser; response bytes parsed back into a browser Response. JSON + HTML + concurrent fetches verified |
| Multiple simultaneous servers | **Fully implemented and tested** | express :3000 + raw http :4173 concurrently; independent previews; kill A does not affect B; A restarts on the same port |
| EADDRINUSE | **Fully implemented and tested** | synchronous port mirror in `bind()` + async `emitErrorNT` path; crash prints the real stack, exit 1 |
| In-guest loopback client (`http.get('http://localhost:3000')`) | **Fully implemented and tested** | virtual connection pairs between processes |
| Outbound HTTP to external hosts | **Partially implemented** | `fetch`-bridged where tools use it (registry.npmjs.org verified: packuments, tarballs, integrity); raw `net.connect`/`http.request` to non-local hosts fails ENOSYS honestly |
| DNS (`dns.lookup`) | **Partial (documented divergence)** | local names resolve for the loopback path; external names are NOT resolved — never a fake IP (the S2 "lying stub" was scoped to localhost) |
| WebSockets | **Unsupported (platform limit, documented)** | a Service Worker cannot intercept WebSocket upgrades; HMR sockets need an injected client shim (roadmap S4) |
| Vite dev server / HMR | **Unsupported — blocked on ESM (S5)** | vite is ESM-only; see §4 |
| TLS / https server | **Unsupported** | honest errors |
| UDP / dgram | **Unsupported** | honest errors |

## 4. Module systems — the ESM boundary

| Feature | Status |
|---|---|
| CommonJS (`require`, real loader, package.json resolution, `.bin` shebangs) | **Fully implemented and tested** |
| ESM (`import`, `import()`, top-level await, `module_wrap`) | **Unsupported with descriptive error** — `ModuleWrap` construction throws a precise "not implemented yet (S5)" message. **This is the single largest compatibility boundary.** It blocks: Vite and all ESM-first tools (`npx create-vite` scaffolding crashes here — the install itself succeeds), Next.js dev, the real npm/pnpm CLIs (ESM-only deps in their trees), Yarn Berry |
| Dual CJS/ESM packages | **Partial (documented divergence)** | `--require-module false` routes requires to legacy CJS entries (upstream behavior would need ESM) |
| `require(esm)` | **Unsupported with descriptive error** |

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

| Feature | Status | Evidence |
|---|---|---|
| Project files survive reload | **Fully implemented and tested** | OPFS full-tree save (debounced 1.5 s + command boundaries); host-written files fixed 2026-11-03 (write-file RPC now reaches the keeper before the save) |
| `node_modules` survive reload | **Fully implemented and tested** | express + cowsay re-required after reload with **zero** registry requests |
| Cross-process file visibility | **Fully implemented and tested** | file written in process A visible in process B (harness 33/33) |
| Server restart on persisted project | **Fully implemented and tested** | reload → `node app.js` → preview serves again |
| Storage | OPFS sync access handles inside the worker; quota ~10.75 GB observed; best-effort eviction per MDN behavior | not a node API — browser substitution |

## 7. Security model (consumer-facing summary)

- **Dependency lifecycle scripts are blocked by default** (pnpm 10 precedent): an untrusted `postinstall` runs with the page's origin — same-origin authenticated fetch is the threat. Root-project scripts always run; per-project allowlist via `"opencontainer": { "allowScripts": [...] }` or `--allow-scripts`.
- Guest = dedicated worker: no DOM/localStorage access; full same-origin OPFS/IndexedDB/Cache access (origin isolation architecture is the S4 milestone).
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
