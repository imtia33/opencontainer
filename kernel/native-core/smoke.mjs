// oc_core.wasm ABI smoke — zero deps (node:fs + node:assert only).
// Instantiates the built crate synchronously and exercises the happy paths
// of the frozen ABI (docs/native-core-spec.md). Exits 0 on success.
import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const bytes = readFileSync(new URL('./pkg/oc_core.wasm', import.meta.url));
const t0 = Date.now();
const module = new WebAssembly.Module(bytes);
const imports = WebAssembly.Module.imports(module);
// The core is import-free by design (memory_size intrinsic, no env).
assert.equal(imports.length, 0, `expected no imports, got ${JSON.stringify(imports)}`);
const instance = new WebAssembly.Instance(module, {});
const e = instance.exports;
const compileMs = Date.now() - t0;
assert.equal(e.oc_version(), 1);

// ---- cached views (re-derive after any growth) ------------------------------
let mem = new Uint8Array(e.memory.buffer);
let dv = new DataView(e.memory.buffer);
const STAT = e.oc_stat_slot();
const RET = e.oc_ret_slot();
assert.ok(STAT > 0 && RET > 0 && STAT !== RET);
const rebind = () => {
  if (mem.buffer !== e.memory.buffer) {
    mem = new Uint8Array(e.memory.buffer);
    dv = new DataView(e.memory.buffer);
  }
};
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---- staging helpers ----------------------------------------------------------
function stage(str) {
  const b = enc.encode(str);
  const p = e.oc_arena_alloc(b.length);
  assert.ok(p !== 0, 'arena alloc');
  rebind();
  mem.set(b, p);
  return [p, b.length];
}
function stageBytes(b) {
  const p = e.oc_arena_alloc(b.length);
  assert.ok(p !== 0, 'arena alloc');
  rebind();
  mem.set(b, p);
  return [p, b.length];
}
function out() {
  rebind();
  const ptr = dv.getUint32(RET, true);
  const len = dv.getUint32(RET + 4, true);
  return mem.subarray(ptr, ptr + len);
}
function outStr() { return dec.decode(out()); }
function statF64s() {
  rebind();
  const a = new Float64Array(e.memory.buffer, STAT, 18);
  return Array.from(a);
}
const O_RDONLY = 0, O_WRONLY = 1, O_RDWR = 2, O_CREAT = 64, O_EXCL = 128, O_TRUNC = 512, O_APPEND = 1024;
let n = 0;
const ok = (label, cond) => { assert.ok(cond, label); n++; };

// ---- cwd ----------------------------------------------------------------------
e.oc_mkdirp(...stage('/home/project'), 0o755);
ok('chdir /home/project', e.oc_chdir(...stage('/home/project')) === 0);
ok('getcwd', e.oc_getcwd() === 0 && outStr() === '/home/project');

// ---- dirs + whole-file fast paths ----------------------------------------------
ok('mkdirp', e.oc_mkdirp(...stage('/home/project/a/b/c'), 0o755) === 0);
ok('write_file', e.oc_write_file(...stage('/home/project/a/b/c/hello.txt'), ...stageBytes(enc.encode('hello native world')), 0o644) === 0);
ok('read_file', e.oc_read_file(...stage('/home/project/a/b/c/hello.txt')) === 0);
ok('read_file bytes', dec.decode(out()) === 'hello native world');
// relative path resolves against the wasm cwd
ok('write_file relative', e.oc_write_file(...stage('rel.txt'), ...stageBytes(enc.encode('rel')), 0o644) === 0);
ok('read_file relative', e.oc_read_file(...stage('rel.txt')) === 0 && dec.decode(out()) === 'rel');

// ---- stat (18 f64 positional) ---------------------------------------------------
ok('stat', e.oc_stat(...stage('/home/project/a/b/c/hello.txt')) === 0);
const s = statF64s();
ok('stat size', s[8] === 18);
ok('stat mode', s[1] === 0o100644);
ok('stat blksize', s[6] === 4096);
ok('stat blocks', s[9] === 1);

// ---- fd ops ----------------------------------------------------------------------
const fd = e.oc_open(...stage('/home/project/fd.txt'), O_WRONLY | O_CREAT | O_TRUNC, 0o644);
ok('open fd>=3', fd >= 3);
ok('write', e.oc_write(fd, ...stageBytes(enc.encode('0123456789'))) === 10);
ok('pwrite no-move', e.oc_pwrite(fd, ...stageBytes(enc.encode("AB")), 2n) === 2);
ok('read back', e.oc_read_file(...stage('/home/project/fd.txt')) === 0 && dec.decode(out()) === '01AB456789');
const rfd = e.oc_open(...stage('/home/project/fd.txt'), O_RDONLY, 0);
ok('read fd', e.oc_read(rfd, 4) === 0 && dec.decode(out()) === '01AB');
ok('pread', e.oc_pread(rfd, 2, 8n) === 0 && dec.decode(out()) === '89');
ok('pread did not move pos', e.oc_read(rfd, 2) === 0 && dec.decode(out()) === '45');
ok('fstat size', e.oc_fstat(rfd) === 0 && statF64s()[8] === 10);
ok('close', e.oc_close(rfd) === 0 && e.oc_close(fd) === 0);
ok('double close EBADF', e.oc_close(rfd) === -9);
ok('O_EXCL EEXIST', e.oc_open(...stage('/home/project/fd.txt'), O_WRONLY | O_CREAT | O_EXCL, 0o644) === -17);

// ---- rename + symlink + readdir order ---------------------------------------------
ok('rename', e.oc_rename(...stage('/home/project/a/b/c/hello.txt'), ...stage('/home/project/a/b/c/renamed.txt')) === 0);
ok('symlink', e.oc_symlink(...stage('renamed.txt'), ...stage('/home/project/a/b/c/link')) === 0);
ok('readlink', e.oc_readlink(...stage('/home/project/a/b/c/link')) === 0 && outStr() === 'renamed.txt');
ok('lstat size = target len', e.oc_lstat(...stage('/home/project/a/b/c/link')) === 0 && statF64s()[8] === 11);
ok('stat follows', e.oc_stat(...stage('/home/project/a/b/c/link')) === 0 && statF64s()[8] === 18);
ok('readdir order', e.oc_readdir(...stage('/home/project/a/b/c')) === 0);
ok('readdir names', outStr().split('\0').filter(Boolean).join(',') === 'hello.txt,renamed.txt,link'.replace('hello.txt,', ''));
// hello.txt was renamed away: expect renamed.txt,link (insertion order)
ok('readdir names exact', outStr().split('\0').filter(Boolean).join(',') === 'renamed.txt,link');

// ---- memory growth + arena no-move ------------------------------------------------
const big = enc.encode('X'.repeat(3 * 1024 * 1024)); // > 1MB chunk + forces growth
const bigPtr = e.oc_arena_alloc(big.length);
rebind();
mem.set(big, bigPtr);
ok('big arena alloc', bigPtr !== 0);
const rcBig = e.oc_write_file(...stage("/home/project/big.bin"), bigPtr, big.length, 0o644);
if (rcBig !== 0) {
  console.error('DEBUG write big rc=%d bigPtr=%d len=%d sum=%d jsBytes=%d moduleBytes=%d',
    rcBig, bigPtr, big.length, bigPtr + big.length, e.memory.buffer.byteLength, e.oc_debug_mem_bytes());
}
ok('write big file', rcBig === 0);
ok('read big file', e.oc_read_file(...stage('/home/project/big.bin')) === 0 && out().length === big.length && out()[0] === 88 && out()[big.length - 1] === 88);
ok('views rebound after growth', mem.buffer === e.memory.buffer);
e.oc_arena_reset();

// ---- tar (hand-built 512-byte headers) ---------------------------------------------
function tarHeader(name, size, typeflag, linkname = '') {
  const h = new Uint8Array(512);
  h.set(enc.encode(name), 0);
  const oct = (off, len, v) => {
    const s = v.toString(8).padStart(len - 1, '0');
    h.set(enc.encode(s), off);
    h[off + len - 1] = 0;
  };
  oct(100, 8, 0o644); oct(108, 8, 0); oct(116, 8, 0);
  oct(124, 12, size); oct(136, 12, 0);
  h.fill(0x20, 148, 156);
  h[156] = typeflag.charCodeAt(0);
  if (linkname) h.set(enc.encode(linkname), 157);
  h.set(enc.encode('ustar'), 257); h[262] = 0; h[263] = 0x30; h[264] = 0x30;
  let sum = 0;
  for (const b of h) sum += b;
  h.set(enc.encode(sum.toString(8).padStart(6, '0')), 148);
  h[154] = 0; h[155] = 0x20;
  return h;
}
const tdata = enc.encode('from tar');
const tar = new Uint8Array(512 * 3 + 512);
tar.set(tarHeader('sub/dir/tarred.txt', tdata.length, '0'), 0);
tar.set(tdata, 512);
tar.set(tarHeader('sub/dir/tlink', 0, '2', 'tarred.txt'), 512 + 512);
// (data padded implicitly by zeros; end marker = zero blocks already present)
e.oc_mkdirp(...stage('/home/project/unpack'), 0o755);
{ const rcT = e.oc_extract_tar(...stageBytes(tar.subarray(0, 512 * 3 + 512)), ...stage('/home/project/unpack')); if (rcT !== 2) console.error('extract_tar rc =', rcT); ok('extract_tar', rcT === 2); }
ok('tar file', e.oc_read_file(...stage('/home/project/unpack/sub/dir/tarred.txt')) === 0 && dec.decode(out()) === 'from tar');
ok('tar link', e.oc_readlink(...stage('/home/project/unpack/sub/dir/tlink')) === 0 && outStr() === 'tarred.txt');

// ---- debug counts -------------------------------------------------------------------
ok('debug_counts', e.oc_debug_counts() === 0);
const c = out();
const cdv = new DataView(c.buffer, c.byteOffset, c.byteLength);
const [inodes, files, dirs, fds] = [0, 1, 2, 3].map((i) => cdv.getUint32(i * 4, true));
ok('fds all closed', fds === 0);
ok('files counted', files >= 4);

console.log(`SMOKE_OK n=${n} compile=${compileMs}ms size=${bytes.length}B`);
