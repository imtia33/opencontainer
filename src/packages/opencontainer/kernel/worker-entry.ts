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
 *                   listen-failed | vfs-apply | write-file | persist-vfs | eval
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

const RUNTIME_BASE = '/opencontainer/runtime';
const OPFS_ROOT_DIR = 'opencontainer-vfs';

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

function post(msg: RpcMsg) {
  (self as any).postMessage(msg);
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
}

const CACHE_NAME = 'opencontainer-runtime-v1';

function cacheKeyUrl(file: string): string {
  return `${RUNTIME_BASE}/${file}`;
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
  const ds = (globalThis as any).DecompressionStream;
  if (typeof ds === 'function') {
    const stream = new Response(buf).body!.pipeThrough(new ds('gzip'));
    return await new Response(stream).arrayBuffer();
  }
  const { gunzipSync } = await import('fflate');
  return gunzipSync(new Uint8Array(buf)).buffer as ArrayBuffer;
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
  if (cached) {
    if (marks) marks[`${phase}CacheMs`] = Math.round(performance.now() - tStart);
    return cached;
  }
  post({ type: 'boot-progress', phase: `${phase}:fetch`, loaded: 0, total: entry.gzBytes });
  const res = await fetch(cacheKeyUrl(entry.file));
  if (!res.ok) throw new Error(`runtime blob fetch failed: ${entry.file} (${res.status})`);
  const gz = await res.arrayBuffer();
  const tInflate = performance.now();
  post({ type: 'boot-progress', phase: `${phase}:inflate`, loaded: 0, total: entry.rawBytes });
  const raw = await gunzip(gz);
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
// VFS persistence: host deltas (in-session snapshots) + OPFS (cross-reload)
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
 *  methods (watchers fire; the persist hook queues OPFS deltas). */
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

// ---- OPFS (cross-reload persistence; worker-only API) --------------------

interface OpfsPaths { dirs: string[]; files: Array<[string, Uint8Array]>; symlinks: Array<[string, string]> }

async function opfsRoot(): Promise<any | null> {
  try {
    const root = await (navigator as any).storage?.getDirectory?.();
    if (!root) return null;
    return await root.getDirectoryHandle(OPFS_ROOT_DIR, { create: true });
  } catch {
    return null; // OPFS unavailable (sandboxed context) — in-session only.
  }
}

function opfsKey(path: string): string {
  return encodeURIComponent(path);
}

/** Ephemeral-path rule — the WebContainers-style node_modules lifecycle.
 *
 *  Dependency weight is NEVER persisted: node_modules at ANY depth is
 *  rebuilt by npm on demand ("reload → project files kept, node_modules
 *  dropped"). The npm HTTP cache under /home/node/.npm/_cacache is
 *  content-addressed (sha-named) and contains no node_modules path segment,
 *  so it survives this rule automatically — reinstalls come back from cache
 *  in ~1 s instead of full network. Shared by save AND load: a stale
 *  manifest from an older session (which still listed node_modules) must
 *  not be able to hydrate them back. */
function isEphemeralPath(p: string): boolean {
  return p.includes('/node_modules/');
}

async function saveTreeToOpfs(): Promise<void> {
  if (!kernel) return;
  const root = await opfsRoot();
  if (!root) return;
  const tree = kernel.vfs.exportTree('/home');
  // Ephemeral filter BEFORE the manifest is built: node_modules is excluded
  // from dirs/files/symlinks, so the manifest never lists it, and the `live`
  // set below purges stale node_modules entries written by older sessions.
  const eDirs = tree.dirs.filter((p) => !isEphemeralPath(p));
  const eFiles = tree.files.filter(([p]) => !isEphemeralPath(p));
  const eSymlinks = tree.symlinks.filter(([p]) => !isEphemeralPath(p));
  const manifest = {
    savedAt: Date.now(),
    dirs: eDirs,
    symlinks: eSymlinks,
    files: eFiles.map(([p]) => p),
  };
  const mf = await root.getFileHandle('_manifest.json', { create: true });
  const w = await mf.createSyncAccessHandle();
  const mbytes = new TextEncoder().encode(JSON.stringify(manifest));
  w.truncate(0);
  w.write(mbytes, { at: 0 });
  w.flush();
  w.close();
  for (const [p, data] of eFiles) {
    const fh = await root.getFileHandle(opfsKey(p), { create: true });
    const acc = await fh.createSyncAccessHandle();
    acc.truncate(0);
    acc.write(data, { at: 0 });
    acc.flush();
    acc.close();
  }
  const live = new Set(eFiles.map(([p]) => opfsKey(p)));
  for await (const [name] of root.entries()) {
    // Skip ONLY our own manifest (`_` prefix). A bare `.endsWith('.json')`
    // guard here once leaked: guest package.json etc. are percent-encoded
    // keys that END in .json, so deleted guest .json files were never
    // purged from OPFS. The live-set is the purge authority.
    if (name.startsWith('_')) continue;
    if (!live.has(name)) {
      try { await root.removeEntry(name); } catch { /* best-effort */ }
    }
  }
}

async function loadTreeFromOpfs(): Promise<OpfsPaths | null> {
  const root = await opfsRoot();
  if (!root) return null;
  let manifest: any = null;
  try {
    const mf = await root.getFileHandle('_manifest.json');
    const file = await mf.getFile();
    manifest = JSON.parse(await file.text());
  } catch {
    return null; // no persisted state
  }
  // Load-time half of the ephemeral rule (see isEphemeralPath): manifests
  // saved by older sessions can still list node_modules — never hydrate it.
  const dirs: string[] = (manifest.dirs ?? []).filter((p: string) => !isEphemeralPath(p));
  const symlinks: Array<[string, string]> = (manifest.symlinks ?? []).filter(
    ([p]: [string, string]) => !isEphemeralPath(p),
  );
  const files: Array<[string, Uint8Array]> = [];
  for (const p of manifest.files ?? []) {
    if (isEphemeralPath(p)) continue;
    try {
      const fh = await root.getFileHandle(opfsKey(p));
      const file = await fh.getFile();
      files.push([p, new Uint8Array(await file.arrayBuffer())]);
    } catch { /* missing file — skip */ }
  }
  return { dirs, files, symlinks };
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
}): Promise<void> {
  const t0 = performance.now();
  const marks: Record<string, number> = {};
  const lap = (key: string) => { marks[key] = Math.round(performance.now() - t0); };
  post({ type: 'boot-progress', phase: 'index', loaded: 0, total: 0 });

  // S3.1: the host embeds the runtime index in the boot message (it is
  // generated together with the blobs, so it cannot drift). Only fall back
  // to the network fetch when the host did not send one — this removes a
  // per-worker index.json round trip.
  let index: RuntimeIndex | null = msg.runtimeIndex ?? null;
  if (!index) {
    const indexRes = await fetch(`${RUNTIME_BASE}/index.json`, { cache: 'no-cache' });
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

  // Cross-reload persistence: with no host snapshot (fresh page load),
  // hydrate the VFS from OPFS once and report the tree to the host.
  let opfsTree: VfsTree | null = msg.hydrate ?? null;
  let hydratedFrom = msg.hydrate ? 'host-snapshot' : 'none';
  if (!opfsTree) {
    const loaded = await loadTreeFromOpfs();
    if (loaded && (loaded.files.length > 0 || loaded.dirs.length > 0)) {
      opfsTree = loaded;
      hydratedFrom = 'opfs';
      lap('opfsLoadMs');
    }
  }

  // Pid-scoped id bases keep kernel-assigned child pids/pipe ids/conn ids
  // unique across every process in the tree.
  const pid = msg.pid ?? 1;
  (globalThis as any).__ocPidBase = pid * 1000 + 1;
  (globalThis as any).__ocPipeIdBase = pid * 10000 + 1;
  (globalThis as any).__ocConnIdBase = pid * 100000 + 1;

  kernel = await bootKernel({
    store: makeLazyStore(),
    hydrate: opfsTree ?? undefined,
    pid,
    ppid: msg.ppid ?? 0,
    stdio: myStdio,
    cwd: msg.cwd,
    env: msg.env,
    argv: msg.argv,
    hooks: {
      // S3.1 Phase 6 — ESM graph transport: publish rewritten module texts
      // to the app-server endpoint (same origin), then let the engine fetch
      // `/oc-esm/<nonce>/<vfs-path>` while it links the guest's ESM graph.
      // (The bun harness uses an equivalent file:// transport.)
      esmServing: {
        async publish(nonce: string, entries: Map<string, string>): Promise<void> {
          const flat: [string, string][] = [];
          for (const [p, text] of entries) flat.push([p, text]);
          const res = await fetch('/oc-esm', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ nonce, entries: flat }),
          });
          if (!res.ok) {
            throw new Error(`OpenContainer: ESM graph publish failed (${res.status})`);
          }
        },
        prefix(nonce: string): string {
          return `/oc-esm/${nonce}`;
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
    if (index.npm && (needsPkg('npm') || needsPkg('npx'))) {
      const npmBuf = await loadBlob(index.npm, 'npm');
      const mounted = mountCliTree(npmBuf, '/usr/lib/node_modules/npm');
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
    // S3.1: only the OPFS-hydrating process (the keeper) reports the tree —
    // children previously echoed the 2+ MB host snapshot back to the host,
    // which ignored it (the host adopts only hydratedFrom==='opfs').
    vfsSnapshot: hydratedFrom === 'opfs' ? opfsTree : undefined,
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

(self as any).onmessage = async (ev: MessageEvent<RpcMsg>) => {
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
              (self as any).onmessage({ data: m } as MessageEvent<RpcMsg>);
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
        kernel.vfs.writeFile(msg.path ?? '/home/project/file.js', msg.content ?? '');
        post({ type: 'write-file-done', id: msg.id });
        break;
      }
      case 'persist-vfs': {
        await saveTreeToOpfs();
        post({ type: 'persist-vfs-done', id: msg.id });
        break;
      }

      // ---- IDE filesystem RPCs (served by whichever kernel receives them;
      // the host always targets the shell keeper, pid 1) --------------------
      // Uniform reply protocol: {type:'rpc-result', id, ok, result|err}. The
      // real VFS methods are used so watchers fire and OPFS deltas queue.
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
        // through the real methods so the persist hook queues OPFS deltas.
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
};
