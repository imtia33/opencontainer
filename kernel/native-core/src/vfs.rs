//! Inode arena, insertion-ordered directory children, fd table and iterative
//! path resolution (spec §4). Semantics mirror `kernel/vfs.ts` exactly unless
//! the frozen ABI spec states otherwise (deviations are listed in README.md).

use std::collections::HashMap;

// ---- mode bits (same values as kernel/vfs.ts) ------------------------------
pub const S_IFMT: u32 = 0o170000;
pub const S_IFREG: u32 = 0o100000;
pub const S_IFDIR: u32 = 0o040000;
pub const S_IFLNK: u32 = 0o120000;

// ---- Linux errnos (spec §1) -------------------------------------------------
pub const EPERM: i32 = 1;
pub const ENOENT: i32 = 2;
pub const EIO: i32 = 5;
pub const EBADF: i32 = 9;
pub const EACCES: i32 = 13;
pub const EFAULT: i32 = 14;
pub const EBUSY: i32 = 16;
pub const EEXIST: i32 = 17;
pub const EXDEV: i32 = 18;
pub const ENOTDIR: i32 = 20;
pub const EISDIR: i32 = 21;
pub const EINVAL: i32 = 22;
pub const EMFILE: i32 = 24;
pub const ENOSPC: i32 = 28;
pub const ESPIPE: i32 = 29;
pub const ENAMETOOLONG: i32 = 36;
pub const ENOSYS: i32 = 38;
pub const ENOTEMPTY: i32 = 39;
pub const ELOOP: i32 = 40;

// ---- open(2) flags as passed by node/UV on Linux (fs.ts numeric values) -----
pub const O_RDONLY: i32 = 0;
pub const O_WRONLY: i32 = 1;
pub const O_RDWR: i32 = 2;
pub const O_CREAT: i32 = 64;
pub const O_EXCL: i32 = 128;
pub const O_TRUNC: i32 = 512;
pub const O_APPEND: i32 = 1024;

// ABI completeness: every errno/flag of the frozen contract (spec §1) is
// declared even where the core itself never returns it.
const _: () = {
    let _ = (EPERM, EIO, EACCES, EXDEV, ENAMETOOLONG, ENOSYS, O_RDONLY, O_WRONLY, O_RDWR);
};

/// Symlink-follow budget (Linux SYMLOOP_MAX, spec §4).
pub const MAX_FOLLOWS: u32 = 40;
/// Hard upper bound for file sizes / positions (wasm32 usize safety margin).
pub const MAX_FILE: i64 = (1 << 31) - 1;

/// Freed-slot tombstone marker inside `Kind::Dir::order`.
pub const TOMB: u32 = u32::MAX;

// ---- data structures (spec §4) ----------------------------------------------

pub enum Kind {
    Dir {
        /// name -> child inode id (O(1) lookup).
        children: HashMap<Box<str>, u32>,
        /// child ids in insertion order (stable readdir; a delete leaves a
        /// `u32::MAX` tombstone, compacted when tombstones > len/2).
        order: Vec<u32>,
        tombstones: u32,
    },
    File { data: Vec<u8> },
    Symlink { target: Box<str> },
}

pub struct Inode {
    pub name: Box<str>,
    pub parent: u32,
    pub kind: Kind,
    /// S_IFMT type bits | permission bits. `mode & S_IFMT == 0` marks a
    /// FREED slot (free-list member).
    pub mode: u32,
    /// Monotonic, never reused even when the slot is recycled.
    pub ino: u64,
    pub atime_ms: f64,
    pub ctime_ms: f64,
    pub mtime_ms: f64,
    pub birthtime_ms: f64,
}

/// Path resolution outcome: the node, or `(parent, name)` when only the
/// FINAL component is absent (parent is guaranteed to be a directory).
pub enum Res {
    Node(u32),
    Missing { parent: u32, name: String },
}

pub struct Vfs {
    pub inodes: Vec<Inode>,
    free_list: Vec<u32>,
    next_ino: u64,
    /// Logical monotonic clock (ms). The frozen ABI defines no time import,
    /// so the core stamps mutations with this deterministic clock; the
    /// bridge can pin exact times via `oc_utimes` (README deviation #1).
    clock_ms: f64,
    /// Current working directory, owned by the core (absolute, normalized).
    pub cwd: String,
}

impl Vfs {
    pub fn new() -> Vfs {
        let t = 0.0f64;
        let root = Inode {
            name: Box::from(""),
            parent: 0,
            kind: Kind::Dir { children: HashMap::new(), order: Vec::new(), tombstones: 0 },
            mode: S_IFDIR | 0o755,
            ino: 1,
            atime_ms: t,
            ctime_ms: t,
            mtime_ms: t,
            birthtime_ms: t,
        };
        Vfs {
            inodes: vec![root],
            free_list: Vec::new(),
            next_ino: 2,
            clock_ms: 0.0,
            cwd: String::from("/"),
        }
    }

    pub fn now_ms(&mut self) -> f64 {
        self.clock_ms += 1.0;
        self.clock_ms
    }

    pub fn is_dir(&self, id: u32) -> bool {
        self.inodes
            .get(id as usize)
            .map_or(false, |n| matches!(n.kind, Kind::Dir { .. }))
    }

    pub fn is_symlink(&self, id: u32) -> bool {
        self.inodes
            .get(id as usize)
            .map_or(false, |n| matches!(n.kind, Kind::Symlink { .. }))
    }

    /// A slot is live iff it carries type bits (freed slots are zeroed).
    pub fn live(&self, id: u32) -> bool {
        self.inodes
            .get(id as usize)
            .map_or(false, |n| n.mode & S_IFMT != 0)
    }

    fn alloc_inode(&mut self, name: &str, parent: u32, kind: Kind, mode: u32, t: f64) -> u32 {
        let ino = self.next_ino;
        self.next_ino += 1;
        let node = Inode {
            name: Box::from(name),
            parent,
            kind,
            mode,
            ino,
            atime_ms: t,
            ctime_ms: t,
            mtime_ms: t,
            birthtime_ms: t,
        };
        match self.free_list.pop() {
            Some(id) => {
                self.inodes[id as usize] = node;
                id
            }
            None => {
                self.inodes.push(node);
                (self.inodes.len() - 1) as u32
            }
        }
    }

    // ---- directory children -------------------------------------------------

    pub fn child_get(&self, dir: u32, name: &str) -> Option<u32> {
        match &self.inodes[dir as usize].kind {
            Kind::Dir { children, .. } => children.get(name).copied(),
            _ => None,
        }
    }

    /// Insert (or re-key) a child: appended at the END of readdir order
    /// (JS Map delete+set semantics of vfs.ts).
    pub fn child_insert(&mut self, dir: u32, name: &str, id: u32) {
        if let Kind::Dir { children, order, .. } = &mut self.inodes[dir as usize].kind {
            children.insert(Box::from(name), id);
            order.push(id);
        }
    }

    /// Remove a child from the map and tombstone it in the order vector,
    /// compacting when tombstones exceed half the vector (spec §4).
    pub fn child_remove(&mut self, dir: u32, name: &str) -> Option<u32> {
        let id = match &mut self.inodes[dir as usize].kind {
            Kind::Dir { children, .. } => children.remove(name)?,
            _ => return None,
        };
        let mut compact = false;
        if let Kind::Dir { order, tombstones, .. } = &mut self.inodes[dir as usize].kind {
            if let Some(pos) = order.iter().position(|&x| x == id) {
                order[pos] = TOMB;
                *tombstones += 1;
            }
            if *tombstones > (order.len() / 2) as u32 {
                compact = true;
            }
        }
        if compact {
            if let Kind::Dir { order, tombstones, .. } = &mut self.inodes[dir as usize].kind {
                order.retain(|&x| x != TOMB);
                *tombstones = 0;
            }
        }
        Some(id)
    }

    pub fn dir_children_count(&self, dir: u32) -> usize {
        match &self.inodes[dir as usize].kind {
            Kind::Dir { children, .. } => children.len(),
            _ => 0,
        }
    }

    /// Child ids in readdir order (live entries only).
    pub fn dir_order(&self, dir: u32) -> Vec<u32> {
        match &self.inodes[dir as usize].kind {
            Kind::Dir { order, .. } => order
                .iter()
                .copied()
                .filter(|&id| id != TOMB && self.live(id))
                .collect(),
            _ => Vec::new(),
        }
    }

    // ---- creation / destruction ----------------------------------------------

    pub fn create_file(&mut self, parent: u32, name: &str, mode: u32, data: Vec<u8>, t: f64) -> u32 {
        let id = self.alloc_inode(name, parent, Kind::File { data }, S_IFREG | (mode & 0o777), t);
        self.child_insert(parent, name, id);
        id
    }

    pub fn create_dir(&mut self, parent: u32, name: &str, mode: u32, t: f64) -> u32 {
        let id = self.alloc_inode(
            name,
            parent,
            Kind::Dir { children: HashMap::new(), order: Vec::new(), tombstones: 0 },
            S_IFDIR | (mode & 0o777),
            t,
        );
        self.child_insert(parent, name, id);
        id
    }

    pub fn create_symlink(&mut self, parent: u32, name: &str, target: &str, t: f64) -> u32 {
        let id = self.alloc_inode(
            name,
            parent,
            Kind::Symlink { target: Box::from(target) },
            S_IFLNK | 0o777,
            t,
        );
        self.child_insert(parent, name, id);
        id
    }

    /// Canonical path of a node (walks the parent chain; root = "/").
    pub fn path_of(&self, id: u32) -> String {
        if id == 0 {
            return String::from("/");
        }
        let mut segs: Vec<&str> = Vec::new();
        let mut cur = id;
        let mut guard = 0usize;
        while cur != 0 && guard <= self.inodes.len() {
            let n = &self.inodes[cur as usize];
            segs.push(&n.name);
            cur = n.parent;
            guard += 1;
        }
        segs.reverse();
        let mut s = String::from("/");
        s.push_str(&segs.join("/"));
        s
    }

    // ---- normalize ------------------------------------------------------------

    /// Lexical normalize of an ABSOLUTE path (vfs.ts `normalize` core):
    /// '.' skipped, '..' pops (bounded at root), '//' collapsed, trailing
    /// '/' preserved iff the input ends with '/' and the result is not root.
    pub fn normalize_lexical(p: &str) -> Option<String> {
        if !p.starts_with('/') {
            return None;
        }
        let is_dir = p.ends_with('/');
        let mut out: Vec<&str> = Vec::new();
        for seg in p.split('/') {
            if seg.is_empty() || seg == "." {
                continue;
            }
            if seg == ".." {
                out.pop();
                continue;
            }
            out.push(seg);
        }
        let mut s = String::with_capacity(p.len() + 1);
        s.push('/');
        for (i, seg) in out.iter().enumerate() {
            if i > 0 {
                s.push('/');
            }
            s.push_str(seg);
        }
        if is_dir && !out.is_empty() {
            s.push('/');
        }
        Some(s)
    }

    /// vfs.ts `normalize`: empty -> None (EINVAL); relative paths resolve
    /// against the core-owned cwd.
    pub fn normalize(&self, p: &str) -> Option<String> {
        if p.is_empty() {
            return None;
        }
        if p.starts_with('/') {
            return Vfs::normalize_lexical(p);
        }
        let full = format!("{}/{}", self.cwd.trim_end_matches('/'), p);
        Vfs::normalize_lexical(&full)
    }

    /// vfs.ts `joinPaths`: absolute target wins; relative targets join the
    /// symlink's PARENT dir (parent-join rule) then normalize lexically.
    pub fn join_target(&self, parent_id: u32, target: &str) -> Option<String> {
        if target.starts_with('/') {
            Vfs::normalize_lexical(target)
        } else {
            let base = self.path_of(parent_id);
            Vfs::normalize_lexical(&format!("{}/{}", base.trim_end_matches('/'), target))
        }
    }

    // ---- path resolution --------------------------------------------------------

    /// Iterative resolution of a NORMALIZED absolute path. Symlinks expand
    /// with the parent-join rule under a 40-follow budget (ELOOP). The walk
    /// is lexical-first exactly like vfs.ts: `..` was already collapsed by
    /// the normalizer before any symlink is considered.
    pub fn resolve(&self, path: &str, follow_last: bool) -> Result<Res, i32> {
        let mut segs: Vec<String> =
            path.split('/').filter(|s| !s.is_empty()).map(String::from).collect();
        let mut follows = 0u32;
        let mut i = 0usize;
        let mut cur = 0u32;
        loop {
            if i >= segs.len() {
                return Ok(Res::Node(cur));
            }
            if !self.is_dir(cur) {
                return Err(ENOENT);
            }
            let is_last = i + 1 == segs.len();
            let seg = segs[i].clone();
            match self.child_get(cur, &seg) {
                None => {
                    if is_last {
                        return Ok(Res::Missing { parent: cur, name: seg });
                    }
                    return Err(ENOENT);
                }
                Some(child) => {
                    let target = match &self.inodes[child as usize].kind {
                        Kind::Symlink { target } => Some(target.to_string()),
                        _ => None,
                    };
                    match target {
                        Some(t) if !is_last || follow_last => {
                            follows += 1;
                            if follows > MAX_FOLLOWS {
                                return Err(ELOOP);
                            }
                            let joined = match self.join_target(cur, &t) {
                                Some(j) => j,
                                None => return Err(EINVAL),
                            };
                            let mut next: Vec<String> = joined
                                .split('/')
                                .filter(|s| !s.is_empty())
                                .map(String::from)
                                .collect();
                            if i + 1 < segs.len() {
                                next.extend(segs[i + 1..].iter().cloned());
                            }
                            segs = next;
                            i = 0;
                            cur = 0;
                        }
                        _ => {
                            cur = child;
                            i += 1;
                        }
                    }
                }
            }
        }
    }

    pub fn resolve_node(&self, path: &str, follow_last: bool) -> Result<u32, i32> {
        match self.resolve(path, follow_last) {
            Ok(Res::Node(id)) => Ok(id),
            Ok(Res::Missing { .. }) => Err(ENOENT),
            Err(e) => Err(e),
        }
    }

    // ---- file data -----------------------------------------------------------

    pub fn file_len(&self, id: u32) -> usize {
        match self.inodes.get(id as usize).map(|n| &n.kind) {
            Some(Kind::File { data }) => data.len(),
            _ => 0,
        }
    }

    pub fn file_copy(&self, id: u32, start: usize, len: usize) -> Vec<u8> {
        match self.inodes.get(id as usize).map(|n| &n.kind) {
            Some(Kind::File { data }) => {
                let start = start.min(data.len());
                let end = (start + len).min(data.len());
                data[start..end].to_vec()
            }
            _ => Vec::new(),
        }
    }

    /// Replace the whole content (writeFile / O_TRUNC semantics).
    pub fn file_set(&mut self, id: u32, data: &[u8], t: f64) {
        if let Kind::File { data: d } = &mut self.inodes[id as usize].kind {
            *d = data.to_vec();
        }
        let n = &mut self.inodes[id as usize];
        n.mtime_ms = t;
        n.ctime_ms = t;
    }

    /// Extend the file (appendFile semantics).
    pub fn file_append(&mut self, id: u32, data: &[u8], t: f64) {
        if let Kind::File { data: d } = &mut self.inodes[id as usize].kind {
            d.extend_from_slice(data);
        }
        let n = &mut self.inodes[id as usize];
        n.mtime_ms = t;
        n.ctime_ms = t;
    }

    /// Write at an explicit offset, growing with a zero gap when the offset
    /// is past EOF (pwrite/merged-write semantics of fs.ts).
    pub fn file_write_at(&mut self, id: u32, start: i64, data: &[u8], t: f64) {
        if let Kind::File { data: d } = &mut self.inodes[id as usize].kind {
            let start = if start < 0 { 0 } else { start as usize };
            if start > d.len() {
                d.resize(start, 0);
                d.extend_from_slice(data);
            } else if start + data.len() > d.len() {
                d.truncate(start);
                d.extend_from_slice(data);
            } else {
                d[start..start + data.len()].copy_from_slice(data);
            }
        }
        let n = &mut self.inodes[id as usize];
        n.mtime_ms = t;
        n.ctime_ms = t;
    }

    pub fn file_resize(&mut self, id: u32, len: i64, t: f64) {
        if let Kind::File { data: d } = &mut self.inodes[id as usize].kind {
            if len < 0 {
                return;
            }
            d.resize(len as usize, 0);
        }
        let n = &mut self.inodes[id as usize];
        n.mtime_ms = t;
        n.ctime_ms = t;
    }

    // ---- subtree freeing -------------------------------------------------------

    /// Detach `id` from its parent and free the whole subtree ITERATIVELY
    /// (no recursion — unbounded tree depth cannot overflow the stack).
    /// Freed slots are zeroed (mode 0) and pushed on the free list for
    /// reuse; their `ino` numbers are never reused.
    pub fn free_subtree(&mut self, id: u32) {
        if id == 0 || !self.live(id) {
            return;
        }
        let parent = self.inodes[id as usize].parent;
        let name = self.inodes[id as usize].name.to_string();
        self.child_remove(parent, &name);
        let mut stack: Vec<u32> = vec![id];
        while let Some(cur) = stack.pop() {
            let kids: Vec<u32> = match &self.inodes[cur as usize].kind {
                Kind::Dir { children, .. } => children.values().copied().collect(),
                _ => Vec::new(),
            };
            stack.extend(kids);
            {
                let n = &mut self.inodes[cur as usize];
                n.kind = Kind::File { data: Vec::new() };
                n.mode = 0;
                n.name = Box::from("");
                n.parent = 0;
            }
            self.free_list.push(cur);
        }
    }
}

// ---- fd table (spec §4: Vec<Option<FdEntry>>, first-free scan, cap 4096) ----

pub struct FdEntry {
    pub inode: u32,
    pub pos: i64,
    pub flags: i32,
}

pub struct FdTable {
    pub fds: Vec<Option<FdEntry>>,
}

impl FdTable {
    pub fn new() -> FdTable {
        // fds 0..3 are reserved for stdio (JS-owned): pre-seed three empty
        // slots so the first alloc lands at index 3 (spec §4).
        FdTable { fds: vec![None, None, None] }
    }

    /// fds 0..3 are reserved for stdio (owned by the JS side) and never
    /// allocated here; the table is capped at 4096 entries (EMFILE).
    pub fn alloc(&mut self, inode: u32, pos: i64, flags: i32) -> Result<i32, i32> {
        let mut i = 3usize;
        while i < self.fds.len() {
            if self.fds[i].is_none() {
                self.fds[i] = Some(FdEntry { inode, pos, flags });
                return Ok(i as i32);
            }
            i += 1;
        }
        if self.fds.len() < 4096 {
            self.fds.push(Some(FdEntry { inode, pos, flags }));
            return Ok((self.fds.len() - 1) as i32);
        }
        Err(-EMFILE)
    }

    pub fn get(&mut self, fd: i32) -> Option<&mut FdEntry> {
        if fd < 3 {
            return None;
        }
        self.fds.get_mut(fd as usize).and_then(|s| s.as_mut())
    }

    pub fn close(&mut self, fd: i32) -> bool {
        if fd < 3 {
            return false;
        }
        match self.fds.get_mut(fd as usize) {
            Some(slot) if slot.is_some() => {
                *slot = None;
                true
            }
            _ => false,
        }
    }

    pub fn open_count(&self) -> usize {
        self.fds.iter().filter(|s| s.is_some()).count()
    }
}

// ---- path helpers on NORMALIZED paths ----------------------------------------

pub fn dirname_of(norm: &str) -> String {
    let trimmed = norm.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(0) | None => String::from("/"),
        Some(i) => String::from(&trimmed[..i]),
    }
}

pub fn basename_of(norm: &str) -> String {
    let trimmed = norm.trim_end_matches('/');
    if trimmed.is_empty() || trimmed == "/" {
        return String::from("/");
    }
    match trimmed.rfind('/') {
        Some(i) => String::from(&trimmed[i + 1..]),
        None => String::from(trimmed),
    }
}
