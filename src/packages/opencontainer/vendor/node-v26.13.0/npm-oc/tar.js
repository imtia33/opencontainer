/**
 * OpenContainer npm-oc — tar extraction for npm registry tarballs.
 *
 * OpenContainer-authored module (NOT vendored Node source). Loaded through
 * node's real CJS loader from /usr/lib/node_modules/npm-oc. Parses the tar
 * formats npm actually publishes: ustar, GNU (longname 'L'), and pax
 * extended headers ('x'/'g'). Integrity of the container is verified by the
 * caller (sha512 from the registry packument) before extraction begins.
 *
 * Spec references: ustar — POSIX.1-1988; pax — POSIX.1-2001; GNU longname —
 * GNU tar 'L' extension. npm tarballs always root at "package/".
 */
'use strict';

const BLOCK = 512;

function octalToNumber(field) {
  // Fields are NUL- or space-terminated octal ASCII. GNU may use base-256
  // (high bit set on first byte) for large sizes.
  if (field && field.length > 0 && (field[0] & 0x80)) {
    let val = field[0] & 0x7f;
    for (let i = 1; i < field.length; i++) val = val * 256 + field[i];
    return val;
  }
  const s = String.fromCharCode.apply(null, Array.from(field))
    .replace(/[\0 ]+$/, '');
  if (s === '') return 0;
  return parseInt(s, 8);
}

function cstr(bytes, start, len) {
  let end = start;
  const max = start + len;
  while (end < max && bytes[end] !== 0) end++;
  return new TextDecoder('latin1').decode(bytes.subarray(start, end));
}

function checksumOk(block) {
  // Sum of all header bytes with the 8-byte checksum field treated as spaces.
  const stored = octalToNumber(block.subarray(148, 156));
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) {
    sum += (i >= 148 && i < 156) ? 32 : block[i];
  }
  return sum === stored;
}

/**
 * Parse pax extended header records ("len key=value\n" repeated).
 * Returns { path?, linkpath?, size?, mode? } overrides.
 */
function parsePax(bytes) {
  const out = {};
  const text = new TextDecoder('latin1').decode(bytes);
  let pos = 0;
  while (pos < text.length) {
    const sp = text.indexOf(' ', pos);
    if (sp < 0) break;
    const len = parseInt(text.slice(pos, sp), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = text.slice(pos, pos + len);
    const eq = record.indexOf('=');
    if (eq < 0) break;
    const key = record.slice(sp - pos + 1, eq);
    const value = record.slice(eq + 1, len - 1); // strip trailing \n
    if (key === 'path' || key === 'linkpath' || key === 'size' || key === 'mode') {
      out[key] = value;
    }
    pos += len;
  }
  return out;
}

function destDirOf(p) {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

/**
 * Extract an npm tarball buffer into `ops`.
 *
 * @param {ArrayBuffer|Uint8Array} archive raw (decompressed) tar bytes
 * @param {object} ops { mkdirSync, writeFileSync, symlinkSync, chmodSync?, existsSync, readFileSync }
 * @param {string} destDir directory that the tarball's "package/" root maps to
 * @returns {{ files: number, dirs: number, symlinks: number, hardlinks: number, bytes: number }}
 */
function extractTar(archive, ops, destDir) {
  const bytes = archive instanceof Uint8Array ? archive : new Uint8Array(archive);
  let off = 0;
  let files = 0, dirs = 0, symlinks = 0, hardlinks = 0, totalBytes = 0;
  let gnuLongName = null;      // pending 'L' name for the next entry
  let gnuLongLink = null;      // pending 'K' linkname
  let paxHeader = null;        // pending 'x' overrides for the next entry

  const type = (b) => String.fromCharCode(b);
  const safeJoin = (dir, rel) => {
    // Normalize and confine to the extraction root (".." cannot escape).
    const parts = [];
    for (const seg of String(rel).split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') { parts.pop(); continue; }
      parts.push(seg);
    }
    return dir.replace(/\/+$/, '') + '/' + parts.join('/');
  };

  while (off + BLOCK <= bytes.length) {
    const block = bytes.subarray(off, off + BLOCK);
    // End-of-archive: zero block (spec requires two; be lenient).
    let allZero = true;
    for (let i = 0; i < BLOCK; i++) { if (block[i] !== 0) { allZero = false; break; } }
    if (allZero) break;
    if (!checksumOk(block)) {
      throw new Error('npm-oc/tar: header checksum mismatch at offset ' + off);
    }

    let name = cstr(block, 0, 100);
    const mode = octalToNumber(block.subarray(100, 108));
    const size = octalToNumber(block.subarray(124, 136));
    const typeflag = type(block[156]) || '0';
    const linkname = cstr(block, 157, 100);
    const magic = cstr(block, 257, 6);
    const prefix = cstr(block, 345, 155);

    off += BLOCK;
    const dataStart = off;
    off += Math.ceil(size / BLOCK) * BLOCK;
    const data = bytes.subarray(dataStart, dataStart + size);

    // Extended headers apply to the NEXT real entry.
    if (typeflag === 'L') { gnuLongName = new TextDecoder('latin1').decode(data).replace(/\0+$/, ''); continue; }
    if (typeflag === 'K') { gnuLongLink = new TextDecoder('latin1').decode(data).replace(/\0+$/, ''); continue; }
    if (typeflag === 'x' || typeflag === 'g') {
      const parsed = parsePax(data);
      if (typeflag === 'x') paxHeader = parsed;
      if (typeflag === 'g' && parsed.path) paxHeader = { ...(paxHeader || {}), path: parsed.path };
      continue;
    }

    // ustar prefix + GNU/pax overrides
    if (magic.startsWith('ustar') && prefix) name = prefix + '/' + name;
    if (gnuLongName !== null) name = gnuLongName; // GNU 'L' long name
    if (paxHeader && paxHeader.path) name = paxHeader.path;
    let link = linkname;
    if (gnuLongLink !== null) link = gnuLongLink;
    if (paxHeader && paxHeader.linkpath) link = paxHeader.linkpath;
    const entrySize = paxHeader && paxHeader.size !== undefined ? parseInt(paxHeader.size, 10) : size;
    gnuLongName = null; gnuLongLink = null; paxHeader = null;

    // npm tarball root: strip the leading "package/".
    let rel = name;
    if (rel === 'package') rel = '';
    else if (rel.startsWith('package/')) rel = rel.slice('package/'.length);
    if (rel === '' || rel === '.' || rel === './') continue;
    const dest = safeJoin(destDir, rel);

    switch (typeflag) {
      case '0': case '\0': case '7': { // regular file ('7' contiguous, rare)
        ops.mkdirSync(destDirOf(dest), { recursive: true });
        const copy = new Uint8Array(entrySize);
        copy.set(bytes.subarray(dataStart, dataStart + entrySize));
        ops.writeFileSync(dest, copy);
        if ((mode & 0o111) && ops.chmodSync) ops.chmodSync(dest, 0o755);
        files++; totalBytes += entrySize;
        break;
      }
      case '5': // directory
        ops.mkdirSync(dest, { recursive: true });
        dirs++;
        break;
      case '2': { // symlink
        ops.mkdirSync(destDirOf(dest), { recursive: true });
        ops.symlinkSync(link, dest);
        symlinks++;
        break;
      }
      case '1': { // hardlink — materialize as a copy within the extraction root
        const srcRel = link.startsWith('package/') ? link.slice('package/'.length) : link;
        const src = safeJoin(destDir, srcRel);
        if (ops.existsSync(src)) {
          ops.mkdirSync(destDirOf(dest), { recursive: true });
          ops.writeFileSync(dest, ops.readFileSync(src));
          hardlinks++;
        }
        break;
      }
      default:
        // '3' char, '4' block, '6' fifo — no meaning in a browser VFS; skip.
        break;
    }
  }
  return { files, dirs, symlinks, hardlinks, bytes: totalBytes };
}

module.exports = { extractTar, _internals: { octalToNumber, checksumOk, parsePax } };
