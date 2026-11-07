/**
 * OpenContainer — native-core bridge acceptance suite (Bun-runnable).
 *
 * Validates kernel/native-vfs.ts (NativeVfs + NativeSys) against the frozen
 * v1 ABI of the Rust core (docs/native-core-spec.md): Vfs-surface parity
 * (stat/readdir order/rename matrix/mkdir+rm matrix/symlinks/watch/persist),
 * NativeSys fd semantics, tar extraction, arena reset safety and memory
 * growth re-caching.
 *
 * SKIPs cleanly (exit 0) while the other workstream has not produced the
 * artifact yet:
 *
 *   bun run scripts/test-native-bridge.ts
 *
 * On any failure prints the failing label and exits 1; on success prints
 * "BRIDGE_OK n=<assert count>".
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { NativeVfs, NativeSys } from '../src/packages/opencontainer/kernel/native-vfs';
import { Vfs, VfsError } from '../src/packages/opencontainer/kernel/vfs';

const WASM_PATH = nodePath.resolve(__dirname, '../kernel/native-core/pkg/oc_core.wasm');

if (!nodeFs.existsSync(WASM_PATH)) {
  console.log('SKIP: oc_core.wasm not built yet');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

let passed = 0;
let current = '';

function ok(cond: boolean, label: string): void {
  if (cond) {
    passed++;
    return;
  }
  console.error(`FAIL: ${current} :: ${label}`);
  process.exit(1);
}

function section(name: string): void {
  current = name;
  console.log(`-- ${name}`);
}

function throwsVfs(fn: () => unknown, code: string, label: string): VfsError {
  try {
    fn();
  } catch (e: any) {
    ok(e instanceof VfsError && e.code === code, `${label} (got ${e?.code ?? e})`);
    return e as VfsError;
  }
  ok(false, `${label} (expected VfsError ${code}, nothing thrown)`);
  return undefined as never;
}

function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.byteLength !== b.byteLength) return false;
    for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEq(a[i], b[i])) return false;
    return true;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!deepEq((a as any)[k], (b as any)[k])) return false;
    }
    return true;
  }
  return false;
}

const ENC = new TextEncoder();
const DEC = new TextDecoder();
const u8 = (s: string): Uint8Array => ENC.encode(s);
const txt = (b: Uint8Array): string => DEC.decode(b);

// Linux open(2) flag values (spec §1 — what node/libuv pass through)
const O_RDONLY = 0, O_WRONLY = 1, O_RDWR = 2;
const O_CREAT = 64, O_EXCL = 128, O_TRUNC = 512, O_APPEND = 1024;

// ---------------------------------------------------------------------------
// instantiate
// ---------------------------------------------------------------------------

const wasmModule = new WebAssembly.Module(nodeFs.readFileSync(WASM_PATH));
let vfs: NativeVfs;
let sys: NativeSys;
try {
  vfs = new NativeVfs(wasmModule);
  sys = vfs.sys; // the SHARED core — fd ops see the same tree as the Vfs surface
} catch (e) {
  console.error(`FAIL: instantiate :: ${e}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// A. construction
// ---------------------------------------------------------------------------
section('A. construction');
ok(sys.version() === 1, 'ABI version 1');
ok(vfs instanceof Vfs, 'NativeVfs instanceof Vfs (drop-in)');
ok(sys.getcwd() === '/', 'initial wasm cwd is /');
ok(deepEq(vfs.readdir('/'), []), 'root starts empty');

// ---------------------------------------------------------------------------
// B. normalize / cwd contract
// ---------------------------------------------------------------------------
section('B. normalize / cwd');
ok(vfs.normalize('/a/b/../c/') === '/a/c/', 'dotdot pops, trailing slash kept');
ok(vfs.normalize('/a/./b//c') === '/a/b/c', 'dot skipped, // collapsed');
ok(vfs.normalize('/..') === '/', 'dotdot bounded at root');
throwsVfs(() => vfs.normalize(''), 'ERR_INVALID_ARG_VALUE', 'empty path rejected');

vfs.mkdir('/home', true);
sys.chdir('/home');
ok(vfs.normalize('proj') === '/home/proj', 'relative resolves against the WASM cwd');
sys.chdir('/');
ok(vfs.normalize('proj') === '/proj', 'wasm cwd back at /');

vfs.mkdir('/home/project', true);
vfs.cwdProvider = () => '/home/project';
ok(vfs.normalize('x') === '/home/project/x', 'cwdProvider drives relative resolution');
ok(sys.getcwd() === '/home/project', 'provider value mirrored into the wasm cwd (lazy sync)');
vfs.cwdProvider = undefined;
sys.chdir('/');

// ---------------------------------------------------------------------------
// C. stat family
// ---------------------------------------------------------------------------
section('C. stat family');
vfs.mkdir('/d', true);
vfs.writeFile('/d/f', 'hello world');
{
  const st = vfs.stat('/d/f');
  ok(st.size === 11, 'stat size');
  ok(st.mode === 0o100666, 'stat mode S_IFREG|0666');
  ok(st.dev === 1 && st.blksize === 4096 && st.nlink === 1 && st.uid === 0 && st.gid === 0 && st.rdev === 0,
    'stat fixed fields (dev/blksize/nlink/uid/gid/rdev)');
  ok(st.blocks === Math.ceil(11 / 512), 'stat blocks = ceil(size/512)');
  ok(st.ino > 0, 'stat ino monotonic');
  ok(Number.isFinite(st.atimeMs) && Number.isFinite(st.mtimeMs) && Number.isFinite(st.ctimeMs) && Number.isFinite(st.birthtimeMs),
    'stat times finite');

  const sd = vfs.stat('/d');
  ok((sd.mode & 0o170000) === 0o040000, 'stat of dir is a dir');
  ok(sd.size === 0, 'dir size 0');

  const e = throwsVfs(() => vfs.stat('/nope'), 'ENOENT', 'stat missing');
  ok(e.syscall === 'stat' && e.path === '/nope', 'stat error carries syscall+path');

  vfs.symlink('/d/f', '/d/lnk');
  const sl = vfs.lstat('/d/lnk');
  ok((sl.mode & 0o170000) === 0o120000, 'lstat of symlink is S_IFLNK');
  ok(sl.size === '/d/f'.length, 'lstat symlink size = target byte length (spec §3)');
  ok(vfs.stat('/d/lnk').size === 11, 'stat follows the symlink');

  vfs.utimes('/d/f', 1000.5, 2000.25);
  const st2 = vfs.stat('/d/f');
  ok(st2.atimeMs === 1000.5 && st2.mtimeMs === 2000.25, 'utimes round-trips through sec/ns split');

  vfs.chmod('/d/f', 0o600);
  ok((vfs.stat('/d/f').mode & 0o7777) === 0o600, 'chmod keeps type bits, sets perms');
  throwsVfs(() => vfs.chmod('/nope', 0o600), 'ENOENT', 'chmod missing');
}

// ---------------------------------------------------------------------------
// D. readdir insertion order + rename moves to end
// ---------------------------------------------------------------------------
section('D. readdir order');
vfs.mkdir('/ord', true);
vfs.writeFile('/ord/a', '1');
vfs.writeFile('/ord/b', '2');
vfs.writeFile('/ord/c', '3');
ok(deepEq(vfs.readdir('/ord'), ['a', 'b', 'c']), 'insertion order');
vfs.rename('/ord/b', '/ord/b2');
ok(deepEq(vfs.readdir('/ord'), ['a', 'c', 'b2']), 'renamed entry moves to END of readdir');
vfs.rm('/ord/a');
vfs.writeFile('/ord/a', '1');
ok(deepEq(vfs.readdir('/ord'), ['c', 'b2', 'a']), 're-created entry appended');
ok(deepEq(vfs.dirents('/d'), [
  { name: 'f', type: 0o100000 },
  { name: 'lnk', type: 0o120000 },
]), 'dirents types (file/link)');
throwsVfs(() => vfs.readdir('/d/f'), 'ENOTDIR', 'readdir of a file');
throwsVfs(() => vfs.readdir('/nope'), 'ENOENT', 'readdir missing');

// ---------------------------------------------------------------------------
// E. rename matrix
// ---------------------------------------------------------------------------
section('E. rename matrix');
vfs.mkdir('/rm1', true);
vfs.writeFile('/rm1/src', 'S');
vfs.writeFile('/rm1/dst', 'D');
vfs.rename('/rm1/src', '/rm1/dst');
ok(txt(vfs.readFile('/rm1/dst')) === 'S', 'file→file replaces');
ok(!vfs.exists('/rm1/src'), 'renamed src gone');

vfs.mkdir('/rm1/e1', true);
vfs.mkdir('/rm1/e2', true);
vfs.rename('/rm1/e1', '/rm1/e2');
ok(vfs.isDirectory('/rm1/e2') && !vfs.exists('/rm1/e1'), 'dir→empty dir replaces');

vfs.mkdir('/rm1/n1', true);
vfs.mkdir('/rm1/n2', true);
vfs.writeFile('/rm1/n2/x', 'x');
throwsVfs(() => vfs.rename('/rm1/n1', '/rm1/n2'), 'ENOTEMPTY', 'dir→non-empty dir');

vfs.writeFile('/rm1/f2', 'f');
vfs.mkdir('/rm1/d2', true);
throwsVfs(() => vfs.rename('/rm1/f2', '/rm1/d2'), 'EISDIR', 'file→dir');

vfs.mkdir('/rm1/d3', true);
vfs.writeFile('/rm1/f3', 'f');
throwsVfs(() => vfs.rename('/rm1/d3', '/rm1/f3'), 'ENOTDIR', 'dir→file');

const eNoSrc = throwsVfs(() => vfs.rename('/rm1/missing', '/rm1/x'), 'ENOENT', 'missing src');
ok(eNoSrc.path === '/rm1/missing', 'missing-src ENOENT carries the old path');
const eNoDst = throwsVfs(() => vfs.rename('/rm1/f3', '/no-such-dir/x'), 'ENOENT', 'missing new parent');
ok(eNoDst.path === '/no-such-dir/x', 'missing-new-parent ENOENT carries the new path');

vfs.mkdir('/rm1/sub', true);
vfs.writeFile('/rm1/sub/inner', 'deep');
vfs.rename('/rm1/sub', '/rm1/sub2');
ok(txt(vfs.readFile('/rm1/sub2/inner')) === 'deep', 'moved dir keeps its subtree');
vfs.rename('/rm1/dst', '/rm1/dst');
ok(vfs.exists('/rm1/dst'), 'rename onto itself is a no-op success');

// ---------------------------------------------------------------------------
// F. mkdir / mkdirp / rm matrix
// ---------------------------------------------------------------------------
section('F. mkdir/rm matrix');
vfs.mkdir('/m', true);
ok(vfs.mkdir('/m/x') === '/m/x', 'mkdir returns the normalized path');
throwsVfs(() => vfs.mkdir('/m/x'), 'EEXIST', 'mkdir over existing dir');
ok(vfs.mkdir('/m/x', true) === null, 'recursive mkdir over existing dir → null');
throwsVfs(() => vfs.mkdir('/m/y/z'), 'ENOENT', 'non-recursive mkdir with missing parent');
ok(vfs.mkdir('/m/y/z', true) === '/m/y/z', 'mkdirp creates parents');
ok(vfs.isDirectory('/m/y') && vfs.isDirectory('/m/y/z'), 'mkdirp levels exist');
vfs.writeFile('/m/f', 'f');
throwsVfs(() => vfs.mkdir('/m/f'), 'EEXIST', 'mkdir over a file');
throwsVfs(() => vfs.mkdir('/m/f', true), 'EEXIST', 'recursive mkdir over a file still EEXISTs');
throwsVfs(() => vfs.mkdir('/m/f/sub', true), 'ENOTDIR', 'non-dir on the mkdirp path');

vfs.rm('/m/y/z');
ok(!vfs.exists('/m/y/z'), 'rm non-recursive of a dir');
vfs.rm('/m/y');
ok(!vfs.exists('/m/y'), 'rm of an empty dir');
vfs.writeFile('/m/x/child', 'c');
throwsVfs(() => vfs.rm('/m/x'), 'ENOTEMPTY', 'rm non-recursive of a non-empty dir');
vfs.rm('/m/x', { recursive: true });
ok(!vfs.exists('/m/x'), 'rm recursive');
throwsVfs(() => vfs.rm('/m/x'), 'ENOENT', 'rm missing');
vfs.rm('/m/x', { force: true });
ok(true, 'rm -f of missing is silent');
vfs.writeFile('/m/f2', 'target');
vfs.symlink('/m/f2', '/m/lnk');
vfs.rm('/m/lnk');
ok(vfs.exists('/m/f2') && !vfs.exists('/m/lnk'), 'rm of a symlink removes the LINK only');
vfs.rm('/m/f');
ok(!vfs.exists('/m/f'), 'rm of a file');

// ---------------------------------------------------------------------------
// G. symlink semantics
// ---------------------------------------------------------------------------
section('G. symlinks');
ok(vfs.readlink('/d/lnk') === '/d/f', 'readlink returns the verbatim target');
throwsVfs(() => vfs.readlink('/nope'), 'ENOENT', 'readlink missing → ENOENT');
throwsVfs(() => vfs.readlink('/d/f'), 'EINVAL', 'readlink of a non-symlink → EINVAL');

vfs.writeFile('/d/lnk', 'replaced');
ok(txt(vfs.readFile('/d/f')) === 'replaced', 'writeFile through a symlink lands on the target');
ok((vfs.lstat('/d/lnk').mode & 0o170000) === 0o120000, 'the symlink itself survives the write');

vfs.symlink('f', '/d/rel');
ok(vfs.stat('/d/rel').size === 'replaced'.length, 'relative target joins the symlink PARENT dir');

vfs.mkdir('/real', true);
vfs.symlink('/real', '/via');
vfs.writeFile('/via/file', 'v');
ok(txt(vfs.readFile('/real/file')) === 'v', 'mid-path dir symlink resolves');

vfs.symlink('x', '/d/f'); // entry exists → spec §3: silent skip, no overwrite
ok(txt(vfs.readFile('/d/f')) === 'replaced', 'symlink over an existing entry is a no-op (spec)');

// ---------------------------------------------------------------------------
// H. readFile/writeFile errors, append, copy
// ---------------------------------------------------------------------------
section('H. file ops');
{
  const e = throwsVfs(() => vfs.writeFile('/nope/f', 'x'), 'ENOENT', 'writeFile missing parent');
  ok(e.syscall === 'open', 'writeFile parent error uses syscall open (vfs.ts parity)');
  throwsVfs(() => vfs.writeFile('/d', 'x'), 'EISDIR', 'writeFile onto a dir');
  const e1 = throwsVfs(() => vfs.readFile('/nope'), 'ENOENT', 'readFile missing');
  ok(e1.syscall === 'readFile', 'readFile error syscall name');
  throwsVfs(() => vfs.readFile('/d'), 'EISDIR', 'readFile of a dir');
  ok(vfs.readTextFile('/d/f') === 'replaced', 'readTextFile decodes');
  vfs.appendFile('/d/f', '++');
  ok(txt(vfs.readFile('/d/f')) === 'replaced++', 'appendFile appends');
  vfs.appendFile('/d/new', 'n');
  ok(txt(vfs.readFile('/d/new')) === 'n', 'appendFile creates');
  vfs.copyFile('/d/f', '/d/fc');
  ok(txt(vfs.readFile('/d/fc')) === 'replaced++', 'copyFile copies bytes');
  const pattern = new Uint8Array(512);
  for (let i = 0; i < pattern.length; i++) pattern[i] = i & 0xff;
  vfs.writeFile('/d/bin', pattern);
  ok(deepEq(vfs.readFile('/d/bin'), pattern), 'binary round-trip');
  ok(vfs.exists('/d/f') && !vfs.exists('/nope') && vfs.isDirectory('/d') && !vfs.isDirectory('/d/f') && !vfs.isDirectory('/nope'),
    'exists/isDirectory');
}

// ---------------------------------------------------------------------------
// I. importTree / exportTree round-trip
// ---------------------------------------------------------------------------
section('I. import/export');
{
  vfs.mkdir('/t/a', true);
  vfs.mkdir('/t/b', true);
  vfs.writeFile('/t/a/x', 'X');
  vfs.writeFile('/t/y', 'Y');
  vfs.symlink('../a', '/t/b/lnk');
  const tree = vfs.exportTree('/t');
  ok(deepEq(tree.dirs, ['/t/a', '/t/b']), 'export dirs in walk order');
  ok(deepEq(tree.files, [['/t/a/x', u8('X')], ['/t/y', u8('Y')]]), 'export files');
  ok(deepEq(tree.symlinks, [['/t/b/lnk', '../a']]), 'export symlinks');

  const vfs2 = new NativeVfs(wasmModule);
  let imported = 0;
  vfs2.persist = () => { imported++; };
  vfs2.importTree(tree);
  ok(imported === 0, 'importTree suppresses persist');
  const tree2 = vfs2.exportTree('/t');
  ok(deepEq(tree2.files, tree.files) && deepEq(tree2.dirs, tree.dirs) && deepEq(tree2.symlinks, tree.symlinks),
    'import→export round-trip');

  // Missing parents in tree.dirs are created (S3.1 fix, kept).
  vfs2.importTree({ dirs: [], files: [['/q/r/s', u8('Z')]], symlinks: [] });
  ok(txt(vfs2.readFile('/q/r/s')) === 'Z', 'importTree ensures missing parents');
  vfs2.importTree(tree); // idempotent (symlink pre-check skip + try/catch)
  ok(true, 'importTree twice is idempotent');

  // applyExternalOps — persist stays suppressed, cascade semantics apply.
  const ops: any[] = [
    { type: 'mkdir', path: '/ae' },
    { type: 'write', path: '/ae/f', data: u8('A') },
    { type: 'mkdir', path: '/ae/d' },
    { type: 'symlink', path: '/ae/lnk', target: 'f' },
    { type: 'rename', from: '/ae/f', to: '/ae/g' },
    { type: 'unlink', path: '/ae/d' },
  ];
  let echoed = 0;
  vfs2.persist = () => { echoed++; };
  vfs2.applyExternalOps(ops);
  ok(echoed === 0, 'applyExternalOps never re-emits persist');
  ok(txt(vfs2.readFile('/ae/g')) === 'A', 'external write+rename applied');
  ok(vfs2.readlink('/ae/lnk') === 'f', 'external symlink applied');
  ok(!vfs2.exists('/ae/d'), 'external unlink applied');
}

// ---------------------------------------------------------------------------
// J. watchers
// ---------------------------------------------------------------------------
section('J. watchers');
{
  vfs.mkdir('/w', true);
  const ev1: Array<{ type: string; filename: string | null }> = [];
  const w1 = vfs.watch('/w', (e) => ev1.push(e));
  vfs.writeFile('/w/f1', '1');
  vfs.writeFile('/w/f1', '2');
  vfs.rm('/w/f1');
  vfs.mkdir('/w/d1', true);
  ok(deepEq(ev1, [
    { type: 'rename', filename: null },   // create
    { type: 'change', filename: 'f1' },   // overwrite
    { type: 'rename', filename: null },   // unlink
    { type: 'rename', filename: null },   // mkdir
  ]), 'dir watcher rename/change stream');
  vfs.rename('/w/d1', '/w/d2');
  ok(ev1.length === 6 && ev1[4].type === 'rename' && ev1[5].type === 'rename',
    'rename fires the (same) parent dir watcher twice');

  // fileFilter: fs.watch(file) semantics — CHANGE events are filtered to
  // the file's basename; RENAME events (like any entry creation in the dir)
  // reach every watcher unfiltered (vfs.ts fireRenameAt has no filter).
  vfs.writeFile('/w/f2', 'x');
  const evFile: Array<{ type: string; filename: string | null }> = [];
  const fw = vfs.watch('/w/f2', (e) => evFile.push(e));
  vfs.writeFile('/w/f1', '3'); // f1 was rm'd → NEW entry → unfiltered rename
  ok(evFile.length === 1 && evFile[0].type === 'rename',
    'rename events are NOT fileFilter-ed (vfs.ts parity)');
  vfs.writeFile('/w/f2', 'y');
  ok(evFile.length === 2 && evFile[1].type === 'change' && evFile[1].filename === 'f2',
    'file watcher receives its own change');
  ok(ev1[ev1.length - 1].type === 'change' && ev1[ev1.length - 1].filename === 'f2',
    'the unfiltered dir watcher saw it too');
  fw.close();
  vfs.writeFile('/w/f2', 'z');
  ok(evFile.length === 2, 'closed watcher is silent');

  // canonical registration: watch through a symlinked dir path
  vfs.symlink('/w', '/wlink');
  const evLink: Array<{ type: string; filename: string | null }> = [];
  vfs.watch('/wlink', (e) => evLink.push(e));
  vfs.writeFile('/w/brandnew', 'n'); // NEW entry → rename on the target dir
  ok(evLink.length === 1 && evLink[0].type === 'rename',
    'watcher registered via a symlink fires for the target dir');

  throwsVfs(() => vfs.watch('/nope', () => {}), 'ENOENT', 'watch missing → ENOENT');
  w1.close();
}

// ---------------------------------------------------------------------------
// K. persist op recording (shapes + order)
// ---------------------------------------------------------------------------
section('K. persist ops');
{
  const ops: any[] = [];
  vfs.persist = (op) => ops.push(op);
  vfs.mkdir('/p/a', true);
  ok(ops.length === 1 && ops[0].type === 'mkdir' && ops[0].path === '/p/a',
    'mkdirp emits ONE mkdir op for the final path');
  vfs.writeFile('/p/a/f', 'x');
  ok(ops.length === 2 && ops[1].type === 'write' && ops[1].path === '/p/a/f' && deepEq(ops[1].data, u8('x')),
    'write op carries the data passed in');
  vfs.rename('/p/a/f', '/p/a/g');
  ok(ops.length === 4 && ops[2].type === 'rename' && ops[2].from === '/p/a/f' && ops[2].to === '/p/a/g'
    && ops[3].type === 'write' && ops[3].path === '/p/a/g' && deepEq(ops[3].data, u8('x')),
    'rename emits rename + whole-file write for the moved file');
  vfs.rm('/p/a/g');
  ok(ops.length === 5 && ops[4].type === 'unlink' && ops[4].path === '/p/a/g', 'unlink op');
  vfs.symlink('g', '/p/l');
  ok(ops.length === 6 && ops[5].type === 'symlink' && ops[5].path === '/p/l' && ops[5].target === 'g', 'symlink op');
  vfs.appendFile('/p/app', 'a');
  vfs.appendFile('/p/app', 'b');
  ok(ops.length === 8 && deepEq(ops[7].data, u8('ab')), 'append persists the MERGED content');
  const u = u8('raw-bytes');
  vfs.writeFile('/p/bin', u);
  ok(ops.length === 9 && deepEq(ops[8].data, u), 'write persist never reads back from wasm');
  vfs.persist = undefined;
}

// ---------------------------------------------------------------------------
// L. NativeSys fd ops (shared core — same tree as the Vfs surface)
// ---------------------------------------------------------------------------
section('L. NativeSys fds');
{
  const fd = sys.open('/fdtest', O_WRONLY | O_CREAT | O_TRUNC, 0o666);
  ok(fd >= 3, 'open returns a fd past stdio');
  ok(sys.write(fd, u8('hello')) === 5, 'write returns the byte count');
  sys.close(fd);
  ok(txt(vfs.readFile('/fdtest')) === 'hello', 'fd write visible through the Vfs surface');

  const fd2 = sys.open('/fdtest', O_RDONLY);
  const v1 = sys.read(fd2, 3);
  ok(txt(v1) === 'hel', 'read returns the first bytes');
  const copy1 = v1.slice(); // callers MUST copy before the next syscall
  const v2 = sys.read(fd2, 3);
  ok(txt(v2) === 'lo', 'read advances the fd position');
  ok(txt(copy1) === 'hel', 'a copy survives later syscalls (view contract)');
  ok(sys.read(fd2, 10).byteLength === 0, 'short read at EOF');
  sys.close(fd2);

  const fdo = sys.open('/fdw', O_RDWR | O_CREAT, 0o666);
  ok(sys.write(fdo, u8('AAAA')) === 4, 'write at fd position');
  ok(sys.write(fdo, u8('BB'), 1) === 2, 'pwrite returns the byte count');
  ok(sys.read(fdo, 10).byteLength === 0, 'pwrite does NOT move the fd position');
  ok(txt(vfs.readFile('/fdw')) === 'ABBA', 'pwrite patched the file in place');
  const fst = sys.fstat(fdo);
  ok(fst instanceof Float64Array && fst.length === 18, 'fstat is the 18-f64 positional stat');
  ok(fst[8] === 4, 'fstat size slot (8)');
  ok(sys.fstat(fdo) === fst, 'fstat returns a VIEW over STAT_SLOT (same object)');
  sys.fchmod(fdo, 0o600);
  ok((vfs.stat('/fdw').mode & 0o7777) === 0o600, 'fchmod visible through stat');
  sys.ftruncate(fdo, 2);
  ok(txt(vfs.readFile('/fdw')) === 'AB', 'ftruncate');
  sys.close(fdo);

  const fda = sys.open('/fda', O_WRONLY | O_CREAT | O_APPEND, 0o666);
  sys.write(fda, u8('x'));
  sys.write(fda, u8('y'));
  sys.close(fda);
  ok(txt(vfs.readFile('/fda')) === 'xy', 'O_APPEND appends');
  {
    const probe = sys.open('/fda', O_RDONLY);
    ok(sys.fstat(probe)[8] === 2, 'O_APPEND fd pos tracks size');
    sys.close(probe);
  }

  throwsVfs(() => sys.open('/fdtest', O_WRONLY | O_CREAT | O_EXCL), 'EEXIST', 'O_CREAT|O_EXCL on existing');
  const fdn = sys.open('/fdnew', O_WRONLY | O_CREAT | O_EXCL, 0o666);
  ok(fdn >= 3, 'O_EXCL on a fresh path creates');
  sys.close(fdn);

  const fdt = sys.open('/fdtest', O_WRONLY | O_TRUNC);
  ok(vfs.readFile('/fdtest').byteLength === 0, 'O_TRUNC empties at open');
  sys.close(fdt);

  throwsVfs(() => sys.close(999), 'EBADF', 'close of an unknown fd');
  throwsVfs(() => sys.read(999, 1), 'EBADF', 'read of an unknown fd');

  // statRaw — the positional array fs.ts's statFields builds today
  const sr = sys.statRaw('/fdw') as Float64Array;
  ok(sr instanceof Float64Array && sr.length === 18 && sr[8] === 2, 'statRaw follow');
  ok((sr[1] & 0o170000) === 0o100000, 'statRaw mode slot');
  const sb = sys.statRaw('/d/lnk', { follow: false, bigint: true }) as BigInt64Array;
  ok(sb instanceof BigInt64Array && sb.length === 18 && (Number(sb[1]) & 0o170000) === 0o120000,
    'statRaw bigint lstat (BigInt64Array copy)');
  const sf = sys.statRaw('/d/lnk', { follow: true }) as Float64Array;
  ok(sf[8] === vfs.readFile('/d/f').byteLength, 'statRaw follows symlinks');

  // standalone construction (its own tree)
  const sysAlone = new NativeSys(wasmModule);
  ok(sysAlone.getcwd() === '/', 'standalone NativeSys boots');
}

// ---------------------------------------------------------------------------
// M. extractTar (tar built in-script, 512-byte headers)
// ---------------------------------------------------------------------------
section('M. extractTar');
{
  const header = (opts: { name: string; size?: number; type?: string; linkname?: string }): Uint8Array => {
    const h = new Uint8Array(512);
    const put = (off: number, s: string, len: number) => {
      for (let i = 0; i < s.length && i < len; i++) h[off + i] = s.charCodeAt(i);
    };
    const oct = (n: number, len: number) => n.toString(8).padStart(len - 1, '0') + '\0';
    put(0, opts.name, 100);
    put(100, oct(0o644, 8), 8);
    put(108, oct(0, 8), 8);
    put(116, oct(0, 8), 8);
    put(124, oct(opts.size ?? 0, 12), 12);
    put(136, oct(0, 12), 12);
    for (let i = 148; i < 156; i++) h[i] = 32; // chksum placeholder
    h[156] = (opts.type ?? '0').charCodeAt(0);
    put(157, opts.linkname ?? '', 100);
    put(257, 'ustar\0', 6);
    put(263, '00', 2);
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += h[i];
    put(148, sum.toString(8).padStart(6, '0') + '\0 ', 8);
    return h;
  };
  const pad = (n: number): Uint8Array => {
    const p = (512 - (n % 512)) % 512;
    return new Uint8Array(p);
  };
  const parts: Uint8Array[] = [
    header({ name: 'tdir/', type: '5' }),
    header({ name: 'tdir/hello.txt', size: 3 }),
    u8('TAR'),
    pad(3),
    header({ name: 'tdir/lnk', type: '2', linkname: '../hello.txt' }),
    new Uint8Array(1024), // end-of-archive
  ];
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const tar = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { tar.set(p, off); off += p.byteLength; }

  vfs.mkdir('/tarex', true);
  ok(sys.extractTar(tar, '/tarex') === 3, 'extractTar returns the entry count');
  ok(txt(vfs.readFile('/tarex/tdir/hello.txt')) === 'TAR', 'tar file extracted');
  ok(vfs.readlink('/tarex/tdir/lnk') === '../hello.txt', 'tar symlink extracted');
  ok(vfs.isDirectory('/tarex/tdir'), 'tar dir extracted');

  // path-escape rejection (spec §3: EINVAL, no partial write of the entry)
  const evil: Uint8Array[] = [
    header({ name: '../../../etc/evil', size: 1 }),
    u8('E'),
    pad(1),
    new Uint8Array(1024),
  ];
  const evilTar = new Uint8Array(evil.reduce((n, p) => n + p.byteLength, 0));
  off = 0;
  for (const p of evil) { evilTar.set(p, off); off += p.byteLength; }
  throwsVfs(() => sys.extractTar(evilTar, '/tarex'), 'EINVAL', 'tar path escape rejected');
  ok(!vfs.exists('/tarex/../../../etc/evil') && !vfs.exists('/etc/evil'), 'no partial write of the rejected entry');

  throwsVfs(() => sys.extractTar(tar, '/no-such-dest'), 'ENOENT', 'extractTar needs an existing dest');
}

// ---------------------------------------------------------------------------
// N. arena reset safety + memory growth re-cache
// ---------------------------------------------------------------------------
section('N. arena/growth');
{
  const big = new Uint8Array(3 * 1024 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = i & 0xff;
  vfs.writeFile('/big', big); // >1MB through oc_write_file — forces growth
  const rb = vfs.readFile('/big');
  ok(rb.byteLength === big.length, 'big file length intact after growth');
  ok(rb[0] === big[0] && rb[1] === big[1] && rb[1048577] === big[1048577] && rb[big.length - 1] === big[big.length - 1],
    'big file bytes intact after growth (views re-cached)');

  // the cached views must have been re-derived — keep operating across types
  ok(vfs.normalize('/x/../y') === '/y', 'normalize still works after growth');
  ok(vfs.stat('/big').size === big.length, 'stat still works after growth');
  ok(vfs.readdir('/d').length >= 2, 'readdir still works after growth');
  vfs.writeFile('/small', 's');
  ok(txt(vfs.readFile('/small')) === 's', 'small write after growth');
  vfs.rename('/small', '/small2');
  ok(txt(vfs.readFile('/small2')) === 's', 'rename after growth');

  const counts = sys.debugCounts();
  ok(counts.inodes > 0 && counts.files > 0 && counts.dirs > 0, 'debugCounts reports the tree');
  ok(counts.fds === 0, 'debugCounts: no leaked fds');
}

console.log(`BRIDGE_OK n=${passed}`);
