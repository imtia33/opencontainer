# OpenContainer Engineering Report — WebContainer Parity Initiative

**Date:** 2026-11-06 · **Scope:** Full WebContainer parity research, repository
audit & implementation (the standing directive) · **Repo:** `imtia33/opencontainer`,
main @ `a24f1e1` (this initiative: commits `b2454ba`, `5709787` (facade), `a24f1e1`
on top of `f5ab4a7`)

---

## A — Audit (A/B/C/D/E classification, source-verified)

Full evidence tables: **`docs/AUDIT.md`** (every row cites file/test/commit).
Summary of what the code actually is — no prior claims trusted, several
corrected:

| Class | Count | Highlights |
|---|---|---|
| **A — Native/genuine upstream** | 4 stacks | node v26.13.0 lib tree (511 modules in the OCRT core blob, 70 lib + 96 internal dirs), npm 12.2.1 (1941 files, sha256-provenanced tarball), pnpm 10.34.9 (unmodified upstream; 10.x = last pure-JS line — ≥11 ships a native binary no browser container can exec), npx (npm's own libnpmexec), amaro, acorn |
| **B — Emulated/adapted** | 43 bindings | internalBinding layer in browser JS: buffer (byte-identical 53/53), fs (vendored fs.js on the VFS), tcp/pipe wraps (virtual conns), timers, zlib (fflate handle protocol 23/23, all 7 modes), crypto hashes (FIPS/RFC vectors), in-process worker_threads, fetch-backed http client (32/32), OPFS persistence |
| **C — DIY (first-party)** | core infra | VFS (POSIX semantics incl. the full rename(2) matrix), process manager (one kernel worker per process), oc-sh shell+coreutils, esm-to-cjs facade + esm-graph, preview ServiceWorker networking, oc-net registry bridge, ephemeral node_modules, OpenContainerRuntime + OpenContainerIDE |
| **D — Stubbed (honest)** | ~15 surfaces | brotli/zstd (ENOSYS), public-key crypto/TLS (descriptive throws), external TCP (UV_ENOSYS, never faked), DNS (local-only), spawn_sync, fork()/stdio:'ipc', receiveMessageOnPort, v8 profilers, corepack |
| **E — Missing (boundaries)** | 4 | native ModuleWrap sync-ESM internals (blocks Vite dev/HMR + Next.js dev — the create-* generators NO LONGER blocked), WebSockets/HMR transport, PTY, multi-node-version selection |

Corrected vs. prior beliefs during this audit: `npx create-*` generators were
believed blocked at the ESM boundary — after this initiative's kernel fixes
they run end-to-end (§D); `test-npm-real.ts` was silently dead since the pnpm
session (bun harness realm leak — §B fix 1); the engine/ + node-std/ trees are
confirmed dead code (no importers).

## B — Build (implemented this initiative)

1. **Shared-realm lifecycle fix (boot.ts)** — the bug that silently killed
   every bun-harness script running >1 process: `waitForExitSettled()` polled
   on a bare `setTimeout` that resolved to the GUEST timer system after the
   globals swap (a dying timer system refuses new schedules — runMain never
   settled; the host exited 0 on a drained loop with zero diagnostics).
   Host loop primitives now captured at MODULE scope (once per realm);
   `restoreHostGlobals()` hands the realm back to the host after the guest's
   exit handlers run (node's chain: emit('exit') → reallyExit → hooks.onExit),
   re-armed per boot. This single fix restored real-npm 12/12.
2. **WebContainer-compatible public API** (`webcontainer-api.ts`, exported
   from the package root): `WebContainer.boot({coep, workdirName,
   forwardPreviewErrors, runtime?})`, `mount()` (files, dirs, **symlinks**,
   binary), `spawn()` → `WebContainerProcess` (exit/input/output[fd1+fd2
   merged, drop-in]/stderr[extension]/resize/kill), `on()` with
   unsubscribe-fn contract (server-ready/port/error/preview-message), `fs`
   (mkdir/readdir/readFile utf-8|binary/writeFile/rm[force]/watch),
   `path`/`workdir`/`teardown()`. Extension: `boot({runtime})` adopts an
   existing OpenContainerRuntime (IDE embedders). Built on a new
   `runtime.spawnProgram()` — host-owned pipe-stdio processes — which
   required making piped-output routing node-correct (stdio{pipeId} messages
   previously fell through to the terminal event; the pipe reader never got
   the bytes).
3. **Node webstreams as globals (boot.ts)** — real node exposes
   internal/webstreams/* as the globals; we kept the browser's natives, so
   every node-stream↔web-stream crossing failed node's symbol brand checks
   ("transform.readable … Received an instance of ReadableStream"). All 17
   webstream globals now install from the vendored tree (realm-restored on
   exit). This is what unblocked tar-extracting generators.
4. **SharedArrayBuffer polyfill de-poisoned (types.ts)** — the boot alias
   (SAB→ArrayBuffer on non-isolated hosts, so guest allocators don't
   ReferenceError) made `x instanceof SharedArrayBuffer` true for EVERY
   ArrayBuffer → node's compression-stream chunk validator rejected every
   chunk. Alias-aware check at call time; binding functions no longer rely
   on `this` (node destructures them).
5. **fs O_TRUNC / O_APPEND honored (natives/fs.ts)** — `writeFileSync` over a
   longer file left the old tail; `appendFileSync` overwrote. Both open(2)
   semantics now correct.
6. **`FetchIncomingMessage.setEncoding`** — node-semantics streaming decoder
   (generator telemetry calls res.setEncoding('utf8')).
7. **POSIX rename(2) matrix + `HandleWrap.close(cb)`** (completed the prior
   session's in-flight work): full file/file-replace, dir/empty-dir,
   ENOTEMPTY/EISDIR/ENOTDIR matrix; close(cb) so net.js emits Socket 'close'
   → ChildProcess 'close'.
8. **Gates built**: `test-node-api.ts` (authenticity suite), browser drivers
   `wc-facade-driver.js`, `npx-generators-driver.js` (+ probe), harness
   multi-runtime preview router.

## C — Compatibility (vs. real WebContainers)

Baseline captured from primary sources → **`docs/webcontainer-research.md`**
(webcontainers.io API reference, guides, blog, GH #560; 2026-11-06).

- **API surface**: drop-in facade complete for boot/mount/spawn/on/fs/path/
  workdir/teardown + SymlinkNode trees + merged output streams (27/27 E2E).
  Not implemented (accepted, documented): binary snapshot mounts
  (@webcontainer/snapshot format), preview-message forwarding.
- **Isolation**: WebContainers REQUIRE COOP/COEP (SharedArrayBuffer).
  OpenContainer requires NOTHING — runs on any static host (SAB polyfilled
  only when absent; real SAB untouched on isolated hosts). Deliberate
  advantage, kept.
- **Persistence**: WebContainers reinstall every page load; we persist source
  files + .npm cache via OPFS and drop node_modules per session (WebContainer-
  parity ephemeral deps + beyond-baseline persistence).
- **Node version**: they run Node 24 default (pinnable via engines.node/
  .nvmrc); we pin the vendored v26.13.0 tree — single-version, documented.
- **npm/pnpm/npx**: genuine upstream CLIs both sides; ours verified against
  the real registry in-browser (§D).

## D — Demonstration (the 7 integration tests, all real, fresh-run on final build)

| # | Integration test | Fixture | Result (fresh, final build) |
|---|---|---|---|
| 1 | **Real npm CLI end-to-end** — init → registry install → ls → cross-process require | `scripts/test-npm-real.ts` + vendored npm 12.2.1 + real registry | **12/12 PASS** |
| 2 | **Real pnpm CLI install** — content-addressable store, .pnpm virtual store, symlink layout, fresh-process require through it | `scripts/pnpm-harness.ts` + vendored pnpm 10.34.9 + real registry | **PASS** ("downloaded 1, added 1, done") |
| 3 | **npx general capability** — `npx -y create-vite@latest cv-app --template vanilla` AND `npx -y create-expo-app@latest expo-app --template blank --no-install`, scaffolded trees verified through the fs API | `harness/e2e/npx-generators-driver.js` (real Chromium, real registry) | **7/7 PASS** (vite: index.html+package.json name=cv-app+vite devDep; expo: App.js+app.json+expo/react/react-native deps) |
| 4 | **Node runtime authenticity** — value-asserted API behavior across fs/path/Buffer/crypto/events/stream/timers/url/querystring/util/os/assert/process (FIPS/RFC vectors, POSIX rename matrix, Dirents, backpressure/drain, timer ordering) | `scripts/test-node-api.ts` (in-kernel) | **45/45 PASS** |
| 5 | **Terminal lifecycle E2E** — boot → node -v/-e → npm -v/init/install/require → npx cowsay (child process) → express dev server → preview through the ServiceWorker (HTTP 200) → kill → **reload: node_modules gone, source persists, reinstall works, require after reinstall** | `harness/e2e/m1-driver.js` (real Chromium) | **18/18 PASS** |
| 6 | **WebContainer facade drop-in** — boot/mount(symlink+binary)/fs roundtrips/spawn exit codes/merged output/stderr/input streams/server-ready/port events/preview fetch with spawn env/kill/unsubscribe/teardown guards | `harness/e2e/wc-facade-driver.js` (real Chromium) | **27/27 PASS** |
| 7 | **Binding-level parity gates** — Buffer byte-identical vs real node; zlib all 7 modes (kernel-produced gzip decompressed by REAL node zlib host-side); http client semantics | `test-buffer-parity.ts`, `test-zlib.ts`, `test-http-client.ts` | **53/53 · 23/23 · 32/32 PASS** |

Every number above was re-run on the final build during this reporting pass
(2026-11-06 22:0x UTC).

## E — Engineering discipline

- **Crash-driven porting only**: every kernel fix in §B traces to a real
  guest crash read from a real run (npm harness, generator E2E), each fixed
  minimally at the binding level and gated permanently.
- **No silent fakes**: D-class surfaces throw descriptive errors; divergences
  documented in COMPATIBILITY.md; the audit (§A) is evidence-cited per row.
- **Commits**: descriptive, cause→fix→evidence per change; regression suites
  re-run green after every kernel change (the discipline that caught the
  `this`-binding regression immediately).
- **Honest correction**: the prior "generators blocked at ESM" belief is
  corrected in AUDIT.md with the new gate as evidence.

## F — Future (remaining boundaries, prioritized)

1. **module_wrap / sync ESM internals (E-class)** — the last big blocker:
  Vite dev server transforms, HMR, Next.js dev. Path: native-ish ModuleWrap
  over the esm-graph + esm-to-cjs machinery, or a Vite-browser-mode adapter.
2. **WebSocket transport (E-class)** — SW cannot intercept WS; needed for
  HMR sockets. Design exists (S4: MessageChannel-backed in-kernel `ws` shim).
3. **Preview origin isolation** — per-port iframe origins (security review).
4. **PTY** — real terminal emulation mode for interactive CLIs (current:
  tty_wrap line discipline).
5. **Multi-version node selection** — WebContainer pins via engines.node/
  .nvmrc; we would need multiple vendored trees (blob size cost).
6. **Package polish** — the M1 single-package distribution
  (`npm install opencontainer`, no manual asset copying): the runtime blobs
  ship in-package today; the remaining work is the asset-serving contract
  for arbitrary hosts (M1 prompt staged).
