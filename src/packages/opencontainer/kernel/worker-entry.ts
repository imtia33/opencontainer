/**
 * OpenContainer Kernel — Browser Worker entry (PROCESS instance).
 *
 * One worker = one Node.js process. The HOST ProcessManager boots this
 * worker with a full process description (entry, argv, env, cwd, stdio,
 * pid/ppid), and from then on the worker speaks the process protocol:
 *
 *   worker → host : ready | boot-progress | stdio{fd,pipeId?} | exit{code}
 *                   child-spawn{req} | child-kill | pipe-write/close
 *                   tcp-listen/unlisten/connect/write/close/shutdown | vfs-delta
 *                   fs-event{watchId,event} | rpc-result{id,ok,result|err}
 *   host → worker : stdin | stdin-eof | resize | signal | pipe-data/eof
 *                   child-exit | tcp-connect/data/eof/connected | ports-update
 *                   listen-failed | vfs-apply | write-file | eval
 *                   fs-read/readdir/stat/apply-ops/watch/unwatch/tree | diag
 *
 * BOOT PIPELINE (unchanged WebContainers-class fast path): index.json →
 * Cache API core blob (warm) → materialize → amaro parallel → bootKernel →
 * run the ENTRY (main/eval/repl/version) → arm the loop-drain watcher.
 */

/// <reference lib="webworker" />
import { bootKernel } from './boot';
import type { BootedKernel } from './boot';
import { VENDOR_ROOT } from './id-map';
import type { VfsTree, VfsPersistOp } from './vfs';
import { gunzipSync } from 'fflate';

// Where the runtime blobs (.ocrt.gz) are fetched from. The HOST decides:
// it is sent in every boot message (default CDN base or the embedder's
// self-hosted base), because the worker cannot guess it — under the CDN
// default the worker itself runs from a blob: URL with no useful location.
let runtimeBase = '/opencontainer/runtime';

// Host bridge: capture the BROWSER's native DecompressionStream BEFORE the
// kernel boot replaces globalThis with node's webstreams shims. Guest
// installers (npm-oc/pnpm-oc) decompress tarballs through this bridge.
const NativeDecompressionStream: any = (globalThis as any).DecompressionStream;
(globalThis as any).__ocHostGunzip = async (gz: Uint8Array): Promise<Uint8Array> => {
  if (typeof NativeDecompressionStream === 'function') {
    try {
      const stream = new Response(gz as any).body!.pipeThrough(new NativeDecompressionStream('gzip'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // Engine-specific breakage of the native stream pipeline (observed in
      // the bun harness after kernel global replacement; Chromium is clean).
    }
  }
  return gunzipSync(gz);
};

export interface EntrySpec {
  type: 'main' | 'eval' | 'repl' | 'version';
  path?: string;
  code?: string;
  print?: boolean;
}

export interface StdioSpec {
  type: 'tty' | 'pipe' | 'ignore';
  pipeId?: number;
}

interface RpcMsg {
  type: string;
  id?: number;
  code?: string | number;
  path?: string;
  data?: string;
  fd?: number;
  cols?: number;
  rows?: number;
  cwd?: string;
  cmd?: string;
  args?: string[];
  hydrate?: VfsTree | null;
  sig?: string;
  pipeId?: number;
  bytes?: Uint8Array;
  pid?: number;
  signal?: string | null;
  connId?: number;
  reqId?: number;
  port?: number;
  remotePort?: number;
  listenId?: number;
  status?: number;
  ports?: number[];
  ops?: VfsPersistOp[];
  content?: string;
  entry?: EntrySpec | null;
  stdio?: StdioSpec[];
  env?: Record<string, string>;
  argv?: string[];
  ppids?: number;
  [k: string]: any;
}

// The kernel worker's own postMessage is its RPC lifeline to the host.
// Guest worker_threads scripts legitimately assign onto the worker global
// (rolldown's wasi-worker.mjs: Object.assign(globalThis, { self, postMessage,
// require, importScripts })) — node worker globals have none of those as
// accessors, so the assigns define fresh globals. In a BROWSER worker,
// `self` is a getter-only accessor (the assign THROWS in strict mode — found
// via vite 8's rolldown wasm32-wasi binding: every pool worker died with
// "Cannot set property self of #<WorkerGlobalScope> which has only a
// getter"), and `postMessage`/`onmessage` are the kernel's own channel.
// Normalized BEFORE any guest code runs:
//   - self → own WRITABLE data property (guest assigns work, like node);
//   - the host postMessage is captured so guest shadowing is harmless;
//   - RPC dispatch rides addEventListener, which no onmessage assignment
//     can remove.
const nativePostMessage: (msg: RpcMsg) => void =
  typeof (self as any).postMessage === 'function'
    ? (self as any).postMessage.bind(self)
    : (msg: RpcMsg) => { throw new Error(`OpenContainer: worker RPC broken — cannot post ${msg?.type}`); };
try {
  // `self` on a browser worker is a getter-only accessor sitting on a
  // PROTOTYPE — DedicatedWorkerGlobalScope.prototype → WorkerGlobalScope
  // .prototype (verified: NOT an own property, NOT on the direct prototype).
  // Walk the chain; if the found accessor has no setter, shadow it with an
  // own WRITABLE data property so guest `Object.assign(globalThis, {self…})`
  // behaves exactly like node's worker globals (wasi-worker.mjs et al.).
  let proto: any = globalThis;
  let d: PropertyDescriptor | undefined;
  while (proto !== null && d === undefined) {
    proto = Object.getPrototypeOf(proto);
    if (proto === null) break;
    d = Object.getOwnPropertyDescriptor(proto, 'self');
  }
  if (d && d.get && !d.set) {
    Object.defineProperty(globalThis, 'self', {
      value: globalThis, writable: true, configurable: true, enumerable: true,
    });
  }
} catch { /* exotic environment — keep the native accessor */ }

// TEMP diagnostic (wasi-threads debugging): guest-side Atomics.wait calls,
// traced through the IMMEDIATE host channel (post) — guest stdio is buffered
// and is lost when the loop blocks, this trace is not.
try {
  const origWait = Atomics.wait;
  (Atomics as any).wait = function (ta: any, index: any, value: any, timeout: any) {
    try {
      let shared = 'non-shared';
      try { if (ta.buffer instanceof SharedArrayBuffer && SharedArrayBuffer !== ArrayBuffer) shared = 'SHARED'; } catch { /* */ }
      post({
        type: 'stdio', fd: 2,
        chunk: `[oc-atomics] wait(${shared}, i=${index}, v=${value}, t=${timeout === undefined ? '∞' : timeout})\n`,
      });
    } catch { /* never break the call */ }
    return origWait.call(Atomics, ta, index, value, timeout);
  };
} catch { /* Atomics frozen — skip tracing */ }

// TEMP diagnostic: EmuPort (in-process worker port) message flow, same
// immediate channel. Enabled by env OC_TRACE_PORTS=1 on the process.
(globalThis as any).__ocWorkerMsgDebug = (s: string): void => {
  try { post({ type: 'stdio', fd: 2, chunk: `[oc-port] ${s}\n` }); } catch { /* noop */ }
};

function post(msg: RpcMsg) {
  nativePostMessage(msg);
}

// ---------------------------------------------------------------------------
// Blob loading (single-request boot + Cache API persistence)
// ---------------------------------------------------------------------------

interface RuntimeIndexEntry {
  file: string;
  sha256: string;
  rawBytes: number;
  gzBytes: number;
  modules: number;
}
interface RuntimeIndex {
  nodeVersion: string;
  core: RuntimeIndexEntry;
  amaro: RuntimeIndexEntry;
  npm?: RuntimeIndexEntry;
  pnpm?: RuntimeIndexEntry;
}

// v2: the blobs were renamed .ocrt.gz → .ocrt (static hosts stamp
// Content-Encoding: gzip on .gz-suffixed files, which the browser then
// transparently decodes — corrupting the double-gunzip assumption and, in
// SW-controlled worker contexts, failing the fetch outright). The rename
// plus the OCRT/gzip magic sniff below make both server behaviors safe; the
// cache-name bump flushes any v1 entries.
const CACHE_NAME = 'opencontainer-runtime-v2';

function cacheKeyUrl(file: string): string {
  return `${runtimeBase}/${file}`;
}

async function readCache(file: string): Promise<ArrayBuffer | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(cacheKeyUrl(file));
    if (!hit) return null;
    return await hit.arrayBuffer();
  } catch {
    return null; // Cache API unavailable (sandboxed context) — network only.
  }
}

async function writeCache(file: string, buf: ArrayBuffer): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(cacheKeyUrl(file), new Response(buf, {
      headers: { 'Content-Type': 'application/octet-stream' },
    }));
    try { await (navigator as any)?.storage?.persist?.(); } catch { /* noop */ }
    try {
      const keys = await caches.keys();
      for (const k of keys) {
        if (k.startsWith('opencontainer-runtime-') && k !== CACHE_NAME) {
          await caches.delete(k);
        }
      }
    } catch { /* noop */ }
  } catch {
    // Quota or sandbox failure — warm boot simply falls back to network.
  }
}

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  // ALWAYS the native DecompressionStream captured at module load — this
  // function runs in the kernel-boot RACE window (the parallel amaro load)
  // where globalThis.DecompressionStream may already be node's webstreams
  // shim, whose stream objects the browser's pipeThrough rejects
  // ("Failed to convert value to 'ReadableStream'").
  const ds: any = NativeDecompressionStream;
  if (typeof ds === 'function') {
    const stream = new Response(buf).body!.pipeThrough(new ds('gzip'));
    return await new Response(stream).arrayBuffer();
  }
  const { gunzipSync } = await import('fflate');
  return gunzipSync(new Uint8Array(buf)).buffer as ArrayBuffer;
}

/** True when the buffer is a RAW OCRT container (magic "OCRT" at offset 0) —
 *  i.e. NOT gzip. Used to survive transparent double-decode: a static host
 *  that serves *.gz (or *.ocrt.gz) with `Content-Encoding: gzip` makes the
 *  browser decode the transport layer, so fetch() hands us the RAW container
 *  where the canonical bytes are gzip. Both server behaviors are accepted. */
function looksLikeOcrt(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false;
  const b = new Uint8Array(buf, 0, 4);
  return b[0] === 0x4f && b[1] === 0x43 && b[2] === 0x52 && b[3] === 0x54; // "OCRT"
}

/** Normalize a fetched/cached runtime blob to the RAW OCRT container:
 *  OCRT magic → as-is (host decoded the transport); gzip magic (1f 8b) →
 *  gunzip; anything else → a configuration-pointing error. */
async function toRawOcrt(buf: ArrayBuffer): Promise<ArrayBuffer> {
  if (looksLikeOcrt(buf)) return buf;
  if (buf.byteLength >= 2) {
    const b = new Uint8Array(buf, 0, 2);
    if (b[0] === 0x1f && b[1] === 0x8b) return gunzip(buf);
  }
  throw new Error(
    'OpenContainer: runtime blob has unexpected leading bytes (expected gzip 1f 8b or OCRT ' +
    'magic) — your static host is probably transforming the blob body (e.g. serving it with ' +
    'Content-Encoding: gzip on a .gz suffix, or double-compressing). Serve the .ocrt files ' +
    'as-is (application/octet-stream, no Content-Encoding).',
  );
}

interface BlobEntry { p: string; o: number; l: number }

/** Parse .ocrt container: header + index + concatenated UTF-8 sources. */
function parseBlob(buf: ArrayBuffer): { entries: BlobEntry[]; bodyStart: number; bytes: Uint8Array } {
  const bytes = new Uint8Array(buf);
  if (bytes.length < 12) throw new Error('OpenContainer: runtime blob truncated');
  if (
    bytes[0] !== 0x4f || bytes[1] !== 0x43 || bytes[2] !== 0x52 || bytes[3] !== 0x54
  ) {
    throw new Error('OpenContainer: runtime blob magic mismatch (not "OCRT")');
  }
  const view = new DataView(buf);
  const version = view.getUint16(4, true);
  if (version !== 1) throw new Error(`OpenContainer: unsupported blob version ${version}`);
  const indexLen = view.getUint32(8, true);
  const indexJson = new TextDecoder().decode(bytes.subarray(12, 12 + indexLen));
  const entries: BlobEntry[] = JSON.parse(indexJson);
  return { entries, bodyStart: 12 + indexLen, bytes };
}

function materialize(buf: ArrayBuffer, into: Map<string, string>): number {
  const { entries, bodyStart, bytes } = parseBlob(buf);
  const decoder = new TextDecoder();
  for (const e of entries) {
    const start = bodyStart + e.o;
    into.set(`${VENDOR_ROOT}/${e.p}`, decoder.decode(bytes.subarray(start, start + e.l)));
  }
  return entries.length;
}
void materialize; // (kept for external tooling; the boot path is lazy now)

// ---------------------------------------------------------------------------
// S3.1 LAZY SOURCE STORE — decode a module's text only when it is first
// required. Previously every worker eagerly decoded ALL 511 module strings
// (~5.5 MB) before bootstrap, while a `node -e` process only ever touches
// ~70 of them (~1.3 MB). Each blob entry keeps a zero-copy subarray view;
// get() decodes (and memoizes) per module. require() stays fully
// synchronous (TextDecoder.decode is sync) and the compiled-module cache
// (BuiltinModule.map) means each source decodes at most once per process.
// ---------------------------------------------------------------------------

interface AttachedEntry { view: Uint8Array }
/** vendor-relative path → blob view. */
const sourceEntries = new Map<string, AttachedEntry>();
/** Decoded module text, memoized. */
const decodedSources = new Map<string, string>();
let coreEntryCount = 0;

function attachBlob(buf: ArrayBuffer): number {
  const { entries, bodyStart, bytes } = parseBlob(buf);
  for (const e of entries) {
    const start = bodyStart + e.o;
    sourceEntries.set(e.p, { view: bytes.subarray(start, start + e.l) });
  }
  return entries.length;
}

const storeDecoder = new TextDecoder();

function makeLazyStore() {
  return {
    get(path: string): string {
      const memo = decodedSources.get(path);
      if (memo !== undefined) return memo;
      const rel = path.startsWith(`${VENDOR_ROOT}/`) ? path.slice(VENDOR_ROOT.length + 1) : path;
      const entry = sourceEntries.get(rel);
      if (entry === undefined) {
        if (rel.startsWith('amaro/') && !amaroReady) {
          throw new Error('OpenContainer: TypeScript support is still loading — retry in a moment');
        }
        // TEMPORARY diag: what does this worker's store actually hold?
        try {
          const keys = [...sourceEntries.keys()];
          (globalThis as any).__ocEvalLog?.(`store miss '${rel}': entries=${sourceEntries.size}, coreEntries=${coreEntryCount}, hasPrefixLib=${keys.filter((k) => k.startsWith('lib/')).length}, sample=${keys.slice(0, 3).join('|')}, undiciKeyPresent=${keys.includes('lib/internal/deps/undici/undici.js')}`);
        } catch { /* noop */ }
        throw new Error(`OpenContainer: source not preloaded: ${path}`);
      }
      const text = storeDecoder.decode(entry.view);
      decodedSources.set(path, text);
      return text;
    },
    list(prefix: string): string[] {
      const out: string[] = [];
      const p = prefix.startsWith(`${VENDOR_ROOT}/`) ? prefix.slice(VENDOR_ROOT.length + 1) : prefix;
      for (const key of sourceEntries.keys()) {
        if (key.startsWith(p)) out.push(`${VENDOR_ROOT}/${key}`);
      }
      return out;
    },
  };
}

async function loadBlob(
  entry: RuntimeIndexEntry,
  phase: string,
  marks?: Record<string, number>,
): Promise<ArrayBuffer> {
  const tStart = performance.now();
  post({ type: 'boot-progress', phase: `${phase}:cache`, loaded: 0, total: entry.gzBytes });
  const cached = await readCache(entry.file);
  if (cached && looksLikeOcrt(cached)) {
    if (marks) marks[`${phase}CacheMs`] = Math.round(performance.now() - tStart);
    return cached;
  }
  // Non-OCRT cache payload = a pre-fix poisoned entry → treat as a miss and
  // self-heal (the write below overwrites it with the canonical raw form).
  post({ type: 'boot-progress', phase: `${phase}:fetch`, loaded: 0, total: entry.gzBytes });
  let res: Response;
  try {
    res = await fetch(cacheKeyUrl(entry.file));
  } catch (first) {
    // A transient rejection here is almost always the preview ServiceWorker
    // claiming/updating this client mid-boot (in-flight fetches of a client
    // can be aborted). Retry once after a beat, bypassing the HTTP cache.
    await new Promise((r) => setTimeout(r, 150));
    try {
      res = await fetch(cacheKeyUrl(entry.file), { cache: 'reload' });
    } catch (second: any) {
      throw new Error(
        `runtime blob fetch failed: ${entry.file} (${second?.message ?? second} — ` +
        `first error: ${first instanceof Error ? first.message : String(first)})`,
      );
    }
  }
  if (!res.ok) throw new Error(`runtime blob fetch failed: ${entry.file} (${res.status})`);
  const body = await res.arrayBuffer();
  const tInflate = performance.now();
  post({ type: 'boot-progress', phase: `${phase}:inflate`, loaded: 0, total: entry.rawBytes });
  // Normalizes BOTH wire forms: canonical gzip container, or a body the
  // host's static server transparently decoded (Content-Encoding: gzip).
  const raw = await toRawOcrt(body);
  if (marks) {
    marks[`${phase}FetchMs`] = Math.round(performance.now() - tStart);
    marks[`${phase}InflateMs`] = Math.round(performance.now() - tInflate);
  }
  void writeCache(entry.file, raw); // async — never blocks boot
  return raw;
}

// ---------------------------------------------------------------------------
// Kernel lifecycle
// ---------------------------------------------------------------------------

let kernel: BootedKernel | null = null;
let amaroReady = false;
/** Messages that arrive while the kernel is still booting (stdin data can
 *  beat the boot completion) — replayed in order once the kernel is live. */
let booting = false;
let earlyMessages: any[] = [];
/** This process's stdio spec (routing stdin + stdio out). */
let myStdio: StdioSpec[] = [
  { type: 'tty' }, { type: 'tty' }, { type: 'tty' },
];

// ---------------------------------------------------------------------------
// VFS deltas (in-session snapshots fanned out by the runtime)
// ---------------------------------------------------------------------------

let deltaQueue: VfsPersistOp[] = [];
let deltaFlushScheduled = false;

/** Post all pending VFS deltas NOW (child-spawn needs the host snapshot to
 *  be fresh before the child boots from it). */
function flushVfsDeltasNow(): void {
  if (deltaFlushScheduled) deltaFlushScheduled = false;
  const ops = deltaQueue;
  deltaQueue = [];
  if (ops.length > 0) post({ type: 'vfs-delta', ops });
}
(globalThis as any).__ocFlushVfsDeltas = flushVfsDeltasNow;

function wireVfsDeltas(): void {
  if (!kernel) return;
  kernel.vfs.persist = (op) => {
    deltaQueue.push(op);
    if (!deltaFlushScheduled) {
      deltaFlushScheduled = true;
      queueMicrotask(() => {
        deltaFlushScheduled = false;
        const ops = deltaQueue;
        deltaQueue = [];
        if (ops.length > 0) post({ type: 'vfs-delta', ops });
      });
    }
  };
}

// ---------------------------------------------------------------------------
// IDE filesystem RPC helpers
// ---------------------------------------------------------------------------

/** VFS watchers registered by the host (watchId → watcher). */
const fsWatchers = new Map<number, { close(): void }>();

/** Uniform RPC success/error reply. VfsError carries node-style codes. */
function rpcReply(msg: { id?: number }, fn: () => unknown): void {
  try {
    post({ type: 'rpc-result', id: msg.id, ok: true, result: fn() });
  } catch (err: any) {
    post({
      type: 'rpc-result', id: msg.id, ok: false,
      err: { code: err?.code ?? 'EIO', message: err?.message ?? String(err), path: err?.path },
    });
  }
}

/** One host-initiated filesystem mutation, applied through the real VFS
 *  methods (watchers fire; the persist hook queues in-session deltas). */
function applyHostFsOp(op: VfsPersistOp & { recursive?: boolean }): void {
  if (!kernel) throw new Error('kernel not booted');
  switch (op.type) {
    case 'write':
      kernel.vfs.writeFile(op.path, op.data ?? new Uint8Array(0));
      break;
    case 'mkdir':
      kernel.vfs.mkdir(op.path, true);
      break;
    case 'symlink':
      kernel.vfs.symlink(op.target, op.path);
      break;
    case 'unlink':
      kernel.vfs.rm(op.path, { recursive: op.recursive !== false, force: true });
      break;
    case 'rename':
      kernel.vfs.rename(op.from, op.to);
      break;
  }
}

async function boot(msg: {
  hydrate?: VfsTree | null;
  entry?: EntrySpec | null;
  stdio?: StdioSpec[];
  env?: Record<string, string>;
  cwd?: string;
  argv?: string[];
  pid?: number;
  ppid?: number;
  runtimeIndex?: RuntimeIndex | null;
  /** Base URL for runtime blob fetches (host-decided; see runtimeBase above). */
  runtimeBase?: string;
}): Promise<void> {
  const t0 = performance.now();
  const marks: Record<string, number> = {};
  const lap = (key: string) => { marks[key] = Math.round(performance.now() - t0); };
  if (typeof msg.runtimeBase === 'string' && msg.runtimeBase) {
    runtimeBase = msg.runtimeBase.replace(/\/+$/, '');
  }
  post({ type: 'boot-progress', phase: 'index', loaded: 0, total: 0 });

  // S3.1: the host embeds the runtime index in the boot message (it is
  // generated together with the blobs, so it cannot drift). Only fall back
  // to the network fetch when the host did not send one — this removes a
  // per-worker index.json round trip.
  let index: RuntimeIndex | null = msg.runtimeIndex ?? null;
  if (!index) {
    const indexRes = await fetch(`${runtimeBase}/index.json`, { cache: 'no-cache' });
    if (!indexRes.ok) throw new Error(`runtime index fetch failed (${indexRes.status})`);
    index = await indexRes.json();
  }
  lap('indexMs');

  const coreBuf = await loadBlob(index.core, 'core', marks);
  lap('coreTotalMs');
  post({ type: 'boot-progress', phase: 'core:decode', loaded: 0, total: index.core.rawBytes });
  // S3.1: register zero-copy views; sources decode lazily on first require.
  const count = attachBlob(coreBuf);
  lap('decodeMs');

  // amaro (TS support) in parallel — merged whenever it lands.
  void loadBlob(index.amaro, 'amaro').then((amaroBuf) => {
    attachBlob(amaroBuf);
    amaroReady = true;
    post({ type: 'amaro-ready' });
  }).catch((e) => {
    post({ type: 'error', message: `amaro (TypeScript) bundle unavailable: ${e?.message ?? e}` });
  });

  post({ type: 'boot-progress', phase: 'bootstrap', loaded: 0, total: count });

  myStdio = msg.stdio ?? myStdio;

  // Temporary-environment contract: the ONLY hydration source is the host
  // snapshot supplied in the boot message (the host owns where project
  // files come from). There is NO cross-reload restore — a fresh page load
  // boots an empty VFS and the host supplies files again.
  const hydrateTree: VfsTree | null = msg.hydrate ?? null;
  const hydratedFrom = msg.hydrate ? 'host-snapshot' : 'none';

  // Pid-scoped id bases keep kernel-assigned child pids/pipe ids/conn ids
  // unique across every process in the tree.
  const pid = msg.pid ?? 1;
  (globalThis as any).__ocPidBase = pid * 1000 + 1;
  (globalThis as any).__ocPipeIdBase = pid * 10000 + 1;
  (globalThis as any).__ocConnIdBase = pid * 100000 + 1;

  kernel = await bootKernel({
    store: makeLazyStore(),
    hydrate: hydrateTree ?? undefined,
    pid,
    ppid: msg.ppid ?? 0,
    stdio: myStdio,
    cwd: msg.cwd,
    env: msg.env,
    argv: msg.argv,
    hooks: {
      // ESM graph transport: rewritten module texts become IN-WORKER blob
      // URLs. No network, no ServiceWorker, no origin dependency — this is
      // load-bearing for CDN embedding, where the kernel worker itself runs
      // from a blob: URL: (a) relative URLs cannot resolve from blob: (the
      // scheme has an opaque path), so the old same-origin '/oc-esm' fetch
      // transport threw "Failed to parse URL" and killed every npm command
      // (npm 12 display.js dynamic-imports chalk, an ESM-only package) with
      // a silent exit 1; (b) even absolute URLs are unreachable — a blob:
      // worker is never a controlled ServiceWorker client, so SW-served
      // transports cannot intercept its fetches. Blob URLs are minted and
      // imported entirely inside this worker: works under the CDN default,
      // self-hosted same-origin, and hosts without Service-Worker-Allowed.
      // (Bun harnesses implement the same contract with file:// URLs.)
      // Blob URLs are never revoked: one per published module per process,
      // bounded by the guest's ESM graph size; the worker's teardown frees
      // them all.
      esmServing: {
        async serve(_nonce: string, entries: Map<string, string>): Promise<Map<string, string>> {
          const urls = new Map<string, string>();
          for (const [p, text] of entries) {
            urls.set(p, URL.createObjectURL(new Blob([text], { type: 'text/javascript' })));
          }
          return urls;
        },
      },
      onExit(code: number, signal?: string | null) {
        post({ type: 'exit', code, signal: signal ?? null });
      },
      onStdio(fd: 1 | 2, chunk: Uint8Array | string) {
        // Piped stdio routes by pipeId (the host owns the pipe table);
        // tty stdio goes to the terminal as text.
        const mode = myStdio[fd];
        if (mode && mode.type === 'pipe' && mode.pipeId !== undefined) {
          const bytes = typeof chunk === 'string'
            ? new TextEncoder().encode(chunk) : chunk;
          post({ type: 'stdio', fd, pipeId: mode.pipeId, bytes });
        } else {
          const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
          post({ type: 'stdio', fd, chunk: text });
        }
      },
      now: () => Date.now(),
      env: () => ({
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: '/home/node',
        LANG: 'en_US.UTF-8',
        TERM: 'xterm-256color',
        NODE_REPL_HISTORY: '/home/node/.node_repl_history',
        ...(msg.env ?? {}),
      }),
      initialCwd: msg.cwd ?? '/home/project',
      // ---- multi-process host bridge ----------------------------------------
      onChildSpawn: (req: any) => post({ type: 'child-spawn', req }),
      onChildKill: (childPid: number, signal: string) =>
        post({ type: 'child-kill', pid: childPid, signal }),
      onPipeWrite: (pipeId: number, chunk: Uint8Array) =>
        post({ type: 'pipe-write', pipeId, bytes: chunk }),
      onPipeClose: (pipeId: number, reason: string) =>
        post({ type: 'pipe-close', pipeId, reason }),
      onTcpListen: (info: any) => post({ type: 'tcp-listen', ...info }),
      onTcpUnlisten: (listenId: number, port: number) =>
        post({ type: 'tcp-unlisten', listenId, port }),
      onTcpConnect: (info: any) => post({ type: 'tcp-connect', ...info }),
      onTcpWrite: (connId: number, chunk: Uint8Array) =>
        post({ type: 'tcp-write', connId, bytes: chunk }),
      onTcpClose: (connId: number) => post({ type: 'tcp-close', connId }),
      onTcpShutdown: (connId: number) => post({ type: 'tcp-shutdown', connId }),
    },
  });

  lap('bootstrapMs');

  // ---- P1 "npm is npm" / "pnpm is pnpm": entry-gated mount of the genuine
  // upstream CLI trees. Both ship as lazily-fetched runtime blobs and are
  // mounted ONLY when this process's entry is one of their binaries, so
  // `node -e` boots never pay the fetch/decode. Mounted BEFORE
  // wireVfsDeltas() — system files are blob-derived and must never enter
  // host snapshots (same discipline as boot.ts's mountPkg).
  {
    const entryPath: string = msg.entry?.path ?? '';
    const argv0 = String(msg.argv?.[1] ?? '');
    const needsPkg = (root: string) =>
      entryPath.startsWith(`/usr/local/bin/${root}`) ||
      entryPath.startsWith(`/usr/lib/node_modules/${root}`) ||
      argv0.startsWith(`/usr/local/bin/${root}`) ||
      argv0.startsWith(`/usr/lib/node_modules/${root}`);
    if (msg.debug) (globalThis as any).__OC_DEBUG = true;
    if (index.npm && (needsPkg('npm') || needsPkg('npx'))) {
      const npmBuf = await loadBlob(index.npm, 'npm');
      const mounted = mountCliTree(npmBuf, '/usr/lib/node_modules/npm');
      if ((globalThis as any).__OC_DEBUG) console.warn('[oc-debug] npm blob mounted', mounted, 'files');
      lap('npmMountMs');
      post({ type: 'boot-progress', phase: 'npm:mount', loaded: mounted, total: mounted });
    }
    if (index.pnpm && (needsPkg('pnpm') || needsPkg('pnpx'))) {
      const pnpmBuf = await loadBlob(index.pnpm, 'pnpm');
      const mounted = mountCliTree(pnpmBuf, '/usr/lib/node_modules/pnpm');
      lap('pnpmMountMs');
      post({ type: 'boot-progress', phase: 'pnpm:mount', loaded: mounted, total: mounted });
    }
  }

  wireVfsDeltas();

  // Connection-level TCP lifecycle trace (OC_TRACE_TCP=1): tcp_wrap logs
  // every accept/readStart/readStop/data/EOF/close with connId + delivery
  // state through the IMMEDIATE host channel (guest stdio is buffered; this
  // trace must survive hangs). Off by default — diagnostics only.
  if (msg.env && String((msg.env as any).OC_TRACE_TCP) === '1') {
    (globalThis as any).__ocTcpTrace = (s: string) => {
      try { post({ type: 'stdio', fd: 2, chunk: s + '\n' }); } catch { /* noop */ }
    };
  }

  // TEMP diagnostic (OC_TRACE_IMMEDIATE=1): guest setImmediate calls —
  // emnapi's async-work engine rides setImmediate; a work item that never
  // executes (immediate never fires) or one whose callback never returns
  // (wasm infinite loop) is the two failure shapes this separates.
  if (msg.env && String((msg.env as any).OC_TRACE_IMMEDIATE) === '1') {
    try {
      const g: any = globalThis;
      const orig = g.setImmediate;
      let n = 0;
      g.setImmediate = function (cb: any, ...a: any[]) {
        const id = ++n;
        post({ type: 'stdio', fd: 2, chunk: `[oc-imm] #${id} scheduled\n` });
        return orig(function (this: any, ...args: any[]) {
          post({ type: 'stdio', fd: 2, chunk: `[oc-imm] #${id} start\n` });
          const r = cb.apply(this, args);
          post({ type: 'stdio', fd: 2, chunk: `[oc-imm] #${id} done\n` });
          return r;
        }, ...a);
      };
    } catch { /* best-effort diagnostic */ }
  }

  (globalThis as any).__oc = (globalThis as any).__oc ?? {};
  (globalThis as any).__oc.kernel = kernel;

  (self as any).addEventListener('unhandledrejection', (ev: any) => {
    const cb = (globalThis as any).__ocGetPromiseRejectCallback?.();
    if (typeof cb === 'function') {
      try { ev?.preventDefault?.(); } catch { /* noop */ }
      cb(0 /* kPromiseRejectWithNoHandler */, ev.promise, ev.reason);
    }
  });

  post({
    type: 'ready',
    nodeVersion: kernel.process.version,
    modules: count,
    bootMs: Math.round(performance.now() - t0),
    phases: marks,
    hydratedFrom,
    // The boot snapshot is host-supplied; nothing to echo back.
    pid,
  });

  // Bring the EADDRINUSE mirror up to date BEFORE the entry runs.
  if (Array.isArray(msg.initialPorts) && msg.initialPorts.length > 0) {
    const tcpB: any = kernel.natives.get('tcp_wrap');
    tcpB.setPortsInUse(msg.initialPorts);
  }

  // ---- run the process ENTRY -----------------------------------------------
  const entry = msg.entry ?? null;
  if (entry) await runEntry(entry);
}

/***
 * Mount a genuine upstream CLI tree from its OCRT blob into the VFS at
 * <root> (boot.ts's bin shims already point /usr/local/bin/npm|npx|pnpm|pnpx
 * at the right files inside). A blob's entry paths are relative to the
 * upstream package root — they do NOT share the core blob's
 * node-v26.13.0/ namespace, which is why this mounts VFS-direct instead of
 * going through the module store.
 */
function mountCliTree(buf: ArrayBuffer, root: string): number {
  if (!kernel) return 0;
  const { entries, bodyStart, bytes } = parseBlob(buf);
  const decoder = new TextDecoder();
  kernel.vfs.mkdir(root, true);
  let n = 0;
  for (const e of entries) {
    const dest = `${root}/${e.p}`;
    kernel.vfs.mkdir(dest.slice(0, dest.lastIndexOf('/')), true);
    kernel.vfs.writeFile(dest, decoder.decode(bytes.subarray(bodyStart + e.o, bodyStart + e.o + e.l)));
    n++;
  }
  return n;
}

function drainTicks(): void {
  try { (globalThis as any).__ocDrainTicks?.(); } catch { /* noop */ }
}

/** Execute this process's entry (node file.js / node -e / REPL / -v). */
async function runEntry(entry: EntrySpec): Promise<void> {
  if (!kernel) throw new Error('kernel not booted');
  try {
    switch (entry.type) {
      case 'version':
        kernel.process.stdout.write(`v${(kernel.process.versions as any).node}\n`);
        break;
      case 'eval':
        await kernel.runEval(entry.code ?? '', entry.print === true);
        break;
      case 'repl':
        kernel.require('internal/main/repl');
        break;
      case 'main':
        await kernel.runMain(entry.path ?? '/home/project/index.js');
        break;
    }
  } catch (err: any) {
    if ((globalThis as any).__OC_DEBUG) console.warn('[oc-debug] entry failed:', err?.stack ?? err);
    post({ type: 'error', message: err?.message ?? String(err), stack: err?.stack });
    // A boot-time entry failure is still a process exit — the host must see
    // an exit code, not a hung worker.
    try { kernel.process.reallyExit?.(1); } catch { /* host will recycle */ }
    return;
  }
  // node semantics: the process exits when the loop drains (a listening
  // server keeps it alive — the drain watcher accounts for open handles).
  kernel.startLoopDrainWatcher();
}

/** Start the interactive REPL — node's real entry (internal/main/repl). */
function startRepl(): void {
  if (!kernel) throw new Error('kernel not booted');
  kernel.require('internal/main/repl');
}

// ---------------------------------------------------------------------------
// RPC dispatch
// ---------------------------------------------------------------------------

let booted = false;

// RPC dispatch on addEventListener, NOT the onmessage property: guest
// worker_threads scripts assign globalThis.onmessage (node semantics — the
// worker owns the global), and a property assignment would otherwise
// DETACH the kernel's host channel. An addEventListener handler can only be
// removed by removeEventListener — guest assigns are harmless shadowing.
async function handleRpcMessage(ev: MessageEvent<RpcMsg>): Promise<void> {
  const msg = ev.data;
  if (booting && msg.type !== 'boot') {
    earlyMessages.push(msg);
    return;
  }
  try {
    switch (msg.type) {
      case 'boot': {
        if (!kernel) {
          booted = true;
          booting = true;
          try {
            await boot(msg as any);
          } finally {
            booting = false;
            const queued = earlyMessages;
            earlyMessages = [];
            for (const m of queued) {
              await handleRpcMessage({ data: m } as MessageEvent<RpcMsg>);
            }
          }
        }
        post({ type: 'boot-done', id: msg.id });
        break;
      }
      case 'eval': {
        if (!kernel) throw new Error('kernel not booted');
        await kernel.runEval(String(msg.code ?? ''));
        kernel.startLoopDrainWatcher();
        post({ type: 'eval-done', id: msg.id });
        break;
      }
      case 'run-main': {
        if (!kernel) throw new Error('kernel not booted');
        await kernel.runMain(msg.path ?? '/home/project/index.js');
        kernel.startLoopDrainWatcher();
        post({ type: 'eval-done', id: msg.id });
        break;
      }
      case 'stdin': {
        if (!kernel) break;
        {
          const mode = myStdio[0];
          if (mode && mode.type === 'pipe' && mode.pipeId !== undefined) {
            // Piped stdin: bytes from the parent's child.stdin writes.
            const pipeB: any = kernel.natives.get('pipe_wrap');
            const bytes = typeof msg.data === 'string'
              ? new TextEncoder().encode(msg.data)
              : (msg.bytes ?? new Uint8Array());
            pipeB.deliverPipeData(mode.pipeId, bytes);
          } else {
            const tty: any = kernel.natives.get('tty_wrap');
            tty.feedStdin(msg.data ?? '');
          }
          drainTicks();
        }
        break;
      }
      case 'stdin-eof': {
        if (!kernel) break;
        const mode = myStdio[0];
        if (mode && mode.type === 'pipe' && mode.pipeId !== undefined) {
          const pipeB: any = kernel.natives.get('pipe_wrap');
          pipeB.deliverPipeEof(mode.pipeId);
        } else {
          const tty: any = kernel.natives.get('tty_wrap');
          tty.sendStdinEof();
        }
        break;
      }
      case 'signal': {
        if (!kernel) break;
        // JS signal semantics: listeners consume; default disposition exits.
        kernel.raiseSignal(msg.sig ?? 'SIGINT');
        drainTicks();
        break;
      }
      case 'resize': {
        if (!kernel) break;
        (globalThis as any).__oc.terminalSize = { cols: msg.cols ?? 80, rows: msg.rows ?? 24 };
        try {
          kernel.process.stdout?._refreshSize?.();
          kernel.process.stderr?._refreshSize?.();
          kernel.process.stdin?._refreshSize?.();
        } catch { /* best-effort */ }
        post({ type: 'resized', id: msg.id });
        break;
      }
      case 'pipe-data': {
        // Bytes from a CHILD we spawned (its stdout/stderr → our handles).
        if (!kernel) break;
        const pipeB: any = kernel.natives.get('pipe_wrap');
        pipeB.deliverPipeData(msg.pipeId ?? -1, msg.bytes ?? new Uint8Array());
        drainTicks();
        break;
      }
      case 'pipe-eof': {
        if (!kernel) break;
        const pipeB: any = kernel.natives.get('pipe_wrap');
        pipeB.deliverPipeEof(msg.pipeId ?? -1);
        break;
      }
      case 'child-exit': {
        if (!kernel) break;
        const procB: any = kernel.natives.get('process_wrap');
        procB.notifyChildExit(msg.pid ?? -1, msg.code ?? 0, msg.signal ?? null);
        drainTicks();
        break;
      }
      case 'tcp-connect': {
        // An incoming connection for one of OUR listening ports. `bytes`
        // (preview bridge) carries the client's first packet with the
        // connect — S3.1: batched into this message instead of a second
        // 'tcp-data' post (one worker hop fewer per preview request; the
        // TCP handle's pending queue makes early delivery safe).
        if (!kernel) break;
        const tcpB: any = kernel.natives.get('tcp_wrap');
        const ok = tcpB.acceptConnection(msg.port ?? 0, msg.connId ?? 0, msg.remotePort ?? 0);
        if (!ok) {
          post({ type: 'tcp-unaccepted', connId: msg.connId });
          break;
        }
        if (msg.bytes && msg.bytes.byteLength > 0) {
          tcpB.deliverTcpData(msg.connId ?? 0, new Uint8Array(msg.bytes));
        }
        drainTicks();
        break;
      }
      case 'tcp-data': {
        (globalThis as any).__ocDebugHook?.(`[worker] tcp-data connId=${msg.connId} ${msg.bytes?.length ?? 0}B kernel=${!!kernel}`);
        if (!kernel) break;
        const tcpB: any = kernel.natives.get('tcp_wrap');
        tcpB.deliverTcpData(msg.connId ?? -1, msg.bytes ?? new Uint8Array());
        drainTicks();
        break;
      }
      case 'tcp-eof': {
        if (!kernel) break;
        const tcpB: any = kernel.natives.get('tcp_wrap');
        tcpB.deliverTcpEof(msg.connId ?? -1);
        break;
      }
      case 'tcp-connected': {
        if (!kernel) break;
        const tcpB: any = kernel.natives.get('tcp_wrap');
        tcpB.__connectComplete(msg.reqId ?? -1, msg.status ?? 0);
        drainTicks();
        break;
      }
      case 'tcp-connect-failed': {
        if (!kernel) break;
        const tcpB: any = kernel.natives.get('tcp_wrap');
        tcpB.__connectComplete(msg.reqId ?? -1, msg.status ?? -111); // UV_ECONNREFUSED
        break;
      }
      case 'ports-update': {
        if (!kernel) break;
        const tcpB: any = kernel.natives.get('tcp_wrap');
        tcpB.setPortsInUse(msg.ports ?? []);
        break;
      }
      case 'listen-failed': {
        if (!kernel) break;
        const tcpB: any = kernel.natives.get('tcp_wrap');
        tcpB.__listenFailed(msg.listenId ?? -1);
        break;
      }
      case 'vfs-apply': {
        // Deltas from OTHER processes — cross-process file visibility.
        if (!kernel) break;
        kernel.vfs.applyExternalOps(msg.ops ?? []);
        break;
      }
      case 'write-file': {
        if (!kernel) throw new Error('kernel not booted');
        // content is a string OR raw bytes (runtime.writeFile accepts both;
        // bytes must never be stringified — see its snapshot-corruption note).
        kernel.vfs.writeFile(msg.path ?? '/home/project/file.js', msg.content ?? '');
        post({ type: 'write-file-done', id: msg.id });
        break;
      }

      // ---- IDE filesystem RPCs (served by whichever kernel receives them;
      // the host always targets the shell keeper, pid 1) --------------------
      // Uniform reply protocol: {type:'rpc-result', id, ok, result|err}. The
      // real VFS methods are used so watchers fire and in-session deltas queue.
      case 'fs-read': {
        if (!kernel) throw new Error('kernel not booted');
        rpcReply(msg, () => ({ data: kernel.vfs.readFile(String(msg.path)) }));
        break;
      }
      case 'fs-readdir': {
        if (!kernel) throw new Error('kernel not booted');
        rpcReply(msg, () => {
          const p = String(msg.path);
          const out: Array<Record<string, unknown>> = [];
          for (const e of kernel.vfs.dirents(p)) {
            const kind =
              e.type === 0o040000 ? 'dir' : e.type === 0o120000 ? 'symlink' : 'file';
            let size = 0;
            let mtimeMs = 0;
            if (kind !== 'dir') {
              try {
                const st = kernel.vfs.stat(p === '/' ? `/${e.name}` : `${p}/${e.name}`);
                size = Number(st.size ?? 0);
                mtimeMs = Number(st.mtimeMs ?? 0);
              } catch { /* dangling symlink — size stays 0 */ }
            }
            out.push({ name: e.name, kind, size, mtimeMs });
          }
          return { entries: out };
        });
        break;
      }
      case 'fs-stat': {
        if (!kernel) throw new Error('kernel not booted');
        rpcReply(msg, () => {
          try {
            const st = kernel.vfs.lstat(String(msg.path));
            return {
              stat: {
                kind:
                  (st.mode & 0o170000) === 0o040000 ? 'dir'
                    : (st.mode & 0o170000) === 0o120000 ? 'symlink' : 'file',
                size: Number(st.size ?? 0),
                mtimeMs: Number(st.mtimeMs ?? 0),
                mode: Number(st.mode ?? 0),
              },
            };
          } catch {
            return { stat: null };
          }
        });
        break;
      }
      case 'fs-apply-ops': {
        // Host-initiated mutations (IDE file operations, project import).
        // Unlike 'vfs-apply' (peer fan-out, persist disabled) these run
        // through the real methods so the persist hook queues in-session deltas.
        if (!kernel) throw new Error('kernel not booted');
        rpcReply(msg, () => {
          for (const op of msg.ops ?? []) applyHostFsOp(op);
          return {};
        });
        break;
      }
      case 'fs-watch': {
        if (!kernel) throw new Error('kernel not booted');
        const watchId = msg.watchId;
        if (watchId === undefined || watchId === null) {
          post({ type: 'rpc-result', id: msg.id, ok: false, err: { code: 'EINVAL', message: 'fs-watch: watchId required' } });
          break;
        }
        const w = kernel.vfs.watch(String(msg.path), (event) => {
          post({ type: 'fs-event', watchId, event });
        });
        fsWatchers.set(watchId, w);
        post({ type: 'rpc-result', id: msg.id, ok: true, result: {} });
        break;
      }
      case 'fs-unwatch': {
        const w = fsWatchers.get(msg.watchId);
        if (w) { w.close(); fsWatchers.delete(msg.watchId); }
        post({ type: 'rpc-result', id: msg.id, ok: true, result: {} });
        break;
      }
      case 'fs-tree': {
        if (!kernel) throw new Error('kernel not booted');
        rpcReply(msg, () => ({ tree: kernel.vfs.exportTree(String(msg.dir ?? '/')) }));
        break;
      }
      case 'diag': {
        if (!kernel) throw new Error('kernel not booted');
        const t0 = performance.now();
        const tree = kernel.vfs.exportTree('/');
        let vfsBytes = 0;
        for (const [, d] of tree.files) vfsBytes += d.byteLength;
        let storage: { usage?: number; quota?: number } | null = null;
        try { storage = await (navigator as any)?.storage?.estimate?.(); } catch { /* unavailable */ }
        post({
          type: 'rpc-result', id: msg.id, ok: true,
          result: {
            fileCount: tree.files.length,
            dirCount: tree.dirs.length,
            symlinkCount: tree.symlinks.length,
            vfsBytes,
            treeWalkMs: Math.round(performance.now() - t0),
            storage,
            moduleCount: (kernel as any).moduleCount ?? null,
            pid: (kernel.process as any).pid ?? null,
          },
        });
        break;
      }
      case 'spawn': {
        // Legacy in-process dispatch (bun harness compatibility). The
        // browser flow boots processes with entries instead.
        if (!kernel) throw new Error('kernel not booted');
        const cmd = msg.cmd ?? '';
        const args = msg.args ?? [];
        const NPM_OC_CLI = '/usr/local/bin/npm';
        const PNPM_OC_CLI = '/usr/local/bin/pnpm';
        if (cmd === 'node') {
          const first = args[0] ?? '';
          if (args.length === 0 || first === '-i' || first === '--interactive') {
            startRepl();
            kernel.startLoopDrainWatcher();
            post({ type: 'spawn-done', id: msg.id });
            break;
          }
          if (first === '-v' || first === '--version') {
            kernel.process.stdout.write(`v${(kernel.process.versions as any).node}\n`);
            kernel.startLoopDrainWatcher();
            post({ type: 'spawn-done', id: msg.id });
            break;
          }
          if (first === '-e' || first === '--eval') {
            // node -e semantics: args[1] is the script, args[2:] → process.argv.
            kernel.process.argv = ['/usr/local/bin/node', ...args.slice(2)];
            await kernel.runEval(args[1] ?? '');
            kernel.startLoopDrainWatcher();
            post({ type: 'spawn-done', id: msg.id });
            break;
          }
          if (first === '-p' || first === '--print') {
            kernel.process.argv = ['/usr/local/bin/node', ...args.slice(2)];
            await kernel.runEval(args[1] ?? '', true);
            kernel.startLoopDrainWatcher();
            post({ type: 'spawn-done', id: msg.id });
            break;
          }
          await kernel.runMain(first);
          kernel.startLoopDrainWatcher();
          post({ type: 'spawn-done', id: msg.id });
          break;
        }
        if (cmd === 'npm' || cmd === 'pnpm') {
          const cli = cmd === 'npm' ? NPM_OC_CLI : PNPM_OC_CLI;
          kernel.process.argv = ['/usr/local/bin/node', cli, ...args];
          await kernel.runMain(cli);
          kernel.startLoopDrainWatcher();
          post({ type: 'spawn-done', id: msg.id });
          break;
        }
        post({
          type: 'error', id: msg.id,
          message: `OpenContainer: legacy in-process spawn supports node/npm/pnpm only (got '${cmd}')`,
        });
        post({ type: 'spawn-done', id: msg.id });
        break;
      }
      default:
        post({ type: 'error', id: msg.id, message: `unknown RPC: ${msg.type}` });
    }
  } catch (err: any) {
    post({
      type: 'error',
      id: msg.id,
      message: err?.message ?? String(err),
      stack: err?.stack,
    });
    if (msg.id !== undefined && msg.type !== 'boot') post({ type: 'eval-done', id: msg.id });
  } finally {
    drainTicks();
  }
}

self.addEventListener('message', (ev: MessageEvent<RpcMsg>) => {
  void handleRpcMessage(ev);
});
