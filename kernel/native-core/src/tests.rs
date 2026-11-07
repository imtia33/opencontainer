//! Host-target acceptance tests for ALL 10 spec §5 groups, ported from
//! kernel/vfs.ts + kernel/natives/fs.ts semantics. Run: cargo test
//! (single-process serialized via a mutex because the core is a static).

use crate::*;
use crate::vfs::*;
use std::sync::{Mutex, MutexGuard};

static LOCK: Mutex<()> = Mutex::new(());

fn setup() -> MutexGuard<'static, ()> {
    let g = LOCK.lock().unwrap_or_else(|e| e.into_inner());
    crate::reset_for_tests();
    g
}

// ---- helpers -----------------------------------------------------------------

fn put(bytes: &[u8]) -> (i32, i32) {
    let ptr = oc_arena_alloc(bytes.len() as i32);
    assert_ne!(ptr, 0, "arena alloc failed");
    hostmem::write(ptr as usize, bytes);
    (ptr, bytes.len() as i32)
}

fn put_str(s: &str) -> (i32, i32) {
    put(s.as_bytes())
}

fn out() -> Vec<u8> {
    state().out.clone()
}

fn out_str() -> String {
    String::from_utf8_lossy(&out()).into_owned()
}

fn names(path: &str) -> Vec<String> {
    let (p, l) = put_str(path);
    assert_eq!(oc_readdir(p, l), 0, "readdir {path}");
    out_str()
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
}

fn stat_bytes() -> [u8; 144] {
    unsafe { *core::ptr::addr_of!(crate::STAT_SLOT.0) }
}

fn ret_bytes() -> [u8; 8] {
    unsafe { *core::ptr::addr_of!(crate::RET_SLOT.0) }
}

fn stat_f64s() -> [f64; 18] {
    let b = stat_bytes();
    let mut out = [0f64; 18];
    for i in 0..18 {
        let mut bb = [0u8; 8];
        bb.copy_from_slice(&b[i * 8..i * 8 + 8]);
        out[i] = f64::from_le_bytes(bb);
    }
    out
}

fn wf(path: &str, data: &[u8], mode: i32) -> i32 {
    let (p, l) = put_str(path);
    let (d, dl) = put(data);
    oc_write_file(p, l, d, dl, mode)
}

fn rf(path: &str) -> Vec<u8> {
    let (p, l) = put_str(path);
    assert_eq!(oc_read_file(p, l), 0, "read_file {path}");
    out()
}

fn openf(path: &str, flags: i32, mode: i32) -> i32 {
    let (p, l) = put_str(path);
    oc_open(p, l, flags, mode)
}

fn wr(fd: i32, data: &[u8]) -> i32 {
    let (d, dl) = put(data);
    oc_write(fd, d, dl)
}

fn pwr(fd: i32, data: &[u8], pos: i64) -> i32 {
    let (d, dl) = put(data);
    oc_pwrite(fd, d, dl, pos)
}

fn rd(fd: i32, len: i32) -> Vec<u8> {
    assert_eq!(oc_read(fd, len), 0, "read fd {fd}");
    out()
}

fn prd(fd: i32, len: i32, pos: i64) -> Vec<u8> {
    assert_eq!(oc_pread(fd, len, pos), 0, "pread fd {fd}");
    out()
}

fn mkdirp(path: &str) -> i32 {
    let (p, l) = put_str(path);
    oc_mkdirp(p, l, 0o777)
}

fn mk1(path: &str) -> i32 {
    let (p, l) = put_str(path);
    oc_mkdir(p, l, 0o777)
}

fn unlink(path: &str) -> i32 {
    let (p, l) = put_str(path);
    oc_unlink(p, l)
}

fn rmrf(path: &str, force: bool) -> i32 {
    let (p, l) = put_str(path);
    oc_rmrf(p, l, if force { 1 } else { 0 })
}

fn rename(o: &str, n: &str) -> i32 {
    let (op, ol) = put_str(o);
    let (np, nl) = put_str(n);
    oc_rename(op, ol, np, nl)
}

fn symlink(target: &str, path: &str) -> i32 {
    let (tp, tl) = put_str(target);
    let (pp, pl) = put_str(path);
    oc_symlink(tp, tl, pp, pl)
}

fn readlink(path: &str) -> String {
    let (p, l) = put_str(path);
    assert_eq!(oc_readlink(p, l), 0, "readlink {path}");
    out_str()
}

fn statp(path: &str) -> i32 {
    let (p, l) = put_str(path);
    oc_stat(p, l)
}

fn lstatp(path: &str) -> i32 {
    let (p, l) = put_str(path);
    oc_lstat(p, l)
}

fn exists(path: &str) -> i32 {
    let (p, l) = put_str(path);
    oc_exists(p, l)
}

// ---- tar fixture builders ------------------------------------------------------

mod tb {
    fn oct(f: &mut [u8], v: u64) {
        let s = format!("{:o}", v);
        let s = if s.len() > f.len() - 1 {
            s[s.len() - (f.len() - 1)..].to_string()
        } else {
            s
        };
        let pad = f.len() - 1 - s.len();
        f[..pad].fill(b'0');
        f[pad..pad + s.len()].copy_from_slice(s.as_bytes());
        f[f.len() - 1] = 0;
    }

    pub fn header(name: &str, mode: u64, size: u64, mtime: u64, typeflag: u8, linkname: &str) -> Vec<u8> {
        let mut h = vec![0u8; 512];
        assert!(name.len() <= 100, "fixture name too long");
        h[..name.len()].copy_from_slice(name.as_bytes());
        oct(&mut h[100..108], mode);
        oct(&mut h[108..116], 0);
        oct(&mut h[116..124], 0);
        oct(&mut h[124..136], size);
        oct(&mut h[136..148], mtime);
        h[148..156].fill(b' ');
        h[156] = typeflag;
        if !linkname.is_empty() {
            h[157..157 + linkname.len()].copy_from_slice(linkname.as_bytes());
        }
        h[257..262].copy_from_slice(b"ustar");
        h[262] = 0;
        h[263] = b'0';
        h[264] = b'0';
        let sum: u64 = h.iter().map(|&b| b as u64).sum();
        let s = format!("{:06o}", sum);
        h[148..154].copy_from_slice(s.as_bytes());
        h[154] = 0;
        h[155] = b' ';
        h
    }

    fn pad(mut d: Vec<u8>) -> Vec<u8> {
        while d.len() % 512 != 0 {
            d.push(0);
        }
        d
    }

    pub fn file(name: &str, data: &[u8], mode: u64, mtime: u64) -> Vec<u8> {
        let mut e = header(name, mode, data.len() as u64, mtime, b'0', "");
        e.extend(pad(data.to_vec()));
        e
    }

    pub fn dir(name: &str, mode: u64) -> Vec<u8> {
        header(name, mode, 0, 0, b'5', "")
    }

    pub fn symlink(name: &str, target: &str) -> Vec<u8> {
        header(name, 0o777, 0, 0, b'2', target)
    }

    pub fn hardlink(name: &str, target: &str) -> Vec<u8> {
        header(name, 0o777, 0, 0, b'1', target)
    }

    pub fn gnu_longname(name: &str) -> Vec<u8> {
        let mut d = name.as_bytes().to_vec();
        d.push(0);
        let d = pad(d);
        let mut e = header("././@LongLink", 0o644, d.len() as u64, 0, b'L', "");
        e.extend(d);
        e
    }

    pub fn gnu_longlink(target: &str) -> Vec<u8> {
        let mut d = target.as_bytes().to_vec();
        d.push(0);
        let d = pad(d);
        let mut e = header("././@LongLink", 0o644, d.len() as u64, 0, b'K', "");
        e.extend(d);
        e
    }

    pub fn pax_record(key: &str, val: &str) -> Vec<u8> {
        let mut len = key.len() + val.len() + 4;
        loop {
            let s = format!("{} {}={}\n", len, key, val);
            if s.len() == len {
                return s.into_bytes();
            }
            len = s.len();
        }
    }

    pub fn pax(records: &[&[u8]]) -> Vec<u8> {
        let mut d: Vec<u8> = records.iter().flat_map(|r| r.to_vec()).collect();
        d = pad(d);
        let mut e = header("PaxHeaders/0", 0o644, d.len() as u64, 0, b'x', "");
        e.extend(d);
        e
    }

    pub fn zeros() -> Vec<u8> {
        vec![0u8; 1024]
    }

    pub fn tar(parts: &[&[u8]]) -> Vec<u8> {
        let mut t: Vec<u8> = parts.iter().flat_map(|p| p.to_vec()).collect();
        t.extend(zeros());
        t
    }
}

fn extract(tar_bytes: &[u8], dest: &str) -> i32 {
    let (tp, tl) = put(tar_bytes);
    let (dp, dl) = put_str(dest);
    oc_extract_tar(tp, tl, dp, dl)
}

// ===========================================================================
// Group 1 — POSIX rename matrix
// ===========================================================================

#[test]
fn g1_rename_matrix_all_branches() {
    let _g = setup();
    // file -> existing file: silent atomic replace
    assert_eq!(wf("/src", b"hello", 0o644), 0);
    assert_eq!(wf("/dst", b"old-content-longer", 0o644), 0);
    assert_eq!(rename("/src", "/dst"), 0);
    assert_eq!(rf("/dst"), b"hello".to_vec());
    assert_eq!(exists("/src"), 0);

    // dir -> existing EMPTY dir: replace
    assert_eq!(mk1("/d1"), 0);
    assert_eq!(mk1("/d2"), 0);
    assert_eq!(rename("/d1", "/d2"), 0);
    assert_eq!(exists("/d1"), 0);
    assert_eq!(exists("/d2"), 1);

    // dir -> existing NON-EMPTY dir: ENOTEMPTY
    assert_eq!(mk1("/e1"), 0);
    assert_eq!(mk1("/e2"), 0);
    assert_eq!(wf("/e2/child", b"x", 0o644), 0);
    assert_eq!(rename("/e1", "/e2"), -ENOTEMPTY);

    // file -> dir: EISDIR
    assert_eq!(wf("/f", b"x", 0o644), 0);
    assert_eq!(mk1("/dd"), 0);
    assert_eq!(rename("/f", "/dd"), -EISDIR);

    // dir -> file: ENOTDIR
    assert_eq!(mk1("/d3"), 0);
    assert_eq!(wf("/ff", b"x", 0o644), 0);
    assert_eq!(rename("/d3", "/ff"), -ENOTDIR);

    // missing src: ENOENT
    assert_eq!(rename("/nope", "/x"), -ENOENT);
    // missing new parent: ENOENT
    assert_eq!(wf("/g", b"x", 0o644), 0);
    assert_eq!(rename("/g", "/missing-dir/x"), -ENOENT);

    // symlink counts as non-dir in the matrix (replace)
    assert_eq!(symlink("/nothing", "/ln1"), 0);
    assert_eq!(wf("/plain", b"p", 0o644), 0);
    assert_eq!(rename("/plain", "/ln1"), 0);
    assert_eq!(rf("/ln1"), b"p".to_vec()); // new file at /ln1
}

#[test]
fn g1_rename_same_path_is_noop_without_reorder() {
    let _g = setup();
    assert_eq!(mk1("/d"), 0);
    assert_eq!(wf("/d/x", b"1", 0o644), 0);
    assert_eq!(wf("/d/y", b"2", 0o644), 0);
    assert_eq!(wf("/d/z", b"3", 0o644), 0);
    assert_eq!(rename("/d/x", "/d/x"), 0);
    // no-op: entry did NOT move to the end (spec: same-inode rename = no-op)
    assert_eq!(names("/d"), vec!["x", "y", "z"]);
    assert_eq!(rename("/d", "/d"), 0);
    assert_eq!(exists("/d"), 1);
}

#[test]
fn g1_rename_subtree_moves_children() {
    let _g = setup();
    assert_eq!(mkdirp("/a/b/c"), 0);
    assert_eq!(wf("/a/b/c/deep.txt", b"deep", 0o644), 0);
    assert_eq!(wf("/a/b/f.txt", b"f", 0o644), 0);
    assert_eq!(mk1("/dest"), 0);
    assert_eq!(rename("/a/b", "/dest/moved"), 0);
    assert_eq!(rf("/dest/moved/c/deep.txt"), b"deep".to_vec());
    assert_eq!(rf("/dest/moved/f.txt"), b"f".to_vec());
    assert_eq!(exists("/a/b"), 0);
    assert_eq!(names("/dest/moved/c"), vec!["deep.txt"]);
}

#[test]
fn g1_rename_moves_entry_to_end_of_new_parent_readdir() {
    let _g = setup();
    assert_eq!(mk1("/p"), 0);
    for n in ["x", "y", "z"] {
        assert_eq!(wf(&format!("/p/{n}"), n.as_bytes(), 0o644), 0);
    }
    assert_eq!(rename("/p/x", "/p/w"), 0);
    assert_eq!(names("/p"), vec!["y", "z", "w"]); // x moved to END as w
    // cross-parent move also lands at the end of the new parent
    assert_eq!(mk1("/q"), 0);
    assert_eq!(wf("/q/first", b"1", 0o644), 0);
    assert_eq!(rename("/p/y", "/q/y"), 0);
    assert_eq!(names("/q"), vec!["first", "y"]);
    assert_eq!(names("/p"), vec!["z", "w"]);
}

#[test]
fn g1_rename_dir_into_own_subtree_einval() {
    let _g = setup();
    assert_eq!(mkdirp("/a/b"), 0);
    assert_eq!(rename("/a", "/a/b/c"), -EINVAL); // would orphan the subtree
    assert_eq!(rename("/a", "/a/b"), -EINVAL);
    assert_eq!(exists("/a/b"), 1); // tree intact
}

#[test]
fn g1_rename_root_guards() {
    let _g = setup();
    assert_eq!(rename("/", "/x"), -EBUSY);
    assert_eq!(wf("/r", b"r", 0o644), 0);
    assert_eq!(rename("/r", "/"), -EINVAL);
}

#[test]
fn g1_rename_dangling_symlink_moves_the_link() {
    let _g = setup();
    assert_eq!(symlink("/gone", "/sl"), 0);
    assert_eq!(rename("/sl", "/sl2"), 0);
    assert_eq!(lstatp("/sl"), -ENOENT);
    assert_eq!(readlink("/sl2"), "/gone");
}

// ===========================================================================
// Group 2 — open flags / fd semantics
// ===========================================================================

#[test]
fn g2_open_o_creat_and_basic_rw() {
    let _g = setup();
    let fd = openf("/new.txt", O_WRONLY | O_CREAT, 0o644);
    assert!(fd >= 3);
    assert_eq!(wr(fd, b"hello "), 6);
    assert_eq!(wr(fd, b"world"), 5);
    assert_eq!(oc_close(fd), 0);
    assert_eq!(rf("/new.txt"), b"hello world".to_vec());
}

#[test]
fn g2_open_o_excl_eexist_any_type() {
    let _g = setup();
    assert_eq!(wf("/ex", b"x", 0o644), 0);
    assert_eq!(openf("/ex", O_WRONLY | O_CREAT | O_EXCL, 0o644), -EEXIST);
    assert_eq!(mk1("/exd"), 0);
    assert_eq!(openf("/exd", O_WRONLY | O_CREAT | O_EXCL, 0o644), -EEXIST);
    // dangling symlink: POSIX link-level check -> EEXIST (README deviation #5)
    assert_eq!(symlink("/gone", "/exl"), 0);
    assert_eq!(openf("/exl", O_WRONLY | O_CREAT | O_EXCL, 0o644), -EEXIST);
    // plain O_CREAT through the dangling link creates at the TARGET
    assert_eq!(openf("/exl", O_WRONLY | O_CREAT, 0o644), 3);
    assert_eq!(exists("/gone"), 1);
    // O_EXCL when the entry does not exist: fine
    assert_eq!(openf("/fresh", O_WRONLY | O_CREAT | O_EXCL, 0o644), 4);
}

#[test]
fn g2_open_o_trunc_empties_at_open() {
    let _g = setup();
    assert_eq!(wf("/t", b"01234567", 0o644), 0); // 8 bytes
    let fd = openf("/t", O_WRONLY | O_TRUNC, 0o644);
    assert!(fd >= 3);
    assert_eq!(oc_fstat(fd), 0);
    assert_eq!(stat_f64s()[8], 0.0); // size 0 right after open
    assert_eq!(wr(fd, b"ab"), 2);
    assert_eq!(oc_close(fd), 0);
    // rewrite of a LONGER file leaves no old tail
    assert_eq!(rf("/t"), b"ab".to_vec());
    let fd2 = openf("/t", O_WRONLY | O_TRUNC, 0o644);
    assert_eq!(wr(fd2, b"Z"), 1);
    assert_eq!(oc_close(fd2), 0);
    assert_eq!(rf("/t"), b"Z".to_vec());
}

#[test]
fn g2_open_o_append_appends_and_pos_tracks_size() {
    let _g = setup();
    assert_eq!(wf("/ap", b"AAA", 0o644), 0);
    let fd = openf("/ap", O_WRONLY | O_APPEND, 0o644);
    assert!(fd >= 3);
    assert_eq!(wr(fd, b"BBB"), 3);
    assert_eq!(wr(fd, b"C"), 1);
    assert_eq!(oc_close(fd), 0);
    assert_eq!(rf("/ap"), b"AAABBBC".to_vec());
    // pos tracked size: next non-append read fd starts at 0, but an
    // append-mode READ continues from the tracked end
    let fd = openf("/ap", O_WRONLY | O_APPEND, 0o644);
    assert_eq!(rd(fd, 100).len(), 0); // pos == size -> EOF
    assert_eq!(oc_close(fd), 0);
}

#[test]
fn g2_pwrite_does_not_move_fd_pos() {
    let _g = setup();
    assert_eq!(wf("/pw", b"AAAABBBBCCCC", 0o644), 0);
    let fd = openf("/pw", O_WRONLY, 0o644);
    assert_eq!(wr(fd, b"XY"), 2); // pos 0 -> 2
    assert_eq!(pwr(fd, b"ZZ", 0), 2); // overwrite at 0, pos UNMOVED
    assert_eq!(rf("/pw"), b"ZZAABBBBCCCC".to_vec());
    assert_eq!(rd(fd, 4), b"AABB".to_vec()); // reads from pos 2
    assert_eq!(oc_close(fd), 0);
    // pwrite past EOF extends with a zero gap
    let fd = openf("/pw", O_WRONLY, 0o644);
    assert_eq!(pwr(fd, b"!", 15), 1);
    assert_eq!(oc_close(fd), 0);
    let data = rf("/pw");
    assert_eq!(data.len(), 16);
    assert_eq!(&data[13..15], &[0, 0]);
    assert_eq!(data[15], b'!');
}

#[test]
fn g2_pread_does_not_move_pos_and_espipe_on_append() {
    let _g = setup();
    assert_eq!(wf("/pr", b"AAAABBBBCCCC", 0o644), 0);
    let fd = openf("/pr", O_RDONLY, 0);
    assert_eq!(rd(fd, 4), b"AAAA".to_vec()); // pos 0 -> 4
    assert_eq!(prd(fd, 4, 8), b"CCCC".to_vec()); // explicit pos, fd pos UNMOVED
    assert_eq!(rd(fd, 4), b"BBBB".to_vec()); // from pos 4
    assert_eq!(rd(fd, 100), b"CCCC".to_vec()); // short read: 4 of 100
    assert_eq!(rd(fd, 100), b"".to_vec()); // now EOF
    assert_eq!(oc_read(fd, 0), 0); // len=0 -> n=0
    assert_eq!(oc_close(fd), 0);
    // pread on an append-only fd: ESPIPE (spec)
    let fd = openf("/pr", O_WRONLY | O_APPEND, 0o644);
    assert_eq!(oc_pread(fd, 4, 0), -ESPIPE);
    assert_eq!(oc_close(fd), 0);
    // negative pos: EINVAL
    let fd = openf("/pr", O_RDONLY, 0);
    assert_eq!(oc_pread(fd, 4, -1), -EINVAL);
    assert_eq!(pwr(fd, b"x", -5), -EINVAL); // negative pwrite position
    assert_eq!(oc_close(fd), 0);
}

#[test]
fn g2_dir_fd_semantics() {
    let _g = setup();
    assert_eq!(mk1("/dd"), 0);
    let fd = openf("/dd", O_RDONLY, 0); // read-only dir open allowed (fstat)
    assert!(fd >= 3);
    assert_eq!(oc_fstat(fd), 0);
    assert_eq!(stat_f64s()[1] as u32 & S_IFMT, S_IFDIR);
    assert_eq!(oc_read(fd, 10), -EISDIR); // read on a dir fd
    assert_eq!(oc_close(fd), 0);
    assert_eq!(openf("/dd", O_WRONLY, 0o644), -EISDIR); // write flags on a dir
    assert_eq!(openf("/dd", O_RDWR, 0o644), -EISDIR);
    assert_eq!(openf("/dd", O_WRONLY | O_TRUNC, 0o644), -EISDIR);
}

#[test]
fn g2_bad_fd_ebadf() {
    let _g = setup();
    assert_eq!(oc_close(-1), -EBADF);
    assert_eq!(oc_close(0), -EBADF); // stdio fds are owned by JS
    assert_eq!(oc_close(1), -EBADF);
    assert_eq!(oc_close(2), -EBADF);
    assert_eq!(oc_close(99), -EBADF);
    assert_eq!(oc_read(99, 4), -EBADF);
    assert_eq!(oc_pread(99, 4, 0), -EBADF);
    let (d, dl) = put(b"x");
    assert_eq!(oc_write(99, d, dl), -EBADF);
    assert_eq!(oc_pwrite(99, d, dl, 0), -EBADF);
    assert_eq!(oc_fstat(99), -EBADF);
    assert_eq!(oc_fchmod(99, 0o644), -EBADF);
    assert_eq!(oc_ftruncate(99, 0), -EBADF);
    // double close
    let fd = openf("/x", O_WRONLY | O_CREAT, 0o644);
    assert_eq!(oc_close(fd), 0);
    assert_eq!(oc_close(fd), -EBADF);
}

#[test]
fn g2_emfile_cap_and_first_free_reuse() {
    let _g = setup();
    let mut opened = 0i32;
    let mut last = 0i32;
    loop {
        let fd = openf(&format!("/f{opened}"), O_WRONLY | O_CREAT, 0o644);
        if fd < 0 {
            assert_eq!(fd, -EMFILE);
            break;
        }
        last = fd;
        opened += 1;
    }
    // fds 3..=4095 (table capped at 4096 entries; 0-2 reserved)
    assert_eq!(opened, 4093);
    assert_eq!(last, 4095);
    assert_eq!(openf("/overflow", O_WRONLY | O_CREAT, 0o644), -EMFILE);
    assert_eq!(oc_close(3), 0);
    assert_eq!(openf("/reuse", O_WRONLY | O_CREAT, 0o644), 3); // first-free scan
}

#[test]
fn g2_open_enoent_matrix() {
    let _g = setup();
    assert_eq!(openf("/missing", O_RDONLY, 0), -ENOENT);
    assert_eq!(openf("/missing", O_WRONLY, 0), -ENOENT);
    assert_eq!(openf("/no/dir/f", O_WRONLY | O_CREAT, 0o644), -ENOENT); // parent missing
    assert_eq!(wf("/plainfile", b"x", 0o644), 0);
    assert_eq!(openf("/plainfile/child", O_RDONLY, 0), -ENOENT); // through a file
    assert_eq!(symlink("/gone", "/dang"), 0);
    assert_eq!(openf("/dang", O_RDONLY, 0), -ENOENT); // dangling, no O_CREAT
}

#[test]
fn g2_open_through_symlinks() {
    let _g = setup();
    assert_eq!(mkdirp("/realdir"), 0);
    assert_eq!(symlink("/realdir", "/ldir"), 0);
    // path THROUGH a symlinked dir resolves to the target dir
    let fd = openf("/ldir/via-link.txt", O_WRONLY | O_CREAT, 0o644);
    assert!(fd >= 3);
    assert_eq!(wr(fd, b"thru"), 4);
    assert_eq!(oc_close(fd), 0);
    assert_eq!(rf("/realdir/via-link.txt"), b"thru".to_vec());
    // final-component symlink: writes land on the TARGET, link intact
    assert_eq!(wf("/target.txt", b"orig", 0o644), 0);
    assert_eq!(symlink("/target.txt", "/flink"), 0);
    let fd = openf("/flink", O_WRONLY | O_TRUNC, 0o644);
    assert_eq!(wr(fd, b"new"), 3);
    assert_eq!(oc_close(fd), 0);
    assert_eq!(rf("/target.txt"), b"new".to_vec());
    assert_eq!(readlink("/flink"), "/target.txt"); // link survived
}

#[test]
fn g2_ftruncate_and_fchmod() {
    let _g = setup();
    assert_eq!(wf("/ft", b"0123456789", 0o644), 0);
    let fd = openf("/ft", O_RDWR, 0o644);
    assert_eq!(oc_ftruncate(fd, 4), 0);
    assert_eq!(rf("/ft"), b"0123".to_vec());
    assert_eq!(oc_fchmod(fd, 0o600), 0);
    assert_eq!(oc_fstat(fd), 0);
    assert_eq!(stat_f64s()[1] as u32, 0o100600);
    assert_eq!(oc_ftruncate(fd, -1), -EINVAL);
    assert_eq!(oc_ftruncate(fd, 1 << 40), -ENOSPC); // > MAX_FILE bound
    assert_eq!(oc_close(fd), 0);
    let dfd = openf("/", O_RDONLY, 0);
    assert_eq!(oc_ftruncate(dfd, 0), -EINVAL); // dir fd
    assert_eq!(oc_close(dfd), 0);
}

#[test]
fn g2_fd_to_unlinked_file_enoent() {
    let _g = setup();
    assert_eq!(wf("/gone-later", b"data", 0o644), 0);
    let fd = openf("/gone-later", O_RDONLY, 0);
    assert_eq!(rmrf("/gone-later", true), 0);
    assert_eq!(oc_read(fd, 4), -ENOENT); // no refcounts in v1 (README)
    assert_eq!(oc_fstat(fd), -ENOENT);
    assert_eq!(oc_close(fd), 0);
}

// ===========================================================================
// Group 3 — symlinks
// ===========================================================================

#[test]
fn g3_midpath_dir_symlink() {
    let _g = setup();
    assert_eq!(mkdirp("/usr/lib/node_modules"), 0);
    assert_eq!(symlink("/usr/lib", "/lib"), 0);
    assert_eq!(wf("/lib/node_modules/x.js", b"module", 0o644), 0);
    assert_eq!(rf("/usr/lib/node_modules/x.js"), b"module".to_vec());
    assert_eq!(exists("/lib/node_modules/x.js"), 1);
}

#[test]
fn g3_final_component_symlink_write_target() {
    let _g = setup();
    assert_eq!(wf("/real", b"first", 0o644), 0);
    assert_eq!(symlink("real", "/rel-link"), 0); // relative target
    assert_eq!(wf("/rel-link", b"second", 0o644), 0);
    assert_eq!(rf("/real"), b"second".to_vec());
    assert_eq!(lstatp("/rel-link"), 0);
    assert_eq!(stat_f64s()[1] as u32 & S_IFMT, S_IFLNK); // still a link
    // append through the link too
    assert_eq!(
        {
            let (p, l) = put_str("/rel-link");
            let (d, dl) = put(b"!");
            oc_append_file(p, l, d, dl)
        },
        0
    );
    assert_eq!(rf("/real"), b"second!".to_vec());
}

#[test]
fn g3_eloop_at_40_follows() {
    let _g = setup();
    // 50-link chain: resolution needs 50 follows > 40 budget
    assert_eq!(symlink("/l1", "/l0"), 0);
    for i in 1..50 {
        assert_eq!(symlink(&format!("/l{}", i + 1), &format!("/l{}", i)), 0);
    }
    assert_eq!(symlink("/definitely-missing", "/l50"), 0);
    assert_eq!(statp("/l0"), -ELOOP);
    assert_eq!(exists("/l0"), 0);
    // self-referential link
    assert_eq!(symlink("/self", "/self"), 0);
    assert_eq!(statp("/self"), -ELOOP);
    // a 40-link chain still resolves (budget is exactly 40), 41 does not
    assert_eq!(symlink("/t1", "/t0"), 0);
    for i in 1..39 {
        // t1 -> t2, ..., t38 -> t39
        assert_eq!(symlink(&format!("/t{}", i + 1), &format!("/t{}", i)), 0);
    }
    assert_eq!(wf("/end", b"ok", 0o644), 0);
    assert_eq!(symlink("/end", "/t39"), 0); // /t0 .. /t39 = 40 links
    assert_eq!(statp("/t0"), 0); // exactly 40 follows: allowed
    assert_eq!(symlink("/t0", "/t40x"), 0); // 41st link at the chain HEAD
    assert_eq!(statp("/t40x"), -ELOOP); // 41 follows: ELOOP
}

#[test]
fn g3_readlink_enoent_vs_einval() {
    let _g = setup();
    assert_eq!(wf("/afile", b"x", 0o644), 0);
    let (p, l) = put_str("/afile");
    assert_eq!(oc_readlink(p, l), -EINVAL); // existing non-symlink
    let (p, l) = put_str("/no-such-link");
    assert_eq!(oc_readlink(p, l), -ENOENT); // missing path
    assert_eq!(symlink("../packages/x", "/lnk"), 0);
    assert_eq!(readlink("/lnk"), "../packages/x"); // verbatim target
}

#[test]
fn g3_lstat_size_is_target_byte_length() {
    let _g = setup();
    assert_eq!(symlink("/a/b/c/target-file.ts", "/lnk"), 0);
    assert_eq!(lstatp("/lnk"), 0);
    let s = stat_f64s();
    assert_eq!(s[1] as u32 & S_IFMT, S_IFLNK);
    assert_eq!(s[8], "/a/b/c/target-file.ts".len() as f64); // size = target bytes
    assert_eq!(s[9], 0.0); // blocks: 0 (vfs.ts quirk)
    // stat follows to the target (parent must exist first — spec §3)
    assert_eq!(mkdirp("/a/b/c"), 0);
    assert_eq!(wf("/a/b/c/target-file.ts", b"12345", 0o644), 0);
    assert_eq!(statp("/lnk"), 0);
    assert_eq!(stat_f64s()[8], 5.0);
    assert_eq!(stat_f64s()[1] as u32 & S_IFMT, S_IFREG);
}

#[test]
fn g3_symlink_to_dir_mkdirp_creates_inside_target() {
    let _g = setup();
    assert_eq!(mkdirp("/real"), 0);
    assert_eq!(symlink("/real", "/alias"), 0);
    assert_eq!(mkdirp("/alias/sub/deeper"), 0);
    assert_eq!(exists("/real/sub/deeper"), 1);
    assert_eq!(lstatp("/alias"), 0);
    assert_eq!(stat_f64s()[1] as u32 & S_IFMT, S_IFLNK); // alias still a link
    assert_eq!(names("/real"), vec!["sub"]);
}

#[test]
fn g3_dangling_symlink_visibility() {
    let _g = setup();
    assert_eq!(symlink("/void", "/dang"), 0);
    assert_eq!(exists("/dang"), 0); // stat through the link: ENOENT
    assert_eq!(statp("/dang"), -ENOENT);
    assert_eq!(lstatp("/dang"), 0); // lstat sees the link itself
    assert_eq!(stat_f64s()[8], "/void".len() as f64);
}

// ===========================================================================
// Group 4 — readdir order / dirents / tombstones
// ===========================================================================

#[test]
fn g4_readdir_insertion_order_and_edits() {
    let _g = setup();
    assert_eq!(mk1("/d"), 0);
    for n in ["c1", "c2", "c3"] {
        assert_eq!(wf(&format!("/d/{n}"), b"x", 0o644), 0);
    }
    assert_eq!(names("/d"), vec!["c1", "c2", "c3"]);
    assert_eq!(unlink("/d/c2"), 0);
    assert_eq!(names("/d"), vec!["c1", "c3"]);
    assert_eq!(rename("/d/c1", "/d/c1b"), 0);
    assert_eq!(names("/d"), vec!["c3", "c1b"]); // renamed entry at END
    assert_eq!(wf("/d/c2", b"x", 0o644), 0); // re-create: END
    assert_eq!(names("/d"), vec!["c3", "c1b", "c2"]);
    // empty dir -> empty blob
    assert_eq!(mk1("/empty"), 0);
    assert_eq!(names("/empty"), Vec::<String>::new());
    // errors
    assert_eq!(wf("/afile", b"x", 0o644), 0);
    let (p, l) = put_str("/afile");
    assert_eq!(oc_readdir(p, l), -ENOTDIR);
    let (p, l) = put_str("/missing");
    assert_eq!(oc_readdir(p, l), -ENOENT);
}

#[test]
fn g4_dirents_type_codes() {
    let _g = setup();
    assert_eq!(mkdirp("/mix/sub"), 0);
    assert_eq!(wf("/mix/file.txt", b"x", 0o644), 0);
    assert_eq!(symlink("sub", "/mix/lnk"), 0);
    let (p, l) = put_str("/mix");
    assert_eq!(oc_dirents(p, l), 0);
    let raw = out();
    // name NUL + u8 code: sub=4(dir), file.txt=8, lnk=10 (insertion order)
    let expected: Vec<u8> = b"sub\0\x04file.txt\0\x08lnk\0\x0a".to_vec();
    // NOTE: "sub" was created first (mkdirp creates /mix then /mix/sub),
    // then file.txt, then lnk.
    assert_eq!(raw, expected);
}

#[test]
fn g4_tombstone_compaction_threshold() {
    let _g = setup();
    assert_eq!(mk1("/t"), 0);
    let letters = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    for n in letters {
        assert_eq!(wf(&format!("/t/{n}"), b"x", 0o644), 0);
    }
    // 3 tombstones (order.len()=10): 3 > 5 false -> no compaction yet
    for n in ["a", "c", "e"] {
        assert_eq!(unlink(&format!("/t/{n}")), 0);
    }
    assert_eq!(names("/t"), vec!["b", "d", "f", "g", "h", "i", "j"]);
    // more deletions cross tombstones > len/2 (6 > 5) -> compacted
    for n in ["g", "i", "b"] {
        assert_eq!(unlink(&format!("/t/{n}")), 0);
    }
    assert_eq!(names("/t"), vec!["d", "f", "h", "j"]); // order preserved
    // still fully functional after compaction
    assert_eq!(wf("/t/new", b"x", 0o644), 0);
    assert_eq!(names("/t"), vec!["d", "f", "h", "j", "new"]);
}

// ===========================================================================
// Group 5 — mkdir / mkdirp / rmdir / unlink / rmrf matrix
// ===========================================================================

#[test]
fn g5_mkdir_matrix() {
    let _g = setup();
    assert_eq!(mk1("/m"), 0);
    assert_eq!(mk1("/m"), -EEXIST); // existing dir
    assert_eq!(wf("/mf", b"x", 0o644), 0);
    assert_eq!(mk1("/mf"), -EEXIST); // existing file
    assert_eq!(symlink("/m", "/ml"), 0);
    assert_eq!(mk1("/ml"), -EEXIST); // symlink to dir (follows -> exists)
    assert_eq!(mk1("/no/parent"), -ENOENT); // parent missing
    assert_eq!(mk1("/mf/child"), -ENOENT); // parent is a file
    // vfs.ts quirk (README deviation #2): dangling symlink -> ENOTDIR
    assert_eq!(symlink("/void", "/dang"), 0);
    assert_eq!(mk1("/dang"), -ENOTDIR);
    // mode applied (masked 0o777)
    let (p, l) = put_str("/moded");
    assert_eq!(oc_mkdir(p, l, 0o750), 0);
    assert_eq!(statp("/moded"), 0);
    assert_eq!(stat_f64s()[1] as u32, 0o040750);
    // mkdir "/" -> EEXIST
    let (p, l) = put_str("/");
    assert_eq!(oc_mkdir(p, l, 0o777), -EEXIST);
}

#[test]
fn g5_mkdirp_matrix() {
    let _g = setup();
    assert_eq!(mkdirp("/a/b/c/d"), 0);
    assert_eq!(exists("/a/b/c/d"), 1);
    assert_eq!(mkdirp("/a/b/c/d"), 0); // final exists and is a dir: success
    assert_eq!(wf("/a/file", b"x", 0o644), 0);
    assert_eq!(mkdirp("/a/file"), -EEXIST); // final exists, not a dir
    assert_eq!(mkdirp("/a/file/deeper"), -ENOTDIR); // non-dir on the path
    assert_eq!(symlink("/void", "/dang"), 0);
    assert_eq!(mkdirp("/dang/x"), -ENOTDIR); // dangling symlink on the path
    let (p, l) = put_str("/");
    assert_eq!(oc_mkdirp(p, l, 0o777), 0); // mkdirp "/" is a success no-op
    // symlink-to-dir final component: resolves through -> success
    assert_eq!(mkdirp("/real2"), 0);
    assert_eq!(symlink("/real2", "/al2"), 0);
    assert_eq!(mkdirp("/al2"), 0);
}

#[test]
fn g5_rmdir_matrix() {
    let _g = setup();
    assert_eq!(mkdirp("/r/kids"), 0);
    assert_eq!(wf("/r/kids/f", b"x", 0o644), 0);
    let (p, l) = put_str("/r/kids");
    assert_eq!(oc_rmdir(p, l), -ENOTEMPTY);
    assert_eq!(unlink("/r/kids/f"), 0);
    assert_eq!(oc_rmdir(p, l), 0); // empty now
    let (p, l) = put_str("/r/kids");
    assert_eq!(oc_rmdir(p, l), -ENOENT);
    assert_eq!(wf("/rf", b"x", 0o644), 0);
    let (p, l) = put_str("/rf");
    assert_eq!(oc_rmdir(p, l), -ENOTDIR); // file
    assert_eq!(symlink("/rf", "/rl"), 0);
    let (p, l) = put_str("/rl");
    assert_eq!(oc_rmdir(p, l), -ENOTDIR); // symlink (no follow)
    let (p, l) = put_str("/");
    assert_eq!(oc_rmdir(p, l), -EBUSY); // root
}

#[test]
fn g5_unlink_matrix() {
    let _g = setup();
    assert_eq!(wf("/u", b"x", 0o644), 0);
    assert_eq!(unlink("/u"), 0);
    assert_eq!(unlink("/u"), -ENOENT);
    assert_eq!(mkdirp("/ud"), 0);
    assert_eq!(unlink("/ud"), -EISDIR); // dir
    // unlink removes the LINK, never the target
    assert_eq!(wf("/target", b"keep", 0o644), 0);
    assert_eq!(symlink("/target", "/ul"), 0);
    assert_eq!(unlink("/ul"), 0);
    assert_eq!(exists("/target"), 1);
    assert_eq!(lstatp("/ul"), -ENOENT);
}

#[test]
fn g5_rmrf_matrix() {
    let _g = setup();
    assert_eq!(rmrf("/nothing", true), 0); // force: ENOENT is success
    assert_eq!(rmrf("/nothing", false), -ENOENT);
    assert_eq!(mkdirp("/tree/a/b"), 0);
    assert_eq!(wf("/tree/a/b/leaf", b"x", 0o644), 0);
    assert_eq!(wf("/tree/file", b"x", 0o644), 0);
    assert_eq!(rmrf("/tree", false), 0); // recursive delete of any type
    assert_eq!(exists("/tree"), 0);
    assert_eq!(exists("/tree/a/b/leaf"), 0);
    // removes a symlink without touching the target
    assert_eq!(wf("/keep", b"k", 0o644), 0);
    assert_eq!(symlink("/keep", "/kl"), 0);
    assert_eq!(rmrf("/kl", false), 0);
    assert_eq!(exists("/keep"), 1);
    // single file
    assert_eq!(wf("/single", b"s", 0o644), 0);
    assert_eq!(rmrf("/single", false), 0);
}

#[test]
fn g5_rm_nonrecursive_matrix() {
    let _g = setup();
    assert_eq!(mkdirp("/nn/inner"), 0);
    let (p, l) = put_str("/nn");
    assert_eq!(oc_rm_nonrecursive(p, l, 0), -ENOTEMPTY);
    assert_eq!(oc_rm_nonrecursive(p, l, 1), -ENOTEMPTY); // force does not bypass ENOTEMPTY
    assert_eq!(rmrf("/nn/inner", false), 0);
    assert_eq!(oc_rm_nonrecursive(p, l, 0), 0); // empty dir now
    assert_eq!(wf("/nfile", b"x", 0o644), 0);
    let (p, l) = put_str("/nfile");
    assert_eq!(oc_rm_nonrecursive(p, l, 0), 0);
    let (p, l) = put_str("/nfile");
    assert_eq!(oc_rm_nonrecursive(p, l, 0), -ENOENT);
    assert_eq!(oc_rm_nonrecursive(p, l, 1), 0); // force
}

// ===========================================================================
// Group 6 — write_file fast path / whole-file ops
// ===========================================================================

#[test]
fn g6_write_file_semantics() {
    let _g = setup();
    // create
    assert_eq!(wf("/w", b"hello world", 0o644), 0);
    assert_eq!(rf("/w"), b"hello world".to_vec());
    assert_eq!(statp("/w"), 0);
    assert_eq!(stat_f64s()[1] as u32, 0o100644);
    assert_eq!(stat_f64s()[8], 11.0);
    // overwrite shorter: no old tail
    assert_eq!(wf("/w", b"hi", 0o644), 0);
    assert_eq!(rf("/w"), b"hi".to_vec());
    // EISDIR / ENOENT (fs.ts maps both with syscall 'open')
    assert_eq!(mkdirp("/dir6"), 0);
    assert_eq!(wf("/dir6", b"x", 0o644), -EISDIR);
    assert_eq!(wf("/no/parent/f", b"x", 0o644), -ENOENT);
    // zero bytes
    assert_eq!(wf("/empty", b"", 0o644), 0);
    assert_eq!(rf("/empty"), b"".to_vec());
    // default mode 0o666 when mode arg 0
    assert_eq!(wf("/defmode", b"x", 0), 0);
    assert_eq!(statp("/defmode"), 0);
    assert_eq!(stat_f64s()[1] as u32, 0o100666);
}

#[test]
fn g6_write_file_through_symlink() {
    let _g = setup();
    assert_eq!(wf("/tgt", b"one", 0o644), 0);
    assert_eq!(symlink("/tgt", "/wl"), 0);
    assert_eq!(wf("/wl", b"two-longer", 0o644), 0);
    assert_eq!(rf("/tgt"), b"two-longer".to_vec()); // TARGET written
    assert_eq!(readlink("/wl"), "/tgt"); // link intact
    // dangling link: creates at the target
    assert_eq!(symlink("/created-via-link", "/dl"), 0);
    assert_eq!(wf("/dl", b"made", 0o644), 0);
    assert_eq!(rf("/created-via-link"), b"made".to_vec());
}

#[test]
fn g6_write_file_equals_open_write_close() {
    let _g = setup();
    // path A: fast path
    assert_eq!(wf("/fast.js", b"console.log(42)\n", 0o600), 0);
    // path B: open(O_WRONLY|O_CREAT|O_TRUNC) + write + close
    let fd = openf("/slow.js", O_WRONLY | O_CREAT | O_TRUNC, 0o600);
    assert!(fd >= 3);
    assert_eq!(wr(fd, b"console.log(42)\n"), 16);
    assert_eq!(oc_close(fd), 0);
    assert_eq!(rf("/fast.js"), rf("/slow.js"));
    assert_eq!(statp("/fast.js"), 0);
    let fast = (stat_f64s()[1], stat_f64s()[8], stat_f64s()[9]);
    assert_eq!(statp("/slow.js"), 0);
    let slow = (stat_f64s()[1], stat_f64s()[8], stat_f64s()[9]);
    assert_eq!(fast, slow);
    // equivalence over an EXISTING longer file (O_TRUNC path)
    assert_eq!(wf("/fast2", b"0123456789", 0o644), 0);
    assert_eq!(wf("/slow2", b"0123456789", 0o644), 0);
    assert_eq!(wf("/fast2", b"xy", 0o644), 0);
    let fd = openf("/slow2", O_WRONLY | O_CREAT | O_TRUNC, 0o644);
    assert_eq!(wr(fd, b"xy"), 2);
    assert_eq!(oc_close(fd), 0);
    assert_eq!(rf("/fast2"), rf("/slow2"));
    assert_eq!(rf("/fast2"), b"xy".to_vec());
}

#[test]
fn g6_read_file_and_append_file() {
    let _g = setup();
    assert_eq!(wf("/r6", b"abc", 0o644), 0);
    let (p, l) = put_str("/r6");
    let (d, dl) = put(b"def");
    assert_eq!(oc_append_file(p, l, d, dl), 0);
    assert_eq!(rf("/r6"), b"abcdef".to_vec());
    // append creates a missing file
    let (p, l) = put_str("/new-append");
    assert_eq!(oc_append_file(p, l, d, dl), 0);
    assert_eq!(rf("/new-append"), b"def".to_vec());
    // append to a dir: EISDIR
    assert_eq!(mkdirp("/d6"), 0);
    let (p, l) = put_str("/d6");
    assert_eq!(oc_append_file(p, l, d, dl), -EISDIR);
    // read_file errors
    let (p, l) = put_str("/missing6");
    assert_eq!(oc_read_file(p, l), -ENOENT);
    assert_eq!(wf("/dirread", b"x", 0o644), 0);
    rmrf("/dirread", false);
    assert_eq!(mkdirp("/dirread"), 0);
    let (p, l) = put_str("/dirread");
    assert_eq!(oc_read_file(p, l), -EISDIR);
}

#[test]
fn g6_copy_file_matrix() {
    let _g = setup();
    assert_eq!(wf("/src6", b"copy me", 0o640), 0);
    let (sp, sl) = put_str("/src6");
    let (dp, dl) = put_str("/dst6");
    assert_eq!(oc_copy_file(sp, sl, dp, dl), 0);
    assert_eq!(rf("/dst6"), b"copy me".to_vec());
    assert_eq!(statp("/dst6"), 0);
    assert_eq!(stat_f64s()[1] as u32, 0o100666); // vfs.ts copyFile: default mode
    // overwrite existing
    assert_eq!(wf("/over", b"old", 0o644), 0);
    let (dp, dl) = put_str("/over");
    assert_eq!(oc_copy_file(sp, sl, dp, dl), 0);
    assert_eq!(rf("/over"), b"copy me".to_vec());
    // src is a dir -> EISDIR; src missing -> ENOENT
    assert_eq!(mkdirp("/sdir"), 0);
    let (sp, sl) = put_str("/sdir");
    let (dp, dl) = put_str("/x6");
    assert_eq!(oc_copy_file(sp, sl, dp, dl), -EISDIR);
    let (sp, sl) = put_str("/no6");
    assert_eq!(oc_copy_file(sp, sl, dp, dl), -ENOENT);
    // dst through a symlink: writes the target (writeFile semantics)
    assert_eq!(wf("/real-dst", b"x", 0o644), 0);
    assert_eq!(symlink("/real-dst", "/dlink6"), 0);
    let (dp, dl) = put_str("/dlink6");
    let (sp, sl) = put_str("/src6");
    assert_eq!(oc_copy_file(sp, sl, dp, dl), 0);
    assert_eq!(rf("/real-dst"), b"copy me".to_vec());
}

#[test]
fn g6_chmod_utimes_truncate_paths() {
    let _g = setup();
    assert_eq!(wf("/cu", b"0123456789", 0o644), 0);
    let (p, l) = put_str("/cu");
    assert_eq!(oc_chmod(p, l, 0o750), 0);
    assert_eq!(statp("/cu"), 0);
    assert_eq!(stat_f64s()[1] as u32, 0o100750); // type bits kept
    let (p, l) = put_str("/cu");
    assert_eq!(oc_utimes(p, l, 1000.25, 2000.5), 0);
    assert_eq!(statp("/cu"), 0);
    let s = stat_f64s();
    assert_eq!(s[10], 1.0);
    assert_eq!(s[11], 250_000.0);
    assert_eq!(s[12], 2.0);
    assert_eq!(s[13], 500_000.0);
    let (p, l) = put_str("/cu");
    assert_eq!(oc_truncate(p, l, 4), 0);
    assert_eq!(rf("/cu"), b"0123".to_vec());
    let (p, l) = put_str("/cu");
    assert_eq!(oc_truncate(p, l, 7), 0); // grow with zeros
    assert_eq!(rf("/cu"), b"0123\0\0\0".to_vec());
    let (p, l) = put_str("/cu");
    assert_eq!(oc_truncate(p, l, -1), -EINVAL);
    let (p, l) = put_str("/missing-cu");
    assert_eq!(oc_truncate(p, l, 0), -ENOENT);
    assert_eq!(mkdirp("/tdir"), 0);
    let (p, l) = put_str("/tdir");
    assert_eq!(oc_truncate(p, l, 0), -EISDIR);
}

// ===========================================================================
// Group 7 — tar
// ===========================================================================

#[test]
fn g7_tar_plain_file_nested_dirs_symlink() {
    let _g = setup();
    assert_eq!(mkdirp("/x"), 0);
    let tar = tb::tar(&[
        &tb::dir("tdir/", 0o755),
        &tb::file("tdir/hello.txt", b"hi tar\n", 0o644, 1_700_000_000),
        &tb::dir("tdir/a/", 0o755),
        &tb::dir("tdir/a/b/", 0o755),
        &tb::file("tdir/a/b/c.txt", b"deep", 0o600, 1_700_000_001),
        &tb::symlink("tdir/link", "tdir/hello.txt"),
        &tb::hardlink("tdir/hard", "tdir/hello.txt"),
    ]);
    assert_eq!(extract(&tar, "/x"), 7); // 3 dirs + 3 files + ... wait: dirs=3, files=2, links=2 -> 7
    assert_eq!(rf("/x/tdir/hello.txt"), b"hi tar\n".to_vec());
    assert_eq!(rf("/x/tdir/a/b/c.txt"), b"deep".to_vec());
    assert_eq!(readlink("/x/tdir/link"), "tdir/hello.txt");
    assert_eq!(readlink("/x/tdir/hard"), "tdir/hello.txt"); // hardlink stored as symlink
    // mode honored (0o7777 mask)
    assert_eq!(lstatp("/x/tdir/a/b/c.txt"), 0);
    assert_eq!(stat_f64s()[1] as u32, 0o100600);
    // mtime honored
    assert_eq!(stat_f64s()[12], 1_700_000_001.0);
    assert_eq!(lstatp("/x/tdir/hello.txt"), 0);
    assert_eq!(stat_f64s()[12], 1_700_000_000.0);
    // dir mode
    assert_eq!(statp("/x/tdir"), 0);
    assert_eq!(stat_f64s()[1] as u32, 0o040755);
}

#[test]
fn g7_tar_gnu_longname_over_100_chars() {
    let _g = setup();
    assert_eq!(mkdirp("/x"), 0);
    let long = format!("very/long/path/{}{}{}", "d".repeat(40), "e".repeat(40), "/file.txt");
    assert!(long.len() > 100);
    let tar = tb::tar(&[&tb::gnu_longname(&long), &tb::file("SHORT", b"long-named", 0o644, 0)]);
    assert_eq!(extract(&tar, "/x"), 1);
    assert_eq!(rf(&format!("/x/{long}")), b"long-named".to_vec());
}

#[test]
fn g7_tar_gnu_longlink() {
    let _g = setup();
    assert_eq!(mkdirp("/x"), 0);
    let long_target = format!("{}{}", "t".repeat(120), "/target");
    let tar = tb::tar(&[
        &tb::file("target-file", b"x", 0o644, 0),
        &tb::gnu_longlink(&long_target),
        &tb::symlink("the-link", "ignored"),
    ]);
    assert_eq!(extract(&tar, "/x"), 2);
    assert_eq!(readlink("/x/the-link"), long_target);
}

#[test]
fn g7_tar_pax_path_override() {
    let _g = setup();
    assert_eq!(mkdirp("/x"), 0);
    let rec = tb::pax_record("path", "pax/overridden/name.txt");
    let tar = tb::tar(&[&tb::pax(&[&rec]), &tb::file("original.txt", b"paxed", 0o644, 0)]);
    assert_eq!(extract(&tar, "/x"), 1);
    assert_eq!(rf("/x/pax/overridden/name.txt"), b"paxed".to_vec());
    assert_eq!(exists("/x/original.txt"), 0); // name was overridden
}

#[test]
fn g7_tar_pax_linkpath_and_global_ignored() {
    let _g = setup();
    assert_eq!(mkdirp("/x"), 0);
    let rec = tb::pax_record("linkpath", "the/pax/target");
    let global = tb::pax_record("comment", "global header");
    let mut gh = tb::header("GlobalHead", 0o644, {
        let mut d = global.clone();
        while d.len() % 512 != 0 {
            d.push(0);
        }
        d.len() as u64
    }, 0, b'g', "");
    let mut d = global;
    while d.len() % 512 != 0 {
        d.push(0);
    }
    gh.extend(d);
    let tar = tb::tar(&[&gh, &tb::pax(&[&rec]), &tb::symlink("lnk", "ignored")]);
    assert_eq!(extract(&tar, "/x"), 1); // 'g' ignored, 1 symlink extracted
    assert_eq!(readlink("/x/lnk"), "the/pax/target");
}

#[test]
fn g7_tar_escape_rejected_einval_no_partial_write() {
    let _g = setup();
    assert_eq!(mkdirp("/dest"), 0);
    let good = tb::file("safe.txt", b"safe", 0o644, 0);
    let evil = tb::file("../escaped.txt", b"evil", 0o644, 0);
    let mut tar = good.clone();
    tar.extend(evil);
    tar.extend(tb::zeros());
    assert_eq!(extract(&tar, "/dest"), -EINVAL);
    // prior entry extracted, the escaping entry NOT written
    assert_eq!(rf("/dest/safe.txt"), b"safe".to_vec());
    assert_eq!(exists("/escaped.txt"), 0);
    // deeper escape via nested ..
    let evil2 = tb::file("a/../../evil2.txt", b"e2", 0o644, 0);
    let tar2 = tb::tar(&[&evil2]);
    assert_eq!(extract(&tar2, "/dest"), -EINVAL);
}

#[test]
fn g7_tar_absolute_path_stripped_and_dot_slash() {
    let _g = setup();
    assert_eq!(mkdirp("/x"), 0);
    let tar = tb::tar(&[
        &tb::file("/abs.txt", b"absolute", 0o644, 0),
        &tb::file("./rel.txt", b"dotslash", 0o644, 0),
        &tb::file(".//weird//name.txt", b"weird", 0o644, 0),
    ]);
    assert_eq!(extract(&tar, "/x"), 3);
    assert_eq!(rf("/x/abs.txt"), b"absolute".to_vec());
    assert_eq!(exists("/abs.txt"), 0); // leading / stripped, not at root
    assert_eq!(rf("/x/rel.txt"), b"dotslash".to_vec());
    assert_eq!(rf("/x/weird/name.txt"), b"weird".to_vec());
}

#[test]
fn g7_tar_overwrite_existing_entries() {
    let _g = setup();
    assert_eq!(mkdirp("/x"), 0);
    assert_eq!(wf("/x/file.txt", b"OLD CONTENT LONGER", 0o600), 0);
    let tar = tb::tar(&[&tb::file("file.txt", b"new", 0o644, 0)]);
    assert_eq!(extract(&tar, "/x"), 1);
    assert_eq!(rf("/x/file.txt"), b"new".to_vec()); // truncated to new content
    // overwrite a symlink with a file
    assert_eq!(symlink("elsewhere", "/x/l"), 0);
    let tar = tb::tar(&[&tb::file("l", b"now-a-file", 0o644, 0)]);
    assert_eq!(extract(&tar, "/x"), 1);
    assert_eq!(rf("/x/l"), b"now-a-file".to_vec());
    // overwrite a file with a dir entry
    assert_eq!(wf("/x/d", b"x", 0o644), 0);
    let tar = tb::tar(&[&tb::dir("d/", 0o755)]);
    assert_eq!(extract(&tar, "/x"), 1);
    assert_eq!(statp("/x/d"), 0);
    assert_eq!(stat_f64s()[1] as u32 & S_IFMT, S_IFDIR);
}

#[test]
fn g7_tar_dest_and_edge_cases() {
    let _g = setup();
    // dest missing -> ENOENT
    let tar = tb::tar(&[&tb::file("f", b"x", 0o644, 0)]);
    assert_eq!(extract(&tar, "/no-such-dest"), -ENOENT);
    // dest is a file -> ENOTDIR
    assert_eq!(wf("/afile", b"x", 0o644), 0);
    assert_eq!(extract(&tar, "/afile"), -ENOTDIR);
    // empty archive (just zero blocks) -> 0 entries
    assert_eq!(mkdirp("/x"), 0);
    assert_eq!(extract(&tb::zeros(), "/x"), 0);
    // truncated data: entry with size beyond the buffer is skipped, count 0
    let mut bad = tb::header("half", 0o644, 4096, 0, b'0', "");
    bad.truncate(700); // header + partial data
    assert_eq!(extract(&bad, "/x"), 0);
    assert_eq!(exists("/x/half"), 0);
}

#[test]
fn g7_tar_type7_and_devices_skipped() {
    let _g = setup();
    assert_eq!(mkdirp("/x"), 0);
    let tar = tb::tar(&[
        &tb::file("normal", b"a", 0o644, 0),
        &tb::header("chardev", 0o644, 0, 0, b'3', ""),
        &tb::header("contig", 0o644, 1, 0, b'7', "y"),
    ]);
    // '7' (contiguous) is treated as a regular file; '3' (chardev) skipped.
    assert_eq!(extract(&tar, "/x"), 2);
    assert_eq!(exists("/x/normal"), 1);
    assert_eq!(exists("/x/chardev"), 0);
}

// ===========================================================================
// Group 8 — arena
// ===========================================================================

#[test]
fn g8_arena_10k_allocs_no_move_across_chunk_growth() {
    let _g = setup();
    let mut saved: Vec<(i32, usize, u8)> = Vec::new();
    let mut total = 0usize;
    for i in 0..10_000usize {
        let size = 100 + (i % 97);
        let p = oc_arena_alloc(size as i32);
        assert_ne!(p, 0);
        let pattern = (i % 251) as u8;
        hostmem::write(p as usize, &vec![pattern; size]);
        saved.push((p, size, pattern));
        total += size;
    }
    assert!(total > 1 << 20, "must cross the 1 MiB chunk boundary (total {total})");
    // no-move: every earlier allocation still holds its bytes
    for (p, size, pattern) in &saved {
        let slice = mem::read(*p, *size as i32).expect("ptr valid");
        assert!(slice.iter().all(|&b| b == *pattern), "alloc at {p} moved/corrupted");
    }
    // a >1 MiB single allocation gets a dedicated chunk, still no-move
    let big = oc_arena_alloc((1 << 20) + 123);
    assert_ne!(big, 0);
    hostmem::write(big as usize, &vec![0xAB; 1024]);
    for (p, size, pattern) in &saved {
        let slice = mem::read(*p, *size as i32).expect("ptr valid");
        assert!(slice.iter().all(|&b| b == *pattern));
    }
    let bigs = mem::read(big, 1024).expect("big valid");
    assert!(bigs.iter().all(|&b| b == 0xAB));
}

#[test]
fn g8_arena_reset_recycles() {
    let _g = setup();
    let p1 = oc_arena_alloc(64);
    assert_ne!(p1, 0);
    hostmem::write(p1 as usize, b"first");
    assert_eq!(oc_arena_reset(), 0);
    let p2 = oc_arena_alloc(64);
    assert_ne!(p2, 0);
    hostmem::write(p2 as usize, b"second");
    let s = mem::read(p2, 6).unwrap();
    assert_eq!(s, b"second");
    // zero-length alloc: stable non-null pointer
    let p0 = oc_arena_alloc(0);
    assert_ne!(p0, 0);
    // negative size: OOM sentinel 0
    assert_eq!(oc_arena_alloc(-1), 0);
}

// ===========================================================================
// Group 9 — cwd
// ===========================================================================

#[test]
fn g9_cwd_chdir_normalize_open_relative() {
    let _g = setup();
    assert_eq!(mkdirp("/home/user/project"), 0);
    let (p, l) = put_str("/home/user/project");
    assert_eq!(oc_chdir(p, l), 0);
    assert_eq!(oc_getcwd(), 0);
    assert_eq!(out_str(), "/home/user/project");
    // relative normalize
    let (p, l) = put_str("src/../lib/./x.js");
    assert_eq!(oc_normalize(p, l), 0);
    assert_eq!(out_str(), "/home/user/project/lib/x.js");
    // '..' above the cwd stays within the absolute tree
    let (p, l) = put_str("../../etc");
    assert_eq!(oc_normalize(p, l), 0);
    assert_eq!(out_str(), "/home/etc");
    // open a RELATIVE path
    let fd = openf("rel.txt", O_WRONLY | O_CREAT, 0o644);
    assert!(fd >= 3);
    assert_eq!(wr(fd, b"relative"), 8);
    assert_eq!(oc_close(fd), 0);
    assert_eq!(rf("/home/user/project/rel.txt"), b"relative".to_vec());
    // chdir("..") from a subdir
    assert_eq!(mkdirp("/home/user/project/src"), 0);
    let (p, l) = put_str("src");
    assert_eq!(oc_chdir(p, l), 0);
    assert_eq!(oc_getcwd(), 0);
    assert_eq!(out_str(), "/home/user/project/src");
    let (p, l) = put_str("..");
    assert_eq!(oc_chdir(p, l), 0);
    assert_eq!(oc_getcwd(), 0);
    assert_eq!(out_str(), "/home/user/project");
    let (p, l) = put_str("../..");
    assert_eq!(oc_chdir(p, l), 0);
    assert_eq!(oc_getcwd(), 0);
    assert_eq!(out_str(), "/home");
}

#[test]
fn g9_cdir_errors_and_symlink_canonical() {
    let _g = setup();
    assert_eq!(wf("/plain", b"x", 0o644), 0);
    let (p, l) = put_str("/plain");
    assert_eq!(oc_chdir(p, l), -ENOTDIR);
    let (p, l) = put_str("/missing-dir");
    assert_eq!(oc_chdir(p, l), -ENOENT);
    // chdir through a symlink stores the CANONICAL path (realpath semantics)
    assert_eq!(mkdirp("/canonical/deep"), 0);
    assert_eq!(symlink("/canonical", "/short"), 0);
    let (p, l) = put_str("/short/deep");
    assert_eq!(oc_chdir(p, l), 0);
    assert_eq!(oc_getcwd(), 0);
    assert_eq!(out_str(), "/canonical/deep");
    // relative ops resolve against the new cwd (LEXICAL normalize —
    // symlinks are never resolved by normalize, only by chdir)
    let (p, l) = put_str("../../short/deep");
    assert_eq!(oc_normalize(p, l), 0);
    assert_eq!(out_str(), "/short/deep");
    // initial cwd is "/"
    // (covered by reset in setup + first getcwd of other tests)
}

#[test]
fn g9_normalize_rules() {
    let _g = setup();
    let cases: Vec<(&str, &str)> = vec![
        ("/a/b/../c//./d/", "/a/c/d/"),      // '.', '..', '//', trailing kept
        ("/a/b/", "/a/b/"),                   // trailing preserved
        ("/a/b", "/a/b"),                     // no trailing
        ("//a///b", "/a/b"),                  // collapse
        ("/..", "/"),                         // .. bounded at root
        ("/../x", "/x"),
        ("/a/../..", "/"),
        ("/", "/"),                           // root, no trailing dup
        ("/a/..", "/"),                       // pops to root: no trailing slash
    ];
    for (input, expect) in cases {
        let (p, l) = put_str(input);
        assert_eq!(oc_normalize(p, l), 0, "normalize({input:?})");
        assert_eq!(out_str(), expect, "normalize({input:?})");
    }
    // EMPTY input: -EINVAL (safety net; bridge pre-validates)
    let (p, l) = put(b"");
    assert_eq!(oc_normalize(p, l), -EINVAL);
    // relative resolves against cwd
    let (p, l) = put_str("x/y");
    assert_eq!(oc_normalize(p, l), 0);
    assert_eq!(out_str(), "/x/y");
}

#[test]
fn g9_join_normalize() {
    let _g = setup();
    let (bp, bl) = put_str("/base/path");
    let (rp, rl) = put_str("rel/deeper");
    assert_eq!(oc_join_normalize(bp, bl, rp, rl), 0);
    assert_eq!(out_str(), "/base/path/rel/deeper");
    // absolute rel wins
    let (rp, rl) = put_str("/abs");
    assert_eq!(oc_join_normalize(bp, bl, rp, rl), 0);
    assert_eq!(out_str(), "/abs");
    // '..' inside rel is collapsed
    let (rp, rl) = put_str("../up");
    assert_eq!(oc_join_normalize(bp, bl, rp, rl), 0);
    assert_eq!(out_str(), "/base/up");
    // base with trailing slash + relative base against cwd
    let (bp, bl) = put_str("/t/");
    let (rp, rl) = put_str("./x");
    assert_eq!(oc_join_normalize(bp, bl, rp, rl), 0);
    assert_eq!(out_str(), "/t/x");
    let (bp, bl) = put_str("sub");
    let (rp, rl) = put_str("y");
    assert_eq!(oc_join_normalize(bp, bl, rp, rl), 0);
    assert_eq!(out_str(), "/sub/y");
}

// ===========================================================================
// Group 10 — STAT_SLOT byte-exact
// ===========================================================================

#[test]
fn g10_stat_slot_byte_exact() {
    let _g = setup();
    // Deterministic: fresh state; the only clock consumer before stat is the
    // create_file inside write_file (clock 0 -> 1.0 ms).
    assert_eq!(wf("/known.txt", b"hello", 0o644), 0); // 5 bytes
    let (p, l) = put_str("/known.txt");
    assert_eq!(oc_utimes(p, l, 1500.75, 2600.5), 0);
    assert_eq!(statp("/known.txt"), 0);

    // Expected 18 f64s (fs.ts formulas, identical values).
    let expected: [f64; 18] = [
        1.0,          // dev
        0o100644 as f64, // mode (S_IFREG | 0o644)
        1.0,          // nlink
        0.0,          // uid
        0.0,          // gid
        0.0,          // rdev
        4096.0,       // blksize
        2.0,          // ino (root=1, this file=2)
        5.0,          // size
        1.0,          // blocks = ceil(5/512)
        1.0,          // atimeS  = floor(1500.75/1000)
        500_750_000.0, // atimeNs = round((1500.75-1000)*1e6)
        2.0,          // mtimeS
        600_500_000.0, // mtimeNs
        0.0,          // ctimeS  = floor(1.0/1000)
        1_000_000.0,  // ctimeNs = round(1.0*1e6)  [fs.ts formula quirk]
        0.0,          // birthtimeS
        1_000_000.0,  // birthtimeNs
    ];
    let got = stat_f64s();
    for (i, (g, e)) in got.iter().zip(expected.iter()).enumerate() {
        assert_eq!(g, e, "stat field {i}");
    }
    // BYTE-EXACT: the raw 144 bytes equal the LE concatenation of expected.
    let mut bytes = Vec::with_capacity(144);
    for v in expected {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    assert_eq!(stat_bytes().to_vec(), bytes);
}

#[test]
fn g10_stat_slot_dir_and_fstat() {
    let _g = setup();
    let (p, l) = put_str("/sd");
    assert_eq!(oc_mkdirp(p, l, 0o755), 0);
    assert_eq!(statp("/sd"), 0);
    let s = stat_f64s();
    assert_eq!(s[1] as u32, 0o040755);
    assert_eq!(s[8], 0.0); // dir size 0
    assert_eq!(s[9], 0.0); // blocks 0
    // root stat: ino 1
    let (p, l) = put_str("/");
    assert_eq!(oc_stat(p, l), 0);
    assert_eq!(stat_f64s()[7], 1.0);
    // fstat matches stat
    assert_eq!(wf("/ff", b"12345678", 0o644), 0);
    let fd = openf("/ff", O_RDONLY, 0);
    assert_eq!(oc_fstat(fd), 0);
    let a = stat_f64s();
    assert_eq!(statp("/ff"), 0);
    let b = stat_f64s();
    assert_eq!(a.to_vec(), b.to_vec());
    assert_eq!(oc_close(fd), 0);
}

// ===========================================================================
// Cross-cutting: slots, version, EFAULT, debug counts, ino monotonicity
// ===========================================================================

#[test]
fn x_version_and_slots_stable() {
    let _g = setup();
    assert_eq!(oc_version(), 1);
    let s1 = oc_stat_slot();
    let r1 = oc_ret_slot();
    // NB: on the HOST target a static's address truncated to i32 may be any
    // value (wasm32 guarantees < 4 GB, so there it is always positive); only
    // stability + distinctness are portable assertions.
    assert_ne!(s1, r1);
    assert_eq!(oc_stat_slot(), s1); // stable for the module lifetime
    assert_eq!(oc_ret_slot(), r1);
    // slots keep working after memory growth (arena chunk push)
    let _ = oc_arena_alloc(2_000_000);
    assert_eq!(oc_stat_slot(), s1);
    assert_eq!(oc_ret_slot(), r1);
}

#[test]
fn x_efault_validation() {
    let _g = setup();
    let (p, l) = put_str("/some/path");
    let over = (mem::size() + 64) as i32; // guaranteed beyond memory
    // ptr+len beyond memory
    assert_eq!(oc_stat(p, over), -EFAULT);
    // near-overflow ptr/len pair (u64 math: no wrap-around false pass)
    assert_eq!(oc_stat(0x7FFF_FFFFi32, 0x7FFF_FFFFi32), -EFAULT);
    // negative len / negative ptr
    assert_eq!(oc_stat(p, -1), -EFAULT);
    assert_eq!(oc_stat(-8, 4), -EFAULT);
    // zero len on a valid ptr is FINE (empty path -> EINVAL, not EFAULT)
    assert_eq!(oc_stat(p, 0), -EINVAL);
    // write with a bad data len
    let fd = openf("/f", O_WRONLY | O_CREAT, 0o644);
    assert_eq!(oc_write(fd, p, over), -EFAULT);
    assert_eq!(oc_close(fd), 0);
    // extract_tar with a bad dest len
    let (tp, tl) = put(b"junk");
    assert_eq!(oc_extract_tar(tp, tl, p, over), -EFAULT);
}

#[test]
fn x_ret_slot_layout() {
    let _g = setup();
    assert_eq!(wf("/blob", b"0123456789", 0o644), 0);
    assert_eq!(rf("/blob").len(), 10);
    let b = ret_bytes();
    let ptr = u32::from_le_bytes([b[0], b[1], b[2], b[3]]);
    let len = u32::from_le_bytes([b[4], b[5], b[6], b[7]]);
    assert_eq!(len, 10);
    assert_eq!(ptr as u32, state().out.as_ptr() as usize as u32); // low 32 bits
}

#[test]
fn x_debug_counts() {
    let _g = setup();
    fn read_u32(c: &[u8], i: usize) -> u32 {
        let mut b = [0u8; 4];
        b.copy_from_slice(&c[i * 4..i * 4 + 4]);
        u32::from_le_bytes(b)
    }
    assert_eq!(oc_debug_counts(), 0);
    let c = out();
    assert_eq!(read_u32(&c, 0), 1); // just the root
    assert_eq!(read_u32(&c, 1), 0);
    assert_eq!(read_u32(&c, 2), 1);
    assert_eq!(read_u32(&c, 3), 0);
    assert_eq!(mkdirp("/cnt/a"), 0);
    assert_eq!(wf("/cnt/a/f.txt", b"x", 0o644), 0);
    assert_eq!(wf("/cnt/g.txt", b"x", 0o644), 0);
    let fd = openf("/cnt/g.txt", O_RDONLY, 0);
    assert_eq!(oc_debug_counts(), 0);
    let c = out();
    assert_eq!(read_u32(&c, 0), 5); // root + cnt + a + f.txt + g.txt
    assert_eq!(read_u32(&c, 1), 2); // files
    assert_eq!(read_u32(&c, 2), 3); // dirs (incl. root)
    assert_eq!(read_u32(&c, 3), 1); // one open fd
    assert_eq!(oc_close(fd), 0);
    assert_eq!(oc_debug_counts(), 0);
    let c = out();
    assert_eq!(read_u32(&c, 3), 0);
    // freed slots don't count; ino never reused even after slot reuse
    let ino_before = {
        assert_eq!(statp("/cnt/a/f.txt"), 0);
        stat_f64s()[7]
    };
    assert_eq!(rmrf("/cnt/a/f.txt", false), 0);
    assert_eq!(wf("/cnt/a/again.txt", b"x", 0o644), 0);
    assert_eq!(statp("/cnt/a/again.txt"), 0);
    assert!(stat_f64s()[7] > ino_before, "ino must stay monotonic across slot reuse");
}
#[test]
fn x_deep_tree_no_stack_overflow() {
    let _g = setup();
    // 5k-deep directory tree: rmrf/free_subtree must be iterative
    let mut path = String::new();
    for i in 0..5000 {
        path.push_str(&format!("/d{i}"));
    }
    assert_eq!(mkdirp(&path), 0);
    // rmrf of the TOP dir recursively frees all 5000 levels iteratively
    let (p, l) = put_str("/d0");
    assert_eq!(oc_rmrf(p, l, 1), 0);
    assert_eq!(exists("/d0"), 0);
}

