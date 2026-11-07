//! oc_* syscall implementations (spec §3). Every function is panic-free by
//! construction: no unwraps on user input, no unchecked slicing, all
//! arithmetic bounded (see README "panic safety"). The thin `#[no_mangle]`
//! wrappers in lib.rs validate ptr/len pairs against the actual memory size
//! (-EFAULT) before calling anything here.

use crate::vfs::*;

// ---- lifecycle / cwd ---------------------------------------------------------

pub fn chdir(v: &mut Vfs, path: &str) -> i32 {
    let norm = match v.normalize(path) {
        Some(n) => n,
        None => return -EINVAL,
    };
    match v.resolve(&norm, true) {
        Ok(Res::Node(id)) => {
            if !v.is_dir(id) {
                return -ENOTDIR;
            }
            // chdir stores the canonical (symlink-resolved) path, like
            // process.chdir + realpath in node.
            v.cwd = v.path_of(id);
            0
        }
        Ok(Res::Missing { .. }) => -ENOENT,
        Err(e) => -e,
    }
}

pub fn getcwd(v: &Vfs) -> Vec<u8> {
    v.cwd.as_bytes().to_vec()
}

// ---- fd ops -------------------------------------------------------------------

pub fn open(v: &mut Vfs, t: &mut FdTable, path: &str, flags: i32, mode: i32) -> i32 {
    let norm = match v.normalize(path) {
        Some(n) => n,
        None => return -EINVAL,
    };
    let creat = flags & O_CREAT != 0;
    let excl = flags & O_EXCL != 0;
    let trunc = flags & O_TRUNC != 0;
    let app = flags & O_APPEND != 0;
    let writing = flags & 3 != 0;

    // O_CREAT|O_EXCL -> EEXIST if ANY entry sits at path (any type,
    // including a dangling symlink — POSIX link-level check; spec "any type").
    if creat && excl {
        if let Ok(Res::Node(_)) = v.resolve(&norm, false) {
            return -EEXIST;
        }
    }

    let id = match v.resolve(&norm, true) {
        Ok(Res::Node(id)) => id,
        Ok(Res::Missing { parent, name }) => {
            if !creat {
                return -ENOENT;
            }
            let m = if mode == 0 { 0o666 } else { (mode as u32) & 0o777 };
            let now = v.now_ms();
            v.create_file(parent, &name, m, Vec::new(), now)
        }
        Err(e) => return -e,
    };

    let pos: i64;
    match &v.inodes[id as usize].kind {
        Kind::Dir { .. } => {
            if writing {
                return -EISDIR;
            }
            pos = 0; // read-only dir fd (for fstat)
        }
        Kind::File { .. } => {
            if trunc && writing {
                let now = v.now_ms();
                v.file_set(id, &[], now);
            }
            pos = if app { v.file_len(id) as i64 } else { 0 };
        }
        Kind::Symlink { .. } => return -ENOENT, // unreachable: resolve(follow=true)
    }
    match t.alloc(id, pos, flags) {
        Ok(fd) => fd,
        Err(e) => e,
    }
}

pub fn close(t: &mut FdTable, fd: i32) -> i32 {
    if t.close(fd) {
        0
    } else {
        -EBADF
    }
}

/// Shared body of read/pread: never moves fd pos (the caller decides).
fn read_at(v: &Vfs, inode: u32, len: i32, pos: i64) -> Result<Vec<u8>, i32> {
    if len < 0 {
        return Err(-EINVAL);
    }
    if !v.live(inode) {
        return Err(-ENOENT); // file was unlinked (vfs.ts re-reads by path -> ENOENT)
    }
    if v.is_dir(inode) {
        return Err(-EISDIR);
    }
    let size = v.file_len(inode);
    let start = if pos < 0 { 0 } else { pos.min(size as i64) as usize };
    let n = (len as usize).min(size - start);
    Ok(v.file_copy(inode, start, n))
}

pub fn read(v: &Vfs, t: &mut FdTable, fd: i32, len: i32) -> Result<Vec<u8>, i32> {
    let (inode, pos) = match t.get(fd) {
        Some(e) => (e.inode, e.pos),
        None => return Err(-EBADF),
    };
    let out = read_at(v, inode, len, pos)?;
    // fs.ts: f.pos = pos + n (pos beyond EOF is left untouched by a 0-read).
    if let Some(e) = t.get(fd) {
        e.pos = pos + out.len() as i64;
    }
    Ok(out)
}

pub fn pread(v: &Vfs, t: &mut FdTable, fd: i32, len: i32, pos: i64) -> Result<Vec<u8>, i32> {
    let (inode, flags) = match t.get(fd) {
        Some(e) => (e.inode, e.flags),
        None => return Err(-EBADF),
    };
    if flags & O_APPEND != 0 {
        return Err(-ESPIPE); // spec: explicit-position read on append-only fd
    }
    if pos < 0 {
        return Err(-EINVAL);
    }
    read_at(v, inode, len, pos) // never moves fd pos
}

fn write_common(
    v: &mut Vfs,
    t: &mut FdTable,
    fd: i32,
    data: &[u8],
    explicit_pos: Option<i64>,
) -> i32 {
    let (inode, pos, flags) = match t.get(fd) {
        Some(e) => (e.inode, e.pos, e.flags),
        None => return -EBADF,
    };
    if !v.live(inode) {
        return -ENOENT;
    }
    if v.is_dir(inode) {
        return -EISDIR;
    }
    let app = flags & O_APPEND != 0;
    let start: i64 = match explicit_pos {
        Some(p) => {
            if p < 0 {
                return -EINVAL;
            }
            p
        }
        None => {
            if app {
                v.file_len(inode) as i64
            } else {
                pos.max(0)
            }
        }
    };
    if start > MAX_FILE || data.len() as i64 > MAX_FILE - start {
        return -ENOSPC; // wasm32 usize safety bound (README deviation #9)
    }
    let now = v.now_ms();
    v.file_write_at(inode, start, data, now);
    if explicit_pos.is_none() {
        // oc_write advances pos (append: to the new end); pwrite NEVER does.
        let new_pos = start + data.len() as i64;
        if let Some(e) = t.get(fd) {
            e.pos = new_pos;
        }
    }
    data.len() as i32
}

pub fn write(v: &mut Vfs, t: &mut FdTable, fd: i32, data: &[u8]) -> i32 {
    write_common(v, t, fd, data, None)
}

pub fn pwrite(v: &mut Vfs, t: &mut FdTable, fd: i32, data: &[u8], pos: i64) -> i32 {
    write_common(v, t, fd, data, Some(pos))
}

pub fn ftruncate(v: &mut Vfs, t: &mut FdTable, fd: i32, len: i64) -> i32 {
    let inode = match t.get(fd) {
        Some(e) => e.inode,
        None => return -EBADF,
    };
    if !v.live(inode) {
        return -ENOENT;
    }
    if v.is_dir(inode) {
        return -EINVAL;
    }
    if len < 0 {
        return -EINVAL;
    }
    if len > MAX_FILE {
        return -ENOSPC;
    }
    let now = v.now_ms();
    v.file_resize(inode, len, now);
    0
}

pub fn fchmod(v: &mut Vfs, t: &mut FdTable, fd: i32, mode: i32) -> i32 {
    let inode = match t.get(fd) {
        Some(e) => e.inode,
        None => return -EBADF,
    };
    if !v.live(inode) {
        return -ENOENT;
    }
    let now = v.now_ms();
    let n = &mut v.inodes[inode as usize];
    n.mode = (n.mode & S_IFMT) | ((mode as u32) & 0o7777);
    n.ctime_ms = now;
    0
}

// ---- path ops -------------------------------------------------------------------

pub fn stat(v: &Vfs, path: &str, follow: bool) -> Result<u32, i32> {
    let norm = match v.normalize(path) {
        Some(n) => n,
        None => return Err(-EINVAL),
    };
    match v.resolve(&norm, follow) {
        Ok(Res::Node(id)) => Ok(id),
        Ok(Res::Missing { .. }) => Err(-ENOENT),
        Err(e) => Err(-e),
    }
}

pub fn exists(v: &Vfs, path: &str) -> i32 {
    let norm = match v.normalize(path) {
        Some(n) => n,
        None => return 0,
    };
    match v.resolve(&norm, true) {
        Ok(Res::Node(_)) => 1,
        _ => 0,
    }
}

/// mkdir / mkdirp — a faithful port of vfs.ts `mkdir` (including its
/// create-loop that follows symlinks when descending and reports ENOTDIR
/// for a dangling symlink on the path).
pub fn mkdir(v: &mut Vfs, path: &str, mode: i32, recursive: bool) -> i32 {
    let norm = match v.normalize(path) {
        Some(n) => n,
        None => return -EINVAL,
    };
    if norm == "/" {
        return if recursive { 0 } else { -EEXIST };
    }
    match v.resolve(&norm, true) {
        Ok(Res::Node(id)) => {
            if recursive && v.is_dir(id) {
                return 0; // mkdirp over an existing dir: success, no create
            }
            return -EEXIST;
        }
        Err(e) => {
            if e != ENOENT {
                return -e; // e.g. ELOOP
            }
        }
        Ok(Res::Missing { .. }) => {}
    }
    if !recursive {
        match v.resolve(&dirname_of(&norm), true) {
            Ok(Res::Node(p)) if v.is_dir(p) => {}
            _ => return -ENOENT,
        }
    }
    // create loop (vfs.ts): walk from the root, creating missing segments,
    // following symlinks for descent (dangling link stays -> ENOTDIR).
    let m = if mode == 0 { 0o777 } else { (mode as u32) & 0o777 };
    let segs: Vec<&str> = norm.split('/').filter(|s| !s.is_empty()).collect();
    let mut cur = 0u32;
    for seg in segs {
        match v.child_get(cur, seg) {
            None => {
                let now = v.now_ms();
                cur = v.create_dir(cur, seg, m, now);
            }
            Some(child) => {
                let c = if v.is_symlink(child) {
                    let target = match &v.inodes[child as usize].kind {
                        Kind::Symlink { target } => target.to_string(),
                        _ => String::new(),
                    };
                    let joined = v.join_target(cur, &target);
                    match joined.and_then(|j| v.resolve(&j, true).ok()) {
                        Some(Res::Node(x)) => x,
                        _ => child, // dangling: stays a symlink -> ENOTDIR below
                    }
                } else {
                    child
                };
                if !v.is_dir(c) {
                    return -ENOTDIR;
                }
                cur = c;
            }
        }
    }
    0
}

pub fn rmdir(v: &mut Vfs, path: &str) -> i32 {
    let norm = match v.normalize(path) {
        Some(n) => n,
        None => return -EINVAL,
    };
    if norm == "/" {
        return -EBUSY;
    }
    match v.resolve(&norm, false) {
        Ok(Res::Node(id)) => {
            if id == 0 {
                return -EBUSY;
            }
            if !v.is_dir(id) {
                return -ENOTDIR;
            }
            if v.dir_children_count(id) > 0 {
                return -ENOTEMPTY;
            }
            v.free_subtree(id);
            0
        }
        Ok(Res::Missing { .. }) => -ENOENT,
        Err(e) => -e,
    }
}

pub fn unlink(v: &mut Vfs, path: &str) -> i32 {
    let norm = match v.normalize(path) {
        Some(n) => n,
        None => return -EINVAL,
    };
    match v.resolve(&norm, false) {
        Ok(Res::Node(id)) => {
            if v.is_dir(id) {
                return -EISDIR; // node unlink(2) behavior (spec §3)
            }
            if id == 0 {
                return -EBUSY;
            }
            v.free_subtree(id);
            0
        }
        Ok(Res::Missing { .. }) => -ENOENT,
        Err(e) => -e,
    }
}

pub fn rmrf(v: &mut Vfs, path: &str, force: bool) -> i32 {
    let norm = match v.normalize(path) {
        Some(n) => n,
        None => return -EINVAL,
    };
    match v.resolve(&norm, false) {
        Ok(Res::Node(id)) => {
            if id == 0 {
                return 0; // vfs.ts quirk: rm("/") is a silent no-op
            }
            v.free_subtree(id);
            0
        }
        _ => {
            if force {
                0
            } else {
                -ENOENT
            }
        }
    }
}

pub fn rm_nonrecursive(v: &mut Vfs, path: &str, force: bool) -> i32 {
    let norm = match v.normalize(path) {
        Some(n) => n,
        None => return -EINVAL,
    };
    match v.resolve(&norm, false) {
        Ok(Res::Node(id)) => {
            if v.is_dir(id) && v.dir_children_count(id) > 0 {
                return -ENOTEMPTY;
            }
            v.free_subtree(id);
            0
        }
        _ => {
            if force {
                0
            } else {
                -ENOENT
            }
        }
    }
}

pub fn rename(v: &mut Vfs, old: &str, new: &str) -> i32 {
    let a = match v.normalize(old) {
        Some(n) => n,
        None => return -EINVAL,
    };
    let b = match v.normalize(new) {
        Some(n) => n,
        None => return -EINVAL,
    };
    if a == b {
        return 0; // same-path rename: true no-op (spec §3; no readdir reorder)
    }
    if a == "/" {
        return -EBUSY; // cannot rename the root
    }
    if b == "/" {
        return -EINVAL; // cannot rename onto the root
    }
    let node = match v.resolve(&a, false) {
        Ok(Res::Node(id)) => id,
        Ok(Res::Missing { .. }) => return -ENOENT,
        Err(e) => return -e,
    };
    let parent_b = match v.resolve(&dirname_of(&b), true) {
        Ok(Res::Node(p)) if v.is_dir(p) => p,
        Ok(_) => return -ENOENT, // missing or not a dir (vfs.ts: ENOENT)
        Err(e) => return -e,
    };
    let base = basename_of(&b);
    if base == "/" {
        return -EINVAL;
    }
    // Same-inode no-op (only reachable when a == b, handled above).
    if let Some(existing) = v.child_get(parent_b, &base) {
        if existing == node {
            return 0;
        }
    }
    // POSIX EINVAL: moving a directory into its own subtree would orphan it
    // (vfs.ts silently corrupts the tree here; Linux returns EINVAL).
    if v.is_dir(node) {
        let mut cur = parent_b;
        let mut guard = 0usize;
        while cur != 0 && guard <= v.inodes.len() {
            if cur == node {
                return -EINVAL;
            }
            cur = v.inodes[cur as usize].parent;
            guard += 1;
        }
        if cur == node {
            return -EINVAL;
        }
    }
    // POSIX rename matrix (vfs.ts):
    //   file  -> existing file   : replace
    //   dir   -> existing empty  : replace
    //   dir   -> existing nonempty: ENOTEMPTY
    //   file  -> dir             : EISDIR
    //   dir   -> file            : ENOTDIR
    if let Some(existing) = v.child_get(parent_b, &base) {
        let ex_dir = v.is_dir(existing);
        let a_dir = v.is_dir(node);
        if ex_dir && a_dir {
            if v.dir_children_count(existing) > 0 {
                return -ENOTEMPTY;
            }
            v.free_subtree(existing);
        } else if ex_dir && !a_dir {
            return -EISDIR;
        } else if !ex_dir && a_dir {
            return -ENOTDIR;
        } else {
            v.free_subtree(existing); // file/symlink onto file/symlink: replace
        }
    }
    // Move: detach from the old parent (tombstone), then append at the END
    // of the new parent's readdir order (vfs.ts Map delete+set semantics).
    let old_parent = v.inodes[node as usize].parent;
    let old_name = v.inodes[node as usize].name.to_string();
    v.child_remove(old_parent, &old_name);
    v.inodes[node as usize].name = Box::from(base.as_str());
    v.inodes[node as usize].parent = parent_b;
    v.child_insert(parent_b, &base, node);
    0
}

pub fn symlink(v: &mut Vfs, target: &str, path: &str) -> i32 {
    let norm = match v.normalize(path) {
        Some(n) => n,
        None => return -EINVAL,
    };
    let parent = match v.resolve(&dirname_of(&norm), true) {
        Ok(Res::Node(p)) if v.is_dir(p) => p,
        _ => return -ENOENT,
    };
    let base = basename_of(&norm);
    if base == "/" {
        return -EINVAL;
    }
    // Spec §3: EEXIST when the entry exists (any type) — the bridge
    // pre-checks exists() and skips the call for importTree idempotency.
    if v.child_get(parent, &base).is_some() {
        return -EEXIST;
    }
    let now = v.now_ms();
    v.create_symlink(parent, &base, target, now);
    0
}

pub fn readlink(v: &Vfs, path: &str) -> Result<Vec<u8>, i32> {
    let norm = match v.normalize(path) {
        Some(n) => n,
        None => return Err(-EINVAL),
    };
    match v.resolve(&norm, false) {
        Ok(Res::Node(id)) => match &v.inodes[id as usize].kind {
            Kind::Symlink { target } => Ok(target.as_bytes().to_vec()),
            _ => Err(-EINVAL), // existing non-symlink (pnpm depends on the split)
        },
        Ok(Res::Missing { .. }) => Err(-ENOENT),
        Err(e) => Err(-e),
    }
}

pub fn readdir(v: &Vfs, path: &str, with_types: bool) -> Result<Vec<u8>, i32> {
    let norm = match v.normalize(path) {
        Some(n) => n,
        None => return Err(-EINVAL),
    };
    let id = match v.resolve(&norm, true) {
        Ok(Res::Node(id)) => id,
        Ok(Res::Missing { .. }) => return Err(-ENOENT),
        Err(e) => return Err(-e),
    };
    if !v.is_dir(id) {
        return Err(-ENOTDIR);
    }
    let mut out: Vec<u8> = Vec::new();
    for cid in v.dir_order(id) {
        let n = &v.inodes[cid as usize];
        out.extend_from_slice(n.name.as_bytes());
        out.push(0);
        if with_types {
            // u8 S_IFMT>>12: 8=file, 4=dir, 10=symlink (spec §3)
            let code = match n.kind {
                Kind::File { .. } => 8u8,
                Kind::Dir { .. } => 4u8,
                Kind::Symlink { .. } => 10u8,
            };
            out.push(code);
        }
    }
    Ok(out)
}

pub fn chmod(v: &mut Vfs, path: &str, mode: i32) -> i32 {
    match stat(v, path, true) {
        Ok(id) => {
            let now = v.now_ms();
            let n = &mut v.inodes[id as usize];
            n.mode = (n.mode & S_IFMT) | ((mode as u32) & 0o7777);
            n.ctime_ms = now;
            0
        }
        Err(e) => e,
    }
}

pub fn utimes(v: &mut Vfs, path: &str, atime_ms: f64, mtime_ms: f64) -> i32 {
    match stat(v, path, true) {
        Ok(id) => {
            let n = &mut v.inodes[id as usize];
            n.atime_ms = atime_ms;
            n.mtime_ms = mtime_ms;
            0
        }
        Err(e) => e,
    }
}

pub fn truncate(v: &mut Vfs, path: &str, size: i64) -> i32 {
    if size < 0 {
        return -EINVAL;
    }
    if size > MAX_FILE {
        return -ENOSPC;
    }
    match stat(v, path, true) {
        Ok(id) => {
            if v.is_dir(id) {
                return -EISDIR;
            }
            let now = v.now_ms();
            v.file_resize(id, size, now);
            0
        }
        Err(e) => e,
    }
}

// ---- whole-file fast paths -------------------------------------------------------

fn write_data(v: &mut Vfs, norm: &str, data: &[u8], mode: u32, replace: bool) -> i32 {
    if data.len() as i64 > MAX_FILE {
        return -ENOSPC;
    }
    match v.resolve(norm, true) {
        Ok(Res::Node(id)) => {
            if v.is_dir(id) {
                return -EISDIR;
            }
            let now = v.now_ms();
            if replace {
                v.file_set(id, data, now);
            } else {
                v.file_append(id, data, now);
            }
            0
        }
        Ok(Res::Missing { parent, name }) => {
            // resolve() guarantees `parent` is a directory; a symlink final
            // component resolves to its target, so creation lands there.
            let m = if mode == 0 { 0o666 } else { mode & 0o777 };
            let now = v.now_ms();
            v.create_file(parent, &name, m, data.to_vec(), now);
            0
        }
        Err(e) => -e,
    }
}

pub fn write_file(v: &mut Vfs, path: &str, data: &[u8], mode: i32) -> i32 {
    let norm = match v.normalize(path) {
        Some(n) => n,
        None => return -EINVAL,
    };
    let m = if mode == 0 { 0o666 } else { (mode as u32) & 0o777 };
    write_data(v, &norm, data, m, true)
}

pub fn append_file(v: &mut Vfs, path: &str, data: &[u8]) -> i32 {
    let norm = match v.normalize(path) {
        Some(n) => n,
        None => return -EINVAL,
    };
    write_data(v, &norm, data, 0o666, false)
}

pub fn read_file(v: &Vfs, path: &str) -> Result<Vec<u8>, i32> {
    match stat(v, path, true) {
        Ok(id) => {
            if v.is_dir(id) {
                return Err(-EISDIR);
            }
            Ok(v.file_copy(id, 0, usize::MAX))
        }
        Err(e) => Err(e),
    }
}

pub fn copy_file(v: &mut Vfs, src: &str, dst: &str) -> i32 {
    let data = match read_file(v, src) {
        Ok(d) => d,
        Err(e) => return e,
    };
    match v.normalize(dst) {
        Some(norm) => write_data(v, &norm, &data, 0o666, true),
        None => -EINVAL,
    }
}

// ---- path utilities ----------------------------------------------------------------

pub fn normalize(v: &Vfs, path: &str) -> Result<Vec<u8>, i32> {
    match v.normalize(path) {
        Some(n) => Ok(n.into_bytes()),
        None => Err(-EINVAL),
    }
}

pub fn join_normalize(v: &Vfs, base: &str, rel: &str) -> Result<Vec<u8>, i32> {
    // vfs.ts joinPaths: absolute rel wins; otherwise base + rel, normalized.
    let full: String = if rel.starts_with('/') {
        rel.to_string()
    } else {
        let b = if base.starts_with('/') {
            base.to_string()
        } else {
            format!("{}/{}", v.cwd.trim_end_matches('/'), base)
        };
        format!("{}/{}", b.trim_end_matches('/'), rel)
    };
    match Vfs::normalize_lexical(&full) {
        Some(n) => Ok(n.into_bytes()),
        None => Err(-EINVAL),
    }
}

// ---- stats --------------------------------------------------------------------------

pub fn debug_counts(v: &Vfs, t: &FdTable) -> Vec<u8> {
    let mut inodes = 0u32;
    let mut files = 0u32;
    let mut dirs = 0u32;
    for n in v.inodes.iter() {
        if n.mode & S_IFMT == 0 {
            continue; // freed slot
        }
        inodes += 1;
        match n.kind {
            Kind::File { .. } => files += 1,
            Kind::Dir { .. } => dirs += 1,
            Kind::Symlink { .. } => {}
        }
    }
    let mut b = Vec::with_capacity(16);
    b.extend_from_slice(&inodes.to_le_bytes());
    b.extend_from_slice(&files.to_le_bytes());
    b.extend_from_slice(&dirs.to_le_bytes());
    b.extend_from_slice(&(t.open_count() as u32).to_le_bytes());
    b
}
