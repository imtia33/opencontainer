# OpenContainer Worklog

**Project**: OpenContainer — open-source WebContainers-compatible browser Node.js runtime (`@open-webcontainer/api`)
**Repo root**: `/home/z/my-project`
**Spec**: `/home/z/my-project/upload/prompt-20261102-184259.txt`
**This file is the single source of truth for session history. Every session MUST append.**

---

## Session 1 — 2026-11-02 (early)

### Done
- Read full spec (2511 lines). Mission: drop-in WebContainers alternative, real Node internals in browser, MIT/Apache licensed, no NodeBox/CheerpX.
- Launched 5 research subagents (teardown of WebContainers internals, Node bootstrap architecture, npm-in-browser, virtual networking/Service Worker previews, licensing).
- **Key finding (architecture-defining)**: WebContainers does NOT run V8-in-WASM. It runs Node's real `lib/*.js` JS sources on the browser's native JS engine, compiling only ~25 C++ `internalBinding` natives to WASM via Emscripten. Virtual TCP stack + Service Worker previews.
- User authorized: build from scratch, competitive with WebContainers, no time constraints.
- Vendored Node v26.13.0 `lib/` sources (MIT) into `src/packages/opencontainer/vendor/node-v26.13.0/` + manifest.json.
- Deleted QuickJS approach (rejected by user — "not the original goal").

### Current code layout
- `src/packages/opencontainer/kernel/` — natives (~30 binding files), boot.ts, vfs.ts, module-registry.ts, worker-entry.ts, node-harness.ts
- `src/packages/opencontainer/engine/` — **legacy QuickJS engine, DEPRECATED, TO DELETE**
- `src/packages/opencontainer/{fs,npm,node-std}/`, `runtime.ts`, `protocol.ts`, `types.ts` — older S1 scaffolding
- `src/app/page.tsx` — demo page (editor + output, no xterm yet)
- `public/opencontainer/kernel-worker.js` — bundled worker (147 KB)
- `public/opencontainer/vendor/node-v26.13.0/` — vendored Node lib sources
- `scripts/build-opencontainer.sh` — bun build of worker + vendor sync
- `externals/v86/` — v86 x86 emulator research artifact (NOT used in final architecture)

### Known problems (reported by user)
1. **FATAL: `Reflect.ownKeys called on non-object`** — appears during module loading. Suspect: primordials loading or a native returning a primitive where Node's lib expects an object.
2. **Run takes 2+ minutes, nothing appears** — worker fetches ~hundreds of individual files over HTTP one by one (batched 32-at-a-time), then boots. No bundling/caching of sources. Unacceptable.
3. **No real terminal UI** — user explicitly requests an **xterm.js terminal** to test commands interactively.
4. QuickJS remnants: `src/packages/opencontainer/engine/`, `quickjs-emscripten` + `@jitl/quickjs-*` deps in package.json, `node-std/` shim layer.

### Architecture decision (standing)
- Real Node `lib/*.js` on browser native engine (same class as WebContainers).
- internalBinding natives re-implemented in TS (in worker), NOT QuickJS.
- Performance targets: boot < 2-3s, run instant. Single-file bundled kernel + single prefetched compressed source blob, IndexedDB/Cache API caching.

---

## Session 2 — 2026-11-02 15:28 UTC (current)

### User directives (verbatim intent)
- Use subagents; research thoroughly; work thoroughly — "we cannot have any messups".
- Delete old QuickJS code completely.
- Performance must match WebContainers — "fast. like really fast", "optimized to oblivion", no memory leaks, no code breaking.
- C++/WASM allowed if needed ("compile in wasm I don't know, do whatever needed") for maintainability + "best of mankind".
- Wants **xterm.js terminal interface** to check terminal commands.
- Keep a worklog ALWAYS (this file).

### Plan for this session
1. [in progress] Audit current kernel code + locate Reflect.ownKeys crash + slow boot root causes.
2. [pending] Launch parallel research subagents (Task IDs 2-a..2-e):
   - 2-a: Node 26 bootstrap deep-dive — exact module load order, which native each lib module calls, Reflect.ownKeys call sites in bootstrap path.
   - 2-b: WebContainers performance teardown — how they achieve ~300ms boot (snapshot/sourcemap tricks, single-file bundles, caching).
   - 2-c: xterm.js integration best practices (Next.js 16, worker-driven, resize, ANSI from Node internals).
   - 2-d: Node native binding surface — complete inventory of internalBinding() calls in lib/*.js with exact expected APIs (for TS re-implementation).
   - 2-e: npm-in-browser feasibility on this architecture (npm CLI as real JS running in kernel with fetch bridge).
3. [pending] Delete QuickJS remnants: `src/packages/opencontainer/engine/`, `node-std/`, quickjs deps from package.json, `externals/v86` reference build paths.
4. [pending] Rebuild kernel bootstrap to fix Reflect.ownKeys + fast boot: single bundled+compressed (gzip/brotli) source payload, Cache API persistence, lazy-load only needed modules.
5. [pending] New xterm.js terminal UI in page.tsx (Run + interactive `node` REPL + `node -e` + command execution).
6. [pending] Lint + browser verification (agent-browser) + append results here.

### Session log (append-only)
- 16:45 — **Phase A DONE**: QuickJS deleted (engine/, node-std/, npm/, fs/protocol/types/version.ts, externals/v86, 2 deps). .ocrt blob packer written (scripts/pack-runtime.ts): core 449 modules 6.29MB→1.43MB gz + amaro split 3.63MB→1.32MB gz, content-addressed filenames + runtime/index.json. public/opencontainer/vendor removed.
- 17:30 — **Phase B kernel fixes applied** (per 2-a sprint order + empirical crash loop):
  - contextify: +constants.measureMemory{mode,execution}, +measureMemory, +startSigintWatchdog/stopSigintWatchdog(false→no phantom SIGINT), compileFunction→node's 10-arg positional signature, **ContextifyScript rewritten with direct-eval wrapper for SCRIPT COMPLETION SEMANTICS** (`new vm.Script('1+1').runInThisContext()===2` — new Function bodies don't fall off completion values; eval does).
  - modules: +readPackageJSON/getNearestParentPackageJSON/getNearestParentPackageJSONType/getPackageScopeConfig/getPackageType (VFS-backed tuple contract from package_json_reader.js deserializePackageJSON) → **user-module require() unblocked**.
  - fs binding: +internalModuleStat (0 file/1 dir/-errno), +legacyMainResolve (returns INDEX 0-9 into legacyMainResolveExtensions — verified esm/resolve.js contract), +getFormatOfExtensionlessFile (WASM magic check).
  - v8: full rewrite — kHeapSpaces(11), heapStatisticsBuffer/heapSpaceStatisticsBuffer/heapCodeStatisticsBuffer Float64Arrays, all k*Index constants, update*Buffer fillers, sampling flags → require('v8') no longer crashes.
  - options: +v26 defaults (--experimental-repl-await/--experimental-detect-module/--strip-types/--require-module true; --enable-source-maps false; --vfs-load ''; --unhandled-rejections 'throw').
  - errors: exitCodes.{kGenericUserError,kInvalidCommandLineArgument} INSIDE exitCodes; +setMaybeCacheGeneratedSourceMap/setSourceMapsEnabled/setGetSourceMapErrorSource/getErrorSourcePositions.
  - symbols: +vm_context_no_contextify/imported_cjs_symbol/embedder_module_hdo/source_text_module_default_hdo/handle_onclose/oninit.
  - module_wrap: +kInstantiated/kSourcePhase/kEvaluationPhase/kDeferPhase + setImportModuleDynamicallyCallback/setInitializeImportMetaObjectCallback/setImportMetaResolveInitializer (stored, S5 ModuleWrap will call) + throwIfPromiseRejected.
  - util: +shouldAbortOnUncaughtToggle Int32Array, +9 privateSymbols, getPromiseDetails→{0:state,1:result} shape w/ WeakMap probe, previewEntries→consumes iterator (≤100), +parseEnv/getCallSites/getCallerLocation/markPromiseAsHandled/getSharedArrayBufferGrowable/getCwdSafe.
  - performance: +markBootstrapComplete (fixed sibling-method reference bug), +getMilestones.
  - process_methods: +patchProcessObject (title/argv/execArgv/pid/ppy accessors per node_process_object.cc), +setEmitWarningSync, +rss/_debug*/_kill/_getActive*/getActiveResourcesInfo/resetStdioForTesting/dlopenBinary.
  - misc: async_wrap +setPromiseHooks/executionAsyncResource/queueDestroyAsyncId/Providers (ASL across await = documented divergence); trace_events full surface; inspector full stub surface; watchdog +TraceSigintWatchdog; report full 20-prop surface.
  - os: +getHomeDirectory (REPL history), +getUserInfoByUid.
  - constants: +internal.EXTENSIONLESS_FORMAT_WASM, +fs.{F_OK,R_OK,W_OK,X_OK,COPYFILE_EXCL}, +~38 zlib constants.
  - uv: +full UV_E* errno set + UV_DIRENT_* types.
  - **string_decoder: FULL NEW BINDING** (natives/string_decoder.ts) mirroring src/string_decoder.h exactly (7-byte state, kSize=7, encodings enum order) with TextDecoder streaming + manual carry for utf8/utf16le/hex/base64 — REPL keypress decoder unblocked.
  - **stream_wrap: TOP-LEVEL constants** (stream_base_commons destructures {kReadBytesOrError,...} directly) — was nested in constants{}, caused nread=undefined→ErrnoException(undefined).
  - stream-state.ts: shared Int32Array singleton for both bindings.
  - tty_wrap: **stdin READ SIDE** — feedStdin/sendStdinEof/resetStdin host bridge implementing uv stream read protocol (streamBaseState[kReadBytesOrError]=n, [kArrayBufferOffset]=0, handle.onread(ab)); pending-chunk queue until readStart.
  - boot.ts: +process._fatalException/setUncaughtExceptionCaptureCallback/add/has (execution.js), +process.emitWarning (warning.js), +process.getBuiltinModule (helpers), +Symbol.toStringTags ('process'/'global'), +versions.amaro 1.1.11, +promises.listenForRejections() + __ocGetPromiseRejectCallback, runMain→executeUserEntryPoint (v26 export; old destructured runMain was not a function), runEval routes sync throws through _fatalException, +mkdir /home/node, +__ocDrainTicks global.
  - task_queue: enqueueMicrotask wraps fn to drain ticks after each kernel microtask (node interleave approximation).
  - config: hasIntl:false (icu stub would crash inspect on non-ASCII; JS fallbacks used instead).
- 17:45 — **REPL MILESTONE**: `kernel.require('internal/main/repl')` boots node's REAL REPL entry: "Welcome to Node.js v26.13.0." + prompt `>` with ANSI cursor drawing (readline terminal mode). Interactive feed test passes: 1+1→2, process.version→'v26.13.0' (quoted like node), .help→full help, .exit→[exit 0]. History warning resolved via os.getHomeDirectory + mkdir /home/node.
- 17:50 — Two hard-won lessons (worklog-worthy): (1) `new Function` bodies DO NOT return completion values — node Script semantics need direct `eval` wrapper; (2) binding constants must match the EXACT destructuring shape lib uses (top-level vs nested constants{}) — verify against vendored source, not intuition.

### Key research conclusions (from 2-a/2-b/2-c)
- **2-b (perf, live WebContainers teardown)**: StackBlitz ships Node lib as ONE minified classic script (blitz.js 2.37MB raw/682KB br) loaded via importScripts in a Blob-URL worker; content-addressed URLs + 1yr cache; total runtime ~9.3MB raw/5.5MB wire; warm boot 479ms, cold ~1-4s. **Our fix**: single binary .ocrt blob (header+JSON index+concat sources) → 455 fetches → 1 fetch; gzip 2.73MB (or 1.04MB with amaro split out); Cache API persistence keyed by nodeVersion+manifestHash (match ~3-10ms); DecompressionStream in worker (451MB/s); per-module TextDecoder slice (4.6ms for all); compile of all 449 modules only 108ms (V8 preparse) — network was the whole bottleneck. Boot budget target: ~0.8-3s cold, ~0.3-0.7s warm. Split amaro (3.8MB, 38% of payload, mostly embedded SWC wasm) into separate lazy blob.
- **2-a (bootstrap fidelity)**: v26 entry = internal/main/{eval_string,run_main_module,repl}. REPL chain: repl.js → lib/repl.js → vm.js (contextify.constants.measureMemory + startSigintWatchdog/stopSigintWatchdog missing = crash 1-3) → v8.js (kHeapSpaces etc. missing → require('v8') crashes) → readline (tty_wrap read side missing → no stdin delivery). **modules binding missing 5 package.json natives → ALL user-module require() broken** (getNearestParentPackageJSON is not a function). fs binding missing internalModuleStat/legacyMainResolve/getFormatOfExtensionlessFile. options defaults missing --experimental-repl-await/--experimental-detect-module/--strip-types (v26 defaults true). process lacks _fatalException/capture callbacks/emitWarning. runMain uses destructured runMain (v26 exports executeUserEntryPoint — runMain is not a function!). Full sprint order given: C.1 contextify → C.2+C.3 modules/fs → C.4+C.5+C.7 process surface+module_wrap stubs+options → C.6 stdin pump → C.8+C.9 v8/icu+exception routing → D.1/D.3 adopt prepareMainThreadExecution shape + executeUserEntryPoint.
- **2-c (xterm v6)**: DOM renderer only in v6 core (webgl addon not installed, don't install). convertEol:true REQUIRED (kernel writes bare \n; no termios ONLCR). Raw byte passthrough architecture — node's real readline owns echo/history/editing/Ctrl+C(\x03→SIGINT). Enter arrives as \r — pass through untouched. fit() needs visible container with h-full+min-h-0 chain; debounce 100ms; refit on fonts.ready. NodeTerminal component skeleton provided (StrictMode-safe, full dispose). runtime.ts needs on()/emit() late-subscription system + writeStdin + spawn + resize-with-ack ('resized' reply currently falls through switch = pending-map leak). Kernel TODOs: 'stdin' RPC + process.stdin tty stream (currently undefined), resize case must call process.stdout._refreshSize() (reads our getWindowSize → emits 'resize' → readline redraws).

### Implementation plan (this session)
- Phase A: delete QuickJS remnants; .ocrt blob packer script; worker-entry rewrite (1 fetch + Cache API + amaro split).
- Phase B: kernel fixes per 2-a sprint order (contextify, modules, fs, process surface, options, v8, icu→hasIntl:false, stdin pump, resize refresh, promises routing, executeUserEntryPoint).
- Phase C: runtime.ts events API + NodeTerminal.tsx + page.tsx rewrite (xterm primary UI).
- Phase D: harness tests + lint + agent-browser e2e + screenshots + worklog.

---

## Session 3 — 2026-11-02 (continued, post-context-restore)

### Context
Session interrupted by context compaction; state re-audited from disk. Phase A/B were already done (verified by re-running harness). This session completed Phase C+D and fixed THREE deep kernel bugs discovered by browser e2e testing.

### Phase C completed (xterm terminal)
- `NodeTerminal.tsx`: xterm v6 DOM renderer, raw-byte passthrough architecture (guest readline owns echo/history/Ctrl+C), convertEol:true, fit addon with 100ms debounce + fonts.ready refit + visibilitychange refit, StrictMode-safe full dispose, local shell (`oc ❯` prompt, help/clear/node dispatch).
- `runtime.ts`: late-subscription `on()/emit()` event system, writeStdin/spawn/resize/writeFile RPC, `recycle()` (terminate + warm reboot), unhandledrejection bridge.
- `page.tsx`: xterm primary UI + editor (Run ▸ / Run file ▸ / REPL buttons), boot progress phases, status badges (version/modules/boot-ms/status).
- npm arrival in S2 stub message for `npm`/`npx` commands.

### Phase D — three deep bugs found & fixed (all browser-e2e discovered)

**BUG 1 — `processTimers()` called without `now` (worker event-loop death).**
Symptom: after `node` spawn in the browser, worker went 100% silent — no heartbeats, no stdin delivery, REPL keystrokes never echoed (harness worked because @repl test never armed the drain watcher).
Root cause: `internal/timers.js processTimers(now)` was invoked with NO argument → `now=undefined` → every comparison NaN → `diff < msecs` always false → the re-inserted setInterval re-fired in a tight synchronous loop (59+ fires/ms measured), starving the worker event loop forever.
Fix (boot.ts): call `processTimers(timersB.getLibuvNow())` — exactly node's C++ contract (`RunTimers` passes uv_now) — and re-arm from the RETURN VALUE (next expiry, negative = unrefed-only, 0 = nothing pending), which is the ONLY re-arm signal for intervals (re-inserted timers join an existing list, so `insert()` never calls scheduleTimer).

**BUG 2 — wakeup-chain accumulation + false timer counts (exit never fires with REPL history).**
Symptom: `.exit` after real eval history → `getActiveTimerCount()` stuck at 3 → loop-drain watcher never sees empty → process never exits (browser + harness reproduced; 1127+ scheduleTimer calls in steady churn).
Root cause (two flaws): (a) my re-arm driver spawned an independent host setTimeout per wakeup → self-perpetuating wakeup CHAINS (count never decreases while timers exist); (b) `getActiveTimerCount()` counted host wakeups, not kernel timers.
Fix (natives/timers.ts REWRITE, uv's own design): SINGLE-ARMED loop wakeup — `scheduleTimer()` dedupes against the armed deadline, earlier-wins, `Math.ceil` host delay so it never fires sub-ms early (that truncation churn was the 0ms/149ms/0ms/… pattern). Accounting now reads node's own refed counts: `timeoutInfo[0]` / `immediateInfo[kRefCount]` (maintained by insertGuarded's incRefCount/decRefCount) — independent of driver internals. Plus boot.ts: drain watcher now uses HOST setInterval captured before the kernel globals overwrite (its own interval would otherwise count as a pending kernel timer and self-block drain detection forever).

**BUG 3 — half-dead process after fatal exception (`nextTick` silently dropped forever).**
Symptom: Run-button eval with a SyntaxError, then a healthy eval → `nextTick` callback vanished (microtask/setImmediate/setTimeout all still worked). Fresh worker → fine.
Root cause: `onGlobalUncaughtException` (execution.js:196) sets `process._exiting=true`, emits 'exit', returns false — node's C++ then TERMINATES. We had no terminator: the process lingered half-dead; node's own `nextTick()` guard (`if (process._exiting) return`) silently refused every future tick; the host never saw an 'exit' so never recycled.
Fix (boot.ts `completeFatalExit`): after an unhandled fatal, print node's default reporter (stack + `Node.js v26.13.0` banner) to stderr, then `process.reallyExit(exitCode ?? 1)` → 'exit' RPC → host recycles. Applied in both runEval and runMain catch paths.

**Follow-on: node-faithful process boundaries (REPL-after-eval assertion).**
Symptom: `node` in the shell after a Run-button eval → internal assertion "This is caused by either a bug in Node.js…" from `initializeModuleLoaders` (pre_execution.js:311 asserts `!hasStartedUserCJSExecution()`).
Root cause: node gives every entry (`-e`, REPL, script) a FRESH process; we reused one worker process across commands.
Fix (three parts): (1) worker-entry arms the loop-drain watcher after EVERY user-code entry (eval/run-main/-v/-e/-p/file) — `node -e` now exits on drain like real node; (2) runtime.spawn() recycles first when the current process is dirty (ran user code, not exited); (3) runtime.writeFile() persists host-written files across recycles (re-hydrated into each fresh VFS — the Run-file flow needs main.js to survive). Terminal UX matches real terminals: silent on exit 0, status line only for non-zero, "kernel ready" only on first boot.

### Hard-won lessons (this session)
1. `processTimers(now)` REQUIRES its argument — NaN comparisons make "too early" checks always-false → tight infinite re-fire. Always mirror the C++ call contract exactly (`uv_now()` in, next-expiry return out).
2. Timer-driver architecture: ONE armed wakeup (uv's design), never per-event host timers — chains self-perpetuate and inflate loop-drain counts.
3. Loop-drain detection must read node's OWN refed counts (`timeoutInfo[0]`), never driver-internal state.
4. A fatal exception must complete the FULL exit chain — a half-exited process (`_exiting=true`) silently refuses every `process.nextTick` forever (node's guard) while looking alive.
5. Every node entry needs a fresh process (`prepareMainThreadExecution` asserts it); the host runtime must recycle across command boundaries and re-hydrate project files.

### Verification (all passing)
- Harness smoke suite (20+ checks): version/platform/Buffer/fs roundtrip/ENOENT/path/util.inspect/events/URL/os/querystring/assert/timers-promises/streams/mkdir-recursive/microtask/nextTick/setImmediate/setTimeout — ALL PASS.
- Harness @repl: banner, 1+1→2, process.version→'v26.13.0', inspect, 2**10→1024, .help, .exit + history flush.
- Harness @repl-min: `.exit` → process.exit → [exit 0] (now fully passes with the timer fixes).
- Browser e2e (agent-browser, Chromium):
  - Cold boot ~85ms badge, warm/recycle boot 50-55ms (WebContainers-class; was 2+ minutes in S0).
  - Run ▸: full sample output instantly (version/platform/Buffer base64/fs roundtrip/inspect/all four async primitives).
  - REPL: banner + prompt; 1+1→2; 7*6→42; 2**10→1024; process.version→'v26.13.0'; .exit→silent recycle; REPL-after-eval works (assertion fixed).
  - `node -v` → v26.13.0; `node -e` → real output; SyntaxError → node-style stderr report + exit 1 + recycle + recovery (next eval works).
  - Run file ▸: VFS write + real CJS loader + output + exit 0 (verified from cleared terminal).
  - No FATAL, no console errors, no Reflect.ownKeys crash.
- Memory: 14.1MB → 14.2MB main-thread heap across 5 Run cycles + 5 REPL spawn/exit recycles (worker terminate = leak-free by construction).
- Lint: clean (eslint over kernel + NodeTerminal + page).
- Screenshots: download/opencontainer-s1-{terminal,repl,final}.png.

### Files changed this session
- `kernel/boot.ts` — processTimers contract fix (now + return re-arm), host-timer capture for drain watcher, completeFatalExit, runEval/runMain fatal routing, idempotent watcher.
- `kernel/natives/timers.ts` — full rewrite: single-armed wakeup, ceil host delay, timeoutInfo/immediateInfo truth-source counts.
- `kernel/worker-entry.ts` — loop-drain watcher armed after every user-code entry.
- `runtime.ts` — dirty-process tracking + recycle-before-spawn, host-file persistence + re-hydration, pending-RPC settlement on exit.
- `components/NodeTerminal.tsx` — ready/exit display semantics (first-boot announce, silent success), debug instrumentation removed.
- `app/page.tsx` — Run buttons disabled while running; REPL button disabled while live.
- Vendored `internal/timers.js` — UNTOUCHED in the end (probe reverted; verified pristine).

### Next (S2 — npm)
- Real `npm init -y` / `npm install express` over the fetch bridge (registry.npmjs.org, CORS proxy strategy TBD).
- VFS persistence across processes (IndexedDB-backed or host-owned FS service) — required for node_modules to survive npm→node invocations.
- Virtual TCP stack + Service Worker preview for `node server.js` (S3).

---

## Session 4 — 2026-11-02 (evening, post-context-restore)

### Context
Session restored from compaction. Two release-critical items from the spec's PART 3/6: (A) the terminal prompt must auto-restore after every command (release blocker), (B) `require('crypto')` crashed at load (`internalBinding('crypto') is not implemented yet (accessed .getFipsCrypto)`).

### A. Prompt restoration (PART 6 — release blocker) — FIXED

**Root cause (empirically reproduced in Chromium):** TWO independent prompt-printing paths raced — `executeCommand` printed a prompt when `spawn()` resolved (the RPC ack — process possibly still streaming output), AND the `exit` listener printed another after recycle. Net effect: duplicate prompts for fast commands, prompt-while-running for slow ones (the user's original "no prompt until Enter" report matched the pre-Session-3 build; the current build had the inverse bug).

**Fix — single prompt authority:**
- The `exit` event is the ONLY thing that prints the next prompt (a process owning the tty has, by definition, ended). `spawn()` resolving prints nothing on success; on rejection (RPC error / stub) the catch restores the prompt itself (no exit will fire).
- Prompt prints IMMEDIATELY at exit (real-terminal feel) while the worker recycle continues in the background; `spawn()` serializes behind any in-flight recycle (`recycleSeq` promise chain — replaces the racy React-ref "in flight" guard).
- REPL ownership: `processStart` runtime event — page-button-triggered REPL/Run now flip the terminal to raw passthrough (previously keystrokes went to the local shell while the REPL was live).
- Latency: `waitForExitSettled` now early-exits on 2 idle samples (~20ms vs fixed 500ms) + drain watcher interval 150→100ms → **prompt latency 952ms → 312ms median**.
- readline-lite idle shell: history (Up/Down + draft), cursor editing (Left/Right/Home/End/Delete/Ctrl+A/E/U/K/L), wrap-aware full-line redraw (`\x1b[nA` up + ED clear — plain `\r`+EL exploded into 12 duplicate rows on >80-col commands), prompt prints without a stray blank line (cursorX-aware `\r\n`).
- `node -v`/help/clear local; `npm`/`npx` route through spawn (S2 stub message shows in-terminal); Ctrl+C in idle shell abandons the line.

**Kernel tty line discipline (tty_wrap.ts):** raw mode is now tracked (UV_TTY_MODE_NORMAL=0 is the only cooked mode). In cooked mode, ETX (0x03) is the INTR character — the kernel converts it to SIGINT instead of delivering it as data (echoes `^C`, JS listeners get `process.emit('SIGINT')`, default disposition exits 130). Raw mode (readline) passes bytes untouched, which is why the REPL still gets \x03 as data and emits its own SIGINT. **Ctrl+C now kills runaway one-shot processes** (`setInterval` demo: `1`s streaming → `^C` → silent exit 130 → prompt) — previously impossible.

### B. crypto binding (PART 3) — IMPLEMENTED (honest partial)

`natives/crypto.ts` (~1100 lines). Full destructure surface enumerated from vendored lib: **134 names** (renamed destructures included). Registered in natives/index.ts.

**REAL (synchronous, pure JS — all verified against OpenSSL via bun's node:crypto):**
- Hash: md5, sha1, sha224, sha256, sha384, sha512 — incremental, cloneable (`Hash.prototype.copy` works), BigInt-based 64-bit path for SHA-384/512.
- Hmac (RFC 2104) all supported hashes, key lengths 0–300 tested; PBKDF2Job (RFC 8018) sync tuple + async promise modes (crypto.pbkdf2/pbkdf2Sync/crypto.pbkdf2 promise).
- randomFillSync/secureBuffer/RandomBytesJob (crypto.getRandomValues, 65536-chunked), timingSafeEqual, oneShotDigest (`crypto.hash()`), HashJob (native subtle.digest), getFipsCrypto(Generation), getCachedAliases/MacAliases, getHashes/getMacs.
- Class factories run at load: createNativeKeyObjectClass/createCryptoKeyClass/createX509CertificateClass (28 prototype methods) — required by keys.js/x509.js module-graph loading.

**HONEST STUBS (throw descriptively on use, never fake):** all public-key crypto (Sign/Verify/RSA/EC/DSA/DH keygen), ciphers (CipherBase, AES*, ChaCha20-Poly1305), X509/SPKAC/PKCS12, SecureContext + root certs (no TLS), scrypt/hkdf/argon2/KMAC/cSHAKE/KEM/primes. `process.versions.openssl` reports '0.0.0'; MD5's T-table computed from the RFC-1321 definition (`floor(2^32·|sin(i+1)|)`).

**Verification (`scripts/test-crypto.ts` — 212/212 pass):** FIPS/RFC published vectors (incl. sha512('')/'abc', sha384, sha224) + differential vs OpenSSL over boundary lengths (0–10000 chars incl. 54/55/56/57/63/64/65/111/112/119/127/128), chunked incremental updates with random splits, binary input, Hash.copy mid-stream, digest encodings (hex/base64/latin1/buffer), HMAC × 6 hashes × 9 key lengths (incl. block-size boundaries 63/64/65/127/128/129), PBKDF2 × 5 cases, randomFill >64KB, timingSafeEqual mismatch throw, and loud-failure assertions for the stub surface.

### Four MORE deep bugs found & fixed along the way (all browser-e2e discovered)

1. **`SharedArrayBuffer is not defined` (ReferenceError) on non-COOP/COEP pages** — natives/types.ts used the bare global in `instanceof`; fixed with a `HAS_SAB` guard (SAB features report false on plain pages). Any crypto randomFill path hit this via `isSharedArrayBuffer`.
2. **`getRandomValues` infinite recursion (RangeError: stack) in the browser** — node's `exposed-window-or-worker.js` lazily replaces `globalThis.crypto` with node's webcrypto facade; my binding calling the live global looped: webcrypto.getRandomValues → random.js → binding → globalThis.crypto… Fix: capture the NATIVE `crypto.getRandomValues` at binding construction (before bootstrap replaces it) — the loop's exit.
3. **`d.dispose is not a function` on unmount** — Effect-2 cleanup called `.dispose()` on mixed shapes (runtime.on() returns unsubscribe FUNCTIONS; xterm listeners return IDisposable). This was the true cause of the dev.log "Fast Refresh had to perform a full reload due to a runtime error" cascade. Cleanup now handles both shapes. StrictMode-safe.
4. **Recycle skip race → fresh-process assertion crash** — after a fast one-shot cycle, the exit listener's React-ref guard (`if (!recyclingRef.current)`) could skip the recycle (stale true from the previous cycle's finally chain) leaving a dirty worker; the next `node` REPL then tripped node's own `prepareMainThreadExecution` assertion ("caused by either a bug in Node.js…"). Also `spawn()` set `dirty = true` AFTER its await — an exit-clear could wipe it late. Fixes: dirty set BEFORE the post; runtime-level `recycleSeq` promise-chain serialization; exit listener always recycles. Verified: 10 fast cycles → REPL → 42 → `.exit` → prompt, no assertion; 100 cycles → REPL → prompt-ok.

### Verification (all passing, Chromium via agent-browser)
- **PART 6.5 required sequence** (no Enter between commands): first/second/third → prompts; `throw new Error('test')` → node-style stderr report + `〃 exited with code 1` + prompt; recovered → prompt; `node` REPL (banner, no shell prompt while live); `.exit` → prompt; `node -v` → v26.13.0 + prompt.
- **Ctrl+C during execution**: setInterval demo → `^C` echo → exit 130 (silent) → prompt. **Ctrl+C during REPL**: mid-line abort (unfinished line discarded, fresh `>`), double-Ctrl+C shows node's exact "(To exit, press Ctrl+C again or Ctrl+D or type .exit)" hint, REPL stays functional (7*6→42 after).
- **stdout+stderr both flush** before the prompt.
- **100-cycle regression**: 100/100 ok, 0 timeouts, exactly one prompt per command (100 command lines + 100 outputs + final prompt; intermediate prompts consumed by command text like a real terminal), outputs 7…700 all correct, **REPL after 100 cycles works**. Latency: median 312ms / p95 342ms / max 368ms.
- **Shell history**: Up recalls `node -v` → `node`, Down returns, Ctrl+U clears.
- **crypto in-browser**: sha256('abc')=ba7816bf…, randomBytes, randomUUID, HMAC, pbkdf2Sync, timingSafeEqual — all correct; `createCipheriv`/`generateKeyPairSync`/`scryptSync` throw clean OpenContainer errors; kernel survives (`nextTick` fires after).
- **Memory**: 15MB heap after 100+ cycles + REPL (worker-per-process = leak-free by construction). **Page errors: 0.**
- Harness smoke suite (20+ checks) still green; @repl-min exit chain green; lint clean.
- Screenshots: download/opencontainer-s4-{terminal,final}.png. E2E hook: `window.__ocTerm` (full-buffer read access).

### Hard-won lessons (this session)
1. Prompt ownership must be singular: a process's RPC ack ("spawn done") is NOT process completion — only the exit event is. Two printing paths always drift into duplicate-or-missing prompts.
2. The browser's native `crypto` global is REPLACED by node's bootstrap (exposed-window-or-worker.js) — capture native primitives BEFORE boot, or every getRandomValues loops forever through node's webcrypto facade.
3. Bare `SharedArrayBuffer` in a browser worker throws on non-cross-origin-isolated pages — guard ALL SAB references (types/util bindings).
4. Dispose arrays mixing functions and IDisposable objects must be normalized — one throw leaks every later listener and cascades into Fast-Refresh full reloads.
5. Background recycling needs runtime-level serialization (promise chain), never UI-level boolean guards — a skipped recycle leaves a dirty kernel that trips node's fresh-process assertions.
6. `\r` + EL only rewrites the CURRENT row — wrapped lines need `\x1b[nA` + ED(J) or each keystroke appends a phantom row.
7. xterm v6: printable input arrives via `input` events (synthetic keydown doesn't type); test hook = `_core.coreService.triggerDataEvent()`. Buffer reads: `buffer.active.getLine(i).translateToString()`; "last line" = `baseY + cursorY`, NOT `length-1` (viewport padding rows are blank).

### Files changed this session
- `kernel/natives/crypto.ts` — NEW: full crypto binding (hashes/HMAC/PBKDF2/random + honest stubs).
- `kernel/natives/tty_wrap.ts` — rawMode tracking + cooked-mode \x03→SIGINT line discipline + attachProcess.
- `kernel/natives/types.ts` — HAS_SAB guard.
- `kernel/natives/index.ts` — register crypto binding.
- `kernel/boot.ts` — attachProcess wiring, waitForExitSettled early-exit, drain watcher 100ms.
- `runtime.ts` — processStart event, dirty-before-post, recycleSeq serialization, await-ready guards, doRecycle split.
- `components/NodeTerminal.tsx` — exit-driven single prompt authority, readline-lite shell (history/cursor/wrap-aware redraw), npm routing, mixed-dispose fix, __ocTerm E2E hook.
- `scripts/test-crypto.ts` — NEW: 212-test crypto verification suite (vectors + differential vs OpenSSL).

### Next (unchanged: S2 — npm)
- Real `npm init -y` / `npm install express` over the fetch bridge (crypto.createHash sha1/sha512 + randomBytes now real — ssri/etag-class integrity is unblocked).
- VFS persistence across processes (IndexedDB-backed) — node_modules must survive npm→node invocations.
- Virtual TCP stack + Service Worker preview for S3.

---

## Session 5 — 2026-11-03 (investigation + S2 npm)

### Context
Follow-up architecture investigation (8 sections, pre-S2) requested with strict rules: no rewriting old reports, repo evidence / real tests / vendored Node source / first-hand docs only, tested-vs-assumed separation, no unrelated features during investigation. Then S2: genuine npm install of Express within documented boundaries.

### A. Investigation (docs/architecture-followup-S2.md + download PDF + docs/bindings-matrix.json)
- **§1**: scripts/investigate-bindings.ts imports every binding live: 70 registered vs 72 consumed; only wasm_web_api (dead — bootstrap file never booted) + stream_pipe (http2-only) missing. Classification incl. HAZARD classes: silent no-op stubs (process_wrap/signal_wrap/tcp_wrap) and LYING cares_wrap DNS (127.0.0.1 for any host) — flagged for honest-throw conversion.
- **§2**: REAL npm CLI 11.20.0 vendored WITH its full bundled dep tree (565 pkgs, 11.7MB) and booted in-kernel: entire module graph loads; hard blocker = `await import('chalk')/'supports-color')` — ESM-only deps → user-land ESM (module_wrap) is THE prerequisite for the real CLI (S5). Express 5.3.0 tree: 65-68 pkgs / ~630 files / 2.2MB — ZERO lifecycle scripts, ZERO native, ZERO ESM → pure scenario A. depd's CallSite failure bisected to a BUN BUG (defineProperty on Error.prepareStackTrace kills delegation — 6-line repro; node/V8 unaffected → browser-safe, harness cannot evidence CallSite paths).
- **§3 [TESTED in real Chromium, page+worker]**: registry.npmjs.org CORS-open — packument 200 (worker 218ms), corgi Accept 335KB vs 804KB full, tarball 200 (165ms, gzip magic ✓), 404 clean, no redirects, sha512 integrity available. NO proxy needed.
- **§4 [benchmarked in worker]**: OPFS open/write/close 1.4ms/file; kept-open handles: write 0.125ms/file, read <5µs; IDB batched 0.08ms/write (async-only); cross-worker persistence verified (201 files, cold 0.74ms/file). DECISION: in-memory VFS authoritative + write-through deltas + OPFS full-tree saves at command boundaries + boot hydration (eager tree, lazy contents). Quota 10.75GB/10.4MB used; best-effort box eviction (MDN).
- **§5**: guest = dedicated worker: no DOM/localStorage; FULL same-origin IDB/OPFS/Cache access (verified); same-origin cookie fetch risk → S4 origin isolation required; PNA on hold, LNA permission prompt (Chrome 138+) cited; 3 action items (DNS lie, silent stubs, isolation).
- **§6**: cold 98ms / warm 55ms live; NEW permanent onStage boot hook decomposes kernel boot (registry 5 → realm 14 → task_queues 19 → per_thread 23 → is_main_thread 43 → console 45 → cjs_loader 46ms; heaviest = is_main_thread 20ms). Cache API: exactly opencontainer-runtime-v1 with 2 content-addressed entries.
- **§7**: terminal regression green (node -v/-e, REPL, crypto FIPS vector, .exit, prompt restoration, warm 55ms).
- **§8**: 10 questions answered + roadmap S2→S5. Report: docs/architecture-followup-S2.md + download/OpenContainer-Architecture-Followup-S2.pdf (7 pages, pdf_qa PASS).

### B. S2 — npm-oc installer (scenario A, registry-faithful)
**New vendored modules (in the runtime blob, mounted at /usr/lib/node_modules):**
- `npm-oc/tar.js` — ustar/GNU('L','K')/pax('x','g') parser + checksums + path-escape containment. 21/21 differential tests vs GNU tar (real express tarball byte-identical; synthetic longname/pax/hardlink/symlink; malicious-path containment).
- `npm-oc/installer.js` — corgi packuments, semver resolution via npm's OWN vendored semver@7.8.5 (through the real CJS loader), flat-hoisted tree + conflict nesting, tarball fetch + sha512/sha1 SRI verification via our REAL crypto Hash, extraction through real node:fs, .bin symlinks, install record.
- `npm-oc/cli.js` — npm init -y / install / ls / -v with honest version banner; keep-alive interval holds the process during async I/O (node semantics), real exit chain.
**Kernel changes:**
- vfs.ts: persist hook → typed ops (write/mkdir/symlink/unlink/rename) + exportTree/importTree.
- boot.ts: hydrate option; mounts npm-oc + semver from blob via store.list(); onStage hook (permanent §6 infra).
- module-registry.ts: **REALM FIX** — per-instance realm tracking (a second bootKernel in the same JS realm silently reused kernel1's realm/modules: stdio getters missing, ESM state stale).
- options.ts: **--require-module false** (documented divergence: node v26's module-sync condition routes dual-package requires to .mjs targets → loadESMFromCJS → S5-stub assert; now resolves legacy CJS entries).
- natives/zlib.ts (NEW): REAL CRC-32 (zlib chaining convention — string→UTF-8 fix caught by differential test) + loadable Zlib/Brotli/Zstd handle classes; init() throws honestly (S3 = fflate streams). Unblocked express's body-parser→zlib chain.
- misc.ts http_parser: + real `methods` list (lib/http.js METHODS export needs it — express requires http at app construction).
- worker-entry.ts: __ocHostGunzip bridge (native DecompressionStream captured pre-boot, fflate fallback — node's DecompressionStream shim routes to the S3 zlib stub); vfs-delta batching → host; OPFS save/load (manifest-first, flat encoded namespace, stale cleanup); npm spawn dispatch (runMain npm-oc cli, argv mirror); boot carries hydrate snapshot.
- runtime.ts: in-session snapshot (deltas applied, cascade on unlink) + persist-before-terminate at recycle boundaries; boot RPC carries snapshot (fast path ~12ms vs OPFS 694ms).
- **Manifest**: +57 files (npm-oc + semver); cleaned 3 stale entries; repacked → core-247ea444 (503 modules, 1.46MB gz).

### C. S2 verification (ALL in real Chromium)
- `npm install express` → **added 68 packages in 16.3s** (real registry, real integrity, real tar; prompt authority intact).
- `node -e "require('express')"` in a fresh process → **EXPRESS-OK: type function | app.get | Router | json | ver 5.3.0** (app constructed + middleware registered; V8 passes depd's CallSite exactly as predicted).
- **Page reload → OPFS hydration 694ms → `PERSIST-OK express 5.3.0 | qs: 1 | crypto: ba7816bf`** with zero network — node_modules survive reloads.
- `npm ls` (full listing) + `npm -v` (honest banner) + prompts restored.
- Final regression: node -v ✓ / node -e REG-42 ✓ / REPL 1+1 ✓ / crypto FIPS ✓ / .exit ✓ / express-after-all 5.3.0 ✓ / warm boot 72-95ms.
- Harness: test-tar 21/21, test-npm-install 12/12 (68 packages, tree audit, spot-requires through real CJS loader).
- Screenshots: download/opencontainer-s2-npm-express-final.png, download/opencontainer-investigation-terminal.png.

### Hard-won lessons (this session)
1. A second bootKernel in one JS realm must track realm-loaded state PER INSTANCE — global sentinel reuse silently serves kernel1's modules (stdio getters nulled by exit cleanup, stale ESM conditions).
2. node v26's `--require-module` adds `module-sync` to CJS resolution conditions — dual-package deps resolve to .mjs → require(esm). Without ESM, disable it and dual packages fall back to their legacy CJS entries (documented divergence, not a hack).
3. Bun's Error.prepareStackTrace delegation dies permanently after any defineProperty on it — CallSite-dependent code (depd) can ONLY be verified in Chromium, never the bun harness.
4. In-kernel `new Uint8Array(string)` is a length-coercion trap (123MB zero array!) — strings must go through TextEncoder. Differential tests catch this instantly.
5. The kernel replaces global DecompressionStream with node's zlib-backed shim — host bridges must capture native primitives BEFORE boot (same pattern as crypto's getRandomValues).
6. keep-alive timers for async CLI work must be REFED (an unrefed interval lets the loop-drain watcher kill the process mid-install).
7. Template literals in test scripts eat `\n` escapes — use String.fromCharCode(10).
8. OPFS full-tree save must happen at recycle boundaries with `exited === true` (worker idle) — inverting that condition silently skips every persist.

### Files changed this session
- NEW: kernel/natives/zlib.ts; vendor npm-oc/{tar,installer,cli}.js + package.json; vendor semver/ (53 files); docs/architecture-followup-S2.md; docs/bindings-matrix.json; scripts/{investigate-bindings,probe-express,probe-prepstack,test-tar,test-npm-install,probe-qs,probe-qs2,probe-extras,probe-ds,probe-detect,probe-detect2,probe-zlib,probe-crc,report-followup-pdf}.ts/py + report-followup-cover.html.
- CHANGED: kernel/{boot,vfs,module-registry,worker-entry}.ts, natives/{index,misc,options}.ts, runtime.ts, NodeTerminal.tsx (hint), vendor manifest.json (512→509 files), scripts/npm-harness.ts (mkdir destRoot fix + dump hook).

### Boundaries standing (documented, not hidden)
- npm-oc = scenario A only (pure JS, no scripts). B (lifecycle scripts) = child_process S5. C (native builds) / D (git+shell) = out of scope.
- Real npm CLI = S5 (needs user-land ESM module_wrap + http/https + zlib streams).
- zlib compression streams + http_parser = S3 (crc32 REAL now; require('zlib') loads; ops throw honestly).
- `app.listen()` (tcp server) = S3 virtual TCP + Service Worker preview.
- npx = honest error (S5).

### Next (S3)
- fflate-backed zlib handle protocol (real streams + sync convenience methods).
- http_parser binding + fetch-bridged http client; virtual server sockets + SW preview domain → `node server.js` with express serving real requests.
- cares_wrap honest ENOSYS or DoH bridge; convert remaining silent stubs as touched.

## Session 6 — 2026-11-03 (S3: preview networking, process manager hardening — commit 28dbed6, context ran out before logging)

### Context
The S3 spec (browser-based dev environment: node server.js, npm run dev, preview URLs, real HTTP verification). This session's engineering landed in commit 28dbed6 but the context window closed before the WORKLOG entry — recorded here retroactively from the commit + code.

### Done (commit 28dbed6)
- **Virtual TCP + real HTTP**: `tcp_wrap` (bind/listen/connect/accept/StreamBase onread protocol, EADDRINUSE mirror), `http_parser` (475 lines, real parsing both directions), `pipe_wrap` (stdio pipes), `process_wrap` (guest child_process.spawn), `stream-state` refactor.
- **Process manager (`runtime.ts` rewritten, +982)**: worker-per-process, pid table with parent/children, pipe table, virtual port registry, preview connection routing, child-spawn fan-out, kill semantics (SIGINT→JS, SIGTERM/KILL→terminate), VFS snapshot + delta fan-out, OPFS persist via shell keeper.
- **Preview Service Worker** (`public/opencontainer/preview-sw.js`): fetch interception, HTTP/1.1 request synthesis, response head parsing, chunked de-framing.
- **oc-sh** (`vendor/node-v26.13.0/oc-sh/sh.js`, 472 lines): POSIX subset shell (; && || > >> 2>&1, env prefix, $VAR, shebang dispatch, PATH lookup, ENOENT→127).
- **npm-oc exec.js** (npx: local .bin first → _npx cache install → bin exec) + **scripts.js** (npm run + lifecycle scripts with the security model: dependency scripts blocked by default).
- **pnpm-oc**: exec (PATH-prepend, .bin only), dlx (isolated cache), run-then-exec fallback.
- **test-s6.ts harness** (991 lines, 33 tests) + **oc-s6-driver.js** (browser E2E).
- bun harness green 33/33 at commit time; browser E2E failed at the preview-fetch stage (404s) — the session ended there.

## Session 7 — 2026-11-03 (S3 completion: preview bridge green end-to-end)

### Context
Continuation. The browser E2E showed preview fetches returning 404 from the Next.js app server — the Service Worker never saw them.

### A. Root causes found and fixed (each verified in real Chromium)
1. **SW SCOPE (the blocker)**: registration used scope `/opencontainer/` — a SW only intercepts fetches from clients it CONTROLS, and the host page at `/` is outside that scope → preview requests sailed to the app server (404s). FIX: `Service-Worker-Allowed: /` header (next.config.ts) + register at scope `/` + stale-scope hygiene. controller=true verified.
2. **REQUEST BYTES NEVER DELIVERED**: the SW sends the full HTTP/1.1 request wire-bytes in the `oc-preview-fetch` payload; the page handler passed only the reply port to `connectPreview` — the http.Server got an accepted connection that never speaks → hang. FIX: `connectPreview(port, channel, initialBytes)` posts `tcp-data` right after `tcp-connect`. First real round-trip: 322 ms.
3. **EADDRINUSE MIRROR RACE**: `runtime.ts` never sent `initialPorts` in the boot message (only the harness did) → the second server's `bind()` saw an empty mirror → S2-READY on a taken port. FIX: `initialPorts: [...this.ports.keys()]` in the boot payload.
4. **SILENT EXIT 0 ON UNCAUGHT nextTick THROWS**: `drainTicks` swallowed throws from `emitErrorNT` (listen EADDRINUSE with no error listener) → exit 0, no output. FIX: route through `process._fatalException` + `completeFatalExit` (stack + banner + exit 1) — node's exact semantics.
5. **LATENT `stream_wrap` BUG EXPOSED BY #4**: the binding never exported `ShutdownWrap`/`WriteWrap`/`ConnectWrap` (net.js `new ShutdownWrap()` on socket.end) and the `kLastWriteWasAsync`/`kLastWriteErr` enum order was backwards vs node v26.13.0's `StreamBaseStateFields` (verified against nodejs/node src/stream_base.h). FIX: classes + exact enum (3=kLastWriteWasAsync, 4=kLastWriteErr). The child_process regression (3 tests) this exposed is green again.
6. **`fs.rmSync(path, {force:true})` threw ENOENT**: node honors force at the JS/C++ rimraf boundary. FIX: vendored fs.js patch (documented) — try/catch ENOENT when force.
7. **HOST-WRITTEN FILES VANISHED FROM OPFS**: `rt.writeFile` used the keeper as delta SOURCE (fan-out skips the source) so the keeper's VFS never received host writes — and the keeper performs the OPFS save. FIX: `write-file` RPC to the keeper before the delta fan-out. Verified: files + node_modules survive reload with ZERO registry requests; server restarts from the persisted project.
8. **`process.chdir` MISSING** (npm lifecycle scripts call it): wired via `rawMethods.chdir` (validated ENOENT) + umask/initCwd.
9. **TERMINAL UX**: bash-style prompt redraw after background job messages (listen events, background exits) with in-progress line preservation; write-tracking (`atCol0Ref`) replaces the render-lag-fragile `cursorX===0` check that concatenated "code 3oc v26.13.0 ❯".
10. **`cd`/`pwd`** in the shell + cwd-aware prompt (suffix only outside /home/project — E2E prompt contract stable) + runtime cwd tracking for relative script resolution and PATH lookup.

### B. E2E driver (public/oc-s6-driver.js) — 23/23 GREEN (fresh-project scenario)
node -v/-e → project-clean (fresh user) → npm init -y → **npm install express (cold, real registry, 15.8 s)** → require('express') → npm run hello/bad (exit codes) → **npm run dev & → listen → REAL preview fetches: JSON 200 + HTML 200 + concurrent** → jobs → **EADDRINUSE (crash + stack + exit 1)** → in-guest http.get → **npx cowsay (_npx cache)** → **pnpm dlx** → **_npx/dlx isolation probe (BIN-ABSENT true)** → npm install cowsay → **pnpm exec (via .bin only)** → kill servers (ports released). Driver lessons: xterm renders writes asynchronously — step pacing must wait for the submit newline to render (buffer growth) before waiting for the prompt, else keystrokes land in a still-running process's stdin and vanish; needle checks poll the buffer after prompt-return.

### C. PART 5/6/7 verification (beyond the driver)
- **Multiple servers**: express :3000 + raw http :4173 concurrently; independent previews; kill A → B unaffected (A: 502, B: 200); A restarts on the same port.
- **Persistence**: reload → files + node_modules hydrate from OPFS with ZERO network; `node persist-probe.js` (require express) + server restart + preview all green.
- **fs.watch**: real change/rename events fire (rename filename may be null — documented divergence).
- **create-vite probe (honest)**: `npx -y create-vite@latest my-app --template react` installs 105 packages (real registry, 2.8 s) but the generator crashes at the ESM boundary (module_wrap, S5) — plus a third attempt hit the documented 8-process limit (EAGAIN). Vite dev/HMR + Next.js dev = blocked on ESM (S5). Documented in COMPATIBILITY.md §4.
- **Performance (measured separately, localhost)**: cold boot 893 ms (index 29 + fetch 144 + inflate 128 + decode 188 + bootstrap 685) · warm boot 224 ms (cache 16 + decode 67 + bootstrap 124) · spawn dispatch 1 ms · spawn→listen 139 ms · preview round-trip ~510 ms · express cold install 15.8 s / HTTP-warm 1.2 s · JS heap 13 MB used.
- **Regression**: harness 33/33, tar 21/21, npm-install 12/12, pnpm-install 30/30.

### D. Docs
- **COMPATIBILITY.md** (repo root, PART 8): full classification (fully/partially/loadable-unverified/unsupported-with-descriptive-errors), engine identity, vendored patches, divergences list, security model.
- **docs/adr-001-preview-networking.md**: the networking ADR (options compared, chosen architecture diagram, 5 verified-by-failure lessons, honest limitations incl. WS/HMR).
- AIM.md S3 marked ✅ with evidence; S4/S5 re-scoped (WS→S4, ESM→S5 named as THE boundary).
- Screenshot: download/opencontainer-s3-preview-express.png (real Chromium, preview pane rendering the express app).

### Hard-won lessons (this session)
1. A SW scope must cover the CLIENT, not the request URL — scope `/opencontainer/` left the page uncontrolled while everything else looked healthy.
2. MessagePort plumbing needs the payload's initial bytes fed into the virtual connection explicitly — an accepted-but-silent socket hangs forever with zero diagnostics.
3. `initialPorts` must travel in the boot message; broadcast updates race user code.
4. Never swallow nextTick throws — they are node's async error path (emitErrorNT); routing them to `_fatalException` exposed a second latent bug (ShutdownWrap) that silent-swallowing had hidden across milestones.
5. Node's stream_base.h enum order (kLastWriteWasAsync BEFORE kLastWriteErr) — verify binding enums against the C++ header, not memory.
6. `rt.writeFile` must reach the OPFS-saving process's own VFS — being the delta source excludes it from the fan-out.
7. E2E drivers over xterm must respect write-render asynchrony: buffer-growth pacing before prompt polling.
8. A pending-persist debounce (1.5 s) means test flows must wait past it before reloading — otherwise the save races the teardown.

### Files changed (session 7)
- CHANGED: next.config.ts (SW header), page.tsx (root-scope registration + request-bytes delivery), NodeTerminal.tsx (printJobMessage, atCol0Ref, cd/pwd, cwd prompt), runtime.ts (initialPorts, connectPreview bytes, keeper write-file RPC, cwd/chdir/resolveInCwd, PATH from cwd), kernel/boot.ts (drainTicks fatal routing, chdir/umask/initCwd), kernel/natives/stream_wrap.ts (ReqWrap classes + enum), kernel/natives/stream-state.ts (node-exact enum), vendor fs.js (rmSync force patch), oc-s6-driver.js (pacing + isolation probe + cleanup step).
- REBUILT: public/opencontainer/kernel-worker.js + runtime blob (core-e3238262, 511 modules, 1.48 MB gz).
- NEW: COMPATIBILITY.md, docs/adr-001-preview-networking.md, download/opencontainer-s3-preview-express.png.

### Boundaries standing (documented, not hidden)
- ESM (module_wrap) = S5 → blocks create-vite/Vite dev/HMR/Next.js dev/real CLIs. npx create-vite installs but the generator crashes at the boundary — honest error, exit 1.
- WebSockets not interceptable by SW → HMR socket needs the S4 injected-transport shim.
- External TCP: ENOSYS (never faked). DNS: local only.
- 8-process limit (EAGAIN beyond).
- Preview shares the host origin (isolation = S4).

### Next (S4)
- WebSocket transport (MessageChannel-backed `ws` shim in-kernel) → Vite HMR after ESM lands.
- Origin isolation for the preview + embed security review (COOP/COEP/CSP, iframe architecture).
- jsh OSC 654 + watchPaths/textSearch/setPreviewScript; kill trees + combined output.
- ESM (module_wrap) remains the S5 prerequisite for the real CLIs + Vite-class tooling.

### Session 7 addendum — final certification (same day, post-docs)
- `process.chdir` wired through the validated binding + `/tmp` provisioned at kernel boot (os.tmpdir() honest; chdir ENOENT verified) — rebuilt worker, harness 33/33.
- **Final E2E certification run (driver v8): 23/23** with the complete change set (express cold install 16.4 s, preview fetch 536 ms). All regression suites re-run green: 33/33, 21/21, 12/12, 30/30.
- Evidence artifacts: `download/opencontainer-s3-e2e-log.json` (full per-check terminal capture incl. the real node-stack EADDRINUSE crash through `opencontainer://net:2371`), `download/opencontainer-s3-benchmarks.md` (cold/warm separated measurements), `download/opencontainer-s3-preview-express.png` + `download/opencontainer-s3-final-e2e.png`.

## Session 8 — 2026-11-03→04 (S3.1 performance investigation + ESM module graph)

(Reconstructed from git history + artifacts — the session ran out of context before logging.)

- Baseline measured (`download/opencontainer-s31-baseline.json`): SW echo RTT P50 12.3/P95 41.2 ms; full preview fetch P50 612/P95 1278 ms; kernel boot cold 22.7 s / warm 4.2 s; `npm install express` cold 34.3 s / warm 1.2 s; readFileSync P50 1.5 ms; writeFileSync P50 6 ms. CPU hotspots: regExpExec 3.1% et al. heap/workerCount left TBD-final-run.
- Compatibility bug 1 fixed: `readdirSync(path, {withFileTypes:true})` Dirents lacked isFile/isDirectory → fs.ts now returns the node contract tuple.
- Compatibility bug 2 fixed: http_parser takeLine was O(n²) → single linear scan (`// PERF (S3.1)`).
- Preview transport investigated (`scripts/preview-transport-report.md`, 5 bench scripts): SW echo round-trip, base64 chunk encoding, 5–7 handoff hops. Optimization proposals C1–C8 documented, NOT yet implemented.
- Phase 6: ESM module-graph importer (`kernel/esm-graph.ts`) — static/dynamic import edges, top-level await, CJS interop.
- ESM E2E 17/17 (`download/opencontainer-s31-esm-e2e.json`); S6 regression 23/23 (`download/opencontainer-s31-s6-e2e.json`).
- Committed as 24677cb (S3 complete + fixes) and 299229c (ESM graph + E2E artifacts + rebuilt worker).

## Session 9 — 2026-11-04 (IDE hardening: user-reported defects, Amplify UI port, terminal truth fixes)

User reports (five defects + one workflow demand), all addressed same-session:

1. **Terminal character corruption** (`c26.13.0`, `nppxx eexxppoo ccrreeaattee`) — TWO stacked root causes:
   - Bare `\x1b` bytes used as "markup" in IdeTerminal/NodeTerminal prompt & help text; xterm.js parses ESC+next-char as a control sequence and EATS the following character. Fixed: SGR discipline — every styled run is a real `\x1b[Nm`…`\x1b[0m` sequence (helper object `S`). Regression guard added to the E2E driver ("prompt renders intact").
   - Double-wire: the boot-gated wiring had two paths (container 'ready' event + boot() promise) and 'ready' can fire after the promise resolves; the 'ready' handler lacked the runtimeRef guard → EVERY write duplicated (prompt ×2, "Ok to proceed? Ok to proceed?"). Fixed: `wire()` is idempotent (`if (disposed || runtimeRef.current) return`). Driver check "renders exactly once".
2. **GitHub import failed** — api.github.com rate-limited (60/h, shared egress IP, remaining: 0) AND codeload CORS-locked to render.githubusercontent.com. Fixed: server-side proxy route `/api/gh-import` (codeload `HEAD` ref = default branch, no REST API, no client rate-limit, clean 404 JSON for missing/private repos). Client accepts `owner/repo` shorthand. Verified live: expressjs/express 136 KB tarball / 285 entries in 0.76 s; UI import → 216 files into VFS, project auto-opened.
3. **node_modules uploaded on directory import** — filter layer in container.ts: `isIgnoredImportPath()` skips node_modules/.git/.next/.turbo/.cache/.pnpm-store/coverage/__MACOSX/.DS_Store at ANY depth, BEFORE reading bytes (importDirectory) and as a safety net in importFiles; ZIP import covered; dist/build deliberately KEPT (some projects ship needed artifacts). Nothing silently dropped: ImportResult.skipped/skippedCount + sidebar importSummary surfaces the numbers.
4. **Terminal didn't look like a real terminal** — ported the Amplify (MIT, verified) terminal stack verbatim: Snazzy theme (#1e1e21/#eff0eb + full ANSI 16), fontSize 12 Geist Mono/Menlo, scrollback 1000, rightClickSelectsWord, allowProposedApi, WebLinks addon, 1rem xterm padding, pill-tab chrome with icon buttons (reset/collapse). globals.css retuned to Amplify tokens: primary #0d9fff, card oklch(0.2301 0.0025 247.93), muted oklch(0.269 0 0).
5. **"Create my project" button removed** — projects are created by TERMINAL COMMANDS now. Sidebar shows the command recipe (`cd /home/projects && npm create vite@latest my-app`). Auto-discovery: watch /home/projects (VFS watchers) + rescan on fs-change (debounced 600 ms + 3 s second pass) + on foreground process exit (scaffold finished) + at boot; any dir gaining package.json is registered (source: 'command') and appears in Recent. Verified live: `mkdir e2e-cmd-app` → `cd e2e-cmd-app` → `npm init -y` ("Wrote to /home/projects/e2e-cmd-app/package.json") → project auto-registered. container.createProject() kept as an API primitive for drivers.
6. **Coreutils + shell chains (new, enables #5)** — oc-sh gained REAL fs builtins: ls (-l/-a, columns), mkdir (-p), rmdir, touch, cat, rm (-r/-f), mv, cp (-r), head/tail (-n), wc (-l/-w/-c), which. Top-level routing: first-token coreutils OR lines with `;`/`&&`/`||` run through `sh -c <single-quoted raw line>` (parseCommand understands single quotes). Three pre-existing latent bugs fixed in oc-sh/runtime: (a) builtin output redirection (`echo hi > file` wrote NOTHING — builtins bypassed the sinks; now intercepted + flushed), (b) tokenizer shattered `2>&1` into '2>' '&' '1' → "syntax error near '2>'" in every position (now one token), (c) resolveShellCommand mapped `sh` to /usr/local/bin/sh but the shim lives at /usr/bin/sh → MODULE_NOT_FOUND when typing `sh`.

Also: project-switcher button in the explorer header (ProjectsPanel reachable when a project is active — was hidden); terminal + store now FOLLOW project switches (container 'projects-changed' → cwdRef/store cwd sync + prompt redraw with `〃 project →` notice); container.exportTree() passthrough added (SearchPanel was calling a non-existent method — pre-existing type error).

E2E: driver extended to 30 checks; three driver-logic races fixed while at it (stale-text waitForText after restart — now t.clear()+port-wait; whole-buffer scan after clear; prompt discipline before typed checks). **Final run: 30/30 PASS** (`download/opencontainer-s9-ide-e2e.json`), incl. npm install express 15.7 s real registry, preview fetch through SW bridge, restart picks up edits, coreutils mkdir, GitHub proxy 200/136 KB. Screenshot: `download/opencontainer-s9-ide-final.png` (pixel-verified: terminal #1e1e21, title bar Amplify card + #0d9fff accent).

### Lessons (session 9)
1. Never emit bare `\x1b` into xterm — it eats the NEXT character. SGR sequences with explicit reset only.
2. Event-driven wiring with two completion paths needs an idempotence guard in the handler itself, not just at one call site.
3. Browser→GitHub needs a server proxy: codeload HEAD covers default-branch without the rate-limited REST API.
4. E2E text-matching over a terminal must account for t.clear() geometry (content at top, viewport filler below) and stale scrollback from earlier runs.
5. oc-sh builtins and spawned commands have DIFFERENT stdio paths — redirects must be enforced at both.

### Files changed (session 9)
- CHANGED: src/components/ide/{IdeTerminal,IdeShell,Sidebar,store,FileExplorer,EditorTabs}.tsx, src/packages/opencontainer/ide/container.ts, src/packages/opencontainer/runtime.ts (sh path), src/app/globals.css, src/packages/opencontainer/vendor/node-v26.13.0/oc-sh/sh.js (coreutils + redirect + tokenizer), scripts/oc-ide-driver.js.
- NEW: src/app/api/gh-import/route.ts; public/monaco/ (earlier this session-series).
- REBUILT: public/opencontainer/kernel-worker.js + runtime blob (core-d3f3d922).
- ARTIFACTS: download/opencontainer-s9-ide-e2e.json, download/opencontainer-s9-ide-final.png.

### Boundaries standing
- `cd` inside a `&&` chain is local to that sh invocation (subshell semantics) — persistent cwd changes need a standalone `cd` (documented in the help text).
- Private GitHub repos unsupported (proxy 404s honestly).
- dist/build are imported (not skipped) — deliberate; skipped list is reported, never silent.

## Session 10 — 2026-11-04 16:00→ (expo crash investigation + ephemeral node_modules + FSA folder import) — LOST, PARTIALLY RECOVERED

*(Reconstructed 2026-11-05 from the session prompt file `upload/prompt-20261105-105045.txt` — the sandbox execution layer died at the finish line; the WORKLOG entry and final E2E re-run were never written.)*

- **expo `npx create-expo-app` crash root-caused as a stale deployment build**: user's npm debug log 16:05:34Z vs fix commit 19fb94d at 16:03Z (fs binding `writeString` signature fix — corrupted tar-stream writes make npm's bundled tar throw `Buffer.concat([buffer, 'LICENSE'])`). Verified 4 independent ways on HEAD: harness install (exit 0, 69 files), browser /ide fresh + warm, and the exact user env (root page, `~/project`, no package.json) — tool prompt reached `? What is your app named?`.
- **Ephemeral node_modules (WebContainers behavior)**: reload keeps project files + `.npm/_cacache`, drops `node_modules`. **STATUS AFTER LOSS: the save/load-time filter in the OPFS keeper was NOT recovered — re-implementation pending** (see Session 12 recovery audit).
- **Folder upload via File System Access picker**: traversal never descends into node_modules/.git — the browser never even enumerates them (57K-file crawl gone). Firefox/Safari fall back to the filtered webkitdirectory path. **Recovered in commit e8d794c** (Sidebar.tsx + container.importDirectoryHandle + fs-access.d.ts, with 20K files / 200 MB / depth-12 guard rails).
- Pending at loss: full 30-check E2E regression re-run + `scripts/oc-npx-expo-driver.js` permanent gate (gate file itself lost).

## Session 11 — 2026-11-05 00:00→04:41 (P1 "npm is npm" — the deep investigation) — COMMITTED e8d794c, WRITE-UP LOST

- Investigation (StackBlitz baseline + upstream node source + real-Chromium probes) found the two missing disciplines: **native-binding surface parity** (internalBinding('buffer') was partial — copy/fill/indexOf/atob/btoa missing, killed create-expo with `_copy is not a function`) and **event-loop handle accounting** (in-flight browser fetches invisible to the loop-drain watcher → npm died mid-packument with "Exit handler never was never called!").
- Adopted as code (all in e8d794c): full buffer binding surface (`natives/buffer.ts`, verified byte-identical vs real node), fetch-as-loop-handle accounting (`net-pending.ts`), Node http/https client over worker fetch (`http-fetch-client.ts`, 1173 lines), http2 + stream_pipe bindings, esm-to-cjs facade, `/api/oc-net` registry CORS bridge (allowlist: registry.npmjs.org/.com, anonymous, https-only — fixes the silent-death CORS on `/-/npm/v1/security/advisories/bulk`), npm 12.2.1 packed as a runtime blob (1,941 modules, 2.86 MB gz).
- **P1 gate result (real Chromium, real registry, unmodified vendored npm@12.2.1)**: `npm install express` → added 65 packages in 16 s; Express 5.3.0 serving through preview (200 P1-GATE-OK); npm view/init/-v pass; npx create-expo-app end-to-end with binary-exact extraction. Evidence artifacts `download/opencontainer-s12-p1-gate.*` — **LOST** (evidence re-verification pending, see Session 12).
- Write-up `docs/reality-initiative/07-oss-strategy-adoption.md` — **LOST uncommitted; the whole reality-initiative series (01-07) was never committed and did not survive.**

## Session 12 — 2026-11-05 (RECOVERY AUDIT + GitHub preservation) — this session

Audit of actual repo state vs the lost claims (git + tree, every claim verified):

| Claim from lost sessions | Actual state |
|---|---|
| Buffer binding full surface | ✅ e8d794c: natives/buffer.ts; parity harness 53/53 byte-identical (re-run this session) |
| HTTP client + registry CORS bridge | ✅ e8d794c; http client 32/32 (re-run this session) |
| net-pending fetch-as-handle accounting | ✅ e8d794c |
| npm blob + /usr/lib/node_modules mount | ✅ blob 2.86 MB gz, 1,941 modules; harness `npm -v` → 12.2.1 (re-run) |
| FSA folder import | ✅ e8d794c |
| kernel-worker.js rebuilt with P1 surface | ❌ built 11-04 08:04 (pre-e8d794c) → **rebuilt this session** (401 KB → 462 KB) |
| Ephemeral node_modules | ❌ NOT in tree (fs.ts persistExclude last touched 11-03; saveTreeToOpfs unfiltered) — **re-implemented this session** (see below) |
| docs/reality-initiative 01-07 | ❌ never committed, unrecoverable → SERIES-RECOVERY.md stub written |
| opencontainer-s12-p1-gate.* evidence | ❌ lost |
| WORKLOG S10-S11 entries | ❌ lost → reconstructed above |

Also this session: `wasm_web_api` binding (bootstrap `exposed-window-or-worker.js` setImplementation), V8 heap-limit fallback (2 GiB constant when the browser hides `performance.memory` — zero limit made arborist's PackumentCache throw `cannot set sizeCalculation without setting maxSize or maxEntrySize`), stream_pipe binding registration, fixed KernelProcess.pending resolve typing (`(value?: any) => void`) that blocked d.ts generation.

**NEW STANDING DIRECTIVE (user):** push the package (and only the package) to github.com/imtia33/opencontainer as sandbox-reset insurance — `scripts/push-github.sh` (+ `.oc-github-token`, gitignored) implements it; npm-release-ready metadata staged in `release/` (package.json with exports/files/scripts, README, MIT LICENSE) and `scripts/build-dist.ts` + `tsconfig.dist.json` produce `dist/` + `dist-types/` (zero runtime dependencies).

## Session 13 — 2026-11-05 (real-npm restoration: zlib/url/fs binding gaps found by the genuine CLI)

Context: this GitHub repo is the flattened package snapshot; the dev sandbox (with the P1-era kernel) was lost. Session 12's claim "genuine npm install works" could NOT be reproduced on this tree — the working tree's bindings had regressed to pre-P1 stubs in exactly the places npm's tarball path needs. All four gaps below were found by running the REAL npm CLI in the bun harness (crash-driven porting), each fixed minimally, each with a permanent gate.

1. **zlib binding was an ENOSYS stub** (`natives/zlib.ts`: "compression streams land in S3") — npm's tar → minizlib extraction cannot work at all without real handles. Re-implemented the full node handle protocol (init/write/writeSync/close/reset/params + writeState + processCallback + jsref accessor) on fflate for ALL 7 modes (DEFLATE/INFLATE zlib-format, GZIP/GUNZIP, DEFLATERAW/INFLATERAW, UNZIP auto-detect via 2-byte sniff — fflate's own Unzip class is a ZIP reader, not the auto-detector). Gotchas found the hard way: (a) handle classes must be created INSIDE makeZlibBinding — node's lib/zlib.js defines a non-configurable `jsref` accessor on binding.Zlib.prototype at module load, a shared prototype breaks the second kernel boot in one realm; (b) lib/zlib.js sets `handle.cb`/`handle.buffer`/`availInBefore`/`availOutBefore`/`inOff`/`flushFlag` as expandos — a binding field named `cb` gets clobbered (async writes silently invoked the user callback instead of processCallback: streams emitted nothing); (c) fflate sync stream ondata is (data, final) — errors are THROWN by push(), not passed; (d) deflate-side flush flags map to fflate's flush(); (e) async zlib writes are uv reqs — added zlibPendingCount() to boot.ts's loop census (net-pending discipline) so the drain watcher doesn't reap processes mid-gunzip. Gate: `scripts/test-zlib.ts` 23/23 (all modes, streaming/pipe/dictionary/garbage/crc32 + host-side real-node gunzip of kernel-produced gzip).
2. **url binding missing format/update/getOrigin** — make-fetch-happen's cache key calls `url.format` (fatal "bindingUrl.format is not a function") and every WHATWG URL mutation goes through `bindingUrl.update(href, action, value)` with the updateActions enum; update must also refresh the shared urlComponents array (setURLContextFromBinding reads it). Implemented on the browser URL (format honors fragment/search/auth flags; unicode approximated as ASCII).
3. **fetch-backed http client leaked content-encoding/content-length** — bun/browser fetch auto-decompresses; npm's minipass-fetch saw content-encoding: gzip over already-decoded JSON → Z_DATA_ERROR. Now stripped in FetchIncomingMessage (http-fetch-client.ts).
4. **fs binding dual() callback-mode bugs** — (a) `binding.stat(path, bigint, req, throwIfNoEntry)`: the req is NOT the last argument (fs.js:2076); the last-arg-only detection made async stat fall through to SYNC mode (threw ENOENT instead of calling back — tar.x hung forever after its first stat). dual() now scans backwards for the req. (b) Async errors were passed to oncomplete as RAW errno numbers (-2) — node's C++ FSReqCallback::Done converts to ErrnoException first; raw numbers broke cacache's `err.code === 'ENOENT'` handling (cache write stream died). Both fixed; errnoExceptionOf now used for the callback path.

Also: fflate added as devDependency (it was inlined in the committed worker but unresolvable in this tree — the build was broken); test-buffer-parity.node.js renamed .cjs (repo "type":"module" broke CJS); `scripts/test-npm-real.ts` added — the REAL npm CLI test (init -y → install lodash from the real registry → ls → fresh-process require) — **12/12 PASS, install in ~2.6 s**.

Evidence (this session, bun harness): buffer parity 53/53, http client 32/32, `npm -v` → 12.2.1, zlib 23/23, real-npm 12/12. Kernel worker + blobs rebuilt (content hashes unchanged: d3f3d922/d518032c), dist rebuilt.

Known remaining: pnpm is still the DIY pnpm-oc (honest, labeled); npx/child-spawn requires the browser host (harness has no ProcessManager); browser E2E evidence regeneration pending (lost host app).
