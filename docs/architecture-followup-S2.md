# OpenContainer — Follow-up Architecture Investigation (pre-S2)

**Date**: 2026-11-03 · **Repo**: `/home/z/my-project` · **Status**: investigation complete, S2 scoped
**Method**: repo evidence + real tests (bun harness, real Chromium via agent-browser, live registry) + vendored Node v26.13.0 source + first-hand docs. Every claim is tagged **[TESTED]** (reproduced this session), **[WORKLOG]** (verified in a previous session, re-checked where cheap), or **[ASSUMED]** (reasoned, not verified — flagged for future testing).

Companion artifacts: `docs/bindings-matrix.json` (machine-generated evidence), `scripts/investigate-bindings.ts`, `scripts/probe-express.ts`, `scripts/probe-prepstack.ts`, `scripts/npm-harness.ts`, screenshots in `download/`.

---

## §1 — Native bindings inventory & compatibility matrix

### 1.1 Quantitative surface [TESTED]

`scripts/investigate-bindings.ts` imports every binding with a mock kernel context and enumerates its real runtime surface; it also statically extracts every `internalBinding('X')` consumer from the vendored lib.

- **70 bindings registered** (36 TS files; `natives/misc.ts` bundles ~30 additional surfaces)
- **72 bindings consumed** by vendored `lib/**` (427 modules reference at least one binding)
- **Consumed but not registered: 2** — `wasm_web_api`, `stream_pipe`
- Registered but unconsumed: 0 (every surface we ship is reachable from node's own code)

Largest surfaces by property count: `uv` 79, `types` 55, `v8` 51, `fs` 50, `process_methods` 45, `symbols` 35, `crypto` 134, `modules` 30, `buffer` 30, `util` 24, `stream_wrap` 24, `module_wrap` 24, `async_wrap` 24.

The two gaps:

| Binding | Consumer | Impact |
|---|---|---|
| `wasm_web_api` | `internal/bootstrap/web/exposed-window-or-worker.js` (we never boot this file), `switches/is_main_thread.js:324` (bare call, no property access) | **Dead code for us today.** Becomes live if we ever boot the full web environment (EventSource/WebSocket globals). |
| `stream_pipe` | `internal/http2/core.js` only | Blocked behind http2, which is an empty stub. No impact until http2 work. |

### 1.2 Classification (per binding) [TESTED/WORKLOG/code-read]

| Class | Bindings | Notes |
|---|---|---|
| **Real, behavior-tested** | `fs` (roundtrips, ENOENT, recursive mkdir [WORKLOG+TESTED]), `modules` (package.json natives — user `require()` works [WORKLOG]), `crypto` (Hash/HMAC/PBKDF2/random: 212/212 vectors [WORKLOG]), `timers` (uv-faithful driver, 100-cycle [WORKLOG]), `tty_wrap` (stdin pump, cooked-mode ETX→SIGINT [WORKLOG]), `string_decoder` (streaming decode), `contextify` (Script completion semantics), `cjs_lexer`, `buffer`, `url`/`url_pattern`, `task_queue`, `errors`, `performance`, `os`, `options`, `builtins`, `encoding_binding`, `types`, `util` (probe-level), `constants`/`symbols`/`uv` (surface correctness — boot-proven), `process_methods`, `credentials` | The CJS world is genuinely node's own code on our primitives. |
| **Real, load-proven only** | `v8` (heap-stat buffers), `async_wrap` (ASL documented divergence), `misc: diagnostics_channel, async_context_frame, blob, serdes, messaging` | Load and satisfy destructuring; deeper behavior untested. |
| **Honest stubs (throw descriptively)** | `module_wrap` (ESM — planned S5), `http_parser` (S3), `spawn_sync` (ENOSYS), `sqlite`, `inspector` | Fail loudly. Correct policy. |
| **Silent stubs (no-op)** — *flagged* | `process_wrap.Process.spawn(){}`, `signal_wrap.Signal.start(){}`, `tcp_wrap.TCP` (empty class), `pipe_wrap`, `udp_wrap` (empty classes), `zlib {zlibConstants:{}}` | **Hazard class**: user code constructs/loads without error, then hangs or misbehaves later instead of failing loudly. See §5/§8. |
| **Lying stubs** — *flagged* | `cares_wrap.getaddrinfo` returns `127.0.0.1` for ANY hostname; `cares_getaddrinfo` returns the hostname itself as "IP" | Misleads DNS-dependent code. Must become honest ENOSYS or a real bridge. |

### 1.3 fs binding vs npm-tarball needs [TESTED]

The fs binding already exposes everything tar extraction needs: `symlink`, `lstat`, `readlink`, `readdir`, `mkdir`, `stat`, `open/close/read/write*`, `rename`, `rmdir`, `chmod`, `copyFile`, `realpath`, `unlink`, plus the module-loader natives (`internalModuleStat`, `legacyMainResolve`, `getFormatOfExtensionlessFile`; the package.json trio lives in `modules`). **The VFS itself implements S_IFLNK nodes with symlink targets.**

### 1.4 Public-module loadability (CJS) [WORKLOG]

`node:fs, path, util, events, url, os, querystring, assert, buffer, string_decoder, timers, timers/promises, stream (+consumers/promises/web), console, repl, crypto (partial-honest), tty, process, v8, vm (partial), module, constants` all load and pass harness smoke checks. `net, http, https, tls, dns (lookup lies — see 1.2), zlib (silent-empty), child_process (spawn throws), cluster, dgram, http2, worker_threads, ffi, wasi, sqlite` are non-functional at varying honesty levels.

---

## §2 — npm compatibility: four scenarios, evidence-based

### 2.1 What the real npm CLI needs [TESTED]

npm 11.20.0 (the version bundled with Node v26.13.0) was vendored **with its full bundled dependency tree** (565 packages, 11.7 MB unpacked, mounted into the VFS as `/usr/lib/node_modules/npm`) and booted through the real kernel CJS loader (`scripts/npm-harness.ts`).

- The kernel **boots npm's entire module graph** (1550 files, 7.9 MB mounted, module loads succeed) — the loader, fs, and bindings survive npm's import surface. [TESTED]
- First hard blocker: `lib/utils/display.js:232` — `await import('chalk')` / `await import('supports-color')`. Both are **ESM-only packages**. Dynamic `import()` from our `new Function`-compiled CJS leaks to the **host engine's** import: in bun it mis-resolves (returns a namespace without the named exports → `createSupportsColor is not a function`), in a browser worker it would reject outright (bare specifier). [TESTED in harness; browser behavior reasoned from the mechanism — will be confirmed during S2 e2e]
- Therefore: **running the real npm CLI requires user-land ESM (`module_wrap.ModuleWrap`), which is planned S5.** This is the single decisive prerequisite; behind it also stand `node:http/https` (make-fetch-happen), `zlib` (minizlib/tar), and `child_process` for lifecycle scripts.

### 2.2 Scenario matrix

| Scenario | Definition | Status | Evidence |
|---|---|---|---|
| **A — pure JS, no lifecycle scripts** | Tarballs contain only JS/JSON; install = resolve + fetch + verify + extract | **S2 target — achievable now** | Express 5.3.0 tree (real install): 65 packages, 584 files, 2.2 MB — **zero lifecycle scripts, zero native builds, zero ESM-only packages** [TESTED]. fs binding has full tar-extraction surface (§1.3). Registry access verified (§3). Integrity sha512 verifiable with our real crypto [WORKLOG 212/212]. |
| **B — JS lifecycle scripts** | `preinstall/install/postinstall/prepare` run `node …` | **Blocked** — requires `child_process` (never-stub by design; `spawn_sync` throws ENOSYS) | Architectural path exists: in-kernel process spawning (nested kernel boot with piped stdio) — see §8. Not claimed until built. |
| **C — native compilation** | `node-gyp`, C/C++ addons | **Out of scope (honest)** | Requires a real toolchain (compiler+make+python) — no browser story short of a WASI SDK (gigabytes). We will not fake it. |
| **D — external shell / git** | curl/git/bash in scripts or git deps | **Out of scope** | No shell, no git client. Registry tarballs only. |

**Position we will NOT take**: claiming "npm compatibility" from a scripts-disabled Express install. Express needs no scripts, so the scripts boundary is orthogonal for it — but the boundary itself is real and documented above. S2 delivers **a registry-faithful installer for scenario A**, and says exactly that.

### 2.3 Express probe (in-kernel, real tree) [TESTED + one bun artifact isolated]

Mounting the real 65-package tree into the kernel VFS and `require('express')`: the loader walks express → body-parser → http-errors → **depd**, and fails at `depd`'s use of V8's `Error.prepareStackTrace` CallSite API (`callSite.getFileName is not a function`).

Bisection (stage-by-stage probe across boot) proved the failure is a **bun bug, not an OpenContainer bug**: after node's `realm.js` does `Object.defineProperty(Error, 'prepareStackTrace', {value})` (node-faithful behavior), **bun permanently stops delegating stack formatting to user replacements** — reproduced standalone in 6 lines on bun, while node delegates correctly. V8/Chromium reads the property natively at format time, so the browser kernel is unaffected in principle; **S2's browser e2e will confirm `require('express')` end-to-end as the authoritative check.**

Harness lesson recorded: the bun harness cannot evidence V8-CallSite-dependent paths (depd and friends); such paths must be verified in Chromium.

---

## §3 — Networking & registry access (verified, not assumed)

All of the following ran in **real Chromium on our origin** (`http://localhost:3000`), in **both** page context and a **same-origin module worker** (the kernel's exact execution environment) [TESTED]:

| Request | Result |
|---|---|
| `GET https://registry.npmjs.org/express` (packument) | 200, no redirect, 343 ms (page) / 218 ms (worker); 290 versions; `dist.integrity` (sha512) present |
| Same + `Accept: application/vnd.npm.install-v1+json` (npm's "corgi" doc) | 200; **804 KB full vs 335 KB corgi** — the installer will send the corgi Accept header like npm does |
| `GET …/express/-/express-5.3.0.tgz` | 200, no redirect, 175 ms (page) / 165 ms (worker); 22,968 bytes; `application/octet-stream`; gzip magic bytes verified |
| Unknown package | clean 404 |

**Conclusion: the public npm registry is directly reachable from the kernel worker with no CORS proxy.** TLS is the browser's. Integrity data is available for supply-chain verification.

Port forwarding / Service Worker previews remain **S3** scope (outbound serving of `node server.js`), and are not needed for S2.

---

## §4 — Filesystem persistence: OPFS vs IndexedDB (benchmarked, recommendation)

Benchmarks: real Chromium, same-origin module worker, 200 files × 4 KB [TESTED]:

| Backend | Write | Read | Notes |
|---|---|---|---|
| OPFS, open/write/close per file | 1.4 ms/file | 1.17 ms/file | Worst-case usage pattern |
| **OPFS, kept-open sync handles (fd-table)** | open 0.86 ms/file (one-time), write 0.125 ms/file | **< 5 µs/file** | Sync semantics preserved |
| IndexedDB, one batched transaction | 0.08 ms/file | 0.055 ms/file | Fastest — but **async-only** |
| OPFS cross-worker persistence | — | 0.74 ms/file cold | Fresh worker saw all 201 files; enumeration 4 ms |

Constraint that decides it: the kernel fs binding implements **synchronous** node fs semantics (`readFileSync`, `writeFileSync`, synchronous fd read/write inside `tar` extraction). The only browser storage primitive with synchronous I/O is the **OPFS sync access handle** (workers only). IndexedDB cannot back a sync fs without a read-through cache + write journal.

**Recommendation (S2 architecture):**
1. **OPFS is the persistence layer for the VFS** — but not as a synchronous mirror of every op. Keep the **in-memory VFS as the runtime authority** (sync, fast), with an async **write-through journal to OPFS** (coalesced flushes), and **boot-time hydration** (eager directory-tree enumeration ~12 ms for 584 files, lazy file-content hydration ~0.74 ms/file on first read). This preserves sync semantics, survives recycles and reloads, and bounds boot cost.
2. **IndexedDB** for installer metadata (packument cache index, integrity records) where async is natural.
3. **Cache API stays** exactly as-is for the runtime blobs (already content-addressed and verified — see §6).

Boot-cost model for an express-sized node_modules: eager tree hydration ≈ 12 ms + lazy contents for ~65 files actually required ≈ 48 ms — well inside the 50–100 ms boot budget. [TESTED components; composite is ASSUMED until S2 measures it]

Quota/eviction reality (measured + MDN): our origin currently reports **10.75 GB quota / 10.4 MB used**; site storage (Cache + IDB + OPFS) is one per-origin unit in "best-effort" box mode — the browser may evict under storage pressure **without warning**; `navigator.storage.persist()` can upgrade the box to "persistent" (evicted last, with user notification) — its Chrome support is unreliable (compat reports it returning false). Mitigation: content-addressed blobs and re-fetchable tarballs make eviction recoverable; request persistence opportunistically; never treat OPFS as the only copy of anything irreplaceable.

---

## §5 — Security & isolation: threat model

Assets: the consumer's origin (its storage, its same-origin APIs), the user's browser session, the machine's local network, and the runtime's own integrity.

**What guest code (kernel worker) can and cannot do [TESTED/verified facts]:**

| Capability | Status | Detail |
|---|---|---|
| DOM / page access | **No** | Dedicated workers have no DOM (standard platform fact; our benches ran in workers). |
| `localStorage` / cookies (direct) | **No** (localStorage), cookies only via fetch | Workers have no `localStorage`; the main-thread runtime's storage is not directly reachable. |
| IndexedDB / OPFS / Cache API | **Yes — full same-origin access** [TESTED] | Our own benches exercised all three from a blob worker. Guest compromise = full read/write of origin storage. |
| Same-origin authenticated requests | **Yes — real risk** | Worker `fetch` to the app's own origin attaches same-origin cookies by default (`credentials: 'same-origin'`). A malicious dependency can act as the user against the app's API. |
| Cross-origin exfiltration | **Constrained by CORS** [TESTED for registry] | Only CORS-permitting endpoints are reachable; responses likewise gated. |
| Local network (LAN/localhost) | **Constrained and tightening** | PNA preflights are currently on hold; the successor **Local Network Access permission prompt** (Chrome 138+, opt-in testing as of June 2025) will gate fetch/subresource/worker fetches to the local network behind a permission. Workers require a prior grant. S3's networking must never depend on reaching the user's LAN. |
| CPU / DoS | **Unbounded within the worker** | A busy-loop cannot be preempted; terminal Ctrl+C only reaches the guest when the event loop is reachable. Same class of limitation as every browser-Node runtime. |
| Filesystem escape | **No host FS** | VFS is the syscall boundary; a kernel compromise reaches VFS + origin storage, not the user's disk. |
| WASM | **Allowed** | Compiles in the worker; no additional sandbox below the worker. |
| Supply chain | **Mitigable — enforce integrity** | Registry `dist.integrity` (sha512) is available (§3) and our crypto Hash is real — the S2 installer **must verify** every tarball and refuse on mismatch. |

**Findings requiring action (from the §1 stub audit):**
1. **`cares_wrap` DNS lies** (returns 127.0.0.1 or the hostname). Fix: honest ENOSYS or a real DNS-over-HTTPS bridge. A lying DNS is a correctness *and* security hazard.
2. **Silent no-op stubs** (`process_wrap`, `signal_wrap`, `tcp_wrap`…) let user code proceed down dead paths and hang instead of failing loudly. Convert touched ones to descriptive throws as their areas come into scope (S2 touches `zlib` if we ever load `lib/zlib.js`; `tcp_wrap` waits for S3).
3. **Same-origin cookie risk** (above): for S4 consumers, run each project on an isolated origin (subdomain-per-container or sandboxed cross-origin iframe), so container compromise cannot hit the app's authenticated API. WebContainers-class isolation; must be a first-class S4 requirement, not an afterthought.

---

## §6 — Performance: boot decomposition, cache & quota

**Live numbers this session [TESTED]:** cold boot badge **98 ms** (dev server), warm boot **55 ms** (terminal regression cycle). Consistent with WORKLOG (85 ms cold / 50–55 ms warm / 100-cycle p95 342 ms prompt latency).

**Kernel-stage decomposition** (new permanent `onStage` boot hook — added as diagnostic infrastructure; harness, same code path as the worker) [TESTED]:

| Stage | Cumulative | Δ |
|---|---|---|
| registry construction | 5 ms | 5 |
| `internal/bootstrap/realm` | 14 ms | 9 |
| `internal/process/task_queues` | 19 ms | 5 |
| `internal/process/per_thread` | 23 ms | 4 |
| `is_main_thread` (stdio + fs + cjs-loader preload) | 43 ms | **20 — heaviest stage** |
| console init | 45 ms | 2 |
| `initializeCJS` | 46 ms | 1 |

So ~46 ms of kernel-side bootstrap; the remainder of the 98 ms badge is browser-side (worker spawn + single blob fetch from Cache API + DecompressionStream + module decode/compile — previously measured at ~451 MB/s decompression and 108 ms full-graph preparse [WORKLOG]).

**Cache & quota [TESTED]:** `caches` contains exactly `opencontainer-runtime-v1` with the 2 content-addressed entries (`core-53ee70db.ocrt.gz`, `amaro-cf665360.ocrt.gz`); `navigator.storage.estimate()` → 10.75 GB quota / 10.4 MB used. Eviction policy: best-effort box (MDN) — may be evicted under pressure without warning; content-addressed naming + deterministic re-fetch makes this recoverable, and the runtime already re-fetches on cache miss. OPFS/IDB additions in S2 share the same origin unit and quota.

---

## §7 — Terminal regression (real Chromium + xterm v6) [TESTED]

Sequence executed against the live app via the `window.__ocTerm` hook (`triggerDataEvent`, buffer reads):

- `node -v` → output + prompt auto-restore ✓
- `node -e "console.log('OC-E2E-' + (21*2))"` → output + prompt ✓
- `node` REPL: `1+1`, `7*6` → results + live `>` prompt ✓
- `require('crypto').createHash('sha256').update('abc').digest('hex').slice(0,16)` → **`ba7816bf8f01cfea`** (FIPS-180 vector) ✓
- `.exit` → clean exit, prompt restored ✓
- Wrapped long-command rendering correct; warm boot badge 55 ms ✓
- Screenshot: `download/opencontainer-investigation-terminal.png`

**Terminal is release-healthy going into S2.** The full PART 6.5 sequence from WORKLOG Session 4 will be re-run after S2 lands (it modifies the shell's npm routing).

---

## §8 — Long-term architecture: 10 questions + roadmap

**Q1 — ESM strategy.** `module_wrap.ModuleWrap` is the gate to the real npm CLI and modern packages (chalk 5, supports-color 10 are ESM-only). Options: (a) source-rewrite ESM evaluator on acorn (fast to ship, subtle live-binding/TDZ divergences), (b) faithful module-record/linker implementation (WebContainers-class effort). Recommend (a) behind a hard compatibility test-suite (es-module-suite), scheduled S5, because S2's scenario-A packages are all CJS and do not need it.

**Q2 — In-kernel process spawning.** child_process as nested kernel boot (fresh process context, piped stdio, exit codes) unlocks scenario B (lifecycle scripts), `npm run/exec`, and test runners. This is the highest-leverage future binding. Design constraint: sequential spawn semantics first; parallel child workers later (process table).

**Q3 — Networking for S3.** Server sockets need the Service Worker preview domain (custom origin serving guest HTTP). Client side: a fetch-bridged `http.request` (real `lib/http.js` over an emulated socket) vs full user-space TCP. Recommend fetch-bridge first (covers 90% of package network use), raw-TCP later only if proven necessary.

**Q4 — VFS persistence.** Adopt the OPFS journal design (§4) in S2. Later: fs watchers (fs_event_wrap is already a binding surface) for editor/IDE flows.

**Q5 — zlib.** Needed by tar (gzip streams) and HTTP content-encoding. `fflate` is already a runtime dependency and the code comments already plan for it ("zlib natives arrive in S2 via fflate"). S2's installer decompresses via `DecompressionStream` (native, 451 MB/s [WORKLOG]) — the full `lib/zlib.js` binding can wait for S3 unless a package requires it at install time.

**Q6 — Origin isolation for consumers (S4).** Subdomain-per-container (or sandboxed cross-origin iframe) to defuse the same-origin cookie risk (§5). Non-negotiable for the "consumers embed OpenContainer" story.

**Q7 — Process model.** Current: worker-per-process + recycle (leak-free, fresh-process semantics node asserts). Alternative: one container worker + process table (WebContainers model; cheaper spawns, shared VFS, harder isolation). Keep current model; revisit only if S5's child_process forces a table anyway.

**Q8 — Native addons.** Declare out of scope, honestly (§2.2-C). A WASI-SDK toolchain is a research project, not a milestone.

**Q9 — Boot below 50 ms cold.** Candidates: V8 code-cache via `scriptStreaming`-shaped serving, precompiled-module snapshots, trimming `is_main_thread` (the 20 ms stage). Only worth it after S2 persistence adds its hydration cost — measure then optimize.

**Q10 — Compatibility honesty policy.** Publish a per-module compatibility table (COMPATIBILITY.md is already referenced in code); convert silent/lying stubs to loud ENOSYS as their surfaces come into scope; never print fake successes. This report formalizes the policy.

### Roadmap (priority order)

| Stage | Scope | Exit criterion |
|---|---|---|
| **S2 (now)** | OPFS-persistent VFS + registry-faithful installer (corgi packuments, vendored real `semver`, sha512 integrity, ustar/gnu/pax extraction, flat-hoisted layout, `.bin` symlinks) + `npm init -y` / `npm install` / `npm ls` terminal UX | `npm install express` in real Chromium → `require('express')` in a fresh process → app object built; survives reload via OPFS; §7 regression suite green |
| **S3** | zlib binding (fflate) if needed; `http_parser` + fetch-bridged http client; virtual server sockets + Service Worker preview domain | `node server.js` with express serving requests from a preview URL |
| **S4** | `@opencontainer/core` package, consumer embedding, origin isolation, quota UX | Consumer app embeds OpenContainer on an isolated origin |
| **S5** | ESM (ModuleWrap) + in-kernel child_process + real npm CLI | Real `npm install` with lifecycle scripts (scenario B) |
| Beyond | watch mode, process table, node-gyp research, sub-50 ms cold boot | — |

---

## S2 implementation plan (approved by this investigation)

1. **Persistence**: kernel-side OPFS journal (write-through, coalesced) + boot hydration (eager tree, lazy contents). Runtime's host-file re-hydration simplifies to writing through the kernel.
2. **Vendored `semver`** (npm's own, pure CJS) mounted at `/usr/lib/node_modules/semver` — the installer uses npm's real version logic through node's real CJS loader.
3. **Installer** (our kernel module, clearly not vendored node code): corgi packuments, flat-hoisted resolution, tarball fetch + sha512 verification (real crypto binding), ustar/gnu/pax tar extraction into VFS, `.bin` symlink creation, minimal install record.
4. **Terminal**: `npm init -y`, `npm install [pkg[@ver]]` with progress, `npm ls`, honest `npm -v` banner; runs inside the fresh-process model so prompt authority and exit semantics are unchanged.
5. **Verification**: Chromium e2e — install → fresh-process require → express app object → reload persistence → regression suite → screenshots; harness-level tar/semver/integrity unit checks.

**Explicit non-goals for S2**: lifecycle scripts (B), native modules (C), git/shell (D), the real npm CLI (needs ESM, S5), any claim of general "npm compatibility".

---

## Postscript — S2 results (same session, investigation-driven implementation)

The plan above was executed immediately after the investigation. All verification ran in real Chromium on the live app:

| Check | Result |
|---|---|
| `npm install express` | **added 68 packages in 16.3s** — real registry packuments (corgi), real sha512 integrity verification, real ustar/gnu/pax extraction, `.bin` links, install record |
| `node -e "require('express')"` (fresh process) | **EXPRESS-OK: type function · app.get · Router · json · ver 5.3.0** — full module graph through node's real CJS loader; app constructed, middleware registered |
| Page reload (OPFS persistence) | boot hydrates the whole tree in **694ms**; `PERSIST-OK express 5.3.0 · qs: 1 · crypto: ba7816bf` with zero network |
| `npm ls` / `npm -v` | Full 68-package listing; honest banner `11.20.0-oc (…real npm CLI lands in S5)` |
| Regression suite | node -v · node -e · REPL · crypto FIPS vector · .exit · express-after-all — all green, warm boot 72–95ms |
| Harness | tar differential 21/21 (byte-identical vs GNU tar; malicious-path containment), install e2e 12/12 |

Two kernel fixes the investigation predicted and one it discovered: the bun `Error.prepareStackTrace` artifact behaved exactly as diagnosed (Chromium passes depd cleanly); node v26's `--require-module` (module-sync condition) routes dual-package requires to ESM targets — disabled with a documented divergence until S5; and a second `bootKernel` in one JS realm silently reused the previous kernel's realm (per-instance realm tracking added). A real CRC-32 + loadable-handle zlib binding landed (compression streams themselves remain S3, honestly throwing), and `http_parser.methods` became real so `require('http')` loads for app construction.

**Standing boundaries after S2 (unchanged in spirit, now enforced by tests):** scenario A installs only; lifecycle scripts (B) need in-kernel child_process (S5); native builds (C) and git/shell (D) out of scope; the real npm CLI needs user-land ESM (S5); zlib streams and HTTP servers are S3.

---

## Postscript 2 — pnpm support (pnpm-oc, same repo, same session pattern)

**Ask:** pnpm alongside npm. Delivered as `pnpm-oc` — an OpenContainer-authored installer with pnpm's *defining* semantics, mounted at `/usr/lib/node_modules/pnpm-oc` and executed as a real node process through the real CJS loader (`process.argv = [node, pnpm-cli.js, ...args]`), exactly like npm-oc. It reuses npm-oc's registry machinery (corgi packuments, vendored semver, sha512 SRI verification, ustar/gnu/pax tar) via `require('../npm-oc/installer.js')` — one source of truth for everything that is not pnpm-specific.

### What pnpm-oc implements (the pnpm semantics that differ from npm)

- **Per-range version resolution**: every distinct `(name, range)` pair picks its own `maxSatisfying` version — conflicting versions coexist in the store instead of npm's conflict-nesting.
- **Symlinked layout** (`node_modules/<direct> → .pnpm/<pkg>@<ver>/node_modules/<pkg>`; deps of each package as relative `../../<dep>@<ver>/node_modules/<dep>` sibling links inside its virtual dir; scoped keys encode as `@scope+name@ver` like real pnpm).
- **Strict resolution**: only declared deps are require-able — phantom dependencies fail loudly. This is enforced by the *kernel itself* (loader realpath + node_modules walk), not by convention — see the kernel fixes below.
- **Commands**: `pnpm init · install/i/add [-D|-E|-O] · remove/rm/un (with store garbage-collection via reachability) · ls · why <pkg> (dependency chains) · store path · -v` (honest banner `1.0.0-oc (…real pnpm CLI lands in S5)`).
- **Install record** (`.opencontainer-install.json`, `layout: pnpm-symlinked`, direct + edges for why/GC) — honestly NOT a `pnpm-lock.yaml`; the real lockfile arrives with the real CLI (S5). Mixed layouts are refused: a foreign manager's record is replaced with an explicit notice (everything is re-fetchable from the registry).

**Documented divergences from real pnpm** (COMPATIBILITY policy): peers auto-installed but without peer-suffixed instance dirs; no hidden-hoist pattern (`.pnpm/node_modules` hoisting); per-project store (within-project reuse only — existing `<pkg>@<ver>` dirs are never re-extracted; the cross-project content-addressed store arrives with the real CLI). Scenario boundaries identical to npm-oc's (A only; B/C/D and the real CLI are S5).

### Kernel fixes pnpm forced (the interesting part)

pnpm's layout is the first S2 consumer that requires node's module resolution to work *through symlinks*. A layout probe (`scripts/probe-pnpm-layout.ts` — builds the exact `.pnpm` structure by hand with the real fs binding, then `realpathSync`/`lstat`/`require` in-kernel) surfaced two real gaps, both fixed:

1. **stat/lstat/fstat returned named-field objects, but node's `getStatsFromBinding` consumes a positional array.** Every `Stats` predicate (`isDirectory`, `isSymbolicLink`, …) was silently false. Fix: the binding now returns `Float64Array` (or `BigInt64Array` when the `bigint` flag is set — `fs.realpathSync` passes `bigint: true` and calls `BigInt.prototype.toString` on `stats[0]`) in node's field order, and `lstat` of a symlink reports the target-string length like node. This un-broke `fs.realpathSync`'s entire symlink walk — and with it the CJS loader's `tryFile → toRealPath`, which is what makes `require('express')` resolve to the *physical* `.pnpm` path (and therefore find its deps as sibling links). [TESTED: probe + harness + Chromium e2e]
2. **bun's `BigInt64Array.from(numberArray)` throws** (ToBigInt on a plain Number array) — worked around with element-wise `BigInt()` fills; harmless in V8/Chromium.

Harness lesson re-confirmed and now encoded in every script header: in the one-realm bun harness, host output sinks (`console`/`process.stdout`) must be captured **before** `bootKernel` — after boot replaces `globalThis.process`/`console`, host writes recurse through the kernel's stdio into a tick-queue blowup (observed as an OOM kill).

### Evidence [all TESTED]

| Check | Result |
|---|---|
| Harness: `pnpm add express` (real registry) | **30/30 checks** — 68 virtual-store dirs, top-level + sibling links with relative targets, record/edges, package.json `^5.3.0`; `pnpm why bytes` → `express@5.3.0 ← body-parser@2.4.0 ← bytes@3.1.2` (+raw-body chain); `pnpm remove express` GC'd **68/68** store dirs; `pnpm add -D ms` saved devDependencies |
| Harness: resolution semantics (fresh processes) | realpath → physical `.pnpm` path; `require.resolve('express')` physical; qs/debug/cookie resolve through sibling links; **phantom qs & mime-types hidden at root** (strict) |
| Chromium e2e (real terminal, real worker) | `pnpm -v` / `pnpm init` ✓; **`pnpm add express` in 19.8s** (Packages: +68, Done in 19.8s); **`require('express')` → app instance: `PNPM-E2E-OK function function function 5.3.0`** (full graph incl. depd — the V8 CallSite path the bun harness cannot evidence); strictness `MODULE_NOT_FOUND` ✓; layout facts ✓ |
| Chromium: persistence (page reload) | OPFS write-through journal persisted the **symlinked** layout; post-reload `require('express')` → `PNPM-PERSIST-OK 5.3.0`, `SYMLINK-OK true true`, `pnpm ls`/`why` intact — zero network |
| Regressions after the stat-binding fix | npm-oc install e2e **12/12** (4.6s); tar differential **21/21**; terminal suite (node -v · node -e · REPL 7*6 + .exit · crypto FIPS `ba7816bf8f01cfea`) all green |
| Screenshot | `download/opencontainer-pnpm-e2e.png` |

Artifacts: `vendor/node-v26.13.0/pnpm-oc/{cli,installer}.js` (+ package.json, manifest-registered), `scripts/probe-pnpm-layout.ts`, `scripts/test-pnpm-install.ts`, `scripts/e2e-pnpm-driver.js`, `scripts/e2e-pnpm-persist-driver.js`. Runtime blob rebuilt (content-addressed → cache-safe): core now 506 modules.
