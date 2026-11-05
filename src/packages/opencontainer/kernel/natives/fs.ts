import type { Binding, NativesContext } from './index';
import { VfsError, errnoOf } from '../vfs';

/**
 * internalBinding('fs') — the syscall surface over the VFS.
 *
 * Node 26 convention: ONE entry point per operation; the LAST argument being
 * a request object (something with `oncomplete`) selects ASYNC mode, its
 * absence selects SYNC mode (return value or thrown ErrnoException).
 * Signatures below mirror src/node_file.cc exactly.
 */

function uvCode(e: unknown): number {
  if (e instanceof VfsError) return -errnoOf(e.code);
  return -22; // EINVAL
}

/** VFS S_IFMT mode bits → UV_DIRENT_* code (constants.ts values: the same
 *  table lib/internal/fs/utils.js's Dirent checks against). UNKNOWN makes
 *  node's JS fall back to lstat, which is always correct. */
export function uvDirentOfHelper(mode: number): number {
  switch (mode & 0o170000) {
    case 0o100000: return 1; // UV_DIRENT_FILE
    case 0o040000: return 2; // UV_DIRENT_DIR
    case 0o120000: return 3; // UV_DIRENT_LINK
    case 0o010000: return 4; // UV_DIRENT_FIFO
    case 0o140000: return 5; // UV_DIRENT_SOCKET
    case 0o020000: return 6; // UV_DIRENT_CHAR
    case 0o060000: return 7; // UV_DIRENT_BLOCK
    default: return 0;       // UV_DIRENT_UNKNOWN → JS lstat fallback
  }
}

interface ReqLike {
  oncomplete: ((err: number | null, ...args: any[]) => void) | null;
  context?: any;
}

export function makeFsBinding(ctx: NativesContext): Binding {
  const vfs = ctx.vfs;

  /** Throws node-shaped ErrnoException for a VfsError. */
  function syncError(e: unknown, syscall: string, path?: string): never {
    if (e instanceof VfsError) {
      const err: any = new Error(e.message);
      err.code = e.code;
      err.errno = -errnoOf(e.code);
      err.syscall = syscall;
      if (path !== undefined) err.path = path;
      throw err;
    }
    throw e;
  }

  const isReq = (v: any): v is ReqLike =>
    v !== null && typeof v === 'object' && typeof v !== 'function' &&
    ('oncomplete' in v || 'context' in v || v instanceof FSReqCallback);

  /** VFS S_IFMT mode bits → UV_DIRENT_* code (constants.ts values: the same
   *  table lib/internal/fs/utils.js's Dirent checks against). UNKNOWN makes
   *  node's JS fall back to lstat, which is always correct. */
  /** node-style fs.cp error (the C++ side throws node SystemErrors; the
   *  observable surface is code/errno/syscall/path/message). */
  function cpErr(code: string, message: string, path: string, errno = -22): Error {
    const err: any = new Error(message);
    err.code = code;
    err.errno = errno;
    err.syscall = 'cp';
    err.path = path;
    return err;
  }

  /**
   * Wrap a sync vfs op into a tri-mode binding method:
   *   - callback mode: last arg is an FSReqCallback (has oncomplete)
   *   - promise mode: last arg === kUsePromises → return a Promise
   *   - sync mode: plain args
   */
  function dual<T extends (...args: any[]) => any>(
    syscall: string,
    getPath: (args: any[]) => string | undefined,
    fn: T,
  ) {
    return (...args: any[]) => {
      const maybeReq = args.length ? args[args.length - 1] : undefined;
      if (isReq(maybeReq)) {
        const req = maybeReq as ReqLike;
        const opArgs = args.slice(0, -1);
        let result: any;
        try {
          result = fn(...opArgs);
        } catch (e) {
          const code = uvCode(e);
          queueMicrotask(() => req.oncomplete?.(code));
          return;
        }
        queueMicrotask(() => req.oncomplete?.(null, result));
        return;
      }
      // S3.1: the kUsePromises sentinel is NOT always the LAST argument —
      // promises.js's stat/lstat pass throwIfNoEntry AFTER it
      // (binding.stat(path, bigint, kUsePromises, throwIfNoEntry)), so scan
      // every position. Missing it made fs/promises.stat fall through to
      // sync mode, returning a plain object where a Promise was required
      // ("TypeError: |this| is not a Promise" — found via fs.promises.cp).
      const promiseIdx = args.indexOf(kUsePromisesFlag);
      if (promiseIdx >= 0) {
        // fs promise-mode: node's C++ returns a native Promise that resolves
        // with the operation result (or rejects with an ErrnoException).
        const opArgs = args.slice(0, promiseIdx).concat(args.slice(promiseIdx + 1));
        return new Promise((resolve, reject) => {
          queueMicrotask(() => {
            try {
              resolve(fn(...opArgs));
            } catch (e) {
              try {
                reject(errnoExceptionOf(e, syscall, getPath(opArgs)));
              } catch (internal) {
                reject(internal);
              }
            }
          });
        });
      }
      try {
        return fn(...args);
      } catch (e) {
        syncError(e, syscall, getPath(args));
      }
    };
  }

  const kUsePromisesFlag = 1 << 30;

  /** Build a node-shaped ErrnoException (for promise rejections). */
  function errnoExceptionOf(e: any, syscall: string, path?: string): Error {
    if (e instanceof VfsError) {
      const err: any = new Error(
        `${e.code}: ${syscall}${path ? `, '${path}'` : ''}${e.message ? `, ${e.message}` : ''}`,
      );
      err.code = e.code;
      err.errno = -errnoOf(e.code);
      err.syscall = syscall;
      if (path !== undefined) err.path = path;
      return err;
    }
    return e instanceof Error ? e : new Error(String(e));
  }

  // -- fd table ---------------------------------------------------------------
  interface Fd { path: string; flags: number; pos: number; }
  const fds = new Map<number, Fd>();
  let nextFd = 3;

  function registerFd(path: string, flags: number): number {
    const exists = vfs.exists(path);
    if (!exists && (flags & 64 /* O_CREAT */)) {
      vfs.writeFile(path, new Uint8Array(0));
    }
    if (!vfs.exists(path)) {
      throw new VfsError('ENOENT', errnoOf('ENOENT'), 'open', path);
    }
    const fd = nextFd++;
    fds.set(fd, { path, flags, pos: 0 });
    return fd;
  }

  function mustFd(fd: number, syscall: string): Fd {
    const f = fds.get(fd);
    if (!f) throw new VfsError('EBADF', errnoOf('EBADF'), syscall, String(fd));
    return f;
  }

  function fdPath(fd: number): string {
    return mustFd(fd, 'read').path;
  }

  function readFd(fd: number, buffer: Uint8Array, offset: number, length: number, position: number): number {
    const f = mustFd(fd, 'read');
    const data = vfs.readFile(f.path);
    const pos = position === -1 || position === null || position === undefined ? f.pos : position;
    const avail = Math.max(0, data.byteLength - pos);
    const n = Math.min(length, avail);
    buffer.set(data.subarray(pos, pos + n), offset);
    if (position === -1 || position === null || position === undefined) f.pos = pos + n;
    return n;
  }

  function writeFd(fd: number, bytes: Uint8Array, position: number): number {
    const f = mustFd(fd, 'write');
    if (position !== -1 && position !== null && position !== undefined) {
      const existing = vfs.readFile(f.path);
      const merged = new Uint8Array(Math.max(existing.byteLength, position + bytes.byteLength));
      merged.set(existing);
      merged.set(bytes, position);
      vfs.writeFile(f.path, merged);
      // pwrite semantics (verified against real node): an EXPLICIT position
      // write does NOT move the fd's file offset — only position:null reads/
      // writes advance f.pos. (fs.writeSync(fd, 'foo', 0) leaves the offset
      // at 0; a following writeSync(fd, 'bar', null) overwrites from 0.)
      return bytes.byteLength;
    }
    if (f.flags & 1024 /* O_APPEND */) {
      vfs.appendFile(f.path, bytes);
      f.pos = vfs.stat(f.path).size;
    } else {
      const existing = vfs.readFile(f.path);
      const merged = new Uint8Array(Math.max(existing.byteLength, f.pos + bytes.byteLength));
      merged.set(existing);
      merged.set(bytes, f.pos);
      vfs.writeFile(f.path, merged);
      f.pos += bytes.byteLength;
    }
    return bytes.byteLength;
  }

  function statFields(p: string, followSymlinks: boolean, bigint = false): any {
    const s = followSymlinks ? vfs.stat(p) : vfs.lstat(p);
    // node's internal/fs/utils.getStatsFromBinding consumes a POSITIONAL
    // array: [dev, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks,
    // atimeS, atimeNs, mtimeS, mtimeNs, ctimeS, ctimeNs, birthtimeS,
    // birthtimeNs]. Array TYPE follows the binding's bigint flag exactly as
    // C++ node does: Float64Array for numbers, BigInt64Array for
    // bigint:true callers (fs.realpathSync passes bigint:true and calls
    // BigInt.prototype.toString on stats[0]). A named-fields object made
    // every Stats predicate (isDirectory/isSymbolicLink/…) false — which
    // silently broke realpathSync's symlink walk (the CJS loader's
    // tryFile→toRealPath depends on it, and therefore pnpm's symlinked
    // node_modules layout).
    if (!followSymlinks && (s.mode & 0o170000) === 0o120000 /* S_IFLNK */) {
      // node semantics: lstat of a symlink reports the TARGET STRING length
      // (targets are ASCII in practice — .length == byteLength).
      try { s.size = vfs.readlink(p).length; } catch { /* keep 0 */ }
    }
    const sec = (ms: number | undefined) => Math.floor(ms ?? 0);
    const ns = (ms: number | undefined) => Math.round(((ms ?? 0) - sec(ms ?? 0)) * 1e6);
    // Coerce every field to a finite number: undefined/NaN are legal in the
    // Float64Array form but throw in BigInt64Array.from (ToBigInt).
    const num = (v: number | undefined) =>
      typeof v === 'number' && Number.isFinite(v) ? v : 0;
    const nums = [
      num(s.dev), num(s.mode), num(s.nlink), num(s.uid), num(s.gid),
      num(s.rdev), num(s.blksize), num(s.ino), num(s.size), num(s.blocks),
      sec(s.atimeMs), ns(s.atimeMs),
      sec(s.mtimeMs), ns(s.mtimeMs),
      sec(s.ctimeMs), ns(s.ctimeMs),
      sec(s.birthtimeMs), ns(s.birthtimeMs),
    ];
    if (bigint) {
      // NB: BigInt64Array.from(array) is broken in bun's JSC (ToBigInt on a
      // plain Number array throws) — fill element-wise via BigInt() instead,
      // which works everywhere (V8, JSC, bun).
      const out = new BigInt64Array(nums.length);
      for (let i = 0; i < nums.length; i++) out[i] = BigInt(nums[i]);
      return out;
    }
    return new Float64Array(nums);
  }

  class FSReqCallback {
    oncomplete: ((err: number | null, ...args: any[]) => void) | null = null;
    context?: any;
    constructor(oncomplete?: (err: number | null, ...args: any[]) => void) {
      if (oncomplete) this.oncomplete = oncomplete;
    }
    toString() { return '[FSReqCallback]'; }
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /** Encode an entire string under a (possibly aliased) encoding name —
   * node's C++ WriteString → ParseEncoding + StringBytes::Write path. */
  function encodeWholeString(str: string, encoding?: string | null): Uint8Array {
    const name =
      encoding == null ? 'utf8'
      : String(encoding).toLowerCase().replace(/[-_]/g, '');
    switch (name) {
      case 'utf8':
        return enc.encode(str);
      case 'utf16le': case 'ucs2': {
        const out = new Uint8Array(str.length * 2);
        for (let i = 0; i < str.length; i++) {
          const c = str.charCodeAt(i);
          out[i * 2] = c & 0xff;
          out[i * 2 + 1] = (c >> 8) & 0xff;
        }
        return out;
      }
      case 'latin1': case 'binary': {
        const out = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
        return out;
      }
      case 'ascii': {
        const out = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0x7f;
        return out;
      }
      case 'hex': {
        const out = new Uint8Array(str.length >> 1);
        for (let i = 0; i < out.length; i++) {
          out[i] = Number.parseInt(str.substr(i * 2, 2), 16) || 0;
        }
        return out;
      }
      case 'base64': case 'base64url': {
        // lenient decode (node StringBytes BASE64 skips invalid chars)
        const norm = name === 'base64url'
          ? str.replace(/-/g, '+').replace(/_/g, '/')
          : str;
        const bin = atob(norm.replace(/[^A-Za-z0-9+/=]/g, ''));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      }
      default:
        return enc.encode(str);
    }
  }

  const binding: Binding = {
    FSReqCallback,

    // ---- open/close ----------------------------------------------------------
    open: dual('open', (a) => String(a[0]), (path: string, flags: number, _mode: number) =>
      registerFd(String(path), flags)),
    close: dual('close', (a) => String(a[0]), (fd: number) => {
      mustFd(fd, 'close');
      fds.delete(fd);
    }),

    // ---- read/write -----------------------------------------------------------
    read: dual('read', (a) => fdPath(a[0]), (fd: number, buffer: Uint8Array, offset: number, length: number, position: number) =>
      readFd(fd, buffer, offset, length, position)),
    writeBuffer: dual('write', (a) => fdPath(a[0]), (fd: number, buffer: Uint8Array, offset: number, length: number, position: number) => {
      // note: fs.js passes (fd, buffer, offset, length, position) — buffer slice [offset, offset+length)
      const chunk = buffer.subarray(offset, offset + length);
      return writeFd(fd, chunk, position);
    }),
    writeString: dual('write', (a) => fdPath(a[0]), (fd: number, str: string, position: number | null, encoding?: string) => {
      // node lib/fs.js contract (writeSync ~1234 / write ~1168):
      //   binding.writeString(fd, str, position, encoding, ...)
      // where arg 3 is the FILE POSITION (number | null — null = current
      // f.pos) and arg 4 is the ENCODING NAME ('utf8' default). The whole
      // string is encoded then written at `position`.
      const bytes = encodeWholeString(str, encoding);
      return writeFd(fd, bytes, position ?? null);
    }),
    writeBuffers: dual('write', (a) => fdPath(a[0]), (fd: number, buffers: Uint8Array[], position: number | null) => {
      // node lib/fs.js writev: binding.writeBuffers(fd, buffers, position, req)
      // with position normalized to number | null (null/-1 → current f.pos,
      // buffers written back-to-back).
      let written = 0;
      const explicit = position !== null && position !== undefined && position !== -1;
      for (const b of buffers) {
        written += writeFd(fd, b, explicit ? position! + written : null);
      }
      return written;
    }),
    readBuffers: dual('read', (a) => fdPath(a[0]), (fd: number, buffers: Uint8Array[], position: number | null) => {
      let total = 0;
      const explicit = position !== null && position !== undefined && position !== -1;
      for (const b of buffers) {
        const n = readFd(fd, b, 0, b.byteLength, explicit ? position! + total : null);
        total += n;
        if (n < b.byteLength) break;
      }
      return total;
    }),

    // ---- stat family ----------------------------------------------------------
    stat: dual('stat', (a) => String(a[0]), (path: string, bigint?: boolean, _req?: any, throwIfNoEntry?: boolean) => {
      try {
        return statFields(String(path), true, bigint === true);
      } catch (e) {
        if (throwIfNoEntry === false && e instanceof VfsError && e.code === 'ENOENT') return undefined;
        throw e;
      }
    }),
    lstat: dual('lstat', (a) => String(a[0]), (path: string, bigint?: boolean, _req?: any, throwIfNoEntry?: boolean) => {
      try {
        return statFields(String(path), false, bigint === true);
      } catch (e) {
        if (throwIfNoEntry === false && e instanceof VfsError && e.code === 'ENOENT') return undefined;
        throw e;
      }
    }),
    fstat: dual('fstat', (a) => fdPath(a[0]), (fd: number, bigint?: boolean, _req?: any, throwIfNoEntry?: boolean) => {
      try {
        return statFields(fdPath(fd), true, bigint === true);
      } catch (e) {
        if (throwIfNoEntry === false && e instanceof VfsError && e.code === 'ENOENT') return undefined;
        throw e;
      }
    }),

    // ---- directories -----------------------------------------------------------
    // S3.1: readdir with types MUST return the node contract tuple
    // [names[], types[]] with UV_DIRENT_* codes — lib/internal/fs/utils.js
    // getDirents destructures `{ 0: names, 1: types }` and Dirent#isDirectory()
    // compares kType against UV_DIRENT_DIR. The previous Array<{name,type}>
    // return made every withFileTypes readdir return raw VFS objects instead
    // of Dirents (found by fs-bench-traverse; breaks fs.cpSync, npm log-file).
    mkdir: dual('mkdir', (a) => String(a[0]), (path: string, mode: number, recursive: boolean) =>
      vfs.mkdir(String(path), !!recursive, mode)),
    rmdir: dual('rmdir', (a) => String(a[0]), (path: string) => {
      // rmdir requires an EMPTY dir
      const entries = vfs.readdir(String(path));
      if (entries.length) throw new VfsError('ENOTEMPTY', errnoOf('ENOTEMPTY'), 'rmdir', path);
      vfs.rm(String(path));
    }),
    readdir: dual('readdir', (a) => String(a[0]), (path: string, _encoding: string, types?: boolean) => {
      const p = String(path);
      if (vfs.exists(p) && !vfs.isDirectory(p)) {
        throw new VfsError('ENOTDIR', errnoOf('ENOTDIR'), 'readdir', p);
      }
      if (!types) return vfs.readdir(p);
      const entries = vfs.dirents(p);
      const names: string[] = [];
      const uvTypes: number[] = [];
      for (const e of entries) {
        names.push(e.name);
        uvTypes.push(uvDirentOfHelper(e.type));
      }
      return [names, uvTypes];
    }),
    // Recursive readdir: node contract (lib/fs.js readdirSyncRecursive +
    // getRecursiveDirents):
    //   without withFileTypes → string[] of RELATIVE joined paths
    //   with withFileTypes    → [names[], types[], counts[], dirs[]] where
    //     names/counts group per dirs entry (dirs[0] === '' root, others are
    //     relative dir paths) and types are UV_DIRENT_* codes.
    // The previous implementation returned ABSOLUTE paths for the non-types
    // variant and an unusable shape for the types variant.
    readdirRecursive: dual('readdir', (a) => String(a[0]),
      (basePath: string, _encoding?: string, withFileTypes?: boolean) => {
        const root = String(basePath);
        const paths: string[] = [];   // non-types variant
        const names: string[] = [];   // types variant (bare names, grouped)
        const uvTypes: number[] = [];
        const counts: number[] = [];
        const dirs: string[] = [''];
        const walk = (dir: string, rel: string) => {
          const entries = vfs.dirents(dir);
          if (withFileTypes) {
            counts.push(entries.length);
            for (const e of entries) {
              names.push(e.name);
              uvTypes.push(uvDirentOfHelper(e.type));
            }
          }
          for (const e of entries) {
            const childRel = rel === '' ? e.name : `${rel}/${e.name}`;
            if (!withFileTypes) paths.push(childRel);
            if ((e.type & 0o170000) === 0o040000) {
              if (withFileTypes) dirs.push(childRel);
              walk(vfs.joinPaths(dir, e.name), childRel);
            }
          }
        };
        walk(root, '');
        return withFileTypes ? [names, uvTypes, counts, dirs] : paths;
      }),
    mkdtemp: dual('mkdtemp', (a) => String(a[0]), (prefix: string) => {
      const dir = `${prefix}${Math.random().toString(36).slice(2, 10)}`;
      vfs.mkdir(dir, true);
      return dir;
    }),

    // ---- file-level sync fast paths ---------------------------------------------
    existsSync(path: string): boolean {
      try { vfs.stat(String(path)); return true; } catch { return false; }
    },
    readFileUtf8(path: string, _flags: number): string {
      return dec.decode(vfs.readFile(String(path)));
    },
    writeFileUtf8(path: string, data: string, _flags: number, _mode: number): void {
      vfs.writeFile(String(path), data);
    },
    rmSync(path: string, _maxRetries: number, recursive: boolean, _retryDelay: number): void {
      vfs.rm(String(path), { recursive, force: false });
    },

    // ---- mutations ---------------------------------------------------------------
    unlink: dual('unlink', (a) => String(a[0]), (path: string) => vfs.rm(String(path))),
    rename: dual('rename', (a) => String(a[0]), (oldPath: string, newPath: string) =>
      vfs.rename(String(oldPath), String(newPath))),
    copyFile: dual('copyfile', (a) => String(a[0]), (src: string, dest: string) =>
      vfs.copyFile(String(src), String(dest))),
    symlink: dual('symlink', (a) => String(a[1]), (target: string, path: string) =>
      vfs.symlink(String(target), String(path))),
    link: dual('link', (a) => String(a[0]), (existing: string, newPath: string) =>
      vfs.symlink(String(existing), String(newPath))),
    readlink: dual('readlink', (a) => String(a[0]), (path: string) => vfs.readlink(String(path))),
    chmod: dual('chmod', (a) => String(a[0]), (path: string, mode: number) => vfs.chmod(String(path), mode)),
    fchmod: dual('fchmod', (a) => fdPath(a[0]), (fd: number, mode: number) => vfs.chmod(fdPath(fd), mode)),
    utimes: dual('utimes', (a) => String(a[0]), (path: string, atime: number, mtime: number) =>
      vfs.utimes(String(path), atime, mtime)),
    futimes: dual('futimes', (a) => fdPath(a[0]), (fd: number, atime: number, mtime: number) =>
      vfs.utimes(fdPath(fd), atime, mtime)),
    lutimes: dual('lutimes', (a) => String(a[0]), (path: string, atime: number, mtime: number) =>
      vfs.utimes(String(path), atime, mtime)),
    truncate: dual('truncate', (a) => String(a[0]), (path: string, len: number) => {
      const data = vfs.readFile(String(path)).subarray(0, len);
      vfs.writeFile(String(path), new Uint8Array(data));
    }),
    ftruncate: dual('ftruncate', (a) => fdPath(a[0]), (fd: number, len: number) => {
      const f = mustFd(fd, 'ftruncate');
      const data = vfs.readFile(f.path).subarray(0, len);
      vfs.writeFile(f.path, new Uint8Array(data));
    }),
    access: dual('access', (a) => String(a[0]), (path: string) => { vfs.stat(String(path)); }),
    realpath: dual('realpath', (a) => String(a[0]), (path: string) => vfs.normalize(String(path))),

    // ---- fs.cp support (S3.1) ---------------------------------------------------
    // lib/internal/fs/cp/cp-sync.js drives the whole operation from JS but
    // leans on three C++ entry points for the no-filter paths; the async
    // side additionally needs CpDirJob. Semantics mirrored from node's
    // node_file.cc (CopySyncCheckPaths / CopySync / CpDirJob) and verified
    // by differential tests against real node v24 (message strings included).
    cpSyncCheckPaths(src: string, dest: string, dereference: boolean, recursive: boolean): void {
      const srcStat = dereference ? vfs.stat(String(src)) : vfs.lstat(String(src));
      const srcIsDir = (srcStat.mode & 0o170000) === 0o040000;
      const destExists = vfs.exists(String(dest));
      if (srcIsDir) {
        if (!recursive) {
          throw cpErr('ERR_FS_EISDIR',
            `Recursive option not enabled, cannot copy a directory: ${src}/`, String(dest), -21);
        }
        if (destExists) {
          const destStat = vfs.stat(String(dest));
          if ((destStat.mode & 0o170000) !== 0o040000) {
            throw cpErr('ERR_FS_CP_DIR_TO_NON_DIR',
              `Cannot overwrite non-directory ${dest} with directory ${src}`, String(dest));
          }
          if (destStat.ino === srcStat.ino && destStat.dev === srcStat.dev) {
            throw cpErr('ERR_FS_CP_EINVAL', `src and dest cannot be the same ${dest}`, String(dest));
          }
        }
        // dest inside src (path-string check, mirrors isSrcSubdir).
        const s = vfs.normalize(String(src));
        const d = vfs.normalize(String(dest));
        if (d === s || d.startsWith(s.endsWith('/') ? s : s + '/')) {
          throw cpErr('ERR_FS_CP_EINVAL',
            `Cannot copy ${s}/ to a subdirectory of self ${dest}`, String(dest));
        }
      } else if (destExists) {
        const destStat = vfs.stat(String(dest));
        if ((destStat.mode & 0o170000) === 0o040000) {
          throw cpErr('ERR_FS_CP_NON_DIR_TO_DIR',
            `Cannot overwrite directory ${dest} with non-directory ${src}`, String(dest));
        }
        if (destStat.ino === srcStat.ino && destStat.dev === srcStat.dev) {
          throw cpErr('ERR_FS_CP_EINVAL', `src and dest cannot be the same ${dest}`, String(dest));
        }
      }
    },
    cpSyncOverrideFile(src: string, dest: string, _mode: number, preserveTimestamps: boolean): void {
      vfs.rm(String(dest), { force: true });
      vfs.copyFile(String(src), String(dest));
      if (preserveTimestamps) {
        const st = vfs.stat(String(src));
        vfs.chmod(String(dest), st.mode);
        vfs.utimes(String(dest), st.atimeMs ?? 0, st.mtimeMs ?? 0);
      }
    },
    cpSyncCopyDir(src: string, dest: string, force: boolean, dereference: boolean,
      errorOnExist: boolean, verbatimSymlinks: boolean, preserveTimestamps: boolean): void {
      const srcStat = vfs.stat(String(src));
      vfs.mkdir(String(dest), false, srcStat.mode & 0o7777);
      const walk = (dir: string, outDir: string) => {
        for (const e of vfs.dirents(dir)) {
          const from = vfs.joinPaths(dir, e.name);
          const to = vfs.joinPaths(outDir, e.name);
          const type = e.type & 0o170000;
          if (type === 0o040000) {
            // Create the directory entry before descending (mirror of the
            // C++ walk: mkdir(dest entry) with the source dir's mode).
            const st = vfs.stat(from);
            vfs.mkdir(to, false, st.mode & 0o7777);
            if (preserveTimestamps) {
              vfs.chmod(to, st.mode);
              vfs.utimes(to, st.atimeMs ?? 0, st.mtimeMs ?? 0);
            }
            walk(from, to);
          } else if (type === 0o120000) {
            let target = vfs.readlink(from);
            if (!verbatimSymlinks && !target.startsWith('/')) {
              target = vfs.normalize(`${vfs.dirname(dir)}/${target}`);
            }
            if (vfs.exists(to)) {
              if (force) { vfs.rm(to); vfs.symlink(target, to); }
              else if (errorOnExist) throw cpErr('ERR_FS_CP_EEXIST', `Target already exists: ${to} already exists`, to);
            } else {
              vfs.symlink(target, to);
            }
          } else if (type === 0o100000) {
            if (vfs.exists(to)) {
              if (force) {
                vfs.rm(to);
                vfs.copyFile(from, to);
                if (preserveTimestamps) {
                  const st = vfs.stat(from);
                  vfs.chmod(to, st.mode);
                  vfs.utimes(to, st.atimeMs ?? 0, st.mtimeMs ?? 0);
                }
              } else if (errorOnExist) {
                throw cpErr('ERR_FS_CP_EEXIST', `Target already exists: ${to} already exists`, to);
              } // else: silently skip (node's semantics without force)
            } else {
              vfs.copyFile(from, to);
              if (preserveTimestamps) {
                const st = vfs.stat(from);
                vfs.chmod(to, st.mode);
                vfs.utimes(to, st.atimeMs ?? 0, st.mtimeMs ?? 0);
              }
            }
          } else if (type === 0o140000) {
            throw cpErr('ERR_FS_CP_SOCKET', `cannot copy a socket file: ${to}`, to);
          } else if (type === 0o010000) {
            throw cpErr('ERR_FS_CP_FIFO_PIPE', `cannot copy a FIFO pipe: ${to}`, to);
          } else {
            throw cpErr('ERR_FS_CP_UNKNOWN', `cannot copy an unknown file type: ${to}`, to);
          }
        }
      };
      walk(String(src), String(dest));
    },

    /** Async fs.cp dir job (lib/internal/fs/cp/cp.js copyDirNative):
     *  run() performs the walk asynchronously and reports through ondone
     *  (err, specialFile?, specialFilePath?) — sockets/fifos come back as
     *  (kind, path) so the JS rejects with node's exact errors. */
    CpDirJob: class CpDirJob {
      ondone: ((err: Error | null, specialFile?: string, specialFilePath?: string) => void) | null = null;
      constructor(
        private src: string, private dest: string, private force: boolean,
        private dereference: boolean, private errorOnExist: boolean,
        private verbatimSymlinks: boolean, private preserveTimestamps: boolean,
        private _mode: number,
      ) {}
      run(): void {
        queueMicrotask(() => {
          // Sentinel for special files: node's C++ surfaces them as
          // (kind, path) rather than an error so the JS can reject with
          // ERR_FS_CP_SOCKET / _FIFO_PIPE / _UNKNOWN itself.
          const special = (kind: string, path: string) => {
            const marker: any = new Error('oc-cp-special');
            marker.__ocSpecial = [kind, path];
            throw marker;
          };
          try {
            const srcStat = vfs.stat(this.src);
            vfs.mkdir(this.dest, false, srcStat.mode & 0o7777);
            const walk = (dir: string, outDir: string): void => {
              for (const e of vfs.dirents(dir)) {
                const from = vfs.joinPaths(dir, e.name);
                const to = vfs.joinPaths(outDir, e.name);
                const type = e.type & 0o170000;
                if (type === 0o040000) {
                  const st = vfs.stat(from);
                  vfs.mkdir(to, false, st.mode & 0o7777);
                  if (this.preserveTimestamps) {
                    vfs.chmod(to, st.mode);
                    vfs.utimes(to, st.atimeMs ?? 0, st.mtimeMs ?? 0);
                  }
                  walk(from, to);
                } else if (type === 0o120000) {
                  let target = vfs.readlink(from);
                  if (!this.verbatimSymlinks && !target.startsWith('/')) {
                    target = vfs.normalize(`${vfs.dirname(dir)}/${target}`);
                  }
                  if (vfs.exists(to)) {
                    if (this.force) { vfs.rm(to); vfs.symlink(target, to); }
                    else if (this.errorOnExist) {
                      throw cpErr('ERR_FS_CP_EEXIST', `Target already exists: ${to} already exists`, to);
                    }
                  } else {
                    vfs.symlink(target, to);
                  }
                } else if (type === 0o100000) {
                  if (vfs.exists(to)) {
                    if (this.force) {
                      vfs.rm(to);
                      vfs.copyFile(from, to);
                      if (this.preserveTimestamps) {
                        const st = vfs.stat(from);
                        vfs.chmod(to, st.mode);
                        vfs.utimes(to, st.atimeMs ?? 0, st.mtimeMs ?? 0);
                      }
                    } else if (this.errorOnExist) {
                      throw cpErr('ERR_FS_CP_EEXIST', `Target already exists: ${to} already exists`, to);
                    }
                  } else {
                    vfs.copyFile(from, to);
                    if (this.preserveTimestamps) {
                      const st = vfs.stat(from);
                      vfs.chmod(to, st.mode);
                      vfs.utimes(to, st.atimeMs ?? 0, st.mtimeMs ?? 0);
                    }
                  }
                } else if (type === 0o140000) {
                  special('socket', to);
                } else if (type === 0o010000) {
                  special('fifo', to);
                } else {
                  special('unknown', to);
                }
              }
            };
            walk(this.src, this.dest);
            this.ondone?.(null);
          } catch (err: any) {
            if (err && typeof err === 'object' && err.__ocSpecial) {
              const [kind, path] = err.__ocSpecial as [string, string];
              this.ondone?.(null, kind, path);
            } else {
              this.ondone?.(err ?? new Error(String(err)));
            }
          }
        });
      }
    },
    statfs: dual('statfs', (a) => String(a[0]), (path: string) => {
      vfs.stat(String(path));
      return {
        bsize: 4096, frsize: 4096, blocks: 1 << 20, bfree: 1 << 19,
        bavail: 1 << 19, files: 1e5, ffree: 9e4, fsid: 0, flags: 0, namelen: 255,
      };
    }),
    chown: dual('chown', (a) => String(a[0]), (path: string) => { vfs.stat(String(path)); }),
    fchown: dual('fchown', (a) => fdPath(a[0]), (fd: number) => { mustFd(fd, 'fchown'); }),
    lchown: dual('lchown', (a) => String(a[0]), (path: string) => { vfs.stat(String(path)); }),
    fdatasync: dual('fdatasync', (a) => fdPath(a[0]), (fd: number) => { mustFd(fd, 'fdatasync'); }),
    fsync: dual('fsync', (a) => fdPath(a[0]), (fd: number) => { mustFd(fd, 'fsync'); }),

    // ---- async job classes (fs.js one-shot readers) -------------------------------
    /** fs.js readFile fast path: new ReadFileJob(path, flags, bufLen, unmanaged);
     *  job.ondone = readFileAfterOneShot(err, buffer, fd=-1, size, closeErr);
     *  job.run(path) → undefined (scheduled) | errno (sync access error). */
    ReadFileJob: class ReadFileJob {
      oncomplete: any = null;
      ondone: ((err: any, buffer?: Uint8Array, fd?: number, size?: number, closeErr?: any) => void) | null = null;
      context: any = null;
      constructor(
        public path: any,
        public flags: any,
        _bufferLength?: number,
        _unmanaged?: boolean,
      ) {}
      run(path?: any): number | undefined {
        const p = String(path ?? this.path);
        try {
          const raw = vfs.readFile(p);
          // Deliver a real Buffer VIEW (no copy) so context.encoding paths
          // (buffer.toString('utf8')) behave like node.
          const B = (globalThis as any).Buffer;
          const data: Uint8Array = B
            ? B.from(raw.buffer, raw.byteOffset, raw.byteLength)
            : raw;
          queueMicrotask(() => this.ondone?.(null, data, -1, data.length, undefined));
          return undefined;
        } catch (e: any) {
          // node's C++ returns an ErrnoException object (callers run
          // Error.captureStackTrace on it) — never a bare errno.
          if (e instanceof VfsError) {
            const err: any = new Error(`${e.code}: open, '${p}'`);
            err.code = e.code;
            err.errno = -errnoOf(e.code);
            err.syscall = 'open';
            err.path = p;
            return err;
          }
          return e instanceof Error ? e : new Error(String(e));
        }
      }
      start(): number | undefined { return this.run(); }
    },
    WriteFileJob: class WriteFileJob {
      oncomplete: any = null;
      ondone: ((err: any) => void) | null = null;
      constructor(public path: any, public flags: any, public mode?: any, public data?: any) {}
      run(path?: any): number | undefined {
        const p = String(path ?? this.path);
        try {
          vfs.writeFile(p, this.data as any);
          queueMicrotask(() => this.ondone?.(null));
          return undefined;
        } catch (e: any) {
          if (e instanceof VfsError) {
            const err: any = new Error(`${e.code}: open, '${p}'`);
            err.code = e.code;
            err.errno = -errnoOf(e.code);
            err.syscall = 'open';
            err.path = p;
            return err;
          }
          return e instanceof Error ? e : new Error(String(e));
        }
      }
      start() { return this.run(); }
    },
    FileHandle: class FileHandle {
      constructor(public fd: number) {}
      close() { fds.delete(this.fd); }
    },

    /** internal/fs/watchers.js: fs.watchFile backend (polling-free no-op:
     *  onchange is assigned by JS; start() registers a poll when needed). */
    StatWatcher: class StatWatcher {
      onchange: ((current: any, previous: any) => void) | null = null;
      constructor(_opts?: any) {}
      start(_path: string, _bigint: boolean, _persistent: boolean, _interval: number): void {
        // S1: stat polling not implemented — watchFile callbacks stay quiet.
      }
      stop(): void {}
      ref() {}
      unref() {}
    },

    /** internal/fs/promises.js open(): binding.openFileHandle(path, flags, mode, kUsePromises)
     *  → Promise<{fd:number}> (JS FileHandle wraps the result). */
    openFileHandle(path: any, flags?: any, mode?: any, reqOrPromise?: any): any {
      const openIt = (): number => {
        const flagsNumber = typeof flags === 'number' ? flags : 0 /* O_RDWR|O_CREAT-ish defaults handled by registerFd */;
        return registerFd(String(path), flagsNumber | (flagsNumber === 0 ? 64 /* O_CREAT */ : 0));
      };

      if (reqOrPromise === kUsePromisesFlag) {
        return new Promise((resolve, reject) => {
          queueMicrotask(() => {
            try {
              const fd = openIt();
              // node's C++ FileHandle: { fd, close() → Promise } — the JS
              // FileHandle class delegates close() to this object.
              resolve({
                fd,
                close(): Promise<void> {
                  return new Promise((res, rej) => {
                    queueMicrotask(() => {
                      try { fds.delete(fd); res(); }
                      catch (e) { rej(e); }
                    });
                  });
                },
              });
            } catch (e) {
              reject(errnoExceptionOf(e, 'open', String(path)));
            }
          });
        });
      }
      if (isReq(reqOrPromise)) {
        try {
          const fd = openIt();
          queueMicrotask(() => (reqOrPromise as ReqLike).oncomplete?.(null, fd));
        } catch (e: any) {
          queueMicrotask(() => (reqOrPromise as ReqLike).oncomplete?.(uvCode(e)));
        }
        return;
      }
      return openIt();
    },

    kUsePromises: 1 << 30,

    // ---- CJS loader natives (helpers.js loaderMethods) -------------------------------
    /** internalModuleStat: 0 = file, 1 = dir, negative = -errno. Cached by loader.js.
     *  Raw VFS stats carry the type in `mode` bits (S_IFMT/S_IFDIR) — there is
     *  no `.isDirectory` FIELD (that's the Stats class method) — reading it as
     *  a property made EVERY path classify as a file, breaking the CJS
     *  resolver's directory branch (node_modules/index resolution). */
    internalModuleStat(filename: string): number {
      try {
        const st = vfs.stat(String(filename));
        return (st.mode & 0o170000) === 0o040000 ? 1 : 0;
      } catch (e: any) {
        return -uvCode(e);
      }
    },

    /**
     * legacyMainResolve(pkgPath, main, base): resolve a package's "main".
     * Returns an INDEX into helpers.js legacyMainResolveExtensions
     * ['', '.js', '.json', '.node', '/index.js', '/index.json', '/index.node',
     *  './index.js', './index.json', './index.node'] — 0-6 when main is
     * defined, 7-9 otherwise. Falls back to 7 (index.js) when nothing
     * matches, matching node's load-time failure path.
     */
    legacyMainResolve(pkgPath: string, main?: string, _base?: string): number {
      const pkgDir = vfs.normalize(String(pkgPath)).replace(/\/package\.json$/, '');
      const isFile = (p: string): boolean => {
        try {
          const st = vfs.stat(p);
          return (st.mode & 0o170000) === 0o100000;
        } catch { return false; }
      };
      const hasDir = (p: string): boolean => {
        try { return (vfs.stat(p).mode & 0o170000) === 0o040000; } catch { return false; }
      };
      if (main != null && main !== '') {
        const m = main.replace(/^\.\//, '');
        if (isFile(`${pkgDir}/${m}`)) return 0;
        if (isFile(`${pkgDir}/${m}.js`)) return 1;
        if (isFile(`${pkgDir}/${m}.json`)) return 2;
        if (isFile(`${pkgDir}/${m}.node`)) return 3;
        if (isFile(`${pkgDir}/${m}/index.js`)) return 4;
        if (isFile(`${pkgDir}/${m}/index.json`)) return 5;
        if (isFile(`${pkgDir}/${m}/index.node`)) return 6;
        if (hasDir(`${pkgDir}/${m}`)) return 4;
        return 0;
      }
      if (isFile(`${pkgDir}/index.json`)) return 8;
      if (isFile(`${pkgDir}/index.node`)) return 9;
      return 7;
    },

    /** getFormatOfExtensionlessFile: 1 = WASM (constants.internal.EXTENSIONLESS_FORMAT_WASM), 0 = JS. */
    getFormatOfExtensionlessFile(filePath: string): number {
      try {
        const data = vfs.readFile(String(filePath));
        if (
          data.length >= 4 &&
          data[0] === 0x00 && data[1] === 0x61 &&
          data[2] === 0x73 && data[3] === 0x6d
        ) {
          return 1;
        }
      } catch { /* fallthrough: JS */ }
      return 0;
    },
  };

  return binding;
}
