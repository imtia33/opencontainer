/**
 * internalBinding('wasi') — WASI preview1 over the kernel's virtual FS.
 *
 * This is what unlocks napi-rs WASM builds (@rolldown/binding-wasm32-wasi,
 * @rollup/wasm-node, …) in the browser kernel — the same capability
 * WebContainer's runtime has (rolldown's own WebContainer fallback loads
 * the wasm32-wasi binding through node:wasi).
 *
 * Contract with node's vendored lib/wasi.js:
 *   new WASI(args[], env[] /* "K=V" *​/, preopens[] /* [guest, host, …] pairs *​/,
 *           stdio[3] /* fd indices *​/)
 * returns `wrap`, whose EVERY wasi syscall must be an own enumerable
 * function (lib/wasi.js binds them with `for (const prop in wrap)`), plus
 * `_setMemory(memory)` (deleted from the import object by the lib).
 *
 * Syscall set: exactly what napi-rs wasm modules import (verified against
 * rolldown-binding.wasm32-wasi.wasm's import section) — 21 functions.
 * Errnos are WASI preview1 codes. Struct layouts follow wasi-types.h.
 */
import type { Binding, NativesContext } from './index';

/* wasi errno (preview1) */
const ESUCCESS = 0;
const EBADF = 8;
const EEXIST = 20;
const EFAULT = 21;
const EINVAL = 28;
const EIO = 29;
const EISDIR = 31;
const ENOENT = 44;
const ENOMEM = 45;
const ENOSYS = 52;
const ENOTDIR = 54;
const ENOTEMPTY = 55;
const ENOTSUP = 58;
const EPERM = 63;

/* wasi filetype */
const FILETYPE_UNKNOWN = 0;
const FILETYPE_DIR = 3;
const FILETYPE_REGULAR = 4;
const FILETYPE_SYMBOLIC_LINK = 7;

/* wasi oflags */
const OFLAG_CREAT = 1 << 0;
const OFLAG_DIRECTORY = 1 << 1;
const OFLAG_EXCL = 1 << 2;
const OFLAG_TRUNC = 1 << 3;

/* wasi rights (subset used for open mode) */
const RIGHT_FD_READ = 1 << 1;
const RIGHT_FD_WRITE = 1 << 6;

/* wasi whence */
const WHENCE_SET = 0;
const WHENCE_CUR = 1;
const WHENCE_END = 2;

interface WasiFd {
  kind: 'stdio' | 'preopen' | 'file' | 'dir';
  /** host path (preopen/dir/file base) */
  path: string;
  /** guest-visible name for preopens (fd_prestat_dir_name) */
  preopenName?: string;
  data?: Uint8Array;
  pos?: number;
  readable?: boolean;
  writable?: boolean;
  /** write-mode files flush on close */
  dirty?: boolean;
}

export function makeWasiBinding(ctx: NativesContext): Binding {
  const trace = (name: string, ...rest: any[]): void => {
    try {
      const env = (globalThis as any).process?.env ?? {};
      if (!env.OC_WASI_TRACE) return;
      ctx.hooks.onStdio(2, `[wasi] ${name} ${rest.map((x) => {
        const s = String(x);
        return s.length > 40 ? s.slice(0, 40) + '…' : s;
      }).join(' ')}\n`);
    } catch { /* noop */ }
  };
  const traceOn = (): boolean => {
    try { return !!(globalThis as any).process?.env?.OC_WASI_TRACE; } catch { return false; }
  };
  /** Shared per-process proc_exit target (lib/wasi.js replaces it when
   *  returnOnExit is true, but returnOnExit:false calls ours). */
  const wasiProcExit = (code: number): void => {
    ctx.hooks.onExit(code);
    throw new Error(`WASI proc_exit(${code})`);
  };

  class WASIImpl {
    private fds = new Map<number, WasiFd>();
    private nextFd = 3;
    private memory: WebAssembly.Memory | null = null;
    private args: string[];
    private env: string[];

    constructor(args: string[], env: string[], preopens: string[], _stdio: number[]) {
      this.args = args ?? [];
      this.env = env ?? [];
      this.fds.set(0, { kind: 'stdio', path: '' });
      this.fds.set(1, { kind: 'stdio', path: '' });
      this.fds.set(2, { kind: 'stdio', path: '' });
      // preopens arrive as a FLAT [guestPath, hostPath, guestPath, hostPath…]
      for (let i = 0; i + 1 < preopens.length; i += 2) {
        const guest = preopens[i];
        const host = preopens[i + 1];
        const fd = this.nextFd++;
        this.fds.set(fd, { kind: 'preopen', path: host, preopenName: guest });
      }
      // wasiImport must expose every syscall as an own enumerable fn —
      // and NOTHING else: lib/wasi.js binds every enumerable prop
      // (`for (const prop in wrap)`), so private state must be hidden.
      const syscalls = [
        'args_get', 'args_sizes_get', 'clock_time_get', 'environ_get',
        'environ_sizes_get', 'fd_close', 'fd_fdstat_get', 'fd_filestat_get',
        'fd_prestat_get', 'fd_prestat_dir_name', 'fd_read', 'fd_readdir',
        'fd_seek', 'fd_write', 'path_create_directory', 'path_filestat_get',
        'path_open', 'path_readlink', 'path_remove_directory',
        'path_unlink_file', 'poll_oneoff', 'proc_exit', 'random_get',
        'sched_yield',
      ];
      for (const name of syscalls) {
        const fn = (this as any)[name].bind(this);
        Object.defineProperty(this, name, {
          value: (...args: any[]) => {
            if (traceOn()) trace(name, ...args.slice(0, 4));
            return fn(...args);
          },
          enumerable: true, writable: true, configurable: true,
        });
      }
      for (const name of ['fds', 'nextFd', 'memory', 'args', 'env']) {
        const v = (this as any)[name];
        Object.defineProperty(this, name, {
          value: v, writable: true, enumerable: false, configurable: true,
        });
      }
      // `_setMemory` must be a THIS-INDEPENDENT closure, exactly like the
      // native binding's: lib/wasi.js grabs it (`this[kSetMemory] =
      // wrap._setMemory`) and later calls it as a method of the *lib's* WASI
      // object (`this[kSetMemory](instance.exports.memory)` — wasi-threads'
      // setupInstance / the lib's finalizeBindings). A prototype method would
      // write `memory` onto the LIB instance and the kernel's WASIImpl would
      // keep memory=null — every wasi syscall then died at
      // `WASIImpl.mem` (found via @rolldown/binding-wasm32-wasi + Vite 8:
      // random_get crashed "Cannot read properties of null (reading 'buffer')"
      // before the dev server could ever boot).
      Object.defineProperty(this, '_setMemory', {
        value: (memory: WebAssembly.Memory) => { this.memory = memory; },
        enumerable: false, writable: true, configurable: true,
      });
    }

    // ---- memory helpers ----------------------------------------------------
    private mem(): { u8: Uint8Array; dv: DataView } {
      const buf = this.memory!.buffer as ArrayBuffer;
      return { u8: new Uint8Array(buf), dv: new DataView(buf) };
    }
    private str(ptr: number, len: number): string {
      const { u8 } = this.mem();
      return new TextDecoder().decode(u8.subarray(ptr, ptr + len));
    }
    private writeBytes(ptr: number, bytes: Uint8Array): void {
      const { u8 } = this.mem();
      u8.set(bytes, ptr);
    }
    private writeU64(ptr: number, value: number): void {
      const { dv } = this.mem();
      dv.setUint32(ptr, value >>> 0, true);
      dv.setUint32(ptr + 4, Math.floor(value / 4294967296), true);
    }

    // ---- args / env --------------------------------------------------------
    args_get(argvPtr: number, argvBufPtr: number): number {
      const { dv } = this.mem();
      let bufAt = argvBufPtr;
      this.args.forEach((a, i) => {
        const bytes = new TextEncoder().encode(a);
        dv.setUint32(argvPtr + i * 4, bufAt, true);
        this.writeBytes(bufAt, bytes);
        bufAt += bytes.length + 1;
      });
      return ESUCCESS;
    }
    args_sizes_get(argcPtr: number, bufLenPtr: number): number {
      const { dv } = this.mem();
      const total = this.args.reduce((n, a) => n + a.length + 1, 0);
      dv.setUint32(argcPtr, this.args.length, true);
      dv.setUint32(bufLenPtr, total, true);
      return ESUCCESS;
    }
    environ_get(envPtr: number, envBufPtr: number): number {
      const { dv } = this.mem();
      let bufAt = envBufPtr;
      this.env.forEach((e, i) => {
        const bytes = new TextEncoder().encode(e);
        dv.setUint32(envPtr + i * 4, bufAt, true);
        this.writeBytes(bufAt, bytes);
        bufAt += bytes.length + 1;
      });
      return ESUCCESS;
    }
    environ_sizes_get(countPtr: number, bufLenPtr: number): number {
      const { dv } = this.mem();
      const total = this.env.reduce((n, e) => n + e.length + 1, 0);
      dv.setUint32(countPtr, this.env.length, true);
      dv.setUint32(bufLenPtr, total, true);
      return ESUCCESS;
    }

    // ---- clocks / random / yield -------------------------------------------
    clock_time_get(_id: number, _precLo: number, _precHi: number, outPtr: number): number {
      const now = _id === 0 ? Date.now() : Math.round(performance.now());
      this.writeU64(outPtr, now);
      return ESUCCESS;
    }
    random_get(bufPtr: number, bufLen: number): number {
      const { u8 } = this.mem();
      const view = u8.subarray(bufPtr, bufPtr + bufLen);
      try {
        crypto.getRandomValues(view);
      } catch {
        for (let i = 0; i < view.length; i++) view[i] = (Math.random() * 256) | 0;
      }
      return ESUCCESS;
    }
    sched_yield(): number { return ESUCCESS; }

    // ---- fd helpers ---------------------------------------------------------
    private fdget(fd: number): WasiFd | undefined { return this.fds.get(fd); }
    private allocFd(entry: WasiFd): number {
      const fd = this.nextFd++;
      this.fds.set(fd, entry);
      return fd;
    }
    /** Resolve a path relative to the fd's base (preopen/dir/file) — path_open only. */
    private resolveAt(fd: number, path: string): string {
      const base = this.fds.get(fd);
      if (!base) throw new Error('bad fd');
      if (base.kind === 'file') throw new Error('not a directory fd');
      if (path.startsWith('/')) return normalizeGuest(path);
      return normalizeGuest((base.path === '' ? '/' : base.path) + '/' + path);
    }
    private fileTypeOf(path: string, follow: boolean): number {
      try {
        const st = ctx.vfs.stat(path, follow);
        const mode = st.mode & 0o170000;
        if (mode === 0o040000) return FILETYPE_DIR;
        if (mode === 0o120000) return FILETYPE_SYMBOLIC_LINK;
        return FILETYPE_REGULAR;
      } catch {
        return FILETYPE_UNKNOWN;
      }
    }

    // ---- fd syscalls ---------------------------------------------------------
    fd_close(fd: number): number {
      const entry = this.fds.get(fd);
      if (!entry) return EBADF;
      // Flush pending file writes back into the VFS.
      if (entry.kind === 'file' && entry.dirty && entry.data) {
        try { ctx.vfs.writeFile(entry.path, entry.data); } catch { return EIO; }
      }
      if (fd > 2) this.fds.delete(fd);
      return ESUCCESS;
    }

    fd_fdstat_get(fd: number, bufPtr: number): number {
      const entry = this.fds.get(fd);
      if (!entry) return EBADF;
      const { dv } = this.mem();
      let filetype = FILETYPE_UNKNOWN;
      let rights = 0;
      if (entry.kind === 'stdio') { filetype = FILETYPE_CHARACTER_DEVICE; rights = 0; }
      else if (entry.kind === 'preopen' || entry.kind === 'dir') filetype = FILETYPE_DIR;
      else { filetype = FILETYPE_REGULAR; rights = (entry.readable ? RIGHT_FD_READ : 0) | (entry.writable ? RIGHT_FD_WRITE : 0); }
      dv.setUint8(bufPtr, filetype);
      dv.setUint16(bufPtr + 2, 0, true); // fs_flags (append, nonblock…)
      dv.setUint32(bufPtr + 4, rights >>> 0, true);
      dv.setUint32(bufPtr + 8, 0, true);
      dv.setUint32(bufPtr + 12, rights >>> 0, true);
      dv.setUint32(bufPtr + 16, 0, true);
      return ESUCCESS;
    }

    fd_filestat_get(fd: number, bufPtr: number): number {
      const entry = this.fds.get(fd);
      if (!entry) return EBADF;
      if (entry.kind === 'stdio') {
        // /dev/null-like stdio filestat
        this.writeFilestat(bufPtr, { dev: 0, ino: 0, filetype: FILETYPE_CHARACTER_DEVICE, nlink: 1, size: 0, atime: 0, mtime: 0, ctime: 0 });
        return ESUCCESS;
      }
      try {
        const st = ctx.vfs.stat(entry.path);
        return this.writeFilestat(bufPtr, {
          dev: 1, ino: st.ino ?? 0,
          filetype: this.fileTypeOf(entry.path, true),
          nlink: 1, size: st.size,
          atime: st.atimeMs ?? 0, mtime: st.mtimeMs ?? 0, ctime: st.ctimeMs ?? 0,
        });
      } catch { return EBADF; }
    }

    private writeFilestat(bufPtr: number, s: { dev: number; ino: number; filetype: number; nlink: number; size: number; atime: number; mtime: number; ctime: number }): number {
      const { dv } = this.mem();
      this.writeU64(bufPtr, s.dev);
      this.writeU64(bufPtr + 8, s.ino);
      dv.setUint8(bufPtr + 16, s.filetype);
      this.writeU64(bufPtr + 24, s.nlink);
      this.writeU64(bufPtr + 32, s.size);
      this.writeU64(bufPtr + 40, s.atime);
      this.writeU64(bufPtr + 48, s.mtime);
      this.writeU64(bufPtr + 56, s.ctime);
      return ESUCCESS;
    }

    fd_prestat_get(fd: number, bufPtr: number): number {
      const entry = this.fds.get(fd);
      if (!entry) return EBADF;
      if (entry.kind !== 'preopen') return EBADF; // EINVAL in spec; EBADF is what node's tests expect for non-preopens
      const nameLen = new TextEncoder().encode(entry.preopenName ?? '').length;
      const { dv } = this.mem();
      dv.setUint32(bufPtr, 0, true); // pr_type = preopentype_dir
      this.writeU64(bufPtr + 8, nameLen);
      return ESUCCESS;
    }

    fd_prestat_dir_name(fd: number, pathPtr: number, pathLen: number): number {
      const entry = this.fds.get(fd);
      if (!entry || entry.kind !== 'preopen') return EBADF;
      const bytes = new TextEncoder().encode(entry.preopenName ?? '');
      this.writeBytes(pathPtr, bytes.subarray(0, pathLen));
      return ESUCCESS;
    }

    fd_read(fd: number, iovsPtr: number, iovsLen: number, nreadPtr: number): number {
      const entry = this.fds.get(fd);
      if (!entry) return EBADF;
      if (entry.kind !== 'file' || !entry.data) return EBADF; // stdin reads unsupported
      const { dv } = this.mem();
      let total = 0;
      let pos = entry.pos ?? 0;
      for (let i = 0; i < iovsLen; i++) {
        const bufPtr = dv.getUint32(iovsPtr + i * 8, true);
        const bufLen = dv.getUint32(iovsPtr + i * 8 + 4, true);
        const avail = Math.max(0, entry.data.length - pos);
        const n = Math.min(bufLen, avail);
        if (n > 0) {
          this.writeBytes(bufPtr, entry.data.subarray(pos, pos + n));
          pos += n;
          total += n;
        }
        if (n < bufLen) break;
      }
      entry.pos = pos;
      dv.setUint32(nreadPtr, total, true);
      return ESUCCESS;
    }

    fd_readdir(fd: number, bufPtr: number, bufLen: number, cookie: number, bufusedPtr: number): number {
      const entry = this.fds.get(fd);
      if (!entry) return EBADF;
      if (entry.kind !== 'preopen' && entry.kind !== 'dir') return ENOTDIR;
      let names: string[];
      try { names = ctx.vfs.readdir(entry.path); } catch { return ENOENT; }
      const { dv } = this.mem();
      // cookie = 1-based index of the next entry to return; 0 = first.
      let at = bufPtr;
      let used = 0;
      let nextCookie = Math.max(1, cookie);
      let i = nextCookie - 1;
      for (; i < names.length; i++) {
        const nameBytes = new TextEncoder().encode(names[i]);
        const entrySize = 24 + nameBytes.length;
        if (used + entrySize > bufLen) break;
        const dNext = i + 2; // cookie for the NEXT entry
        const type = this.fileTypeOf(joinGuest(entry.path, names[i]), true);
        this.writeU64(at, dNext);
        this.writeU64(at + 8, 0); // d_ino (best-effort 0)
        dv.setUint32(at + 16, nameBytes.length, true);
        dv.setUint8(at + 20, type);
        this.writeBytes(at + 24, nameBytes);
        at += entrySize;
        used += entrySize;
        nextCookie = dNext;
      }
      dv.setUint32(bufusedPtr, used, true);
      return ESUCCESS;
    }

    fd_seek(fd: number, offsetLo: number, offsetHi: number, whence: number, newOffsetPtr: number): number {
      const entry = this.fds.get(fd);
      if (!entry || entry.kind !== 'file') return EBADF;
      const offset = offsetLo + offsetHi * 4294967296;
      const base = whence === WHENCE_SET ? 0 : whence === WHENCE_CUR ? entry.pos ?? 0 : entry.data?.length ?? 0;
      if (whence !== WHENCE_SET && whence !== WHENCE_CUR && whence !== WHENCE_END) return EINVAL;
      const next = base + offset;
      if (next < 0) return EINVAL;
      entry.pos = next;
      this.writeU64(newOffsetPtr, next);
      return ESUCCESS;
    }

    fd_write(fd: number, iovsPtr: number, iovsLen: number, nwrittenPtr: number): number {
      const entry = this.fds.get(fd);
      if (!entry) return EBADF;
      const { dv, u8 } = this.mem();
      let total = 0;
      const parts: Uint8Array[] = [];
      for (let i = 0; i < iovsLen; i++) {
        const bufPtr = dv.getUint32(iovsPtr + i * 8, true);
        const bufLen = dv.getUint32(iovsPtr + i * 8 + 4, true);
        parts.push(u8.slice(bufPtr, bufPtr + bufLen));
        total += bufLen;
      }
      if (entry.kind === 'stdio') {
        if (fd === 0) return EBADF;
        const merged = concat(parts);
        ctx.hooks.onStdio(fd === 2 ? 2 : 1, merged);
      } else if (entry.kind === 'file' && entry.writable) {
        const merged = concat(parts);
        const pos = entry.pos ?? 0;
        const end = pos + merged.length;
        if (entry.data && end <= entry.data.length) {
          entry.data.set(merged, pos);
        } else {
          const grown = new Uint8Array(end);
          grown.set(entry.data ?? new Uint8Array(0), 0);
          grown.set(merged, pos);
          entry.data = grown;
        }
        entry.pos = end;
        entry.dirty = true;
      } else {
        return EBADF;
      }
      dv.setUint32(nwrittenPtr, total, true);
      return ESUCCESS;
    }

    // ---- path syscalls ---------------------------------------------------------
    path_create_directory(fd: number, pathPtr: number, pathLen: number): number {
      const path = this.resolveAtChecked(fd, pathPtr, pathLen);
      if (path === null) return EBADF;
      try { ctx.vfs.mkdir(path, false); return ESUCCESS; }
      catch (e: any) { return errnoOfVfs(e); }
    }

    path_filestat_get(fd: number, flags: number, pathPtr: number, pathLen: number, bufPtr: number): number {
      const path = this.resolveAtChecked(fd, pathPtr, pathLen);
      if (path === null) return EBADF;
      const follow = (flags & 2) === 0; // 1 = FOLLOW_SYMLINKS, 2 = NOFOLLOW
      try {
        const st = ctx.vfs.stat(path, follow);
        return this.writeFilestat(bufPtr, {
          dev: 1, ino: st.ino ?? 0, filetype: this.fileTypeOf(path, follow), nlink: 1, size: st.size,
          atime: st.atimeMs ?? 0, mtime: st.mtimeMs ?? 0, ctime: st.ctimeMs ?? 0,
        });
      } catch (e: any) { return errnoOfVfs(e); }
    }

    path_open(
      fd: number, _dirflags: number, pathPtr: number, pathLen: number, oflags: number,
      rightsBaseLo: number, _rightsBaseHi: number, _rightsInhLo: number, _rightsInhHi: number,
      fdOutPtr: number,
    ): number {
      const path = this.resolveAtChecked(fd, pathPtr, pathLen);
      if (path === null) return EBADF;
      const wantDir = (oflags & OFLAG_DIRECTORY) !== 0;
      const create = (oflags & OFLAG_CREAT) !== 0;
      const excl = (oflags & OFLAG_EXCL) !== 0;
      const trunc = (oflags & OFLAG_TRUNC) !== 0;
      const readable = (rightsBaseLo & RIGHT_FD_READ) !== 0;
      const writable = (rightsBaseLo & RIGHT_FD_WRITE) !== 0;

      let exists = true;
      let isDir = false;
      try {
        const st = ctx.vfs.stat(path);
        isDir = (st.mode & 0o170000) === 0o040000;
      } catch { exists = false; }

      if (excl && exists && create) return EEXIST;
      if (wantDir) {
        if (!exists) return ENOENT;
        if (!isDir) return ENOTDIR;
        const newFd = this.allocFd({ kind: 'dir', path });
        const { dv } = this.mem();
        dv.setUint32(fdOutPtr, newFd, true);
        return ESUCCESS;
      }
      if (isDir) return EISDIR;
      if (!exists) {
        if (!create || !writable) return ENOENT;
        try { ctx.vfs.writeFile(path, new Uint8Array(0)); } catch (e: any) { return errnoOfVfs(e); }
      } else if (trunc && writable) {
        try { ctx.vfs.writeFile(path, new Uint8Array(0)); } catch (e: any) { return errnoOfVfs(e); }
      }
      let data: Uint8Array;
      try { data = ctx.vfs.readFile(path); } catch (e: any) { return errnoOfVfs(e); }
      const newFd = this.allocFd({
        kind: 'file', path, data, pos: 0, readable, writable, dirty: false,
      });
      const { dv } = this.mem();
      dv.setUint32(fdOutPtr, newFd, true);
      return ESUCCESS;
    }

    path_readlink(fd: number, pathPtr: number, pathLen: number, bufPtr: number, bufLen: number, bufUsedPtr: number): number {
      const path = this.resolveAtChecked(fd, pathPtr, pathLen);
      if (path === null) return EBADF;
      try {
        const target = ctx.vfs.readlink(path);
        const bytes = new TextEncoder().encode(target);
        const n = Math.min(bytes.length, bufLen);
        this.writeBytes(bufPtr, bytes.subarray(0, n));
        const { dv } = this.mem();
        dv.setUint32(bufUsedPtr, n, true);
        return ESUCCESS;
      } catch (e: any) { return errnoOfVfs(e); }
    }

    path_remove_directory(fd: number, pathPtr: number, pathLen: number): number {
      const path = this.resolveAtChecked(fd, pathPtr, pathLen);
      if (path === null) return EBADF;
      try {
        ctx.vfs.rm(path, { recursive: false });
        return ESUCCESS;
      } catch (e: any) { return errnoOfVfs(e); }
    }

    path_unlink_file(fd: number, pathPtr: number, pathLen: number): number {
      const path = this.resolveAtChecked(fd, pathPtr, pathLen);
      if (path === null) return EBADF;
      try {
        ctx.vfs.rm(path, { recursive: false });
        return ESUCCESS;
      } catch (e: any) { return errnoOfVfs(e); }
    }

    /** path variant that never throws for a bad fd (returns null → EBADF). */
    private resolveAtChecked(fd: number, pathPtr: number, pathLen: number): string | null {
      const base = this.fds.get(fd);
      if (!base) return null;
      const rel = this.str(pathPtr, pathLen);
      try { return this.resolveAt(fd, rel); } catch { return null; }
    }

    // ---- poll / exit ---------------------------------------------------------
    poll_oneoff(inPtr: number, outPtr: number, nsubs: number, neventsPtr: number): number {
      // Subscription (24 bytes): userdata u64, u_type u8 (+pad), union (clock:
      // timeout u64 + precision u64 + flags u16; fdread/fdwrite: fd u32).
      // Event (32 bytes): userdata u64, error u16 (+pad), type u8.
      // All clock subscriptions complete immediately (bundler workloads use
      // them for sleeps/yields); fd subscriptions report ENOSYS per-event.
      const { dv } = this.mem();
      let events = 0;
      for (let i = 0; i < nsubs; i++) {
        const sub = inPtr + i * 24;
        const userdataLo = dv.getUint32(sub, true);
        const userdataHi = dv.getUint32(sub + 4, true);
        const type = dv.getUint8(sub + 8);
        const ev = outPtr + i * 32;
        this.writeU64(ev, userdataLo + userdataHi * 4294967296);
        dv.setUint16(ev + 8, type === 0 /*clock*/ ? 0 : ENOSYS, true);
        dv.setUint8(ev + 10, type);
        events++;
      }
      dv.setUint32(neventsPtr, events, true);
      return ESUCCESS;
    }

    proc_exit(code: number): number {
      wasiProcExit(code);
      return 0; // unreachable
    }
  }

  return { WASI: WASIImpl as any };
}

/* ---- helpers ---------------------------------------------------------- */

/** wasi filetype 2 = character device (stdio). */
const FILETYPE_CHARACTER_DEVICE = 2;

function normalizeGuest(p: string): string {
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

function joinGuest(base: string, name: string): string {
  return normalizeGuest((base === '/' ? '' : base) + '/' + name);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** Map VfsError codes to WASI errnos. */
function errnoOfVfs(e: any): number {
  const code = String(e?.code ?? e?.message ?? '');
  if (code.includes('ENOENT')) return ENOENT;
  if (code.includes('EEXIST')) return EEXIST;
  if (code.includes('EISDIR')) return EISDIR;
  if (code.includes('ENOTDIR')) return ENOTDIR;
  if (code.includes('ENOTEMPTY')) return ENOTEMPTY;
  if (code.includes('EPERM') || code.includes('EACCES')) return EPERM;
  if (code.includes('ENOMEM')) return ENOMEM;
  if (code.includes('ENOTSUP')) return ENOTSUP;
  return EIO;
}
