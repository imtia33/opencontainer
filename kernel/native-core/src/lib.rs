//! OpenContainer native kernel core — Rust -> wasm32-unknown-unknown.
//!
//! Implements the FROZEN ABI in docs/native-core-spec.md exactly: every
//! export is `#[no_mangle] pub extern "C"`, returns i32 (`>= 0` success,
//! `< 0` = -errno), validates every (ptr,len) pair against the ACTUAL
//! memory size before any dereference (-EFAULT) and is panic-free by
//! construction (panic=abort: a panic would kill the whole worker).
//!
//! Memory model (spec §2):
//! - INBOUND: chunked append-only bump arena (`oc_arena_alloc` /
//!   `oc_arena_reset`) — allocations never move; valid until the next reset.
//! - OUTBOUND: a growable `Vec<u8>` whose (ptr,len) pair is stored in the
//!   8-byte RET_SLOT; the blob is valid only until the next oc_* call.
//! - STAT_SLOT: 144 bytes = 18 x f64 (LE), positional stat layout.
//!
//! Slot addresses are statics — stable for the module's lifetime (growth of
//! linear memory never moves existing data).

mod arena;
mod syscalls;
mod tar;
mod vfs;
#[cfg(test)]
mod tests;

use vfs::{EFAULT, EINVAL, Kind, Vfs};

// ---------------------------------------------------------------------------
// Memory access (target-specific size query; identical validation logic).
// ---------------------------------------------------------------------------

pub mod mem {
    /// Actual size of addressable memory, in bytes.
    #[cfg(target_arch = "wasm32")]
    pub fn size() -> usize {
        // 2026-era intrinsic: const-generic memory index — memory_size::<0>().
        // (A runtime-arg call compiles against the deprecated shim but
        // returns garbage; found via the EFAULT smoke probe.)
        core::arch::wasm32::memory_size::<0>() * 65536
    }

    #[cfg(not(target_arch = "wasm32"))]
    pub fn size() -> usize {
        crate::hostmem::len()
    }

    /// Validate (ptr,len) against the actual memory size BEFORE any
    /// dereference. None -> the caller returns -EFAULT (14). Never panics:
    /// the bounds check runs in u64 so ptr+len cannot wrap.
    pub fn read(ptr: i32, len: i32) -> Option<&'static [u8]> {
        if ptr < 0 || len < 0 {
            return None;
        }
        let (p, l) = (ptr as u64, len as u64);
        if p + l > size() as u64 {
            return None;
        }
        if l == 0 {
            return Some(&[]);
        }
        #[cfg(target_arch = "wasm32")]
        unsafe {
            return Some(core::slice::from_raw_parts(ptr as *const u8, l as usize));
        }
        #[cfg(not(target_arch = "wasm32"))]
        unsafe {
            let base = crate::hostmem::base();
            if base.is_null() {
                return None;
            }
            return Some(core::slice::from_raw_parts(base.add(ptr as usize), l as usize));
        }
    }
}

/// Host-only backing store: the "linear memory" for `cargo test`. Arena
/// chunks are sub-ranges of this vector and oc_arena_alloc returns offsets —
/// the no-move guarantee holds in offset space, which is exactly what the
/// bridge observes on wasm.
#[cfg(not(target_arch = "wasm32"))]
pub mod hostmem {
    static mut MEM: Option<Vec<u8>> = None;

    unsafe fn mem_vec() -> &'static mut Option<Vec<u8>> {
        &mut *core::ptr::addr_of_mut!(MEM)
    }

    pub fn ensure(total: usize) {
        unsafe {
            let cell = mem_vec();
            if cell.is_none() {
                *cell = Some(Vec::new());
            }
            if let Some(m) = cell.as_mut() {
                if m.len() < total {
                    m.resize(total, 0);
                }
            }
        }
    }

    pub fn len() -> usize {
        unsafe { mem_vec().as_ref().map_or(0, |m| m.len()) }
    }

    pub fn base() -> *mut u8 {
        unsafe {
            mem_vec()
                .as_mut()
                .map_or(core::ptr::null_mut(), |m| m.as_mut_ptr())
        }
    }

    pub fn write(off: usize, bytes: &[u8]) {
        unsafe {
            let base = base();
            if base.is_null() || bytes.is_empty() {
                return;
            }
            if off <= len() && bytes.len() <= len() - off {
                core::ptr::copy_nonoverlapping(bytes.as_ptr(), base.add(off), bytes.len());
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Slots (statics — stable addresses for the module's lifetime).
// ---------------------------------------------------------------------------

#[repr(C, align(8))]
struct StatSlot([u8; 144]);
static mut STAT_SLOT: StatSlot = StatSlot([0u8; 144]);

#[repr(C, align(8))]
struct RetSlot([u8; 8]);
static mut RET_SLOT: RetSlot = RetSlot([0u8; 8]);

fn set_ret(ptr: u32, len: u32) {
    unsafe {
        let base = core::ptr::addr_of_mut!(RET_SLOT.0) as *mut u8;
        core::ptr::copy_nonoverlapping(ptr.to_le_bytes().as_ptr(), base, 4);
        core::ptr::copy_nonoverlapping(len.to_le_bytes().as_ptr(), base.add(4), 4);
    }
}

/// Fill STAT_SLOT: 144 bytes = 18 x f64 (LE) in the positional layout
/// internalBinding('fs') hands to lib/internal/fs/utils.js:
/// [dev, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks,
///  atimeS, atimeNs, mtimeS, mtimeNs, ctimeS, ctimeNs, birthtimeS, birthtimeNs]
/// Times computed in Rust exactly like fs.ts: sec = floor(ms/1000),
/// ns = round((ms - sec*1000) * 1e6).
pub fn fill_stat_slot(v: &Vfs, id: u32, lstat: bool) {
    let n = &v.inodes[id as usize];
    let (size, blocks) = match (&n.kind, lstat) {
        (Kind::File { data }, _) => (data.len() as f64, ((data.len() + 511) / 512) as f64),
        // lstat of a symlink: size = TARGET BYTE LENGTH (spec §3).
        // blocks stays 0 like vfs.ts (a symlink has no data vector).
        (Kind::Symlink { target }, true) => (target.len() as f64, 0.0),
        _ => (0.0, 0.0),
    };
    unsafe {
        let base = core::ptr::addr_of_mut!(STAT_SLOT.0) as *mut u8;
        let put = |i: usize, val: f64| {
            let b = val.to_le_bytes();
            core::ptr::copy_nonoverlapping(b.as_ptr(), base.add(i * 8), 8);
        };
        put(0, 1.0); // dev
        put(1, n.mode as f64); // mode (type bits included)
        put(2, 1.0); // nlink
        put(3, 0.0); // uid
        put(4, 0.0); // gid
        put(5, 0.0); // rdev
        put(6, 4096.0); // blksize
        put(7, n.ino as f64); // ino
        put(8, size);
        put(9, blocks);
        let split = |ms: f64| -> (f64, f64) {
            let sec = (ms / 1000.0).floor();
            let ns = ((ms - sec * 1000.0) * 1e6).round();
            (sec, ns)
        };
        let (a_s, a_ns) = split(n.atime_ms);
        let (m_s, m_ns) = split(n.mtime_ms);
        let (c_s, c_ns) = split(n.ctime_ms);
        let (b_s, b_ns) = split(n.birthtime_ms);
        put(10, a_s);
        put(11, a_ns);
        put(12, m_s);
        put(13, m_ns);
        put(14, c_s);
        put(15, c_ns);
        put(16, b_s);
        put(17, b_ns);
    }
}

// ---------------------------------------------------------------------------
// Global state (single-threaded worker; the bridge owns that discipline).
// ---------------------------------------------------------------------------

pub struct State {
    pub vfs: Vfs,
    pub fds: vfs::FdTable,
    pub arena: arena::Arena,
    pub out: Vec<u8>,
}

static mut STATE: Option<State> = None;

pub fn state() -> &'static mut State {
    unsafe {
        let s = core::ptr::addr_of_mut!(STATE);
        if (*s).is_none() {
            *s = Some(State {
                vfs: Vfs::new(),
                fds: vfs::FdTable::new(),
                arena: arena::Arena::new(),
                out: Vec::new(),
            });
        }
        // Some by construction; unwrap_unchecked cannot panic (panic-free ABI).
        (*s).as_mut().unwrap_unchecked()
    }
}

#[cfg(test)]
pub fn reset_for_tests() {
    unsafe {
        *core::ptr::addr_of_mut!(STATE) = None;
    }
    state();
}

fn read_str(ptr: i32, len: i32) -> Result<String, i32> {
    match mem::read(ptr, len) {
        Some(b) => Ok(String::from_utf8_lossy(b).into_owned()),
        None => Err(-EFAULT),
    }
}

fn read_bytes(ptr: i32, len: i32) -> Result<&'static [u8], i32> {
    mem::read(ptr, len).ok_or(-EFAULT)
}

/// Store a blob in the out buffer and point RET_SLOT at it (ptr,len).
fn finish_out(bytes: &[u8]) -> i32 {
    let st = state();
    st.out.clear();
    st.out.extend_from_slice(bytes);
    if st.out.capacity() == 0 {
        st.out.reserve(8); // non-null, dereferenceable base even for len 0
    }
    set_ret(st.out.as_ptr() as u32, st.out.len() as u32);
    0
}

// ===========================================================================
// EXPORTS (spec §3 — exact names, exact signatures)
// ===========================================================================

// ---- lifecycle / memory ------------------------------------------------------

#[no_mangle]
pub extern "C" fn oc_version() -> i32 {
    1
}

#[no_mangle]
pub extern "C" fn oc_stat_slot() -> i32 {
    unsafe { core::ptr::addr_of!(STAT_SLOT.0) as i32 }
}

#[no_mangle]
pub extern "C" fn oc_ret_slot() -> i32 {
    unsafe { core::ptr::addr_of!(RET_SLOT.0) as i32 }
}

#[no_mangle]
pub extern "C" fn oc_arena_reset() -> i32 {
    state().arena.reset();
    0
}

#[no_mangle]
pub extern "C" fn oc_arena_alloc(n: i32) -> i32 {
    state().arena.alloc(n)
}

// ---- cwd ----------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn oc_chdir(path_ptr: i32, path_len: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    syscalls::chdir(&mut st.vfs, &path)
}

#[no_mangle]
pub extern "C" fn oc_getcwd() -> i32 {
    let cwd = {
        let st = state();
        syscalls::getcwd(&st.vfs)
    };
    finish_out(&cwd)
}

// ---- fd ops ---------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn oc_open(path_ptr: i32, path_len: i32, flags: i32, mode: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    syscalls::open(&mut st.vfs, &mut st.fds, &path, flags, mode)
}

#[no_mangle]
pub extern "C" fn oc_close(fd: i32) -> i32 {
    let st = state();
    syscalls::close(&mut st.fds, fd)
}

#[no_mangle]
pub extern "C" fn oc_read(fd: i32, len: i32) -> i32 {
    let out = {
        let st = state();
        syscalls::read(&st.vfs, &mut st.fds, fd, len)
    };
    match out {
        Ok(bytes) => finish_out(&bytes),
        Err(e) => e,
    }
}

#[no_mangle]
pub extern "C" fn oc_pread(fd: i32, len: i32, pos: i64) -> i32 {
    let out = {
        let st = state();
        syscalls::pread(&st.vfs, &mut st.fds, fd, len, pos)
    };
    match out {
        Ok(bytes) => finish_out(&bytes),
        Err(e) => e,
    }
}

#[no_mangle]
pub extern "C" fn oc_write(fd: i32, data_ptr: i32, data_len: i32) -> i32 {
    let data = match read_bytes(data_ptr, data_len) {
        Ok(d) => d,
        Err(e) => return e,
    };
    let st = state();
    syscalls::write(&mut st.vfs, &mut st.fds, fd, data)
}

#[no_mangle]
pub extern "C" fn oc_pwrite(fd: i32, data_ptr: i32, data_len: i32, pos: i64) -> i32 {
    let data = match read_bytes(data_ptr, data_len) {
        Ok(d) => d,
        Err(e) => return e,
    };
    let st = state();
    syscalls::pwrite(&mut st.vfs, &mut st.fds, fd, data, pos)
}

#[no_mangle]
pub extern "C" fn oc_ftruncate(fd: i32, len: i64) -> i32 {
    let st = state();
    syscalls::ftruncate(&mut st.vfs, &mut st.fds, fd, len)
}

#[no_mangle]
pub extern "C" fn oc_fstat(fd: i32) -> i32 {
    let st = state();
    let inode = match st.fds.get(fd) {
        Some(e) => e.inode,
        None => return -vfs::EBADF,
    };
    if !st.vfs.live(inode) {
        return -vfs::ENOENT;
    }
    fill_stat_slot(&st.vfs, inode, false);
    0
}

#[no_mangle]
pub extern "C" fn oc_fchmod(fd: i32, mode: i32) -> i32 {
    let st = state();
    syscalls::fchmod(&mut st.vfs, &mut st.fds, fd, mode)
}

// ---- path ops ---------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn oc_stat(path_ptr: i32, path_len: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    match syscalls::stat(&st.vfs, &path, true) {
        Ok(id) => {
            fill_stat_slot(&st.vfs, id, false);
            0
        }
        Err(e) => e,
    }
}

#[no_mangle]
pub extern "C" fn oc_lstat(path_ptr: i32, path_len: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    match syscalls::stat(&st.vfs, &path, false) {
        Ok(id) => {
            fill_stat_slot(&st.vfs, id, true);
            0
        }
        Err(e) => e,
    }
}

#[no_mangle]
pub extern "C" fn oc_exists(path_ptr: i32, path_len: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(_) => return 0,
    };
    let st = state();
    syscalls::exists(&st.vfs, &path)
}

#[no_mangle]
pub extern "C" fn oc_mkdir(path_ptr: i32, path_len: i32, mode: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    syscalls::mkdir(&mut st.vfs, &path, mode, false)
}

#[no_mangle]
pub extern "C" fn oc_mkdirp(path_ptr: i32, path_len: i32, mode: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    syscalls::mkdir(&mut st.vfs, &path, mode, true)
}

#[no_mangle]
pub extern "C" fn oc_rmdir(path_ptr: i32, path_len: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    syscalls::rmdir(&mut st.vfs, &path)
}

#[no_mangle]
pub extern "C" fn oc_unlink(path_ptr: i32, path_len: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    syscalls::unlink(&mut st.vfs, &path)
}

#[no_mangle]
pub extern "C" fn oc_rmrf(path_ptr: i32, path_len: i32, force: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    syscalls::rmrf(&mut st.vfs, &path, force != 0)
}

#[no_mangle]
pub extern "C" fn oc_rm_nonrecursive(path_ptr: i32, path_len: i32, force: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    syscalls::rm_nonrecursive(&mut st.vfs, &path, force != 0)
}

#[no_mangle]
pub extern "C" fn oc_rename(old_ptr: i32, old_len: i32, new_ptr: i32, new_len: i32) -> i32 {
    let old = match read_str(old_ptr, old_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let new = match read_str(new_ptr, new_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    syscalls::rename(&mut st.vfs, &old, &new)
}

#[no_mangle]
pub extern "C" fn oc_symlink(target_ptr: i32, target_len: i32, path_ptr: i32, path_len: i32) -> i32 {
    let target = match read_str(target_ptr, target_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    syscalls::symlink(&mut st.vfs, &target, &path)
}

#[no_mangle]
pub extern "C" fn oc_readlink(path_ptr: i32, path_len: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let out = {
        let st = state();
        syscalls::readlink(&st.vfs, &path)
    };
    match out {
        Ok(bytes) => finish_out(&bytes),
        Err(e) => e,
    }
}

#[no_mangle]
pub extern "C" fn oc_readdir(path_ptr: i32, path_len: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let out = {
        let st = state();
        syscalls::readdir(&st.vfs, &path, false)
    };
    match out {
        Ok(bytes) => finish_out(&bytes),
        Err(e) => e,
    }
}

#[no_mangle]
pub extern "C" fn oc_dirents(path_ptr: i32, path_len: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let out = {
        let st = state();
        syscalls::readdir(&st.vfs, &path, true)
    };
    match out {
        Ok(bytes) => finish_out(&bytes),
        Err(e) => e,
    }
}

#[no_mangle]
pub extern "C" fn oc_chmod(path_ptr: i32, path_len: i32, mode: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    syscalls::chmod(&mut st.vfs, &path, mode)
}

#[no_mangle]
pub extern "C" fn oc_utimes(path_ptr: i32, path_len: i32, atime_ms: f64, mtime_ms: f64) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    syscalls::utimes(&mut st.vfs, &path, atime_ms, mtime_ms)
}

#[no_mangle]
pub extern "C" fn oc_truncate(path_ptr: i32, path_len: i32, size: i64) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    syscalls::truncate(&mut st.vfs, &path, size)
}

#[no_mangle]
pub extern "C" fn oc_copy_file(src_ptr: i32, src_len: i32, dst_ptr: i32, dst_len: i32) -> i32 {
    let src = match read_str(src_ptr, src_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let dst = match read_str(dst_ptr, dst_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    syscalls::copy_file(&mut st.vfs, &src, &dst)
}

// ---- whole-file fast paths ----------------------------------------------------------

#[no_mangle]
pub extern "C" fn oc_write_file(
    path_ptr: i32,
    path_len: i32,
    data_ptr: i32,
    data_len: i32,
    mode: i32,
) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let data = match read_bytes(data_ptr, data_len) {
        Ok(d) => d,
        Err(e) => return e,
    };
    let st = state();
    syscalls::write_file(&mut st.vfs, &path, data, mode)
}

#[no_mangle]
pub extern "C" fn oc_read_file(path_ptr: i32, path_len: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let out = {
        let st = state();
        syscalls::read_file(&st.vfs, &path)
    };
    match out {
        Ok(bytes) => finish_out(&bytes),
        Err(e) => e,
    }
}

#[no_mangle]
pub extern "C" fn oc_append_file(path_ptr: i32, path_len: i32, data_ptr: i32, data_len: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let data = match read_bytes(data_ptr, data_len) {
        Ok(d) => d,
        Err(e) => return e,
    };
    let st = state();
    syscalls::append_file(&mut st.vfs, &path, data)
}

// ---- path utilities -------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn oc_normalize(path_ptr: i32, path_len: i32) -> i32 {
    let path = match read_str(path_ptr, path_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let out = {
        let st = state();
        syscalls::normalize(&st.vfs, &path)
    };
    match out {
        Ok(bytes) => finish_out(&bytes),
        Err(e) => e,
    }
}

#[no_mangle]
pub extern "C" fn oc_join_normalize(base_ptr: i32, base_len: i32, rel_ptr: i32, rel_len: i32) -> i32 {
    let base = match read_str(base_ptr, base_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let rel = match read_str(rel_ptr, rel_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let out = {
        let st = state();
        syscalls::join_normalize(&st.vfs, &base, &rel)
    };
    match out {
        Ok(bytes) => finish_out(&bytes),
        Err(e) => e,
    }
}

// ---- tar -------------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn oc_extract_tar(data_ptr: i32, data_len: i32, dest_ptr: i32, dest_len: i32) -> i32 {
    let data = match read_bytes(data_ptr, data_len) {
        Ok(d) => d,
        Err(e) => return e,
    };
    let dest = match read_str(dest_ptr, dest_len) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let st = state();
    let dest_norm = match st.vfs.normalize(&dest) {
        Some(n) => n,
        None => return -EINVAL,
    };
    tar::extract(&mut st.vfs, data, &dest_norm)
}

// ---- stats -------------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn oc_debug_counts() -> i32 {
    let counts = {
        let st = state();
        syscalls::debug_counts(&st.vfs, &st.fds)
    };
    finish_out(&counts)
}

/// Debug (temporary): the module's own view of linear memory size in bytes.
#[no_mangle]
pub extern "C" fn oc_debug_mem_bytes() -> i32 {
    mem::size() as i32
}
