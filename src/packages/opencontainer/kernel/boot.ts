/**
 * OpenContainer Kernel — Boot orchestrator.
 *
 * Mirrors node's own bootstrap sequence (internal/bootstrap/node.js →
 * internal/bootstrap/switches/is_main_thread.js) using the REAL vendored
 * modules wherever possible. The only trimmed part: the ESM loader-worker
 * spawn (CJS-first stage); everything CJS is node's own code.
 */

import { Vfs, VfsTree } from './vfs';
import { Natives, KernelHooks } from './natives';
import { ModuleRegistry, loadPrimordials, SourceStore } from './module-registry';
import { NODE_VERSION, VENDOR_ROOT, resolveModuleFile } from './id-map';
import { wireBuiltinCompile } from './natives/builtins';
import { activeFsCount } from './natives/fs';
import { makeEsmGraphImporter, fileUrlOf, dirnameOf as esmDirname } from './esm-graph';
import { installNetPendingGlobalFetch, netPendingCount } from './net-pending';
import { zlibPendingCount } from './natives/zlib';
import { installFetchHttpClient } from './http-fetch-client';
import { transformEsmToCjs, RequireAsyncModuleError } from './esm-to-cjs';

export interface BootedKernel {
  process: any;
  registry: ModuleRegistry;
  natives: Natives;
  vfs: Vfs;
  /** Run a CJS string like `node -e` (real internal/process/execution path). */
  runEval(code: string, print?: boolean): Promise<void>;
  /** Run a CJS file like `node file.js` (real CJS loader main entry). */
  runMain(path: string): Promise<void>;
  /** require() for host-provided preloads. */
  require(id: string): any;
  /** Start node's "event loop empty ⇒ process exits" watcher. */
  startLoopDrainWatcher(): void;
  /** Stop the loop-drain watcher. */
  stopLoopDrainWatcher(): void;
  /** Deliver a signal to this process (SIGINT semantics; returns whether a
   *  JS listener handled it — the caller applies the default disposition). */
  raiseSignal(sig: string): boolean;
  /** True when this process still owns live resources (handles/children). */
  hasLiveHandles(): boolean;
}

export interface BootOptions {
  store: SourceStore;
  hooks: KernelHooks;
  vfs?: Vfs;
  cwd?: string;
  env?: Record<string, string>;
  argv?: string[];
  /** options map exposed via internalBinding('options') (e.g. --eval). */
  options?: Map<string, any>;
  /** Diagnostic: invoked at the end of each boot stage (name + elapsed ms). */
  onStage?: (name: string, ms: number) => void;
  /** Snapshot hydration (host-owned VFS state — survives recycles). */
  hydrate?: VfsTree;
  /** Process identity (multi-process model: one kernel = one process). */
  pid?: number;
  ppid?: number;
  /** Stdio modes for fd 0/1/2: real tty, virtual pipe, or ignore. */
  stdio?: Array<{ type: 'tty' | 'pipe' | 'ignore'; pipeId?: number }>;
}

/* ------------------------------------------------------------------ */
/* Host loop primitives — captured at MODULE scope, once per realm.     */
/* ------------------------------------------------------------------ */
/**
 * The kernel's timers module replaces globalThis.setTimeout/setInterval with
 * the GUEST timer system (guest code expects node-semantics timers as
 * globals). Kernel-internal machinery — the settle-poll in runMain/runEval
 * and the loop-drain watcher — must run on the HOST loop instead:
 *  1. a kernel timer would count as a pending guest handle and block
 *     "loop empty ⇒ process exits" detection forever;
 *  2. after the guest process begins exiting, node's own timers refuse new
 *     schedules (_exiting guard), so a guest-scheduled settle-poll NEVER
 *     fires — runMain's promise hangs and, in the bun harness (no other
 *     live host handle), the host silently exits on the drained loop;
 *  3. sequential in-realm boots (harness: one kernel per process) must not
 *     capture a PREVIOUS kernel's swapped globals — hence module scope,
 *    which runs before any bootKernel() call in this realm.
 */
const hostSetTimeout: (cb: () => void, ms?: number) => any =
  (globalThis as any).setTimeout?.bind(globalThis)
  ?? ((cb: () => void, ms?: number) => setTimeout(cb, ms));
const hostSetInterval: (cb: () => void, ms: number) => any =
  (globalThis as any).setInterval?.bind(globalThis)
  ?? ((cb: () => void, ms: number) => setInterval(cb, ms));
const hostClearInterval: (t: any) => void =
  (globalThis as any).clearInterval?.bind(globalThis)
  ?? ((t: any) => clearInterval(t));

/**
 * Pristine realm globals, captured once at module load — i.e. BEFORE any
 * bootKernel() call in this realm has swapped them for the guest's. Used by
 * restoreHostGlobals() to hand the realm back to the host when the guest
 * process dies. In the browser worker this is belt-and-braces (the whole
 * worker is recycled); in shared-realm hosts (the bun test harness, node
 * embedding) it is REQUIRED: host code that touches `process`, `console`,
 * `setTimeout`, or `Buffer` after a kernel exited would otherwise run on a
 * dead guest's objects — timers schedule inside an exiting timer system
 * (never fire), process.exit hits the guest's wrapped binding, and the host
 * silently dies on its drained loop.
 */
const pristineGlobals = (() => {
  const g = globalThis as any;
  return {
    process: g.process,
    console: g.console,
    setTimeout: g.setTimeout,
    clearTimeout: g.clearTimeout,
    setInterval: g.setInterval,
    clearInterval: g.clearInterval,
    setImmediate: g.setImmediate,
    clearImmediate: g.clearImmediate,
    Buffer: g.Buffer,
    global: g.global,
    // Web-stream classes: the kernel installs node's own implementations
    // (node parity — see the webstreams_globals boot stage); the realm must
    // get the HOST's (browser-native) classes back on kernel exit.
    ReadableStream: g.ReadableStream,
    ReadableStreamDefaultReader: g.ReadableStreamDefaultReader,
    ReadableStreamBYOBReader: g.ReadableStreamBYOBReader,
    ReadableStreamBYOBRequest: g.ReadableStreamBYOBRequest,
    ReadableByteStreamController: g.ReadableByteStreamController,
    ReadableStreamDefaultController: g.ReadableStreamDefaultController,
    WritableStream: g.WritableStream,
    WritableStreamDefaultWriter: g.WritableStreamDefaultWriter,
    WritableStreamDefaultController: g.WritableStreamDefaultController,
    TransformStream: g.TransformStream,
    TransformStreamDefaultController: g.TransformStreamDefaultController,
    ByteLengthQueuingStrategy: g.ByteLengthQueuingStrategy,
    CountQueuingStrategy: g.CountQueuingStrategy,
    TextEncoderStream: g.TextEncoderStream,
    TextDecoderStream: g.TextDecoderStream,
    CompressionStream: g.CompressionStream,
    DecompressionStream: g.DecompressionStream,
  };
})();

let realmGlobalsRestored = false;

/** Return the realm's globals to their pre-boot (host) values. Idempotent. */
function restoreHostGlobals(): void {
  if (realmGlobalsRestored) return;
  realmGlobalsRestored = true;
  const g = globalThis as any;
  for (const [key, value] of Object.entries(pristineGlobals)) {
    try {
      if (value === undefined) delete g[key];
      else g[key] = value;
    } catch { /* non-writable global — leave it */ }
  }
}

export async function bootKernel(opts: BootOptions): Promise<BootedKernel> {
  const __stageT0 = Date.now();
  const __stage = (name: string) => { try { opts.onStage?.(name, Date.now() - __stageT0); } catch { /* diagnostic only */ } };
  // hostSetTimeout / hostSetInterval / hostClearInterval are captured at
  // MODULE scope (see above) — never from the possibly-swapped globals here.

  // Realm return: after the guest process is dead (its 'exit' handlers have
  // run — node's exit chain is emit('exit') → reallyExit → hooks.onExit),
  // hand the realm's globals back to the host. The guest's own exit handlers
  // still see the guest globals (they run BEFORE the hook). Wrapping here
  // (before nativesCtx captures the hooks) funnels EVERY exit path —
  // process.exit, reallyExit, fatal exits, signal default dispositions —
  // through the same restore.
  const userOnExit = opts.hooks.onExit;
  // A fresh kernel takes ownership of this realm's globals — re-arm the
  // restore (sequential in-realm boots: kernel #1 restored on exit, kernel
  // #2 swaps again and must restore again).
  realmGlobalsRestored = false;
  opts = {
    ...opts,
    hooks: {
      ...opts.hooks,
      onExit: (code: number) => {
        try {
          userOnExit?.(code);
        } finally {
          restoreHostGlobals();
        }
      },
    },
  };

  // P1 loop-handle accounting: an in-flight guest fetch is a live uv-style
  // handle (see kernel/net-pending.ts). Installed BEFORE any native code
  // loads so every later consumer (npm-oc, the fetch-backed http client,
  // user code) is counted from the first call.
  installNetPendingGlobalFetch();

  // SharedArrayBuffer polyfill for non-cross-origin-isolated hosts. Unlike
  // WebContainers (which REQUIRES COOP/COEP headers), OpenContainer runs on
  // any static host — but then the browser hides SharedArrayBuffer, and
  // guest code that merely allocates one (pnpm: Buffer.from(new
  // SharedArrayBuffer(n)) as a chunk-copy target) dies with a ReferenceError.
  // Our workers are in-process, so nothing ever shares memory across threads;
  // aliasing to ArrayBuffer preserves exactly the semantics we can honor.
  // Real SAB (isolated hosts, bun/node harnesses) is left untouched.
  if (typeof (globalThis as any).SharedArrayBuffer === 'undefined') {
    (globalThis as any).SharedArrayBuffer = ArrayBuffer;
  }

  const vfs = opts.vfs ?? new Vfs();
  const cwd = opts.cwd ?? '/home/project';
  vfs.mkdir('/home', true);
  vfs.mkdir(cwd, true);
  vfs.mkdir('/home/node', true); // os.homedir() — REPL history lives here
  // Standard base directories every unix-ish node program expects to exist
  // (the "OS image" our runtime ships). /tmp backs os.tmpdir(); chdir into
  // these paths must not ENOENT.
  vfs.mkdir('/tmp', true);
  if (opts.hydrate) {
    vfs.importTree(opts.hydrate);
    __stage('hydrate');
  }

  // Mount OpenContainer-authored packages (npm-oc + pnpm-oc installers and
  // npm's own semver) from the vendored store into /usr/lib/node_modules —
  // node's global-prefix layout, so require('semver') and
  // require('../npm-oc/installer.js') resolve through node's REAL CJS loader
  // from both installer CLIs. Mounted before the persist hook exists:
  // system files are blob-derived and never enter host snapshots.
  {
    const mountPkg = (pkg: string) => {
      const files = opts.store.list?.(`${VENDOR_ROOT}/${pkg}/`) ?? [];
      if (files.length === 0) return 0;
      const root = `/usr/lib/node_modules/${pkg}`;
      let n = 0;
      for (const f of files) {
        const rel = f.slice(`${VENDOR_ROOT}/${pkg}/`.length);
        if (!/\.(js|cjs|mjs|json)$/.test(rel)) continue;
        const dest = `${root}/${rel}`;
        vfs.mkdir(dest.slice(0, dest.lastIndexOf('/')), true);
        vfs.writeFile(dest, opts.store.get(f));
        n++;
      }
      return n;
    };
    mountPkg('npm-oc');
    mountPkg('pnpm-oc');
    mountPkg('semver');
    mountPkg('oc-sh');
    mountPkg('oc-compat');

    // ---- internal executables (the execvp surface of the virtual OS) -----
    // Real files in the VFS so PATH resolution + shebang parsing behave
    // exactly like execve: bins found on PATH, interpreted by their
    // shebangs. `node` is special-cased by process_wrap (the interpreter
    // itself); everything else is a node program one require() deep.
    const binShim = (path: string, requirePath: string) => {
      vfs.mkdir(path.slice(0, path.lastIndexOf('/')), true);
      // Diagnostics (guest-side, both opt-in via env):
      //  - OC_TRACE_EXIT: print argv + a stack at every process.exit — for
      //    finding WHERE a silent CLI death happens;
      //  - shim require failure: always printed (a CLI entry that cannot
      //    even be required would otherwise vanish without a trace).
      const trace = "if(process.env.OC_TRACE_EXIT){process.stderr.write('OC-ARGV '+JSON.stringify(process.argv)+'\\n');const oe=process.exit;process.exit=function(c){process.stderr.write('OC-EXIT '+c+'\\n'+new Error().stack+'\\n');return oe.call(process,c);};}";
      vfs.writeFile(path,
        `#!/usr/bin/env node\n'use strict';\n${trace}\ntry { require(${JSON.stringify(requirePath)}); } catch (e) { process.stderr.write('OC-SHIM-ERROR ' + path + ': ' + (e && e.stack || e) + '\\n'); process.exit(42); }\n`);
    };
    // The npm/pnpm compat shim: runs the real CLI, then — after install-class
    // commands — the oc-compat WASM pass (esbuild/rollup → official WASM
    // twins; native binaries cannot execute in a browser kernel). npm exits
    // via process.exitCode + event-loop drain on success (never calling
    // process.exit), so the pass hooks BOTH the CLI's completion promise
    // (npm's lib/cli.js exports fn(process) → promise) and process.exit
    // (pnpm + npm error paths). Marked swap dirs + a notice are left behind;
    // OC_COMPAT_WASM=0 disables.
    const compatShim = (paths: string[]) => {
      for (const p of paths) {
        const isPnpm = p.includes('pnpm');
        const entry = isPnpm
          ? '/usr/lib/node_modules/pnpm/bin/pnpm.cjs'
          : '/usr/lib/node_modules/npm/lib/cli.js';
        vfs.mkdir(p.slice(0, p.lastIndexOf('/')), true);
        vfs.writeFile(p,
          `#!/usr/bin/env node\n'use strict';\n` +
          `const __ocRealExit = process.exit.bind(process);\n` +
          `let __ocCompatStarted = false;\n` +
          `let __ocCompatSettled = null; // resolves when the running pass is done\n` +
          `const __ocRunCompat = (done) => {\n` +
          `  if (__ocCompatStarted) {\n` +
          `    // A pass is (or was) in flight: npm's own exit path arrives here\n` +
          `    // AFTER our completion-promise chain already started the pass —\n` +
          `    // queue this exit behind it instead of killing the fetches.\n` +
          `    return (__ocCompatSettled ?? Promise.resolve()).then(() => done());\n` +
          `  }\n` +
          `  __ocCompatStarted = true;\n` +
          `  const cmd = process.argv[2];\n` +
          `  if (['install','i','add','ci','update','up'].indexOf(cmd) === -1) return done();\n` +
          `  if (process.env && String(process.env.OC_COMPAT_WASM) === '0') return done();\n` +
          `  __ocCompatSettled = new Promise((res) => { __ocCompatSettledResolve = res; });\n` +
          `  try {\n` +
          `    require('/usr/lib/node_modules/oc-compat/main.js').postInstall(process.cwd(), (err) => {\n` +
          `      if (err) process.stderr.write('[opencontainer] compat pass failed: ' + (err && err.message || err) + '\\n');\n` +
          `      __ocCompatSettledResolve();\n` +
          `      done();\n` +
          `    });\n` +
          `  } catch (e) {\n` +
          `    process.stderr.write('[opencontainer] compat pass failed: ' + (e && e.message || e) + '\\n');\n` +
          `    __ocCompatSettledResolve();\n` +
          `    done();\n` +
          `  }\n` +
          `};\n` +
          `let __ocCompatSettledResolve = () => {};\n` +
          `const __ocTrace = (tag) => { try { process.stderr.write('OC-TRACE ' + tag + ' argv=' + JSON.stringify(process.argv) + ' exitCode=' + JSON.stringify(process.exitCode) + ' at ' + new Error().stack.split('\\n').slice(2,6).join(' <- ') + '\\n'); } catch (_) {} };\n` +
          `process.exit = function (code) { if (process.env && process.env.OC_TRACE_EXIT === '1') __ocTrace('exit(' + code + ')'); __ocRunCompat(() => __ocRealExit(code)); };\n` +
          `let __ocResult;\n` +
          `try { __ocResult = require(${JSON.stringify(entry)})(process); }\n` +
          `catch (e) { process.stderr.write('OC-SHIM-ERROR ${p}: ' + (e && e.stack || e) + '\\n'); process.exit(42); }\n` +
          `if (__ocResult && typeof __ocResult.then === 'function') {\n` +
          `  // The CLI settled. Run the compat pass (install-class commands\n` +
          `  // only), then EXIT — always. The previous guard (only exit when\n` +
          `  // exitCode was truthy) left success-path exits to loop drain,\n` +
          `  // and any surviving handle (a stray timer, an unclosed socket)\n` +
          `  // hung the process forever: 'npm install' completed, printed its\n` +
          `  // summary, and never returned the prompt.\n` +
          `  __ocResult.catch((e) => { try { process.stderr.write('OC-CLI-REJECT ' + (e && e.stack || e) + '\\n'); } catch (_) {} }).then(() => __ocRunCompat(() => {\n` +
          `    if (process.env && process.env.OC_TRACE_EXIT === '1') __ocTrace('chain-exit');\n` +
          `    __ocRealExit(Number(process.exitCode) || 0);\n` +
          `  }));\n` +
          `}\n`);
      }
    };
    vfs.mkdir('/usr/local/bin', true);
    vfs.mkdir('/usr/bin', true);
    vfs.mkdir('/bin', true);
    // The node "binary": recognized by path in process_wrap (NODE_BIN).
    vfs.writeFile('/usr/local/bin/node', '#!/usr/bin/env node\n');
    // npm/npx and pnpm/pnpx shims additionally run the oc-compat WASM pass
    // after install-class commands: esbuild/rollup native twins cannot
    // execute in a browser kernel, so they are swapped for the official WASM
    // builds (marker + notice printed; OC_COMPAT_WASM=0 disables). The exit
    // hook defers the real process.exit until the (async, network-bound)
    // pass finishes, preserving npm's own exit code.
    binShim('/usr/local/bin/npm', '/usr/lib/node_modules/npm/bin/npm-cli.js');
    binShim('/usr/local/bin/npx', '/usr/lib/node_modules/npm/bin/npx-cli.js');
    binShim('/usr/bin/npm', '/usr/lib/node_modules/npm/bin/npm-cli.js');
    binShim('/usr/bin/npx', '/usr/lib/node_modules/npm/bin/npx-cli.js');
    binShim('/usr/local/bin/npm-oc', '/usr/lib/node_modules/npm-oc/cli.js');
    binShim('/usr/local/bin/pnpm', '/usr/lib/node_modules/pnpm/bin/pnpm.cjs');
    binShim('/usr/local/bin/pnpx', '/usr/lib/node_modules/pnpm/bin/pnpx.cjs');
    binShim('/usr/local/bin/pnpm-oc', '/usr/lib/node_modules/pnpm-oc/cli.js');
    compatShim(['/usr/local/bin/npm', '/usr/bin/npm', '/usr/local/bin/pnpm']);
    binShim('/usr/local/bin/corepack', '/usr/lib/node_modules/oc-sh/corepack.js');
    binShim('/usr/bin/sh', '/usr/lib/node_modules/oc-sh/sh.js');
    binShim('/bin/sh', '/usr/lib/node_modules/oc-sh/sh.js');
    __stage('builtin-mounts');
  }

  let currentCwd = cwd;
  const options = opts.options ?? new Map<string, any>();
  const stdio = opts.stdio ?? [
    { type: 'tty' }, { type: 'tty' }, { type: 'tty' },
  ];
  const env: Record<string, string> = {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: '/home/node',
    LANG: 'en_US.UTF-8',
    TERM: 'xterm-256color',
    npm_config_registry: 'https://registry.npmjs.org/',
    // npm's audit posts JSON to /-/npm/v1/security/advisories/bulk — a
    // cross-origin POST that preflights (JSON content-type is never
    // CORS-simple), and registry.npmjs.org does not answer OPTIONS. Audit
    // is optional telemetry, not install correctness — OFF by default in
    // the browser container (overridable per-process: spawn with env
    // { npm_config_audit: 'true' } behind a bridge of your own).
    npm_config_audit: 'false',
    // Lifecycle scripts stay OFF by default until the explicit permission
    // model exists (P1 security rule): npm skips them with its own notice —
    // safe + transparent, no silent host execution.
    npm_config_ignore_scripts: 'true',
    // napi-rs packages (rolldown, oxc, …) select their wasm32-wasi build when
    // this is set — the correct choice for a browser container, where native
    // dlopen cannot exist. Documented in COMPATIBILITY.md (§ divergences).
    NAPI_RS_FORCE_WASI: 'true',
    ...opts.env,
  };

  const nativesCtx = {
    vfs,
    hooks: opts.hooks,
    cwd: () => currentCwd,
    chdir: (p: string) => { currentCwd = p; },
    options,
    stdio,
  };
  // Relative guest paths (fs.writeFileSync('a.txt'), …) resolve against the
  // LIVE cwd — process.chdir is honored for the rest of the process's life.
  vfs.cwdProvider = () => currentCwd;
  const natives = new Natives(nativesCtx);
  // ------------------------------------------------------------------ process
  const process: any = Object.create(EventEmitterLikeProto);
  Object.assign(process, {
    version: NODE_VERSION,
    versions: {
      node: NODE_VERSION.slice(1),
      v8: '0.0.0',               // the BROWSER's engine — documented in COMPATIBILITY.md
      uv: '1.51.0+opencontainer', // virtual event loop, browser-backed
      zlib: 'fflate',
      brotli: '0.0.0',
      ares: '1.0.0',
      modules: '137',
      http_parser: 'llhttp/9.0.0',
      openssl: '0.0.0',           // no OpenSSL: node:crypto is WebCrypto-backed
      icu: 'browser',
      unicode: 'browser',
      napi: '10',
      llhttp: '9.1.0',
      amaro: '1.1.11',            // vendored deps/amaro (strip-types)
      webcontainers: undefined as any,
      opencontainer: '0.1.0',
    },
    platform: 'browser',
    arch: 'wasm32',
    machine: 'wasm',
    pid: opts.pid ?? 1,
    ppid: opts.ppid ?? 0,
    title: 'node',
    execPath: '/usr/local/bin/node',
    execArgv: [] as string[],
    argv: opts.argv ?? ['node'],
    env,
    argv0: 'node',
    cwd: () => nativesCtx.cwd(),
    exitCode: undefined,
    sourceMapsEnabled: false,
    debugPort: 0,
    debugUsage: false,
    throwDeprecation: false,
    traceDeprecation: false,
    symbols: {},
    report: { getReport: () => '', reportOnUncaughtException: false, reportOnSignal: false, reportOnFatalError: false, signal: 'SIGUSR2', filename: '' },
    _exiting: false,
    stdout: undefined,
    stderr: undefined,
    stdin: undefined,
    domain: null,
    config: {
      target_defaults: {},
      variables: { v8_enable_i18n_support: 0, node_use_openssl: 'false', node_shared: 'false', node_use_dtrace: 'false', node_no_literals: 'false' },
      nodedir: '', nodes: 'browser', node_prefix: '/usr',
    },
    release: {
      name: 'node',
      sourceUrl: `https://nodejs.org/download/release/${NODE_VERSION}/node-${NODE_VERSION}.tar.xz`,
      headersUrl: '',
    },
    features: {
      inspector: false, debug: false, uv: true, ipv6: true, tls_alpn: false,
      tls_sni: false, tls_ocsp: false, tls: false, openssl_is_boringssl: false,
      cached_builtins: false, green_ee: false, openbsd: false,
    },
  });

  // nextTick lives on process before anything loads — node injects it from
  // task_queues during bootstrap; we provide the real one early via the module.
  const internalBinding = (name: string) => natives.get(name);

  // Node exposes these as context globals to builtins (see realm.js header:
  // /* global process, getLinkedBinding, getInternalBinding, primordials */).
  // internalBinding() itself is DEFINED by internal/bootstrap/realm.js on top
  // of getInternalBinding — exactly like node.
  const g = globalThis as any;
  g.getInternalBinding = internalBinding;
  // Stdio modes for util.guessHandleType (fd → tty/pipe/ignore) — the
  // bootstrap's createWritableStdioStream branches on it (piped children get
  // net.Socket({fd}) over pipe_wrap, ignored ones get a black-hole stream).
  g.__ocStdio = stdio;
  g.getLinkedBinding = (name: string) => {
    throw new Error(`OpenContainer: getLinkedBinding('${name}') — linked bindings do not exist in the browser`);
  };
  // The registry wires builtins.compileFunction to our source store in its
  // constructor (must be live before the registry/realm loads).
  g.__ocWireBuiltinCompile = wireBuiltinCompile;
  g.__ocEnv = () => env;

  const registry = new ModuleRegistry(opts.store, {
    process,
    internalBinding, // replaced by realm's after realm loads
    primordials: {}, // filled below before any module load
    global: globalThis,
  });
  __stage('registry');

  // ------------------------------------------------------------- primordials
  const primordials = loadPrimordials(opts.store);
  (registry as any).rt.primordials = primordials;
  g.primordials = primordials;

  const require = registry.require;

  // ---------------------------------------------------------------- realm
  // internal/bootstrap/realm runs FIRST (node does the same): it defines
  // internalBinding(), the BuiltinModule loader, and prepares stack traces.
  // Every later builtin require routes through its BuiltinModule.map —
  // node's own loader with our store-backed compileFunction.
  require('internal/bootstrap/realm');
  __stage('realm');

  // ---------------------------------------------------- task queues + nextTick
  // node's bootstrap loads internal/process/task_queues which installs
  // process.nextTick driven by our task_queue binding callback.
  const taskQueues = require('internal/process/task_queues');
  __stage('task_queues');
  // Real bootstrap step (internal/bootstrap/node.js:363-364):
  //   const { nextTick, runNextTicks } = setupTaskQueue();
  //   process.nextTick = nextTick;
  let runNextTicks: (() => void) | null = null;
  if (typeof taskQueues.setupTaskQueue === 'function') {
    const tickFns = taskQueues.setupTaskQueue();
    process.nextTick = tickFns.nextTick;
    runNextTicks = tickFns.runNextTicks;
  }
  // wire drain: whenever the browser runs microtasks, drain ticks too.
  const drainTicks = () => {
    try { runNextTicks?.(); } catch (err: any) {
      // A throwing nextTick callback is an UNCAUGHT exception in node
      // (emitErrorNT with no 'error' listener — e.g. listen EADDRINUSE on a
      // server without an error handler). node's C++ loop runner routes it
      // to the fatal handler; swallowing it here made the process exit 0
      // SILENTLY. Route through node's own machinery: capture callbacks /
      // uncaughtException listeners get a chance, else report + exit(1).
      let handled = false;
      try {
        handled = typeof process._fatalException === 'function'
          ? process._fatalException(err, false)
          : false;
      } catch { /* the fatal handler itself died — fall through */ }
      if (!handled) {
        try { completeFatalExit(err); } catch { /* host will recycle */ }
      }
    }
  };
  // Host-side entry points (worker RPC handlers, harness feeds) call this
  // after every kernel re-entry — node drains ticks between loop phases.
  (globalThis as any).__ocDrainTicks = drainTicks;

  // ---------------------------------------------------------------- process setup
  // Mirrors internal/bootstrap/node.js setupProcessObject + is_main_thread.js
  const perThreadSetup = require('internal/process/per_thread');
  __stage('process_per_thread');
  const rawMethods = internalBinding('process_methods');
  const wrapped = perThreadSetup.wrapProcessMethods(rawMethods);
  process.loadEnvFile = wrapped.loadEnvFile;
  process._rawDebug = wrapped._rawDebug;
  process.cpuUsage = wrapped.cpuUsage;
  process.threadCpuUsage = wrapped.threadCpuUsage;
  process.resourceUsage = wrapped.resourceUsage;
  process.memoryUsage = wrapped.memoryUsage;
  process.constrainedMemory = rawMethods.constrainedMemory;
  process.availableMemory = rawMethods.availableMemory;
  process.kill = wrapped.kill;
  process.exit = wrapped.exit;
  process.execve = wrapped.execve;
  // node's C++ process object exposes chdir/umask directly (the JS bootstrap
  // never wraps them); the binding validates ENOENT + updates the cwd.
  process.chdir = rawMethods.chdir;
  process.umask = rawMethods.umask;
  process.initCwd = cwd;
  process.ref = perThreadSetup.ref;
  process.unref = perThreadSetup.unref;
  process.hrtime = perThreadSetup.hrtime;
  process.hrtime.bigint = perThreadSetup.hrtimeBigInt;
  process.openStdin = function () { process.stdin.resume(); return process.stdin; };
  process._getActiveRequests = rawMethods._getActiveRequests ?? (() => []);
  process._getActiveHandles = rawMethods._getActiveHandles ?? (() => []);
  process.getActiveResourcesInfo = rawMethods.getActiveResourcesInfo ?? (() => []);
  process.reallyExit = rawMethods.reallyExit;
  process._kill = wrapped.kill;
  process._debugProcess = rawMethods._debugProcess ?? (() => {});
  process._debugEnd = rawMethods._debugEnd ?? (() => {});

  // EventEmitter-ify process via the real events module (node uses internal/
  // bootstrap/node.js + process is created with EventEmitter earlier; here we
  // attach the real prototype).
  const EventEmitter = require('events');
  setProto(process, EventEmitter.prototype);
  EventEmitter.call(process);

  // The tty line discipline raises SIGINT (cooked-mode Ctrl+C) on the process
  // — it needs the EventEmitter surface, which just went live.
  (natives.get('tty_wrap') as any).attachProcess?.(process);

  // ------------------------------------------------------------------ stdio
  // Running the REAL is_main_thread bootstrap gives us tty.WriteStream stdio
  // built on our tty_wrap binding, plus preload of fs/cjs loader/run_main.
  require('internal/bootstrap/switches/is_main_thread');
  __stage('is_main_thread');

  // ------------------------------------------------------------------ console
  // node's C++ bootstrap calls initializeGlobalConsole(globalConsole) after
  // loading internal/console/global.js — we do the same.
  const consoleModule = require('console');
  const consoleConstructorMod = require('internal/console/constructor');
  consoleConstructorMod.initializeGlobalConsole(consoleModule);
  __stage('console');
  (globalThis as any).__ocBootDebug?.('after-console');

  // The kernel owns globalThis: compiled user code resolves `process`,
  // `console`, `Buffer` through the globals exactly like a node context.
  // (In the browser worker these globals don't exist until we define them.)
  const g2 = globalThis as any;
  g2.process = process;
  g2.console = consoleModule;

  // ------------------------------------------------------- web streams
  // Node parity: real node exposes its OWN webstreams implementations as
  // the global classes (internal/bootstrap/web/exposed-wildcard.js →
  // internal/webstreams/*). Keeping the BROWSER's natives instead made
  // every node-stream ↔ web-stream crossing throw
  //   ERR_INVALID_ARG_TYPE "transform.readable ... must be an instance of
  //   ReadableStream. Received an instance of ReadableStream"
  // (node's symbol brand check vs the browser class) — create-expo-app's
  // tar extraction died exactly there: a node-adapters ReadableStream
  // .pipeThrough(new DecompressionStream(...)) with the browser's
  // DecompressionStream. With node's own classes as globals, both sides
  // share the brand. TextEncoder/TextDecoder stay native (identical API,
  // faster); only the STREAM classes swap.
  try {
    const readableStreamMod = require('internal/webstreams/readablestream');
    const writableStreamMod = require('internal/webstreams/writablestream');
    const transformStreamMod = require('internal/webstreams/transformstream');
    const queuingStrategiesMod = require('internal/webstreams/queuingstrategies');
    const webEncodingMod = require('internal/webstreams/encoding');
    const compressionMod = require('internal/webstreams/compression');
    g2.ReadableStream = readableStreamMod.ReadableStream;
    g2.ReadableStreamDefaultReader = readableStreamMod.ReadableStreamDefaultReader;
    g2.ReadableStreamBYOBReader = readableStreamMod.ReadableStreamBYOBReader;
    g2.ReadableStreamBYOBRequest = readableStreamMod.ReadableStreamBYOBRequest;
    g2.ReadableByteStreamController = readableStreamMod.ReadableByteStreamController;
    g2.ReadableStreamDefaultController = readableStreamMod.ReadableStreamDefaultController;
    g2.WritableStream = writableStreamMod.WritableStream;
    g2.WritableStreamDefaultWriter = writableStreamMod.WritableStreamDefaultWriter;
    g2.WritableStreamDefaultController = writableStreamMod.WritableStreamDefaultController;
    g2.TransformStream = transformStreamMod.TransformStream;
    g2.TransformStreamDefaultController = transformStreamMod.TransformStreamDefaultController;
    g2.ByteLengthQueuingStrategy = queuingStrategiesMod.ByteLengthQueuingStrategy;
    g2.CountQueuingStrategy = queuingStrategiesMod.CountQueuingStrategy;
    g2.TextEncoderStream = webEncodingMod.TextEncoderStream;
    g2.TextDecoderStream = webEncodingMod.TextDecoderStream;
    g2.CompressionStream = compressionMod.CompressionStream;
    g2.DecompressionStream = compressionMod.DecompressionStream;
    __stage('webstreams_globals');
  } catch (e: any) {
    (globalThis as any).__ocDebugHook?.(`[webstreams globals failed] ${String(e)}`);
  }

  // ------------------------------------------------------------------ globals
  // Real bootstrap step (C++ does this in node): initialize debuglog env.
  (globalThis as any).__ocBootDebug?.('before-debuglog');
  const debuglogMod = require('internal/util/debuglog');
  if (typeof debuglogMod.initializeDebugEnv === 'function') {
    debuglogMod.initializeDebugEnv(env.NODE_DEBUG ?? '');
  }

  // Real pre_execution step: initializeCJS() sets Module.builtinModules,
  // resolution conditions, search paths and runMain (node calls this during
  // prepareMainThreadExecution).
  (globalThis as any).__ocBootDebug?.('before-cjs-loader');
  const cjsLoaderMod = require('internal/modules/cjs/loader');
  cjsLoaderMod.initializeCJS();
  __stage('cjs_loader');

  // ---------------------------------------------------------- require(esm)
  // node v26 ships require(esm) unflagged: getOptionValue('--require-module')
  // defaults true in the binary. Our options map is kernel-owned, so we set
  // the node-v26 default explicitly.
  if (!options.has('--require-module')) options.set('--require-module', true);

  // The engine face of require(esm) — the C++ ModuleWrap's synchronous
  // instantiate+evaluate — cannot exist in a browser engine (import() is
  // async, full stop). We compile format-'module' require() targets through
  // the REAL CJS pipeline after an acorn ESM→CJS transform (node's own
  // vendored acorn; byte-exact surgery on import/export statements only).
  // Divergences (snapshot semantics, cycle handling, ERR_REQUIRE_ASYNC_
  // MODULE) are documented in COMPATIBILITY.md and tested in
  // scripts/test-require-esm.ts.
  {
    const acornMod: any = require('internal/deps/acorn/acorn/dist/acorn');
    const ModuleCtor = cjsLoaderMod.Module;
    const origCompile = ModuleCtor.prototype._compile;
    ModuleCtor.prototype._compile = function (
      this: any, content: string, filename: string, format: string | undefined,
    ) {
      if (format === 'module' || format === 'module-typescript') {
        if (format === 'module-typescript') {
          // strip TS types first via the vendored amaro stripper, then fall
          // through to the ESM→CJS transform (amaro is loaded lazily by the
          // loader only when --strip-types; here we require it ourselves).
          const { lazyTypeScript } = require('internal/modules/ts_limiter');
          content = lazyTypeScript().stripTypeScriptTypes(content, filename, fileUrlOf(filename));
          format = 'module';
        }
        const { code } = transformEsmToCjs(content, filename, acornMod, fileUrlOf(filename));
        return origCompile.call(this, code, filename, 'commonjs');
      }
      return origCompile.apply(this, arguments as any);
    };
    __stage('require_esm');
  }

  // ------------------------------------------------------------- outbound http
  // P1 "npm is npm": real npm networks through make-fetch-happen →
  // @npmcli/agent → node's http/https CLIENT. Outbound internet from a
  // browser worker can only be `fetch()` (no sockets) — so the client
  // surface is fetch-backed (kernel/http-fetch-client.ts) while GUEST
  // LOOPBACK (guest↔guest, guest↔preview) keeps node's real stack through
  // tcp_wrap. No same-origin bridge by default: cross-origin requests are
  // reduced to CORS-simple requests inside the client (safelisted headers
  // only — the registry answers ACAO:* on simple requests), and an
  // embedder-supplied `outboundRewrite` hook stays available for private
  // registry setups.
  {
    const httpMod = require('http');
    const httpsMod = require('https');
    installFetchHttpClient({
      http: httpMod,
      https: httpsMod,
      rewrite: (opts.hooks as any).outboundRewrite,
    });
    __stage('http_client');
  }

  // ------------------------------------------------------------------ ESM
  // S3.1 Phase 6: the ESM graph importer. Node's own loader JS boots fine in
  // the realm (initializeESM, translators, resolver) but its engine face —
  // the C++ ModuleWrap binding — cannot exist in a browser. Instead we drive
  // REAL V8 modules: resolve + acorn-parse + minimally rewrite the graph,
  // publish the rewritten texts through the host transport, and let
  // dynamic import() link/evaluate it. See kernel/esm-graph.ts.
  if (opts.hooks.esmServing) {
    const acorn: any = require('internal/deps/acorn/acorn/dist/acorn');
    const builtinModules: string[] = cjsLoaderMod.Module?.builtinModules ?? [];
    const requireCjsFile = (p: string): any => cjsLoaderMod.Module._load(p, null, true);
    // Kernel file-require hook for the in-process worker_threads compat
    // layer (natives/worker.ts): worker scripts load through node's own CJS
    // loader — same VFS, same require cache, same semantics.
    (globalThis as any).__ocRequireFile = requireCjsFile;
    const importer = makeEsmGraphImporter({
      vfs: nativesCtx.vfs,
      requireBuiltin: require,
      requireCjs: requireCjsFile,
      builtinModules,
      acorn,
      serving: opts.hooks.esmServing,
    });
    (globalThis as any).__ocEsmGraphImport = (entryUrl: string, entryPath: string) =>
      importer.importEntry(entryPath.startsWith('/') ? entryPath : entryUrl);
    // EVERY guest dynamic import() is rewritten to this hook (see
    // kernel/esm-graph.ts rewriteModule): it resolves + publishes lazily at
    // evaluation time (node's semantics), arms a REFED keep-alive while the
    // import is in flight (a pending import() holds the event loop in node;
    // browser-fetch module loads register no kernel handle), and throws
    // ERR_MODULE_NOT_FOUND for unresolvable optional peers — a rejected
    // import() promise the guest's own catch handles, exactly like node.
    (globalThis as any).__ocDynImport = (parentDir: string, spec: string) =>
      importer.dynamicImport(parentDir, spec);
    // Worker-graph dynamic import (natives/worker.ts): worker_threads in the
    // importing worker's graph binds THAT worker's view via a per-worker
    // shim URL (esm-graph dynamicImportWorker). Registered BEFORE any worker
    // can boot, alongside the main hook.
    (globalThis as any).__ocDynImportW = (threadId: number, parentDir: string, spec: string) =>
      importer.dynamicImportWorker(threadId, parentDir, spec);
    (globalThis as any).__ocEsmBuiltin = (id: string) => require(id);
    // Builtin resolution for a WORKER's module graph: worker_threads comes
    // from the per-worker view registry (natives/worker.ts publishes each
    // worker's view there); every other builtin is the shared realm module.
    (globalThis as any).__ocEsmWorkerBuiltin = (threadId: number, id: string) => {
      const views: Map<number, any> | undefined = (globalThis as any).__ocWorkerViews;
      const view = views?.get(threadId);
      if (view !== undefined && (id === 'worker_threads' || id === 'node:worker_threads')) {
        return view;
      }
      return require(id);
    };
    (globalThis as any).__ocEsmCjs = (p: string) => requireCjsFile(p);
    (globalThis as any).__ocEsmJson = (p: string) => {
      const bytes = nativesCtx.vfs.readFile(p);
      return JSON.parse(new TextDecoder().decode(bytes));
    };
    (globalThis as any).__ocMetaFor = (p: string) => {
      const url = fileUrlOf(p);
      const meta: any = { url, dirname: null, filename: null };
      try { meta.filename = p; meta.dirname = esmDirname(p); } catch { /* keep null */ }
      return Object.freeze(meta);
    };
  }
  __stage('esm_graph');
  const helpers = require('internal/modules/helpers');
  if (typeof helpers.addBuiltinLibsToObject === 'function') {
    helpers.addBuiltinLibsToObject(globalThis, '<eval>');
  }
  (globalThis as any).__ocBootDebug?.('before-timers');
  const timersModule = require('timers');
  const internalTimers = require('internal/timers');
  // node's C++ loop drives the JS timer queues; our browser loop does the
  // same through binding('timers') drivers (installed on globalThis for the
  // binding to call back into):
  if (typeof internalTimers?.getTimerCallbacks === 'function') {
    const timerCallbacks = internalTimers.getTimerCallbacks(() => runNextTicks?.());
    const timersB: any = internalBinding('timers');
    // node's C++ loop calls processTimers(uv_now()) and arms the next loop
    // timeout FROM THE RETURN VALUE: >0 = next refed expiry, <0 = next
    // unrefed-only expiry (negated), 0 = nothing pending (RunTimers loops
    // once more only on 0). Mirroring that contract exactly is what makes
    // setInterval re-arm: the re-inserted timer joins an EXISTING list, so
    // insert() never calls scheduleTimer — the return value is the ONLY
    // re-arm signal. (Passing no `now` made every comparison NaN → intervals
    // re-fired in a tight synchronous loop → worker event-loop death.)
    g.__ocProcessTimers = () => {
      runNextTicks?.();
      const now = timersB.getLibuvNow();
      const next = timerCallbacks.processTimers(now);
      if (next !== 0) {
        // Re-arm the single loop wakeup from the returned expiry (fractional
        // precision — the binding ceils the host delay so it never fires
        // sub-ms early). next<0 = only unrefed timers remain (abs() them:
        // they still deserve to fire, they just don't hold the loop).
        timersB.scheduleTimer(Math.max(0, Math.abs(next) - now));
      }
    };
    g.__ocProcessImmediate = () => { runNextTicks?.(); timerCallbacks.processImmediate(); };
  }
  (globalThis as any).setImmediate = timersModule.setImmediate;
  (globalThis as any).clearImmediate = timersModule.clearImmediate;
  (globalThis as any).setInterval = timersModule.setInterval;
  (globalThis as any).clearInterval = timersModule.clearInterval;
  // node's own setTimeout/clearTimeout: the return value is a real Timeout
  // (unref/ref/refresh/hasRef — npm's spinner calls .unref()), and refed
  // timers join the loop census (node semantics: they keep the loop alive).
  (globalThis as any).setTimeout = timersModule.setTimeout;
  (globalThis as any).clearTimeout = timersModule.clearTimeout;

  (globalThis as any).__ocBootDebug?.('before-buffer');
  const Buffer = require('buffer').Buffer;
  globalThis.Buffer = Buffer;
  globalThis.global = globalThis;

  // ---------------------------------------------------- process surface (cont.)
  // Mirrors bootstrap/node.js:311-357: fatal-exception routing + warning +
  // capture callbacks + getBuiltinModule. The REPL's setupExceptionCapture
  // (repl.js:194) requires the capture callbacks; every mode needs _fatalException.
  (globalThis as any).__ocBootDebug?.('before-execution');
  const execution = require('internal/process/execution');
  process._fatalException = execution.onGlobalUncaughtException;
  process.setUncaughtExceptionCaptureCallback = execution.setUncaughtExceptionCaptureCallback;
  process.addUncaughtExceptionCaptureCallback = execution.addUncaughtExceptionCaptureCallback;
  process.hasUncaughtExceptionCaptureCallback = execution.hasUncaughtExceptionCaptureCallback;

  const warningMod = require('internal/process/warning');
  process.emitWarning = warningMod.emitWarning;

  // helpers.getBuiltinModule (node ≥ 22): process.getBuiltinModule('fs').
  process.getBuiltinModule = helpers.getBuiltinModule;

  // bootstrap/node.js:428-461 — identity tags.
  try {
    Object.defineProperty(process, Symbol.toStringTag, {
      __proto__: null, configurable: true, value: 'process',
    });
    Object.defineProperty(globalThis, Symbol.toStringTag, {
      __proto__: null, configurable: true, value: 'global',
    });
  } catch { /* exotic global — skip */ }

  // Unhandled-rejection routing: node's C++ HostPromiseRejectionCallback is
  // the task_queue binding's promise-reject callback. The browser worker's
  // 'unhandledrejection' event feeds the same handler (worker-entry wires it).
  try {
    const promisesMod = require('internal/process/promises');
    promisesMod.listenForRejections();
    (globalThis as any).__ocGetPromiseRejectCallback =
      () => natives.get('task_queue').getPromiseRejectCallback?.();
  } catch (e: any) {
    (globalThis as any).__ocDebugHook?.(`[promises setup failed] ${String(e)}`);
  }

  (globalThis as any).__ocBootDebug?.('before-cjs-exec');
  // ------------------------------------------------------------ CJS execution
  const cjsExecution = execution;

  /** node's C++ termination semantics for an UNHANDLED fatal exception:
   *  report to stderr, then terminate. In node this is done by the C++
   *  bootstrap (TerminateExecution + exit); in the kernel the JS fatal path
   * (internal/process/execution.js onGlobalUncaughtException) already set
   *  `_exiting`, `exitCode` and emitted 'exit' — we finish the chain via
   *  reallyExit so the HOST sees the 'exit' RPC and recycles the worker.
   *  Without this the process lingered half-dead: `_exiting=true` silently
   *  refused every later `process.nextTick` (node's own guard) forever. */
  function completeFatalExit(err: any): boolean {
    if (!process._exiting) return false;
    try {
      // node's default reporter: stack + version banner on stderr — with the
      // error code bracketed into the header line exactly as node prints
      // uncaught system errors ("Error [ERR_MODULE_NOT_FOUND]: ...").
      const stack = err?.stack ?? String(err);
      const code = typeof err?.code === 'string' ? err.code : null;
      let header = stack;
      const name = err?.name ?? 'Error';
      if (code && !stack.includes(`[${code}]`) && stack.startsWith(`${name}: `)) {
        header = `${name} [${code}]: ${stack.slice(name.length + 2)}`;
      }
      opts.hooks.onStdio(2, `${header}\nNode.js ${NODE_VERSION}\n`);
      process.reallyExit?.(process.exitCode ?? 1);
    } catch { /* nothing more can be done — host will recycle */ }
    return true; // the process is dead; callers swallow like node's C++
  }

  async function runEval(code: string, print?: boolean): Promise<void> {
    options.set('--eval', code);
    if (print) options.set('--print', true);
    // Real node -e flow (internal/main/eval_string.js, CJS branch):
    // addBuiltinLibsToObject was applied at boot; evalScript does the rest.
    try {
      cjsExecution.evalScript('[eval]', code, false, print === true, false);
    } catch (err: any) {
      // Mirror node: uncaught sync exceptions route through _fatalException
      // so the REPL/uncaught capture callbacks + exit code behave identically.
      const handled = typeof process._fatalException === 'function'
        ? process._fatalException(err, false)
        : false;
      if (!handled) {
        if (completeFatalExit(err)) return; // node never returns from a fatal
        throw err;
      }
    }
    await waitForExitSettled();
  }

  async function runMain(path: string): Promise<void> {
    // Real node flow: patchProcessObject(expandArgv1) resolves argv[1] to an
    // ABSOLUTE path (CWD-relative) before the loader sees it; bare specifiers
    // like 'main.js' would otherwise miss (modulePaths has no CWD entry).
    const mainPath = path.startsWith('/')
      ? path
      : vfs.normalize(`${nativesCtx.cwd()}/${path}`);
    process.argv[1] = mainPath;
    const { executeUserEntryPoint } = require('internal/modules/run_main');
    /** node's RunMain routing for main-module exceptions (sync + async). */
    const fatalRoute = (err: any): boolean => {
      const handled = typeof process._fatalException === 'function'
        ? process._fatalException(err, false)
        : false;
      if (!handled) {
        if (completeFatalExit(err)) return true;
      }
      return handled;
    };
    try {
      const r = executeUserEntryPoint(mainPath);
      // The ESM entry path (patched run_main) returns a promise that settles
      // when the module graph evaluation settles (TLA included).
      if (r !== null && r !== undefined && typeof r.then === 'function') {
        await r;
      }
    } catch (err: any) {
      if (!fatalRoute(err)) throw err;
    }
    await waitForExitSettled();
  }

  /** Let pending microtasks/timers flush after the entry returns — but bail
   *  out as soon as the kernel loop is already idle (the common case for
   *  `node -e`/`node -p`: nothing async pending, no reason to wait). */
  function waitForExitSettled(): Promise<void> {
    return new Promise<void>((resolve) => {
      let counter = 0;
      let idleSamples = 0;
      const check = () => {
        counter++;
        drainTicks();
        if (kernelLoopEmpty()) {
          if (++idleSamples >= 2) return resolve(); // ~20ms of quiet = settled
        } else {
          idleSamples = 0;
        }
        if (counter > 50) return resolve(); // don't wait forever
        hostSetTimeout(check, 10);
      };
      hostSetTimeout(check, 10);
    });
  }

  // ------------------------------------------------------------ loop drain
  // node's "event loop empty ⇒ process exits": when no kernel timers,
  // immediates, or readStarted stdin remain, the process exits with its
  // current exit code (default 0). This is how real node finishes REPL
  // sessions (.exit) and scripts whose only handles were timers.
  let drainWatcher: ReturnType<typeof setInterval> | null = null;

  function kernelLoopEmpty(): boolean {
    const timersB: any = natives.get('timers');
    const ttyB: any = natives.get('tty_wrap');
    const pipeB: any = natives.get('pipe_wrap');
    const tcpB: any = natives.get('tcp_wrap');
    const procB: any = natives.get('process_wrap');
    const fsB: any = natives.get('fs');
    const pendingTimers = timersB.getActiveTimerCount?.() ?? 0;
    const pendingImmediates = timersB.getActiveImmediateCount?.() ?? 0;
    const stdinReading = ttyB.stdinReading?.() ?? false;
    const openPipes = pipeB.activePipeCount?.() ?? 0;
    const openTcp = tcpB.activeTcpCount?.() ?? 0;
    const liveChildren = procB.activeChildCount?.() ?? 0;
    // P1: in-flight fetches are live handles (a pending op holds the loop in
    // node; a browser fetch must too — see kernel/net-pending.ts).
    const pendingNet = netPendingCount();
    // P1 (zlib): in-flight compression writes are live uv reqs too.
    const pendingZlib = zlibPendingCount();
    // P2 (fs): an in-flight async fs op is a threadpool uv req in node —
    // npm's reify phase is a storm of them; uncounted, the drain watcher
    // killed it mid-reify ("Exit handler never called!").
    const pendingFs = activeFsCount();
    return pendingTimers === 0 && pendingImmediates === 0 && !stdinReading
      && openPipes === 0 && openTcp === 0 && liveChildren === 0
      && pendingNet === 0 && pendingZlib === 0 && pendingFs === 0;
  }

  /** True while this process owns live OS-like resources (open pipes,
   *  sockets, listening servers, live children) — the host asks before
   *  treating a quiet process as finished. */
  function hasLiveHandles(): boolean {
    const pipeB: any = natives.get('pipe_wrap');
    const tcpB: any = natives.get('tcp_wrap');
    const procB: any = natives.get('process_wrap');
    const ttyB: any = natives.get('tty_wrap');
    return ((pipeB.activePipeCount?.() ?? 0) > 0)
      || ((tcpB.activeTcpCount?.() ?? 0) > 0)
      || ((procB.activeChildCount?.() ?? 0) > 0)
      || (ttyB.stdinReading?.() ?? false)
      || netPendingCount() > 0
      || zlibPendingCount() > 0
      || activeFsCount() > 0;
  }

  /** Deliver a signal to this process, node's JS-visible semantics: a
   *  listener consumes it; otherwise the default disposition terminates.
   *  Returns true when a JS listener handled it. */
  function raiseSignal(sig: string): boolean {
    try {
      if (typeof process.listenerCount === 'function' &&
          process.listenerCount(sig) > 0) {
        process.emit(sig, sig);
        return true;
      }
      // Default dispositions: SIGINT→130, SIGTERM→143, SIGHUP→129.
      const code = sig === 'SIGINT' ? 130 : sig === 'SIGHUP' ? 129 : 143;
      process.exitCode = code;
      process.reallyExit?.(code);
      return false;
    } catch (e: any) {
      (globalThis as any).__ocDebugHook?.(`[signal ${sig} error] ${String(e)}`);
      return false;
    }
  }

  function startLoopDrainWatcher(): void {
    if (drainWatcher !== null) return;
    let emptyTicks = 0;
    let busyTicks = 0;
    drainWatcher = hostSetInterval(() => {
      drainTicks();
      // Idempotence: a second armed wakeup can fire in the same host batch
      // after process.exit already ran (the re-arm was scheduled before the
      // interval was cleared) — must not exit twice.
      if (process._exiting) { stopLoopDrainWatcher(); return; }
      if (kernelLoopEmpty()) {
        emptyTicks++;
        // Fifteen consecutive empty samples (≈1.5s). The census counts every
        // known handle class (timers, immediates, pipes, tcp, children, net
        // — fetches AND streamed bodies — zlib, stdin, in-flight fs), but its
        // history has blind spots: each one turned "loop looks empty for
        // 200ms" into a kill of a LIVE process (npm died mid-reify with
        // "Exit handler never called!"). Live guest work pauses for <1s
        // between phases; a finished script has nothing left and waits out
        // the same 1.5s before its exit — prompt for users, survivable for
        // stragglers. OC_NO_DRAIN_EXIT=1 disables watcher exits entirely
        // (diagnostics: prove a CLI completes without it).
        if (emptyTicks >= 15 && !(process.env && String(process.env.OC_NO_DRAIN_EXIT) === '1')) {
          stopLoopDrainWatcher();
          try {
            if (process.env && String(process.env.OC_TRACE_DRAIN) === '1') {
              opts.hooks.onStdio(2, `[oc-drain] watcher exiting process code=${process.exitCode ?? 0}\n`);
            }
            process.exit(process.exitCode ?? 0);
          } catch (e: any) {
            (globalThis as any).__ocDebugHook?.(
              '[loop-drain exit error] ' + String(e));
          }
        }
      } else {
        emptyTicks = 0;
        // OC_TRACE_DRAIN=1: a process whose script finished but whose loop
        // never drains is the classic "silent hang" — npm did this for
        // months before anyone noticed. Every ~5s of a continuously busy
        // loop, name the handle that keeps it alive.
        if (busyTicks++ % 50 === 49) {
          if (process.env && String(process.env.OC_TRACE_DRAIN) === '1') {
            try {
              const tB: any = natives.get('timers');
              const yB: any = natives.get('tty_wrap');
              const pB: any = natives.get('pipe_wrap');
              const cB: any = natives.get('tcp_wrap');
              const xB: any = natives.get('process_wrap');
              opts.hooks.onStdio(2, `[oc-drain] loop busy for ${Math.round(busyTicks / 10)}s: timers=${tB.getActiveTimerCount?.() ?? 0} immediates=${tB.getActiveImmediateCount?.() ?? 0} stdinReading=${yB.stdinReading?.() ?? false} pipes=${pB.activePipeCount?.() ?? 0} tcp=${cB.activeTcpCount?.() ?? 0} children=${xB.activeChildCount?.() ?? 0} net=${netPendingCount()} zlib=${zlibPendingCount()} fs=${activeFsCount()}\n`);
            } catch { /* diagnostics must never break the watcher */ }
          }
        }
      }
    }, 100);
  }

  function stopLoopDrainWatcher(): void {
    if (drainWatcher !== null) {
      hostClearInterval(drainWatcher);
      drainWatcher = null;
    }
  }

  return {
    process,
    registry,
    natives,
    vfs,
    runEval,
    runMain,
    require,
    startLoopDrainWatcher,
    stopLoopDrainWatcher,
    raiseSignal,
    hasLiveHandles,
  };
}

/** minimal EventEmitter stand-in for the initial proto (replaced by real events) */
const EventEmitterLikeProto: any = {
  on() { return this; },
  off() { return this; },
  once() { return this; },
  emit() { return false; },
  addListener() { return this; },
  removeListener() { return this; },
  removeAllListeners() { return this; },
  listeners() { return []; },
  setMaxListeners() { return this; },
};

function setProto(obj: any, proto: any) {
  Object.setPrototypeOf(obj, proto);
}
