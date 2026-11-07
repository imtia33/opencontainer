/**
 * OpenContainer Kernel — native-core bridge (Rust→WASM VFS data plane).
 *
 * Drop-in replacement for the JS VFS data plane (kernel/vfs.ts): every public
 * Vfs method is overridden and backed by the frozen v1 ABI of the Rust crate
 * at kernel/native-core (docs/native-core-spec.md). JS keeps what §6 of the
 * spec assigns to it — watchers, persist deltas, VfsError shaping — while the
 * inode tree, fd table, path resolution, file I/O and tar extraction live in
 * wasm, called synchronously through a flat C ABI.
 *
 * Construction / boot.ts integration recipe
 * -----------------------------------------
 *   import { NativeVfs } from './native-vfs';
 *
 *   // pkg/oc_core.wasm bytes (ArrayBuffer) or a precompiled WebAssembly.Module
 *   const wasmBytes: ArrayBuffer = ...;
 *   const vfs = new NativeVfs(wasmBytes);   // typeof Vfs → drop-in
 *   const kernel = await bootKernel({ ...opts, vfs });
 *
 *   // cwdProvider sync (REQUIRED — see the contract below): boot.ts assigns
 *   // `vfs.cwdProvider = () => currentCwd;` AFTER bootKernel created the base
 *   // dirs. The bridge intercepts that assignment and mirrors every change
 *   // into the wasm cwd (oc_chdir) LAZILY, on the next normalize() — the
 *   // provider is a LIVE closure over the process cwd (process.chdir mutates
 *   // `currentCwd` without re-assigning the field), so the sync re-checks the
 *   // provider's current value on every path resolution. Both views (JS
 *   // lexical prefix, Rust cwd for raw NativeSys paths) therefore agree.
 *
 * Memory discipline (§2 of the spec)
 * ----------------------------------
 * - Inbound path/data bytes are staged through the chunked bump arena
 *   (oc_arena_alloc + mem.set). Allocations never move, so multi-buffer
 *   staging (rename: old+new, write_file: path+data) is safe.
 * - oc_arena_reset() runs in a `finally` after EVERY syscall wrapper — one
 *   reset point, owned by this bridge.
 * - Outbound blobs (file reads, readdir lists, symlink targets, getcwd) come
 *   back as (ptr,len) in RET_SLOT and are only valid until the next oc_*
 *   call. Vfs-level methods always COPY them out; NativeSys.read()/fstat()/
 *   statRaw() deliberately return VIEWS (the fs.ts refactor copies) — each is
 *   marked with a ⚠️ below.
 * - The whole-memory views (mem/dv/statView) are re-derived whenever
 *   `mem.buffer !== memory.buffer` (growth detaches the old buffer). Every
 *   wrapper re-checks BEFORE staging (the previous call may have grown) and
 *   the core re-checks AFTER each call returns.
 *
 * Times: the wasm core owns atime/mtime/ctime/birthtime (its own clock; the
 * `now` constructor parameter is kept only for Vfs signature compatibility —
 * the super-constructor's root node is dead weight and never consulted).
 *
 * Error mapping: every oc_* rc < 0 becomes a VfsError with the SAME errno
 * numbering errnoOf() uses (a reverse table verified against errnoOf at module
 * load), the wrapper's syscall name, and the ORIGINAL path argument — exactly
 * the shape vfs.ts threw, so fs.ts's dual()/syncError/uvCode keep working.
 */

import { Vfs, VfsError, errnoOf } from './vfs';
import type { StatFields, VfsWatcher, VfsPersistOp, VfsTree } from './vfs';

// ---------------------------------------------------------------------------
// errno reverse table (errno number → code string)
// ---------------------------------------------------------------------------

/** EXACT copy of errnoOf's table in vfs.ts (Linux numbers). The module-load
 *  integrity check below throws if the two tables ever drift. */
const ERRNO_TABLE: Record<string, number> = {
  EPERM: 1, ENOENT: 2, ESRCH: 3, EINTR: 4, EIO: 5, ENXIO: 6, E2BIG: 7,
  ENOEXEC: 8, EBADF: 9, ECHILD: 10, EAGAIN: 11, ENOMEM: 12, EACCES: 13,
  EFAULT: 14, EBUSY: 16, EEXIST: 17, EXDEV: 18, ENODEV: 19, ENOTDIR: 20,
  EISDIR: 21, EINVAL: 22, ENFILE: 23, EMFILE: 24, ENOTTY: 25, EFBIG: 27,
  ENOSPC: 28, ESPIPE: 29, EROFS: 30, EMLINK: 31, EPIPE: 32, ENAMETOOLONG: 36,
  ENOSYS: 38, ENOTEMPTY: 39, ELOOP: 40, ENODATA: 61, ENOTSOCK: 88,
  EDESTADDRREQ: 89, EMSGSIZE: 90, EPROTOTYPE: 91, ENOPROTOOPT: 92,
  EPROTONOSUPPORT: 93, EOPNOTSUPP: 95, EAFNOSUPPORT: 97, EADDRINUSE: 98,
  EADDRNOTAVAIL: 99, ENETDOWN: 100, ENETUNREACH: 101, ECONNABORTED: 103,
  ECONNRESET: 104, ENOBUFS: 105, EISCONN: 106, ENOTCONN: 107, ETIMEDOUT: 110,
  ECONNREFUSED: 111, EHOSTUNREACH: 113, EINPROGRESS: 115,
};

const ERRNO_TO_CODE = new Map<number, string>();
for (const code of Object.keys(ERRNO_TABLE)) ERRNO_TO_CODE.set(ERRNO_TABLE[code], code);
// Integrity: this bridge must round-trip exactly what errnoOf() maps.
for (const code of Object.keys(ERRNO_TABLE)) {
  if (errnoOf(code) !== ERRNO_TABLE[code]) {
    throw new Error(`native-vfs: errno table drift at ${code} — sync ERRNO_TABLE with vfs.ts`);
  }
}

/** Map a negative oc_* return to a thrown VfsError (same errno numbering the
 *  JS VFS used, so fs.ts's errnoOf(e.code) round-trips identically). */
function throwErrno(errno: number, syscall: string, path: string): never {
  const code = ERRNO_TO_CODE.get(errno);
  if (code === undefined) {
    throw new Error(`native-core: unknown errno ${errno} from ${syscall} (${path})`);
  }
  throw new VfsError(code, errno, syscall, path);
}

// ---------------------------------------------------------------------------
// constants / small helpers
// ---------------------------------------------------------------------------

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

const ENC = new TextEncoder();
const DEC = new TextDecoder();

/** parent dir of an ALREADY-NORMALIZED absolute path (pure string math —
 *  matches Vfs.dirname on normalized input, without a second normalize). */
function parentOf(norm: string): string {
  let p = norm;
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (p === '/') return '/';
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

/** final component of an ALREADY-NORMALIZED absolute path (Vfs.basename on
 *  normalized input). */
function baseOf(norm: string): string {
  let p = norm;
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (p === '/') return '/';
  return p.slice(p.lastIndexOf('/') + 1);
}

// ---------------------------------------------------------------------------
// Core — wasm instantiation + memory discipline (module-internal)
// ---------------------------------------------------------------------------

interface WasmImportDescriptor { module: string; name: string; kind: string }

/** Conventional host-clock import names (the wasm32-unknown-unknown target
 *  has no clock — if the core asks the host for time, give it Date.now()).
 *  The frozen spec v1 declares no imports; this is purely defensive. */
const KNOWN_TIME_IMPORTS = /^(oc_)?(now_ms|now|time_ms|time|clock_ms|clock|date_now|ms)$/i;

class Core {
  readonly memory: WebAssembly.Memory;
  readonly exports: Record<string, any>;
  /** STAT_SLOT address (static for the module lifetime — §2). */
  readonly statSlot: number;
  /** RET_SLOT address (8 bytes: ptr u32, len u32, little-endian). */
  readonly retSlot: number;

  /** Whole-memory views — INVALIDATED by memory growth; re-derived via
   *  touch(). @internal to this module. (Assigned in recache(), called from
   *  the constructor — definite-assignment asserted.) */
  mem!: Uint8Array;
  dv!: DataView;
  statView!: Float64Array;

  /** The cwd currently installed in the wasm core (owned HERE so that
   *  NativeSys.chdir and NativeVfs's lazy cwdProvider sync agree on one
   *  cache; getcwd() initializes it at construction). */
  lastCwd: string;

  /** Optional pre-syscall hook. NativeVfs installs syncWasmCwd here so the
   * wasm cwd is current for EVERY syscall (a raw sys.open('relative')
   * after process.chdir must resolve against the NEW cwd even when no
   * normalize() ran in between). Reentrancy-safe: syncWasmCwd's own
   * oc_chdir re-enters run(), where the hook no-ops on unchanged cwd. */
  beforeRun?: () => void;

  constructor(wasm: ArrayBuffer | WebAssembly.Module) {
    // Synchronous compile — the kernel runs in a worker (no main-thread 4KB
    // limit), and the whole bridge is a synchronous drop-in for Vfs.
    const mod = wasm instanceof WebAssembly.Module ? wasm : new WebAssembly.Module(wasm);
    const imports = WebAssembly.Module.imports(mod) as WasmImportDescriptor[];

    // Build the import object defensively. Two module shapes are supported:
    //   (a) the module EXPORTS its own memory ("memory" export) — the common
    //       Rust cdylib shape; the bridge reads it off instance.exports;
    //   (b) the module IMPORTS linear memory — the bridge creates the
    //       WebAssembly.Memory itself, passes it in, and keeps the reference.
    // Plus the possible NATIVE-A amendment `oc_mem_size` (module "e"): with
    // an imported memory the Rust side cannot query the buffer size, so the
    // host provides () => byteLength. It binds late (memory is only known
    // after instantiation in shape (a)).
    const importObject: Record<string, Record<string, any>> = {};
    const memBox: { m: WebAssembly.Memory | null } = { m: null };
    let memory: WebAssembly.Memory | undefined;
    const unmet: string[] = [];
    for (const imp of imports) {
      const ns = (importObject[imp.module] ??= {});
      if (Object.prototype.hasOwnProperty.call(ns, imp.name)) continue;
      if (imp.kind === 'memory') {
        if (!memory) memory = new WebAssembly.Memory({ initial: 16 }); // 1 MiB
        ns[imp.name] = memory;
      } else if (imp.kind === 'function') {
        if (imp.name === 'oc_mem_size') {
          ns.oc_mem_size = () => (memBox.m ? memBox.m.buffer.byteLength : 0);
        } else if (KNOWN_TIME_IMPORTS.test(imp.name)) {
          ns[imp.name] = () => Date.now();
        } else {
          unmet.push(`${imp.module}.${imp.name} (${imp.kind})`);
        }
      } else {
        unmet.push(`${imp.module}.${imp.name} (${imp.kind})`);
      }
    }
    if (unmet.length > 0) {
      throw new Error(
        `native-core: module imports unsupported symbol(s): ${unmet.join(', ')} — ` +
        `the bridge provides oc_mem_size and Date.now()-style time imports; ` +
        `add the symbol to the import object in kernel/native-vfs.ts.`);
    }

    const instance = new WebAssembly.Instance(mod, importObject);
    const ex = instance.exports as Record<string, any>;
    const exportedMemory = ex.memory as WebAssembly.Memory | undefined;
    this.memory = memory ?? exportedMemory!;
    if (!this.memory) {
      throw new Error('native-core: module neither exports nor imports linear memory');
    }
    memBox.m = this.memory;

    // Slot discovery (§2 — addresses are static for the module lifetime).
    const version: number = ex.oc_version();
    if (version !== 1) {
      throw new Error(`native-core: ABI version ${version} is not supported (frozen contract v1)`);
    }
    this.statSlot = ex.oc_stat_slot() >>> 0;
    this.retSlot = ex.oc_ret_slot() >>> 0;
    this.exports = ex;
    this.recache();
    this.lastCwd = this.getcwdInternal();
  }

  private recache(): void {
    const buf = this.memory.buffer;
    this.mem = new Uint8Array(buf);
    this.dv = new DataView(buf);
    this.statView = new Float64Array(buf, this.statSlot, 18);
  }

  /** Re-derive the cached views when memory grew (the old buffer detached). */
  touch(): void {
    if (this.mem.buffer !== this.memory.buffer) this.recache();
  }

  /** Stage bytes into the inbound bump arena. Allocations never move, so
   *  multiple live stagings are safe. Zero-length needs no allocation. */
  stage(bytes: Uint8Array): number {
    const n = bytes.byteLength;
    if (n === 0) return 0;
    const ptr = (this.exports.oc_arena_alloc(n) as number) >>> 0;
    if (ptr === 0) {
      throw new Error(`native-core: arena OOM (oc_arena_alloc(${n}) returned 0)`);
    }
    this.touch(); // the chunk allocation may have grown memory
    this.mem.set(bytes, ptr);
    return ptr;
  }

  /** Run ONE oc_* syscall: re-derive views around the call (growth), map a
   *  negative rc to a thrown VfsError, and ALWAYS reset the inbound arena
   *  afterwards (single reset point — the bridge owns that discipline). */
  run(syscall: string, errPath: string, fn: () => number): number {
    try {
      if (this.beforeRun) this.beforeRun();
      this.touch();
      const rc = fn();
      this.touch(); // the call itself may have grown memory (file writes)
      if (rc < 0) throwErrno(-rc, syscall, errPath);
      return rc;
    } finally {
      this.exports.oc_arena_reset();
    }
  }

  /** Like run() but returns the raw rc (no VfsError) — for existence/mode
   *  probes that treat failures as "missing". */
  tryRun(fn: () => number): number {
    try {
      if (this.beforeRun) this.beforeRun();
      this.touch();
      const rc = fn();
      this.touch();
      return rc;
    } finally {
      this.exports.oc_arena_reset();
    }
  }

  /** ⚠️ VIEW into the out buffer over the RET_SLOT blob — valid until the
   *  next oc_* call (oc_arena_reset does NOT touch the out buffer; only
   *  producing calls overwrite it). Copy if it must survive. */
  retView(): Uint8Array {
    const ptr = this.dv.getUint32(this.retSlot, true);
    const len = this.dv.getUint32(this.retSlot + 4, true);
    return this.mem.subarray(ptr, ptr + len);
  }

  retCopy(): Uint8Array {
    return new Uint8Array(this.retView());
  }

  retString(): string {
    return DEC.decode(this.retView());
  }

  // -- staging + call combinators (arena reset always via run/tryRun) ------

  /** Stage one path, run fn(ptr, len). `abs` is what wasm sees (callers pass
   *  already-normalized absolute paths); `errPath` is the ORIGINAL argument
   *  for VfsError parity with vfs.ts. */
  withPath(abs: string, syscall: string, errPath: string,
           fn: (ptr: number, len: number) => number): number {
    const b = ENC.encode(abs);
    const ptr = this.stage(b);
    return this.run(syscall, errPath, () => fn(ptr, b.byteLength));
  }

  /** Stage two paths (rename/symlink/copy — order preserved in fn). */
  withPaths(a: string, b: string, syscall: string, errPath: string,
            fn: (ap: number, al: number, bp: number, bl: number) => number): number {
    const ab = ENC.encode(a);
    const bb = ENC.encode(b);
    const ap = this.stage(ab);
    const bp = this.stage(bb);
    return this.run(syscall, errPath, () => fn(ap, ab.byteLength, bp, bb.byteLength));
  }

  /** Stage a path + a data buffer (write_file / append_file shape). */
  withPathBytes(abs: string, data: Uint8Array, syscall: string, errPath: string,
                fn: (pp: number, pl: number, dp: number, dl: number) => number): number {
    const pb = ENC.encode(abs);
    const pp = this.stage(pb);
    const dp = this.stage(data);
    return this.run(syscall, errPath, () => fn(pp, pb.byteLength, dp, data.byteLength));
  }

  private getcwdInternal(): string {
    this.run('getcwd', '', () => this.exports.oc_getcwd());
    return this.retString();
  }
}

// ---------------------------------------------------------------------------
// NativeSys — raw syscall layer (the natives/fs.ts refactor surface)
// ---------------------------------------------------------------------------

/**
 * The raw fd/path syscall layer over one wasm core instance. This is the
 * surface the later natives/fs.ts refactor binds to (replacing its JS fd
 * table + read-modify-write writeFile loops with real open(2)/read(2)/
 * write(2) semantics). The Vfs-level bridge (NativeVfs) is a thin, exact-
 * semantics layer on top of the same primitives.
 *
 * Construct standalone (`new NativeSys(bytes)`) or reach the instance SHARED
 * with a NativeVfs via `nativeVfs.sys` (one wasm tree, both surfaces).
 *
 * ⚠️ VIEW RULE: read()/fstat()/statRaw() return views into wasm linear
 * memory (out-buffer / STAT_SLOT). They are valid only until the NEXT
 * oc_* call — copy (`.slice()` / `new Float64Array(v)`) before any further
 * syscall. The Vfs-level NativeVfs methods already do this internally.
 *
 * Flags are LINUX numeric values (what node/libuv pass through):
 * O_RDONLY=0 O_WRONLY=1 O_RDWR=2 O_CREAT=64 O_EXCL=128 O_TRUNC=512
 * O_APPEND=1024.
 */
export class NativeSys {
  /** @internal shared wasm core (the same instance the owning NativeVfs
   *  uses, when constructed via NativeVfs). */
  readonly core: Core;

  constructor(wasm: ArrayBuffer | WebAssembly.Module, sharedCore?: unknown) {
    this.core = sharedCore instanceof Core ? sharedCore : new Core(wasm);
  }

  /** ABI version of the loaded core (frozen contract: 1). */
  version(): number {
    return this.core.exports.oc_version();
  }

  /** open(2): returns a fd (≥ 3; the table starts past stdio). Full POSIX
   *  flag semantics per §3 of the spec (parent symlink walk, O_CREAT|O_EXCL
   *  → EEXIST, O_TRUNC empties NOW, O_APPEND appends, dirs open read-only).
   *  mode defaults to 0o666 when 0. Throws VfsError on failure. */
  open(path: string, flags: number, mode = 0): number {
    return this.core.withPath(path, 'open', path, (ptr, len) =>
      this.core.exports.oc_open(ptr, len, flags, mode));
  }

  /** close(2). EBADF on an unknown fd. */
  close(fd: number): void {
    this.core.run('close', String(fd), () => this.core.exports.oc_close(fd));
  }

  /** read(2)/pread(2). With `position` → pread (NEVER moves the fd offset);
   *  without (undefined/null/-1) → read at the fd's current position,
   *  advancing it. Short read at EOF.
   *  ⚠️ Returns a VIEW into the wasm out-buffer — COPY BEFORE THE NEXT
   *  SYSCALL; the next oc_* call may overwrite (or detach) that memory. */
  read(fd: number, length: number, position?: number | null): Uint8Array {
    const core = this.core;
    const advance = position === undefined || position === null || position === -1;
    core.run('read', String(fd), () =>
      advance
        ? core.exports.oc_read(fd, length)
        : core.exports.oc_pread(fd, length, BigInt(Math.trunc(position))));
    return core.retView();
  }

  /** write(2)/pwrite(2). With `position` → pwrite (never moves the fd
   *  offset); without → write at the fd position (O_APPEND: at end),
   *  advancing it. Returns the byte count written. */
  write(fd: number, data: Uint8Array, position?: number | null): number {
    const core = this.core;
    const ptr = core.stage(data);
    const advance = position === undefined || position === null || position === -1;
    return core.run('write', String(fd), () =>
      advance
        ? core.exports.oc_write(fd, ptr, data.byteLength)
        : core.exports.oc_pwrite(fd, ptr, data.byteLength, BigInt(Math.trunc(position))));
  }

  /** ftruncate(2). */
  ftruncate(fd: number, len: number): void {
    this.core.run('ftruncate', String(fd), () =>
      this.core.exports.oc_ftruncate(fd, BigInt(Math.trunc(len))));
  }

  /** fstat(2).
   *  ⚠️ Returns a VIEW over STAT_SLOT (18 f64s, positional node stat) —
   *  COPY BEFORE THE NEXT SYSCALL. */
  fstat(fd: number): Float64Array {
    this.core.run('fstat', String(fd), () => this.core.exports.oc_fstat(fd));
    return this.core.statView;
  }

  /** fchmod(2). */
  fchmod(fd: number, mode: number): void {
    this.core.run('fchmod', String(fd), () => this.core.exports.oc_fchmod(fd, mode));
  }

  /** chdir(2) — moves the WASM cwd (the single source of truth for relative
   *  paths when no JS cwdProvider is installed; NativeVfs.normalize lazily
   *  mirrors a cwdProvider into it). ENOENT/ENOTDIR on failure. */
  chdir(path: string): void {
    this.core.withPath(path, 'chdir', path, (ptr, len) =>
      this.core.exports.oc_chdir(ptr, len));
    this.core.lastCwd = this.getcwd();
  }

  /** getcwd(3) — the wasm core's current working directory. */
  getcwd(): string {
    this.core.run('getcwd', '', () => this.core.exports.oc_getcwd());
    return this.core.retString();
  }

  /** Positional node stat — the exact array internalBinding('fs') hands to
   *  lib/internal/fs/utils.js getStatsFromBinding:
   *  [dev, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks,
   *   atimeS, atimeNs, mtimeS, mtimeNs, ctimeS, ctimeNs, birthtimeS,
   *   birthtimeNs].
   *  ⚠️ bigint:false → VIEW over STAT_SLOT (copy before the next syscall);
   *  bigint:true → BigInt64Array COPY (the f64 slot cannot be viewed). */
  statRaw(path: string, opts: { follow?: boolean; bigint?: boolean } = {}): Float64Array | BigInt64Array {
    const follow = opts.follow !== false;
    const core = this.core;
    core.withPath(path, follow ? 'stat' : 'lstat', path, (ptr, len) =>
      follow ? core.exports.oc_stat(ptr, len) : core.exports.oc_lstat(ptr, len));
    if (opts.bigint) {
      const out = new BigInt64Array(18);
      for (let i = 0; i < 18; i++) out[i] = BigInt(core.statView[i]);
      return out;
    }
    return core.statView;
  }

  /** Extract a ustar/pax/GNU tar image into destDir (must exist). Returns
   *  the number of entries extracted; EINVAL for entries whose joined path
   *  escapes destDir via '..' (no partial write of that entry). */
  extractTar(bytes: Uint8Array, destDir: string): number {
    const core = this.core;
    const dp = core.stage(bytes);
    const db = ENC.encode(destDir);
    const pp = core.stage(db);
    return core.run('extractTar', destDir, () =>
      core.exports.oc_extract_tar(dp, bytes.byteLength, pp, db.byteLength));
  }

  /** Debug counters from the core (oc_debug_counts). */
  debugCounts(): { inodes: number; files: number; dirs: number; fds: number } {
    const core = this.core;
    core.run('debug_counts', '', () => core.exports.oc_debug_counts());
    const ptr = core.dv.getUint32(core.retSlot, true);
    const u = (i: number) => core.dv.getUint32(ptr + i * 4, true);
    return { inodes: u(0), files: u(1), dirs: u(2), fds: u(3) };
  }
}

// ---------------------------------------------------------------------------
// NativeVfs — the drop-in Vfs surface over the wasm core
// ---------------------------------------------------------------------------

/**
 * Rust→WASM-backed drop-in for kernel/vfs.ts's `Vfs`. Extends Vfs so
 * `instanceof Vfs`, every type annotation (NativesContext.vfs, BootOptions)
 * and the post-construction field assignments (`persist`, `cwdProvider`)
 * keep working unchanged. The super-constructor's root node is unused dead
 * weight — all data plane calls go to the wasm core.
 */
export class NativeVfs extends Vfs {
  /** The raw syscall layer over the SAME wasm instance (one tree, both
   *  surfaces) — what the later natives/fs.ts refactor binds to. */
  readonly sys: NativeSys;

  /** @internal */ private readonly core: Core;
  /** Registered watchers, keyed by the dir's CANONICAL path (symlinks
   *  resolved — see canonicalizeDir). Named differently from the base
   *  class's private `watchersByDir` (node-keyed, unusable here). */
  /** @internal */ private readonly dirWatchers = new Map<string, Set<VfsWatcher>>();
  /** @internal */ private cwdProviderStore: (() => string) | undefined;

  constructor(wasm: ArrayBuffer | WebAssembly.Module, now: () => number = () => Date.now()) {
    super(now); // the JS root node is dead weight; the wasm core owns the tree
    const core = new Core(wasm);
    this.core = core;
    this.sys = new NativeSys(wasm, core);
    // EVERY syscall re-checks the live cwdProvider and mirrors it into the
    // wasm cwd (see syncWasmCwd — the fs.ts native path passes raw relative
    // paths straight to sys.open/read/write, so the wasm cwd must be
    // current even without an intervening normalize()).
    core.beforeRun = () => this.syncWasmCwd();
    // Intercept post-construction `vfs.cwdProvider = ...` (boot.ts does
    // exactly this) so the live provider value can be mirrored into the wasm
    // cwd lazily — see syncWasmCwd(). A plain field can't observe writes.
    Object.defineProperty(this, 'cwdProvider', {
      get: () => this.cwdProviderStore,
      set: (v: (() => string) | undefined) => { this.cwdProviderStore = v; },
      enumerable: true,
      configurable: true,
    });
  }

  // -- cwd sync -------------------------------------------------------------

  /** @internal */ private syncingCwd = false;

  /** Mirror cwdProvider()'s LIVE value into the wasm cwd (best-effort: a
   *   missing dir keeps the previous wasm cwd — Vfs.normalize is purely
   *   lexical and does not care; the sync exists so raw NativeSys paths and
   *   oc_normalize agree with the JS view). Re-checked on EVERY syscall
   *   (Core.beforeRun) because the provider is a closure over a mutable
   *   process cwd. The syncingCwd guard breaks the reentrancy loop
   *   (sync → oc_chdir → run() → beforeRun → sync). */
  private syncWasmCwd(): void {
    if (this.syncingCwd) return;
    const prov = this.cwdProviderStore;
    if (!prov) return;
    let cwd: string;
    try { cwd = prov(); } catch { return; }
    if (typeof cwd !== 'string' || cwd === '' || cwd === this.core.lastCwd) return;
    const core = this.core;
    this.syncingCwd = true;
    try {
      core.withPath(cwd, 'chdir', cwd, (ptr, len) => core.exports.oc_chdir(ptr, len));
      core.lastCwd = cwd;
    } catch { /* missing dir — keep the previous wasm cwd, retry next time */ }
    finally { this.syncingCwd = false; }
  }

  // -- path utilities ---------------------------------------------------------

  normalize(p: string): string {
    if (p === '') {
      throw new VfsError('ERR_INVALID_ARG_VALUE' as string, 22, 'normalize', p,
        'The "path" argument must not be empty');
    }
    const core = this.core;
    if (p.startsWith('/')) {
      core.withPath(p, 'normalize', p, (ptr, len) => core.exports.oc_normalize(ptr, len));
      return core.retString();
    }
    const prov = this.cwdProviderStore;
    if (!prov) {
      // No JS provider: the WASM cwd is the single source of truth (kept
      // current via NativeSys.chdir) — Rust resolves the relative path.
      core.withPath(p, 'normalize', p, (ptr, len) => core.exports.oc_normalize(ptr, len));
      return core.retString();
    }
    // Provider installed: resolve EXACTLY like vfs.ts (lexical prefix with
    // the LIVE provider value), then keep the wasm cwd in sync so raw
    // NativeSys relative paths agree with this view.
    let base = '/';
    try {
      const b = prov();
      if (typeof b === 'string' && b !== '') base = b;
    } catch { /* keep '/' */ }
    this.syncWasmCwd();
    const abs = `${base.replace(/\/+$/, '')}/${p}`;
    core.withPath(abs, 'normalize', p, (ptr, len) => core.exports.oc_normalize(ptr, len));
    return core.retString();
  }

  joinPaths(a: string, b: string): string {
    // Identical algorithm to vfs.ts (byte-for-byte results), with the wasm
    // oc_normalize underneath — oc_join_normalize exists in the ABI but its
    // "rel absolute → itself" wording does not pin down re-normalization of
    // an absolute `b` ('/a/../b'), so the bridge composes the two primitives
    // it can hold to the exact vfs.ts contract.
    if (b.startsWith('/')) return this.normalize(b);
    return this.normalize(a.replace(/\/+$/, '') + '/' + b);
  }

  dirname(p: string): string {
    const norm = this.normalize(p);
    if (norm === '/') return '/';
    const segs = norm.split('/').filter(Boolean);
    segs.pop();
    return segs.length ? '/' + segs.join('/') : '/';
  }

  basename(p: string): string {
    const segs = this.normalize(p).split('/').filter(Boolean);
    return segs.length ? segs[segs.length - 1] : '/';
  }

  /** Not supported: the wasm core has no JS-side VNode objects. vfs.ts only
   *  ever called this from its own internal lookup(); no external consumer
   *  exists (kept for signature parity — it throws loudly if reached). */
  pathOf(_node: unknown): string {
    throw new Error('NativeVfs.pathOf() is not supported: the wasm core has no VNode objects');
  }

  // -- internal probes (already-normalized absolute paths, no VfsError) ------

  /** Mode of a path (S_IFMT bits included) or null when missing. `follow`
   *  selects stat vs lstat semantics. The mode is extracted from STAT_SLOT
   *  immediately (the view is only valid until the next syscall). */
  private modeOf(norm: string, follow: boolean): number | null {
    const core = this.core;
    const b = ENC.encode(norm);
    const ptr = core.stage(b);
    const rc = core.tryRun(() =>
      follow
        ? core.exports.oc_stat(ptr, b.byteLength)
        : core.exports.oc_lstat(ptr, b.byteLength));
    return rc === 0 ? core.statView[1] : null;
  }

  /** STAT_SLOT (18 f64s) → the named StatFields object fs.ts consumes.
   *  Copies every field out immediately (views do not survive syscalls). */
  private statFieldsFromSlot(): StatFields {
    const v = this.core.statView;
    const ms = (i: number) => v[i] * 1000 + v[i + 1] / 1e6; // (sec, ns) pairs
    return {
      dev: v[0],
      ino: v[7],
      mode: v[1],
      nlink: v[2],
      uid: v[3],
      gid: v[4],
      rdev: v[5],
      size: v[8],
      blksize: v[6],
      blocks: v[9],
      atimeMs: ms(10),
      mtimeMs: ms(12),
      ctimeMs: ms(14),
      birthtimeMs: ms(16),
    };
  }

  // -- stat family -------------------------------------------------------------

  stat(p: string, followSymlinks = true): StatFields {
    const norm = this.normalize(p);
    const core = this.core;
    core.withPath(norm, followSymlinks ? 'stat' : 'lstat', p, (ptr, len) =>
      followSymlinks ? core.exports.oc_stat(ptr, len) : core.exports.oc_lstat(ptr, len));
    return this.statFieldsFromSlot();
  }

  lstat(p: string): StatFields {
    return this.stat(p, false);
  }

  exists(p: string): boolean {
    try {
      const norm = this.normalize(p);
      return this.core.withPath(norm, 'exists', p, (ptr, len) =>
        this.core.exports.oc_exists(ptr, len)) === 1;
    } catch { return false; }
  }

  isDirectory(p: string): boolean {
    try {
      const norm = this.normalize(p);
      const mode = this.modeOf(norm, true);
      return mode !== null && (mode & S_IFMT) === S_IFDIR;
    } catch { return false; }
  }

  // -- directories -------------------------------------------------------------

  mkdir(p: string, recursive = false, mode = 0o777): string | null {
    const norm = this.normalize(p);
    const core = this.core;
    if (norm === '/') {
      if (recursive) return null;
      throw new VfsError('EEXIST', errnoOf('EEXIST'), 'mkdir', p);
    }
    // vfs.ts's `existing` check — lookup(norm) FOLLOWS symlinks.
    const entryMode = this.modeOf(norm, false);
    if (entryMode !== null) {
      const followMode = this.modeOf(norm, true);
      if (followMode === null) {
        // Dangling symlink at the target: vfs.ts's walk lands on the link
        // and throws ENOTDIR (it never reaches the EEXIST branch).
        throw new VfsError('ENOTDIR', errnoOf('ENOTDIR'), 'mkdir', p);
      }
      // vfs.ts: existing (follow) → recursive && dir ? null : EEXIST.
      if ((followMode & S_IFMT) === S_IFDIR && recursive) return null;
      throw new VfsError('EEXIST', errnoOf('EEXIST'), 'mkdir', p);
    }
    // Non-recursive: the parent must exist and be a dir (following symlinks)
    // — ENOENT otherwise (vfs.ts checks the parent BEFORE creating).
    if (!recursive) {
      const parentMode = this.modeOf(parentOf(norm), true);
      if (parentMode === null || (parentMode & S_IFMT) !== S_IFDIR) {
        throw new VfsError('ENOENT', errnoOf('ENOENT'), 'mkdir', p);
      }
    }
    // Walk the segments exactly like vfs.ts: create missing levels with
    // oc_mkdir (same mode for every level), fire rename on each created
    // level's parent, pass through symlinked intermediates (into the target).
    const segs = norm.split('/').filter(Boolean);
    let cur = '/';
    let createdAny = false;
    for (let i = 0; i < segs.length; i++) {
      const path = cur === '/' ? '/' + segs[i] : cur + '/' + segs[i];
      let m = this.modeOf(path, false);
      if (m === null) {
        core.withPath(path, 'mkdir', p, (ptr, len) =>
          core.exports.oc_mkdir(ptr, len, mode & 0o777));
        this.emitRenameAt(cur);
        createdAny = true;
        cur = path;
        continue;
      }
      if ((m & S_IFMT) === S_IFLNK) {
        m = this.modeOf(path, true);
        if (m === null) {
          // dangling symlink mid-path — vfs.ts's walk lands on the link
          throw new VfsError('ENOTDIR', errnoOf('ENOTDIR'), 'mkdir', p);
        }
      }
      if ((m & S_IFMT) !== S_IFDIR) {
        throw new VfsError('ENOTDIR', errnoOf('ENOTDIR'), 'mkdir', p);
      }
      cur = path;
    }
    if (createdAny) this.persist?.({ type: 'mkdir', path: norm });
    return norm;
  }

  readdir(p: string): string[] {
    const norm = this.normalize(p);
    const core = this.core;
    core.withPath(norm, 'readdir', p, (ptr, len) => core.exports.oc_readdir(ptr, len));
    // NUL-separated names in INSERTION order (npm test suites compare
    // listings — the order is part of the contract).
    const view = core.retView();
    if (view.byteLength === 0) return [];
    return DEC.decode(view).split('\0').filter((s) => s !== '');
  }

  dirents(p: string): Array<{ name: string; type: number }> {
    const norm = this.normalize(p);
    const core = this.core;
    core.withPath(norm, 'readdir', p, (ptr, len) => core.exports.oc_dirents(ptr, len));
    const v = core.retView();
    const out: Array<{ name: string; type: number }> = [];
    let i = 0;
    while (i < v.byteLength) {
      let j = i;
      while (j < v.byteLength && v[j] !== 0) j++;
      if (j >= v.byteLength) break; // malformed tail — defensive
      const name = DEC.decode(v.subarray(i, j));
      const code = v[j + 1]; // S_IFMT >> 12: 8=file 4=dir 10=symlink
      out.push({ name, type: (code << 12) & S_IFMT });
      i = j + 2;
    }
    return out;
  }

  // -- file contents -------------------------------------------------------------

  readFile(p: string): Uint8Array {
    const norm = this.normalize(p);
    const core = this.core;
    core.withPath(norm, 'readFile', p, (ptr, len) => core.exports.oc_read_file(ptr, len));
    return core.retCopy(); // vfs.ts returns a fresh copy every call
  }

  readTextFile(p: string): string {
    return DEC.decode(this.readFile(p));
  }

  /** `owned` is irrelevant for the wasm core (data is staged through the
   *  arena — a copy either way); kept for signature compatibility. */
  writeFile(p: string, data: Uint8Array | string, mode = 0o666, owned = false): void {
    const isString = typeof data === 'string';
    const bytes = isString ? ENC.encode(data) : data;
    const norm = this.normalize(p);
    const core = this.core;
    // Final-component branch (NO follow) exactly like vfs.ts.
    const entryMode = this.modeOf(norm, false);
    if (entryMode !== null) {
      const t = entryMode & S_IFMT;
      if (t === S_IFDIR) {
        throw new VfsError('EISDIR', errnoOf('EISDIR'), 'open', p);
      }
      if (t === S_IFLNK) {
        // write THROUGH the link onto its target (parent-join rule) — the
        // recursion re-normalizes and persists the RESOLVED path, exactly
        // like vfs.ts's recursive call.
        const target = this.readlinkOf(norm);
        const resolved = this.joinPaths(parentOf(norm), target);
        this.writeFile(resolved, bytes, mode, owned || isString);
        return;
      }
    }
    // Parent must exist and be a dir (following symlinks) — ENOENT with
    // syscall 'open' (vfs.ts's writeFile maps missing parents onto open).
    const parentMode = this.modeOf(parentOf(norm), true);
    if (parentMode === null || (parentMode & S_IFMT) !== S_IFDIR) {
      throw new VfsError('ENOENT', errnoOf('ENOENT'), 'open', p);
    }
    core.withPathBytes(norm, bytes, 'open', p, (pp, pl, dp, dl) =>
      core.exports.oc_write_file(pp, pl, dp, dl, mode & 0o777));
    // Events: created → rename on the parent; overwritten → change on the
    // basename. Persist carries the data PASSED IN (never read back).
    if (entryMode !== null) this.emitChangeAt(parentOf(norm), baseOf(norm));
    else this.emitRenameAt(parentOf(norm));
    this.persist?.({ type: 'write', path: norm, data: bytes });
  }

  appendFile(p: string, data: Uint8Array | string): void {
    // Composed exactly like vfs.ts so the persist op carries the MERGED
    // content (worker deltas are whole-file writes).
    const existing = this.exists(p) ? this.readFile(p) : new Uint8Array(0);
    const add = typeof data === 'string' ? ENC.encode(data) : data;
    const merged = new Uint8Array(existing.byteLength + add.byteLength);
    merged.set(existing);
    merged.set(add, existing.byteLength);
    this.writeFile(p, merged, 0o666, true);
  }

  copyFile(src: string, dest: string): void {
    // vfs.ts composes readFile+writeFile — that keeps the persist op, the
    // through-symlink-dest behavior and the error precedence identical.
    this.writeFile(dest, this.readFile(src));
  }

  // -- mutations -------------------------------------------------------------

  rm(p: string, opts: { recursive?: boolean; force?: boolean } = {}): void {
    const norm = this.normalize(p);
    const core = this.core;
    if (norm === '/') {
      // vfs.ts quirk (kept): rm('/') deletes nothing (root is not a child of
      // itself) but still fires root watchers and persists the unlink.
      if (!opts.recursive && this.readdir('/').length > 0) {
        throw new VfsError('ENOTEMPTY', errnoOf('ENOTEMPTY'), 'rm', p);
      }
      this.emitRenameAt('/');
      this.persist?.({ type: 'unlink', path: '/' });
      return;
    }
    const entryMode = this.modeOf(norm, false); // NO follow — a symlink is
    // removed as a link, never its target (vfs.ts looks up with followLast
    // = false).
    if (entryMode === null) {
      if (opts.force) return;
      throw new VfsError('ENOENT', errnoOf('ENOENT'), 'rm', p);
    }
    const force = opts.force ? 1 : 0;
    if (opts.recursive) {
      core.withPath(norm, 'rm', p, (ptr, len) => core.exports.oc_rmrf(ptr, len, force));
    } else {
      // ENOTEMPTY for a non-empty dir, unlink for files/symlinks/empty dirs.
      core.withPath(norm, 'rm', p, (ptr, len) =>
        core.exports.oc_rm_nonrecursive(ptr, len, force));
    }
    this.emitRenameAt(parentOf(norm));
    this.persist?.({ type: 'unlink', path: norm });
  }

  rename(oldPath: string, newPath: string): void {
    const a = this.normalize(oldPath);
    const b = this.normalize(newPath);
    const core = this.core;
    if (this.modeOf(a, false) === null) {
      throw new VfsError('ENOENT', errnoOf('ENOENT'), 'rename', oldPath);
    }
    const rc = core.tryRun(() => {
      const ab = ENC.encode(a);
      const bb = ENC.encode(b);
      const ap = core.stage(ab);
      const bp = core.stage(bb);
      return core.exports.oc_rename(ap, ab.byteLength, bp, bb.byteLength);
    });
    if (rc < 0) {
      const errno = -rc;
      if (errno === 2 /* ENOENT */) {
        // Disambiguate for VfsError.path parity: src was pre-checked, so a
        // missing NEW PARENT is the only ENOENT left (vfs.ts reports the
        // newPath for it, the oldPath for a missing src).
        throw new VfsError('ENOENT', errnoOf('ENOENT'), 'rename', newPath);
      }
      throwErrno(errno, 'rename', newPath); // ENOTEMPTY/EISDIR/ENOTDIR → newPath
    }
    // Watchers on BOTH parents (fired twice when they are the same dir —
    // exactly vfs.ts), then the rename delta, then a whole-file write delta
    // for a moved REGULAR file (even empty — node.data was always set).
    this.emitRenameAt(parentOf(a));
    this.emitRenameAt(parentOf(b));
    this.persist?.({ type: 'rename', from: a, to: b });
    const movedMode = this.modeOf(b, false);
    if (movedMode !== null && (movedMode & S_IFMT) === S_IFREG) {
      this.persist?.({ type: 'write', path: b, data: this.readFileOf(b) });
    }
  }

  symlink(target: string, path: string): void {
    const norm = this.normalize(path);
    const core = this.core;
    // Spec §3 oc_symlink: the bridge pre-checks existence and SKIPS the call
    // when the entry exists (oc_symlink itself would answer EEXIST; the
    // frozen contract chose a silent no-op — importTree stays idempotent
    // through its try/catch either way, and no events/persist fire).
    if (this.modeOf(norm, false) !== null) return;
    core.withPaths(target, norm, 'symlink', path, (tp, tl, pp, pl) =>
      core.exports.oc_symlink(tp, tl, pp, pl));
    this.emitRenameAt(parentOf(norm));
    this.persist?.({ type: 'symlink', path: norm, target });
  }

  readlink(p: string): string {
    const norm = this.normalize(p);
    return this.readlinkOf(norm, p);
  }

  /** readlink on an already-normalized path (internal fast path). */
  private readlinkOf(norm: string, errPath: string = norm): string {
    const core = this.core;
    core.withPath(norm, 'readlink', errPath, (ptr, len) =>
      core.exports.oc_readlink(ptr, len));
    return core.retString();
  }

  chmod(p: string, mode: number): void {
    const norm = this.normalize(p);
    const core = this.core;
    core.withPath(norm, 'chmod', p, (ptr, len) =>
      core.exports.oc_chmod(ptr, len, mode & 0o7777));
  }

  utimes(p: string, atimeMs: number, mtimeMs: number): void {
    const norm = this.normalize(p);
    const core = this.core;
    core.withPath(norm, 'utimes', p, (ptr, len) =>
      core.exports.oc_utimes(ptr, len, atimeMs, mtimeMs));
  }

  /** Recursively write a mount tree (WebContainer FileSystemTree format) —
   *  composed over the wasm-backed primitives like vfs.ts. */
  mountTree(dir: string, tree: Record<string, unknown>): void {
    for (const [name, node] of Object.entries(tree)) {
      const path = this.joinPaths(dir, name);
      const anyNode = node as any;
      if (anyNode && typeof anyNode === 'object' && 'file' in anyNode) {
        const contents = anyNode.file.contents;
        if (typeof contents === 'string') this.writeFile(path, contents);
        else if (contents instanceof Uint8Array) this.writeFile(path, contents);
      } else if (anyNode && typeof anyNode === 'object' && 'directory' in anyNode) {
        this.mkdir(path, true);
        this.mountTree(path, anyNode.directory.contents ?? {});
      } else if (typeof anyNode === 'string') {
        // plain string shorthand
        this.writeFile(path, anyNode);
      }
    }
  }

  // -- watchers (JS-side, per §6 of the spec) -----------------------------------

  watch(path: string, onEvent: VfsWatcher['onEvent']): VfsWatcher {
    const norm = this.normalize(path);
    const followMode = this.modeOf(norm, true);
    if (followMode === null) {
      throw new VfsError('ENOENT', errnoOf('ENOENT'), 'watch', norm);
    }
    let dirPath = norm;
    let fileFilter: string | undefined;
    if ((followMode & S_IFMT) !== S_IFDIR) {
      // node's fs.watch(file) registers on the PARENT dir and filters to the
      // file's basename (chokidar/vite module invalidation).
      fileFilter = baseOf(norm);
      dirPath = parentOf(norm);
    }
    const dirMode = this.modeOf(dirPath, true);
    if (dirMode === null || (dirMode & S_IFMT) !== S_IFDIR) {
      throw new VfsError('ENOTDIR', errnoOf('ENOTDIR'), 'watch', dirPath);
    }
    // Register under the dir's CANONICAL path (symlinks resolved): vfs.ts
    // keyed watchers on the NODE, so a watcher placed via '/d/link' fired
    // for mutations reaching the target dir through ANY path. The fire side
    // canonicalizes the same way, making the two views agree.
    const canon = this.canonicalizeDir(dirPath);
    let watchers = this.dirWatchers.get(canon);
    if (!watchers) {
      watchers = new Set();
      this.dirWatchers.set(canon, watchers);
    }
    const w: VfsWatcher = {
      path: norm,
      onEvent,
      fileFilter,
      close: () => {
        watchers.delete(w);
        if (watchers.size === 0) this.dirWatchers.delete(canon);
      },
    };
    watchers.add(w);
    return w;
  }

  /** Canonicalize a dir path by following symlinks (bounded like the core's
   *  40-follow budget). Falls back to the literal path when the walk cannot
   *  complete. Only runs while watchers exist (registration + firing). */
  private canonicalizeDir(dirPath: string): string {
    const segs = dirPath.split('/').filter(Boolean);
    let cur = '/';
    let budget = 40;
    for (const seg of segs) {
      const path = cur === '/' ? '/' + seg : cur + '/' + seg;
      const m = this.modeOf(path, false);
      if (m === null) return dirPath;
      if ((m & S_IFMT) === S_IFLNK) {
        if (--budget < 0) return dirPath;
        let target: string;
        try { target = this.readlinkOf(path); } catch { return dirPath; }
        cur = target.startsWith('/')
          ? this.normalize(target)
          : this.joinPaths(cur, target);
        continue;
      }
      cur = path;
    }
    return cur;
  }

  private emitRenameAt(dirPath: string): void {
    if (this.dirWatchers.size === 0) return;
    const watchers = this.dirWatchers.get(this.canonicalizeDir(dirPath));
    if (!watchers) return;
    for (const w of watchers) w.onEvent({ type: 'rename', filename: null });
  }

  private emitChangeAt(dirPath: string, base: string): void {
    if (this.dirWatchers.size === 0) return;
    const watchers = this.dirWatchers.get(this.canonicalizeDir(dirPath));
    if (!watchers) return;
    for (const w of watchers) {
      if (w.fileFilter !== undefined && w.fileFilter !== base) continue;
      w.onEvent({ type: 'change', filename: base });
    }
  }

  // -- debug / snapshots ---------------------------------------------------------

  /** Debug: dump tree (same formatting as vfs.ts — two-space depth indent,
   *  '/' suffix on dirs, symlinks listed bare, insertion order). */
  dump(dir = '/', depth = 0): string {
    const norm = this.normalize(dir);
    const mode = this.modeOf(norm, true);
    if (mode === null) return '(missing)';
    if ((mode & S_IFMT) !== S_IFDIR) return '';
    const lines: string[] = [];
    for (const e of this.dirents(norm)) {
      lines.push('  '.repeat(depth) + e.name + ((e.type & S_IFMT) === S_IFDIR ? '/' : ''));
      if ((e.type & S_IFMT) === S_IFDIR) {
        lines.push(this.dump(this.joinPaths(norm, e.name), depth + 1));
      }
    }
    return lines.filter(Boolean).join('\n');
  }

  /** Serialize a subtree (dirs, files, symlinks) for snapshots — includes
   *  vfs.ts's quirk of walking the ROOT under the requested prefix when the
   *  dir is missing, and emitting NOTHING for a symlink/file root. */
  exportTree(dir = '/'): VfsTree {
    const norm = this.normalize(dir);
    const dirs: string[] = [];
    const files: Array<[string, Uint8Array]> = [];
    const symlinks: Array<[string, string]> = [];
    const rootMode = this.modeOf(norm, false);
    if (rootMode !== null && (rootMode & S_IFMT) !== S_IFDIR) {
      return { dirs, files, symlinks }; // symlink/file root → no children
    }
    const realRoot = rootMode === null ? '/' : norm; // missing → walk root
    const base = norm;
    const walk = (realDir: string, baseDir: string): void => {
      for (const e of this.dirents(realDir)) {
        const realChild = realDir === '/' ? '/' + e.name : realDir + '/' + e.name;
        const cp = baseDir === '/' ? '/' + e.name : baseDir + '/' + e.name;
        const t = e.type & S_IFMT;
        if (t === S_IFDIR) {
          dirs.push(cp);
          walk(realChild, cp);
        } else if (t === S_IFLNK) {
          symlinks.push([cp, this.readlinkOf(realChild)]);
        } else {
          files.push([cp, this.readFileOf(realChild)]);
        }
      }
    };
    walk(realRoot, base);
    return { dirs, files, symlinks };
  }

  /** Import a snapshot tree (hydrate). Skips the persist hook (the host
   *  already owns this state — hydrating must not echo deltas back). */
  importTree(tree: VfsTree): void {
    const prev = this.persist;
    this.persist = undefined;
    try {
      for (const d of tree.dirs) {
        try { this.mkdir(d, true); } catch { /* EEXIST etc. — idempotent */ }
      }
      // A file whose PARENT dir is missing from tree.dirs must not be
      // silently dropped — create ancestors first (S3.1 fix, kept).
      const ensureParents = (p: string) => {
        const i = p.lastIndexOf('/');
        if (i <= 0) return;
        try { this.mkdir(p.slice(0, i), true); } catch { /* exists */ }
      };
      for (const [p, data] of tree.files) {
        try { ensureParents(p); this.writeFile(p, data, 0o666, true); } catch { /* best-effort */ }
      }
      for (const [p, target] of tree.symlinks) {
        try { ensureParents(p); this.symlink(target, p); } catch { /* best-effort */ }
      }
    } finally {
      this.persist = prev;
    }
  }

  /** Apply VFS ops broadcast from OTHER processes (cross-process file
   *  visibility). Never re-emits persist ops (the host already distributed
   *  them). Mirrors vfs.ts's cascade semantics exactly. */
  applyExternalOps(ops: VfsPersistOp[]): void {
    const prev = this.persist;
    this.persist = undefined;
    try {
      for (const op of ops) {
        try {
          switch (op.type) {
            case 'write': this.writeFile(op.path, op.data, 0o666, true); break;
            case 'mkdir': this.mkdir(op.path, true); break;
            case 'symlink': this.symlink(op.target, op.path); break;
            case 'unlink': {
              try { this.rm(op.path, { recursive: true, force: true }); } catch { /* gone */ }
              break;
            }
            case 'rename': {
              try { this.rename(op.from, op.to); } catch { /* best-effort */ }
              break;
            }
          }
        } catch { /* last-writer-wins divergence is tolerated (documented) */ }
      }
    } finally {
      this.persist = prev;
    }
  }

  /** read a whole file on an already-normalized path (internal fast path). */
  private readFileOf(abs: string): Uint8Array {
    const core = this.core;
    core.withPath(abs, 'readFile', abs, (ptr, len) => core.exports.oc_read_file(ptr, len));
    return core.retCopy();
  }
}

/** Convenience factory: wasm bytes → NativeVfs (identical to
 *  `new NativeVfs(bytes)` — kept for boot-side ergonomics). */
export function loadNativeCore(bytes: ArrayBuffer): NativeVfs {
  return new NativeVfs(bytes);
}
