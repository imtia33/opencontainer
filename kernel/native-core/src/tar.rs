//! ustar / GNU / pax tar extractor (spec §3 `oc_extract_tar`).
//!
//! Supported: '0'/'\0' files, '5' dirs, '2' symlinks, '1' hardlinks (stored
//! as symlinks), 'L' GNU longname, 'K' GNU longlink, 'x' pax path/linkpath/
//! size/mtime overrides, 'g' global pax (ignored per spec). Security: a
//! leading '/' and "./" are stripped from entry names; any entry whose
//! joined+normalized path escapes `dest` via '..' is REJECTED with EINVAL
//! before any of its bytes are written. Existing entries are overwritten
//! (tar semantics). Returns the number of extracted entries (files+dirs+
//! links) or -errno.

use crate::syscalls;
use crate::vfs::*;

const HDR: usize = 512;

fn field_str(f: &[u8]) -> String {
    let end = f.iter().position(|&b| b == 0).unwrap_or(f.len());
    String::from_utf8_lossy(&f[..end]).into_owned()
}

fn strip_nul(f: &[u8]) -> String {
    field_str(f)
}

/// Octal (and GNU base-256) field parser. Empty / all-blank fields read 0.
fn parse_num(f: &[u8]) -> u64 {
    if f.is_empty() {
        return 0;
    }
    if f[0] & 0x80 != 0 {
        // GNU base-256 (big-endian, flag bit in byte 0).
        let mut v: u64 = (f[0] & 0x7f) as u64;
        for &b in &f[1..] {
            v = match v.checked_mul(256).and_then(|x| x.checked_add(b as u64)) {
                Some(x) => x,
                None => return u64::MAX / 2, // saturate; caller clamps to remaining
            };
        }
        return v;
    }
    let s: String = f
        .iter()
        .take_while(|&&b| b != 0)
        .map(|&b| b as char)
        .collect();
    let s = s.trim().trim_matches('\0');
    if s.is_empty() {
        return 0;
    }
    u64::from_str_radix(s, 8).unwrap_or(0)
}

fn checksum_ok(hdr: &[u8]) -> bool {
    let stored = parse_num(&hdr[148..156]);
    let mut sum: u64 = 0;
    let mut signed: i64 = 0;
    for (i, &b) in hdr.iter().enumerate() {
        let effective = if (148..156).contains(&i) { b' ' as u64 } else { b as u64 };
        sum += effective;
        signed += effective as i8 as i64;
    }
    sum == stored || signed == stored as i64
}

/// pax records: "<len> <key>=<value>\n", len counts the whole record.
fn parse_pax(data: &[u8]) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < data.len() {
        let start = i;
        while i < data.len() && data[i].is_ascii_digit() {
            i += 1;
        }
        if i >= data.len() || data[i] != b' ' {
            break;
        }
        let len: usize = match std::str::from_utf8(&data[start..i]) {
            Ok(s) => match s.parse() {
                Ok(l) => l,
                Err(_) => break,
            },
            Err(_) => break,
        };
        if len == 0 || start + len > data.len() || start + len <= i + 1 {
            break;
        }
        let rec = &data[i + 1..start + len - 1]; // strip "<len> " and trailing "\n"
        if let Some(eq) = rec.iter().position(|&b| b == b'=') {
            out.push((
                String::from_utf8_lossy(&rec[..eq]).into_owned(),
                String::from_utf8_lossy(&rec[eq + 1..]).into_owned(),
            ));
        }
        i = start + len;
    }
    out
}

/// Strip leading '/' and "./", then join onto dest and normalize. Ok(None)
/// = skip (empty name). Err(EINVAL) = escapes dest via '..'.
fn entry_dest(dest_norm: &str, raw_name: &str) -> Result<Option<String>, i32> {
    let mut n = raw_name;
    loop {
        if let Some(rest) = n.strip_prefix('/') {
            n = rest;
            continue;
        }
        if let Some(rest) = n.strip_prefix("./") {
            n = rest;
            continue;
        }
        break;
    }
    let n = n.trim_end_matches('/');
    if n.is_empty() || n == "." || n == ".." {
        return Ok(None);
    }
    let joined = if dest_norm == "/" {
        format!("/{}", n)
    } else {
        format!("{}/{}", dest_norm.trim_end_matches('/'), n)
    };
    let norm = match Vfs::normalize_lexical(&joined) {
        Some(x) => x,
        None => return Err(EINVAL),
    };
    if dest_norm != "/" {
        let dest = dest_norm.trim_end_matches('/');
        let prefix = format!("{}/", dest);
        if norm != dest && !norm.starts_with(&prefix) {
            return Err(EINVAL); // escapes dest via '..'
        }
    }
    Ok(Some(norm))
}

/// Lenient parent-ensure for entries whose dirs were not listed first.
fn ensure_parent(v: &mut Vfs, path: &str) {
    let parent = dirname_of(path);
    let _ = syscalls::mkdir(v, &parent, 0o755, true);
}

/// Overwrite semantics: remove whatever currently sits at `path` (lstat
/// level, any type) so tar entries land fresh.
fn remove_existing(v: &mut Vfs, path: &str) {
    if let Ok(Res::Node(id)) = v.resolve(path, false) {
        v.free_subtree(id);
    }
}

pub fn extract(v: &mut Vfs, data: &[u8], dest_norm: &str) -> i32 {
    // dest must exist (ENOENT) and be a directory (ENOTDIR).
    match v.resolve(dest_norm, true) {
        Ok(Res::Node(id)) if v.is_dir(id) => {}
        Ok(Res::Node(_)) => return -ENOTDIR,
        Ok(Res::Missing { .. }) => return -ENOENT,
        Err(e) => return -e,
    }

    let mut pos = 0usize;
    let mut count: i32 = 0;
    let mut longname: Option<String> = None;
    let mut longlink: Option<String> = None;
    let mut pax_path: Option<String> = None;
    let mut pax_link: Option<String> = None;
    let mut pax_size: Option<u64> = None;
    let mut pax_mtime: Option<f64> = None;

    loop {
        if pos + HDR > data.len() {
            break; // no full header left: end of archive
        }
        let hdr_range = pos..pos + HDR;
        let hdr = &data[hdr_range];
        if hdr.iter().all(|&b| b == 0) {
            break; // end-of-archive marker
        }
        if !checksum_ok(hdr) {
            break; // corrupt header: stop (lenient, README)
        }
        pos += HDR;

        let typeflag = hdr[156];
        let hdr_size = parse_num(&hdr[124..136]);
        // pax size override applies to the next REAL entry only.
        let size = if matches!(typeflag, b'L' | b'K' | b'x' | b'g') {
            pax_size = None;
            hdr_size
        } else {
            pax_size.take().unwrap_or(hdr_size)
        };
        let mode = parse_num(&hdr[100..108]) as u32;
        let mtime_s = parse_num(&hdr[136..148]) as f64;
        let name_field = field_str(&hdr[0..100]);
        let prefix = field_str(&hdr[345..500]);
        let linkname_field = field_str(&hdr[157..257]);

        let remaining = data.len().saturating_sub(pos);
        let truncated = size as u64 > remaining as u64;
        let stored = if truncated { remaining } else { size as usize };
        let fdata = &data[pos..pos + stored];
        if truncated {
            pos = data.len();
        } else {
            // u64 math: no usize overflow even for hostile sizes.
            let adv = ((stored as u64 + HDR as u64 - 1) / HDR as u64) * HDR as u64;
            pos = ((pos as u64) + adv).min(data.len() as u64) as usize;
        }

        // A truncated entry (declared size beyond the buffer) is SKIPPED
        // entirely — no partial write, not counted (spec §5 g7).
        if truncated {
            break;
        }

        // Pendings (GNU L/K, pax overrides) apply to exactly the next REAL
        // entry; consume them all up front so nothing leaks past it.
        let is_meta = matches!(typeflag, b'L' | b'K' | b'x' | b'g');
        let (pn_path, pn_link, pn_longname, pn_longlink, pn_mtime) = if is_meta {
            (None, None, None, None, None)
        } else {
            (
                pax_path.take(),
                pax_link.take(),
                longname.take(),
                longlink.take(),
                pax_mtime.take(),
            )
        };

        match typeflag {
            b'L' => {
                longname = Some(strip_nul(fdata));
            }
            b'K' => {
                longlink = Some(strip_nul(fdata));
            }
            b'x' => {
                for (k, val) in parse_pax(fdata) {
                    match k.as_str() {
                        "path" => pax_path = Some(val),
                        "linkpath" => pax_link = Some(val),
                        "size" => pax_size = val.parse().ok(),
                        "mtime" => pax_mtime = val.parse().ok(),
                        _ => {}
                    }
                }
            }
            b'g' => { /* global pax header: ignored per spec */ }
            b'0' | 0 | b'7' => {
                let name = pn_path
                    .or(pn_longname)
                    .unwrap_or_else(|| {
                        if prefix.is_empty() {
                            name_field.clone()
                        } else {
                            format!("{}/{}", prefix, name_field)
                        }
                    });
                let target = match entry_dest(dest_norm, &name) {
                    Ok(Some(p)) => p,
                    Ok(None) => {
                        if truncated {
                            break;
                        }
                        continue;
                    }
                    Err(e) => return -e, // ../escape: EINVAL, no partial write
                };
                ensure_parent(v, &target);
                remove_existing(v, &target);
                match v.resolve(&target, true) {
                    Ok(Res::Missing { parent, name }) => {
                        let now = v.now_ms();
                        let id = v.create_file(parent, &name, 0, fdata.to_vec(), now);
                        let mtime = pn_mtime.map_or(mtime_s * 1000.0, |s| s * 1000.0);
                        let n = &mut v.inodes[id as usize];
                        n.mode = S_IFREG | (mode & 0o7777); // tar honors 0o7777
                        n.mtime_ms = mtime;
                        n.atime_ms = mtime;
                        count += 1;
                    }
                    Ok(Res::Node(_)) => return -EISDIR,
                    Err(e) => return -e,
                }
                if truncated {
                    break;
                }
            }
            b'5' => {
                let name = pn_path
                    .or(pn_longname)
                    .unwrap_or_else(|| {
                        if prefix.is_empty() {
                            name_field.clone()
                        } else {
                            format!("{}/{}", prefix, name_field)
                        }
                    });
                let target = match entry_dest(dest_norm, &name) {
                    Ok(Some(p)) => p,
                    Ok(None) => {
                        if truncated {
                            break;
                        }
                        continue;
                    }
                    Err(e) => return -e,
                };
                let r = syscalls::mkdir(v, &target, (mode & 0o7777) as i32, true);
                if r != 0 && r != -EEXIST {
                    return r;
                }
                let mtime = pn_mtime.map_or(mtime_s * 1000.0, |s| s * 1000.0);
                if let Ok(Res::Node(id)) = v.resolve(&target, true) {
                    let n = &mut v.inodes[id as usize];
                    n.mode = S_IFDIR | (mode & 0o7777);
                    n.mtime_ms = mtime;
                    n.atime_ms = mtime;
                }
                count += 1;
                if truncated {
                    break;
                }
            }
            b'2' | b'1' => {
                // symlink ('2') / hardlink ('1' — stored as a symlink, spec)
                let name = pn_path
                    .or(pn_longname)
                    .unwrap_or_else(|| {
                        if prefix.is_empty() {
                            name_field.clone()
                        } else {
                            format!("{}/{}", prefix, name_field)
                        }
                    });
                let target_path = match entry_dest(dest_norm, &name) {
                    Ok(Some(p)) => p,
                    Ok(None) => {
                        if truncated {
                            break;
                        }
                        continue;
                    }
                    Err(e) => return -e,
                };
                let link_target = pn_link
                    .or(pn_longlink)
                    .unwrap_or_else(|| linkname_field.clone());
                ensure_parent(v, &target_path);
                remove_existing(v, &target_path);
                match v.resolve(&target_path, true) {
                    Ok(Res::Missing { parent, name }) => {
                        let now = v.now_ms();
                        let id = v.create_symlink(parent, &name, &link_target, now);
                        let mtime = pn_mtime.map_or(mtime_s * 1000.0, |s| s * 1000.0);
                        let n = &mut v.inodes[id as usize];
                        n.mtime_ms = mtime;
                        n.atime_ms = mtime;
                        count += 1;
                    }
                    Ok(Res::Node(_)) => return -EISDIR,
                    Err(e) => return -e,
                }
                if truncated {
                    break;
                }
            }
            _ => {
                // devices ('3','4','6'), FIFOs, GNU dumpdir/multivolume: skip
                if truncated {
                    break;
                }
            }
        }
    }
    count
}
