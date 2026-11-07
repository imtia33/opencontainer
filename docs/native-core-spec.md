# OpenContainer Native Core — Rust→WASM kernel ABI specification

**Status: FROZEN CONTRACT v1** — the Rust crate (`kernel/native-core/`), the TS
bridge (`kernel/native-vfs.ts`) and the `natives/fs.ts` syscall refactor all
implement against this document. Motivation + WebContainers parity analysis:
`docs/native-kernel-research.md` (their kernel is Rust→wasm; Node's JS stdlib
runs on the browser engine — our architecture class, now with a native core).

Goal: move the kernel's hot data plane — VFS inode tree, fd table, path
resolution, file I/O, tar extraction — from TypeScript objects into a Rust
crate compiled to `wasm32-unknown-unknown`, called synchronously from the
kernel worker via a flat C ABI. JS keeps: watchers, persist deltas, node
`ErrnoException` shaping, stdio bridging (fds 0/1/2), async scheduling.

## 1. Crate

```
kernel/native-core/
  Cargo.toml        # crate-type ["cdylib","rlib"], std-only, NO external deps
  src/lib.rs        # exports + errno consts + slots
  src/arena.rs      # chunked bump arena (inbound), out buffer (outbound)
  src/vfs.rs        # inode arena, children, fd table, path resolution
  src/syscalls.rs   # oc_* implementations
  src/tar.rs        # ustar/GNU/pax extractor -> VFS entries
```

`Cargo.toml` release profile: `opt-level="z"`, `lto=true`, `codegen-units=1`,
`panic="abort"`, `strip=true`. Build:
`cargo build --release --target wasm32-unknown-unknown` →
`target/wasm32-unknown-unknown/release/native_core.wasm` (ship as
`pkg/oc_core.wasm`). Budget: ≤ 400 KB raw.

Rust targets Linux flag values (what node/UV pass through — fs.ts already
relies on the numeric values): `O_RDONLY=0 O_WRONLY=1 O_RDWR=2 O_CREAT=64
O_EXCL=128 O_TRUNC=512 O_APPEND=1024`.

Errno returns: every export returns `i32`; `>= 0` is success (value/count),
`< 0` is `-errno` (Linux numbers: EPERM 1, ENOENT 2, EIO 5, EBADF 9, EACCES 13,
EBUSY 16, EEXIST 17, EXDEV 18, ENOTDIR 20, EISDIR 21, EINVAL 22, EMFILE 24,
ENOSPC 28, ESPIPE 29, ENAMETOOLONG 36, ENOSYS 38, ENOTEMPTY 39, ELOOP 40).

## 2. Memory conventions (linear memory)

- **Inbound arena** — chunked bump allocator, append-only. `oc_arena_alloc(n)`
  returns a pointer valid until the NEXT `oc_arena_reset()`; allocating never
  moves previous allocations (allocate a new 1 MB chunk when the current one
  is full; chunks are boxed and stable). Bridge calls `oc_arena_reset()` after
  each syscall wrapper (it is only safe to reset when no live allocations are
  needed — the bridge owns that discipline). JS writes path/data bytes into
  these pointers via one cached whole-memory `Uint8Array`.
- **Out buffer** — a growable `Vec<u8>` for returned byte blobs (file reads,
  readdir name lists, symlink targets, getcwd). Exports that produce blobs
  write `(ptr: u32, len: u32)` into **RET_SLOT** and return 0/-errno. The blob
  is valid only until the next oc_* call (single thread; JS copies it out
  synchronously).
- **STAT_SLOT** — 144 bytes = 18 × f64, positional node stat layout
  `[dev, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks, atimeS,
  atimeNs, mtimeS, mtimeNs, ctimeS, ctimeNs, birthtimeS, birthtimeNs]` —
  exactly what `internalBinding('fs')` stat/lstat/fstat must hand to
  `lib/internal/fs/utils.js` (Float64Array form; the bridge wraps
  BigInt64Array when bigint:true). Times are computed in Rust: `sec =
  floor(ms/1000)`, `ns = round((ms - sec*1000) * 1e6)` (same as fs.ts today).

Slot discovery (call once at init; addresses are static for module lifetime):
```
oc_version() -> i32            // 1
oc_stat_slot() -> i32          // address of STAT_SLOT
oc_ret_slot() -> i32           // address of RET_SLOT (8 bytes)
```

## 3. Export list (C ABI, all `extern "C"`, all synchronous)

### lifecycle / memory
```
oc_arena_reset()
oc_arena_alloc(n: i32) -> ptr | 0(=OOM -> return 0; bridge throws)
```

### cwd (Rust owns the cwd — npm resolves thousands of relative paths)
```
oc_chdir(path_ptr, path_len) -> 0 | -errno        // ENOENT/ENOTDIR
oc_getcwd() -> 0 (RET_SLOT: cwd bytes) | -errno
```

### fd ops (the syscall hot path; fd table lives in Rust, next_fd starts at 3)
```
oc_open(path_ptr, path_len, flags, mode) -> fd | -errno
    // full open(2): resolve parents following symlinks (a path THROUGH a
    // symlinked dir resolves to the target dir). Final component: follows a
    // symlink to its target file (writes land on the target — vfs.ts
    // writeFile semantics). O_CREAT creates empty file with mode&0o777
    // (default 0o666 when 0). O_CREAT|O_EXCL -> EEXIST if it exists (any
    // type). O_TRUNC truncates NOW (only regular files; EISDIR if dir and
    // writing). Open a DIRECTORY read-only is allowed (for fstat); opening a
    // dir with write flags -> EISDIR. ENOENT if missing without O_CREAT or
    // parent missing. O_APPEND sets pos = size at open and every write.
oc_close(fd) -> 0 | -EBADF
oc_read(fd, len) -> 0 (RET_SLOT: bytes read, len = n) | -errno
    // reads at fd pos, advances pos by n. len=0 -> n=0. EBADF if not open.
    // EISDIR if fd is a dir. Short read at EOF.
oc_pread(fd, len, pos: i64) -> 0 (RET_SLOT) | -errno   // never moves fd pos; ESPIPE on append-only fd
oc_write(fd, data_ptr, data_len) -> n | -errno
    // writes at fd pos (append: at end), advances pos. Grows the file Vec.
    // Write to a dir fd -> EISDIR.
oc_pwrite(fd, data_ptr, data_len, pos: i64) -> n | -errno  // never moves fd pos
oc_ftruncate(fd, len: i64) -> 0 | -errno
oc_fstat(fd) -> 0 (STAT_SLOT) | -EBADF
oc_fchmod(fd, mode) -> 0 | -EBADF
```

### path ops (mirror `kernel/vfs.ts` semantics EXACTLY — they are battle-tested)
```
oc_stat(path_ptr, path_len)   -> 0 (STAT_SLOT, symlinks followed) | -errno
oc_lstat(path_ptr, path_len)  -> 0 (STAT_SLOT) | -errno
    // lstat of a symlink: size = TARGET BYTE LENGTH, mode S_IFLNK.
oc_exists(path_ptr, path_len) -> 1 | 0
oc_mkdir(path_ptr, path_len, mode) -> 0 | -errno
    // non-recursive: EEXIST if entry exists (any type); ENOENT if parent
    // missing or not a dir.
oc_mkdirp(path_ptr, path_len, mode) -> 0 | -errno
    // recursive: creates parents; EEXIST only if FINAL exists and is NOT a
    // dir; ENOTDIR if a non-dir sits on the path.
oc_rmdir(path_ptr, path_len) -> 0 | -errno       // ENOTEMPTY if children; ENOENT if missing; EISDIR check (ENOTDIR if file)
oc_unlink(path_ptr, path_len) -> 0 | -errno      // removes file OR symlink (not dir: EISDIR... NOTE vfs.ts rm() allows any; unlink on dir -> EISDIR is node behavior; bridge uses rmrf for rm)
oc_rmrf(path_ptr, path_len, force: i32) -> 0 | -errno
    // recursive delete of any type; force=1: ENOENT is success (rm -f).
    // non-recursive mode is NOT needed here (bridge composes).
oc_rm_nonrecursive(path_ptr, path_len, force: i32) -> 0 | -errno // ENOTEMPTY if dir with children
oc_rename(old_ptr, old_len, new_ptr, new_len) -> 0 | -errno
    // POSIX matrix (vfs.ts): file->existing file = replace; dir->existing
    // EMPTY dir = replace; dir->non-empty dir = ENOTEMPTY; file->dir =
    // EISDIR; dir->file = ENOTDIR; missing src = ENOENT; missing new parent
    // = ENOENT. Renaming into itself (same inode) = no-op success. A moved
    // dir keeps its subtree. Insertion order: entry re-inserts at END of the
    // new parent's readdir order.
oc_symlink(target_ptr, target_len, path_ptr, path_len) -> 0 | -errno
    // target stored verbatim (may be relative or absolute). ENOENT if
    // parent missing. EEXIST if entry exists (bridge pre-checks to keep
    // vfs.ts's non-atomic but silent-overwrite? NO — vfs.ts overwrites
    // nothing; it fires rename watchers on the parent even if it would
    // collide. Keep EXACT: bridge checks exists() first and skips the call
    // if the entry exists (importTree idempotency depends on try/catch
    // anyway).
oc_readlink(path_ptr, path_len) -> 0 (RET_SLOT: target) | -errno
    // MISSING path -> ENOENT (2); existing non-symlink -> EINVAL (22).
    // pnpm's resolveLinkTarget depends on the distinction.
oc_readdir(path_ptr, path_len) -> 0 (RET_SLOT: names, NUL-separated, insertion order) | -errno
oc_dirents(path_ptr, path_len) -> 0 (RET_SLOT: per entry: name NUL + u8 S_IFMT>>12 code: 8=file 4=dir 10=symlink) | -errno
oc_chmod(path_ptr, path_len, mode) -> 0 | -errno   // keeps type bits; updates ctime
oc_utimes(path_ptr, path_len, atime_ms: f64, mtime_ms: f64) -> 0 | -errno
oc_truncate(path_ptr, path_len, size: i64) -> 0 | -errno
oc_copy_file(src_ptr, src_len, dst_ptr, dst_len) -> 0 | -errno
```

### whole-file fast paths (npm/cacache/tar write shape — ONE call per file)
```
oc_write_file(path_ptr, path_len, data_ptr, data_len, mode) -> 0 | -errno
    // = open(O_WRONLY|O_CREAT|O_TRUNC, mode) + write(all) + close, with the
    // parent symlink walk. EISDIR if path is a dir; ENOENT if parent
    // missing (fs.ts maps this with syscall name 'open'). If path is a
    // symlink: writes to the TARGET (vfs.ts semantics), leaving the link.
oc_read_file(path_ptr, path_len) -> 0 (RET_SLOT: full bytes) | -errno
oc_append_file(path_ptr, path_len, data_ptr, data_len) -> 0 | -errno
```

### path utilities (pure functions — normalize happens HERE, not in JS)
```
oc_normalize(path_ptr, path_len) -> 0 (RET_SLOT: normalized absolute path)
    // relative paths resolve against the Rust cwd. '.' skipped, '..' pops
    // (bounded at root), '//' collapsed, trailing slash preserved for dirs
    // (vfs.ts keeps a trailing '/' only when the input had one and result
    // is not root). EMPTY input: return -EINVAL (bridge throws
    // ERR_INVALID_ARG_VALUE before calling, so this is a safety net).
oc_join_normalize(base_ptr, base_len, rel_ptr, rel_len) -> 0 (RET_SLOT) // rel absolute -> itself
```

### tar (for OpenContainer's own extraction paths; npm keeps its JS tar)
```
oc_extract_tar(data_ptr, data_len, dest_ptr, dest_len) -> n_entries | -errno
    // dest must exist (ENOENT otherwise). ustar + pax + GNU extensions:
    // '0'/'\0' file, '5' dir, '2' symlink, '1' hardlink (stored as symlink),
    // 'L' GNU longname, 'K' longlink, 'x' pax header (path/linkpath
    // override), 'g' global pax (ignore), 'x' POSIX pax. Security: strip
    // leading '/' and "./" from entry names; REJECT (EINVAL, no partial
    // write of that entry) any entry whose joined path escapes dest via
    // '..' after normalization. mode&0o7777 and mtime honored. Existing
    // entries are overwritten (tar semantics). Returns entries extracted
    // (files+dirs+links).
```

### stats
```
oc_debug_counts() -> 0 (RET_SLOT: 4×u32: inodes, files, dirs, fds)
```

## 4. Internal data structures (required — mirrors WasmFS, sized for npm)

- `inodes: Vec<Inode>`, `InodeId = u32` (0 = root, present at construction).
  `Inode { name: Box<str>, parent: u32, kind: Kind, mode: u32, ino: u64
  (monotonic from 1), atime_ms/ctime_ms/mtime_ms/birthtime_ms: f64 }`.
  `Kind::Dir { children: HashMap<Box<str>, u32>, order: Vec<u32>,
  tombstones: u32 }` — HashMap for O(1) lookup + order Vec for stable
  INSERTION-ORDER readdir (node_modules readdir order must not scramble:
  npm test suites compare listings). Tombstone = u32::MAX in order; compact
  when tombstones > order.len()/2. `Kind::File { data: Vec<u8> }`.
  `Kind::Symlink { target: Box<str> }`. Free inodes (unlink) go on a
  `free_list: Vec<u32>` for reuse (ino keeps increasing — never reuse ino).
- `fds: Vec<Option<FdEntry>>` with `FdEntry { inode: u32, pos: i64, flags:
  i32 }`; scan for first free slot (WasmFS pattern), cap 4096 (EMFILE).
- Path resolution: iterative segment walk; symlinks resolved with the
  parent-join rule (relative targets join the symlink's PARENT dir) with a
  40-follow budget -> ELOOP. Root parent = root.
- Never panic across the ABI: every export is `catch_unwind`-equivalent
  (panic=abort means a panic kills the worker — so all oc_* must be
  infallible by construction: no slicing/arithmetic that can panic; validate
  every ptr/len pair BEFORE dereferencing: ptr+len <= memory size, len >= 0).
  Bad ptr/len -> return -EFAULT (14).

## 5. Behavioral acceptance (cargo test, host target — port these from vfs.ts/fs.ts semantics)

1. POSIX rename matrix (all 6 branches + same-inode no-op + subtree move +
   readdir order: renamed entry moves to END of new parent).
2. open flags: O_CREAT/O_EXCL race-free EEXIST; O_TRUNC empties at open;
   O_APPEND appends + pos tracks size; pwrite does NOT move fd pos; explicit
   position read does not move pos.
3. Symlinks: mid-path dir symlink resolves; final-component symlink open
   writes the TARGET; ELOOP at 40; readlink ENOENT vs EINVAL; lstat size =
   target length; symlink-to-dir mkdirp creates inside target.
4. readdir: insertion order incl. after rename/unlink/re-create;
   dirents type codes; tombstone compaction correctness.
5. mkdir/mkdirp/rmdir/unlink/rmrf force matrix (EEXIST/ENOENT/ENOTEMPTY/
   ENOTDIR/EISDIR exactly as §3).
6. write_file fast path = open+write+close equivalence (byte-for-byte,
   including through-symlink and EISDIR/ENOENT errors).
7. tar: hand-built fixtures — plain file, nested dirs, symlink, GNU
   longname > 100 chars, pax path override, `../escape` rejected EINVAL,
   absolute path stripped, overwrite existing.
8. arena: 10k allocs no-move across chunk growth; reset recycles.
9. cwd: chdir + relative resolution via oc_normalize + open("relative").
10. STAT_SLOT layout byte-exact for a known file (18 f64s, sec/ns split).

Wasm smoke (node script, not a benchmark): instantiate the built .wasm,
allocate a path, mkdir/mkdirp/write_file/read_file/readdir/stat/open/read/
write/pwrite/close/rename/symlink/readlink/extract_tar happy paths — all
green under `node`.

## 6. What does NOT move into Rust (v1)

Watchers (JS callbacks), persist delta hooks, `VfsError`/ErrnoException
shaping, fds 0/1/2 stdio bridging, `dual()` async/promise/sync wrapper
machinery, `mkdtemp`, `readdirRecursive`, `fs.cp` orchestration, encodings
(utf16le/hex/base64 — stays in fs.ts), `realpath` (= normalize), VfsTree
import/export loops (bridge loops oc_mkdirp/oc_write_file/oc_read_file).
These all keep working through the bridge's `Vfs`-compatible surface.
