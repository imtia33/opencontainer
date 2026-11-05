/**
 * OpenContainer — buffer/fs binding parity KERNEL side.
 *
 *   bun run scripts/test-buffer-parity.ts
 *
 * 1. Spawns the sandbox's real `node` on scripts/test-buffer-parity.node.js
 *    to compute the ground-truth JSON (same 52 behavioral cases).
 * 2. Boots OUR kernel the same way scripts/npm-harness.ts does
 *    (diskStore over the vendored node-v26.13.0 tree + bootKernel).
 * 3. Runs the identical case list through the kernel's Buffer/fs (the
 *    vendored lib/buffer.js + lib/fs.js over our natives shim).
 * 4. Diffs both result sets — prints per-case PASS/FAIL and the final
 *    `X/52 byte-identical` line; exit code 1 on any divergence.
 *
 * The CASES section must stay in lockstep with test-buffer-parity.node.js
 * (same ids, same call shapes — only the `api` plumbing differs).
 */
import { spawnSync } from 'node:child_process';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { bootKernel } from '../src/packages/opencontainer/kernel/boot';

const hostLog = console.log.bind(console);
const hostError = console.error.bind(console);

const VENDOR = nodePath.resolve(__dirname, '../src/packages/opencontainer/vendor');
const NODE_SCRIPT = nodePath.join(__dirname, 'test-buffer-parity.node.js');

// ---------------------------------------------------------------------------
// 1. Ground truth from the REAL node binary.
// ---------------------------------------------------------------------------
function expectedFromRealNode(): Record<string, any> {
  const res = spawnSync(process.execPath.includes('bun') ? 'node' : process.execPath, [NODE_SCRIPT], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0 || !res.stdout) {
    hostError('=== node ground-truth script failed ===');
    hostError(res.stderr ?? `(exit ${res.status})`);
    process.exit(1);
  }
  return JSON.parse(res.stdout);
}

// ---------------------------------------------------------------------------
// 2. Boot the kernel (npm-harness.ts boot pattern).
// ---------------------------------------------------------------------------
const diskStore = {
  get(path: string): string {
    return nodeFs.readFileSync(nodePath.join(VENDOR, path), 'utf8');
  },
};

async function boot() {
  return bootKernel({
    store: diskStore as any,
    argv: ['node', '/home/project/parity-main.js'],
    hooks: {
      onExit(code: number) { hostError(`[kernel exit ${code}]`); },
      onStdio(fd: 1 | 2, chunk: any) {
        const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        hostError(`[stdio${fd}] ${JSON.stringify(text)}`);
      },
      now: () => Date.now(),
      env: () => ({
        PATH: '/usr/local/bin:/usr/bin:/bin',
        HOME: '/home/node',
        LANG: 'en_US.UTF-8',
        TERM: 'xterm-256color',
        npm_config_loglevel: 'notice',
      }),
      initialCwd: '/home/project',
    },
  } as any);
}

// ---------------------------------------------------------------------------
// 3. Kernel-side api + the CASES (in lockstep with test-buffer-parity.node.js).
// ---------------------------------------------------------------------------
function makeApi(kernel: any) {
  const bufferMod = kernel.require('buffer');
  return {
    // v26 surface — the vendored lib/buffer.js exports all of these and
    // routes them through internalBinding('buffer') (our natives shim).
    Buffer: bufferMod.Buffer,
    btoa: bufferMod.btoa,
    atob: bufferMod.atob,
    isAscii: bufferMod.isAscii,
    isUtf8: bufferMod.isUtf8,
    isLatin1: bufferMod.isLatin1,
    // v26 Buffer.stringLength (bindingStringLengthUtf8 — the utf8 branch).
    stringLength(bytes: Uint8Array) {
      return bufferMod.Buffer.stringLength(bytes);
    },
    fs: kernel.require('fs'),
  };
}

let tmpSeq = 0;
function tmp(name: string): string {
  return `/tmp/oc-parity-${tmpSeq++}-${name}`;
}

const hex = (b: any) => b.toString('hex');
const B = (str: string, enc?: string) => api.Buffer.from(str, enc);

function throws(fn: () => any) {
  try {
    return { threw: false, value: fn() };
  } catch (e: any) {
    return { threw: true, name: e && e.name, message: e && e.message };
  }
}

let api: any;

const CASES: [string, () => any][] = [
  // ---- copy (node_buffer.cc Copy: _copy(source, target, targetStart,
  //      sourceStart, nb) → bytes copied, node clamping rules) --------------
  ['copy-basic', () => {
    const dst = api.Buffer.alloc(6);
    const ret = B('abcdef').copy(dst);
    return [ret, hex(dst)];
  }],
  ['copy-subrange', () => {
    const dst = api.Buffer.alloc(6);
    const ret = B('abcdef').copy(dst, 1, 2, 4);
    return [ret, hex(dst)];
  }],
  ['copy-target-clamp', () => {
    const dst = api.Buffer.alloc(4);
    const ret = B('abcdef').copy(dst, 2, 0);
    return [ret, hex(dst)];
  }],
  ['copy-srcstart-ge-end', () => {
    const dst = api.Buffer.alloc(6);
    const ret = B('abcdef').copy(dst, 0, 4, 2);
    return [ret, hex(dst)];
  }],
  ['copy-sourceend-clamp', () => {
    const dst = api.Buffer.alloc(8);
    const ret = B('abc').copy(dst, 0, 0, 100);
    return [ret, hex(dst)];
  }],
  ['copy-multibyte', () => {
    const dst = api.Buffer.alloc(9);
    const ret = B('h\u00e9llo\u20ac').copy(dst);
    return [ret, hex(dst)];
  }],

  // ---- fill (bindingFill(buf, value, offset, end, encoding)) --------------
  ['fill-number', () => hex(api.Buffer.alloc(4).fill(0x61))],
  ['fill-string-repeat', () => hex(api.Buffer.alloc(5).fill('ab'))],
  ['fill-utf8-2byte', () => hex(api.Buffer.alloc(5).fill('\u00e9'))],
  ['fill-hex-encoding', () => hex(api.Buffer.alloc(4).fill('0102', 'hex'))],
  ['fill-uint8-value', () => hex(api.Buffer.alloc(5).fill(Uint8Array.of(1, 2, 3)))],

  // ---- indexOf / lastIndexOf (indexOfNumber / indexOfString /
  //      indexOfBuffer — forward + backward, clamps, not-found) -------------
  ['indexOf-number', () => B('abcdef').indexOf(100)],
  ['indexOf-number-negoffset', () => B('abcdef').indexOf(100, -3)],
  ['indexOf-number-notfound', () => B('abcdef').indexOf(122)],
  ['indexOf-string-mb', () => B('a\u00e9bc').indexOf('\u00e9')],
  ['indexOf-string-hex', () => B('abcdef').indexOf('6364', 'hex')],
  ['indexOf-string-ucs2', () => B('a\u00e9bc', 'utf16le').indexOf('\u00e9', 'ucs2')],
  ['indexOf-buffer', () => B('abcdef').indexOf(B('cd'))],
  ['indexOf-buffer-notfound', () => B('abcdef').indexOf(B('xy'))],
  ['lastIndexOf-number', () => B('abcabc').lastIndexOf(99)],
  ['lastIndexOf-string-offset', () => B('aabaab').lastIndexOf('aab', 3)],
  ['lastIndexOf-negoffset', () => B('canal').lastIndexOf('a', -2)],
  ['indexOf-empty-string', () => B('abc').indexOf('')],
  ['lastIndexOf-empty-string', () => B('abc').lastIndexOf('')],

  // ---- compare / compareOffset (Buffer.compare → _compare;
  //      buf.compare(t, ts, te, ss, se) → compareOffset(this, t, ts, ss, te, se)) --
  ['compare-full', () => api.Buffer.compare(B('abc'), B('abd'))],
  ['compareOffset-mismatch', () => B('abcdef').compare(B('abddef'), 2, 4, 2, 4)],
  ['compareOffset-len', () => B('ab').compare(B('ab'), 0, 1, 0, 2)],

  // ---- isAscii / isLatin1 / isUtf8 ----------------------------------------
  ['isAscii-true', () => api.isAscii(Uint8Array.of(0x00, 0x7f, 0x41))],
  ['isAscii-false', () => api.isAscii(Uint8Array.of(0x00, 0x80))],
  ['isAscii-arraybuffer', () => api.isAscii(new Uint8Array([65, 66]).buffer)],
  ['isLatin1-true', () => api.isLatin1('caf\u00e9')],
  ['isLatin1-false', () => api.isLatin1('\u011b')],
  ['isUtf8-valid', () => api.isUtf8(B('h\u00e9llo\u20ac'))],
  ['isUtf8-invalid', () => api.isUtf8(Uint8Array.of(0xc3, 0x28))],
  ['isUtf8-overlong', () => api.isUtf8(Uint8Array.of(0xc0, 0x80))],
  ['isUtf8-surrogate', () => api.isUtf8(Uint8Array.of(0xed, 0xa0, 0x80))],

  // ---- stringLengthUtf8 (v26 Buffer.stringLength, utf8 branch) ------------
  ['stringLength-ascii', () => api.stringLength(Uint8Array.of(0x68, 0x65, 0x6c, 0x6c, 0x6f))],
  ['stringLength-multibyte', () => api.stringLength(B('h\u00e9llo\u20ac'))],

  // ---- atob / btoa (module-level WHATWG forgiving-base64) -----------------
  ['btoa-basic', () => api.btoa('hello')],
  ['btoa-binary', () => api.btoa('\u0000\u00ff\u0010')],
  ['btoa-invalid', () => throws(() => api.btoa('\u0100'))],
  ['atob-basic', () => api.atob('aGVsbG8=')],
  ['atob-whitespace', () => api.atob(' YQ== ')],
  ['atob-single-char', () => throws(() => api.atob('a'))],
  ['atob-invalid-char', () => throws(() => api.atob('a=c'))],

  // ---- fs writeString / writeBuffers (lib/fs.js string form:
  //      binding.writeString(fd, str, POSITION, ENCODING)) -------------------
  ['writeString-pos0', () => {
    const p = tmp('w1');
    const fd = api.fs.openSync(p, 'w');
    const n = api.fs.writeSync(fd, 'hello world', 0);
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
  ['writeString-mid-position', () => {
    const p = tmp('w2');
    const fd = api.fs.openSync(p, 'w');
    api.fs.writeSync(fd, 'A'.repeat(20), 0);
    const n = api.fs.writeSync(fd, 'hello', 8);
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
  ['writeString-null-append', () => {
    const p = tmp('w3');
    const fd = api.fs.openSync(p, 'w');
    api.fs.writeSync(fd, 'foo', 0);
    const n = api.fs.writeSync(fd, 'bar', null);
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
  ['writeString-utf8', () => {
    const p = tmp('w4');
    const fd = api.fs.openSync(p, 'w');
    const n = api.fs.writeSync(fd, 'h\u00e9llo', 0);
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
  ['writeString-latin1', () => {
    const p = tmp('w5');
    const fd = api.fs.openSync(p, 'w');
    const n = api.fs.writeSync(fd, '\u00e9\u00e9', 0, 'latin1');
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
  ['writev-position', () => {
    const p = tmp('w6');
    const fd = api.fs.openSync(p, 'w');
    api.fs.writeSync(fd, 'XXXXXX', 0);
    const n = api.fs.writevSync(fd, [B('ab'), B('cd')], 2);
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
  ['writeBuffer-slice', () => {
    const p = tmp('w8');
    const fd = api.fs.openSync(p, 'w');
    api.fs.writeSync(fd, 'A'.repeat(10), 0);
    // buffer form: binding.writeBuffer(fd, buffer, offset, length, position)
    // — writes buffer[offset, offset+length) at the FILE position.
    const n = api.fs.writeSync(fd, B('abcdef'), 1, 3, 4);
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
  ['writeString-sparse', () => {
    const p = tmp('w7');
    const fd = api.fs.openSync(p, 'w');
    const n = api.fs.writeSync(fd, 'Z', 10);
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
];

// ---------------------------------------------------------------------------
// 4. Compare.
// ---------------------------------------------------------------------------
function identical(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main() {
  if (process.env.OC_PARITY_NPM !== undefined) {
    hostError('--- npm DIAG mode (OC_PARITY_NPM) — parity suite skipped ---');
    return npmDiag();
  }
  const expected = expectedFromRealNode();
  const expectedIds = Object.keys(expected);

  hostError('--- booting kernel (vendored node v26.13.0 lib tree) ---');
  const t0 = Date.now();
  const kernel = await boot();
  hostError(`--- kernel booted in ${Date.now() - t0}ms ---`);
  api = makeApi(kernel);

  const results: Record<string, any> = {};
  for (const [id, run] of CASES) {
    try {
      results[id] = run();
    } catch (e: any) {
      results[id] = { __caseThrew: true, name: e && e.name, message: e && e.message };
    }
  }

  // Case-set drift guard: both sides must run the exact same ids.
  const ids = CASES.map(([id]) => id);
  const missing = expectedIds.filter((id) => !ids.includes(id));
  const extra = ids.filter((id) => !expectedIds.includes(id));
  if (missing.length || extra.length) {
    hostError(`!!! case-set drift — node-only: [${missing}] kernel-only: [${extra}]`);
  }

  let pass = 0;
  const total = expectedIds.length;
  const failures: string[] = [];
  for (const id of expectedIds) {
    if (identical(results[id], expected[id])) {
      pass++;
    } else {
      failures.push(id);
      hostError(`FAIL ${id}`);
      hostError(`     node  : ${JSON.stringify(expected[id])}`);
      hostError(`     kernel: ${JSON.stringify(results[id])}`);
    }
  }
  hostError(`\n=== parity: ${pass}/${total} byte-identical ===`);
  if (failures.length > 0) {
    hostError(`failing: ${failures.join(', ')}`);
    process.exit(1);
  }
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Optional npm CLI diagnosis (OC_PARITY_NPM='<npm args>'): boots the kernel
// exactly like scripts/npm-harness.ts, mounts the vendored npm tree, and —
// unlike the harness — captures uncaughtException errors + every stdout/
// stderr write DIRECTLY to the host console (bypassing the kernel stream
// path that currently swallows npm's error output on exit).
// ---------------------------------------------------------------------------
const NPM_VENDOR_DIAG = nodePath.resolve(__dirname, '../vendor/npm-12.2.1');
const NPM_ROOT_DIAG = '/usr/lib/node_modules/npm';
const CLI_DIAG = `${NPM_ROOT_DIAG}/bin/npm-cli.js`;

const DIAG_TEXT_EXT = new Set([
  '.js', '.cjs', '.mjs', '.json', '.md', '.txt', '.ts',
  '.html', '.py', '.mts', '.cts', '.cc', '.yml', '.typed', '.toml',
  '.ninja', '.gypi', '.fish', '.cs', '.bnf', '.bat', '.cmd', '.sh', '.ps1',
  '.1', '.5', '.7', '.BSD', '.APACHE',
]);

async function npmDiag() {
  const npmArgs = (process.env.OC_PARITY_NPM ?? '-v').split(' ');
  const kernel = await bootKernel({
    store: diskStore as any,
    argv: ['node', CLI_DIAG, ...npmArgs],
    hooks: {
      onExit(code: number) { hostError(`\n[exit ${code}]`); },
      onStdio(fd: 1 | 2, chunk: any) {
        const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        (fd === 1 ? hostLog : hostError)(text.endsWith('\n') ? text.slice(0, -1) : text);
      },
      now: () => Date.now(),
      env: () => ({
        PATH: `${NPM_ROOT_DIAG}/bin:/usr/local/bin:/usr/bin:/bin`,
        HOME: '/home/node',
        LANG: 'en_US.UTF-8',
        TERM: 'xterm-256color',
        npm_config_loglevel: 'notice',
      }),
      initialCwd: '/home/project',
    },
  } as any);

  // --- capture every uncaught exception BEFORE npm's own handler exits ---
  const anyProc: any = kernel.process;
  anyProc.on('uncaughtException', (e: any) => {
    hostError('\n[diag uncaughtException]', e && (e.stack || e.message || String(e)));
    if (e && e.cause) hostError('[diag cause]', e.cause && (e.cause.stack || String(e.cause)));
  });
  anyProc.on('unhandledRejection', (e: any) => {
    hostError('\n[diag unhandledRejection]', e && (e.stack || e.message || String(e)));
  });

  // --- trace stream writes + exit ---
  for (const streamName of ['stdout', 'stderr'] as const) {
    const s: any = anyProc[streamName];
    if (!s || typeof s.write !== 'function') continue;
    const orig = s.write.bind(s);
    s.write = (...a: any[]) => {
      const c: any = a[0];
      const text = typeof c === 'string' ? c : c && c.toString ? c.toString('latin1') : String(c);
      hostError(`[diag ${streamName}.write] ${JSON.stringify(text)}`);
      return orig(...a);
    };
  }
  const origExit = anyProc.exit;
  anyProc.exit = function (c?: number) {
    hostError('[diag process.exit(' + c + ') from:\n' + new Error('trace').stack);
    return origExit.call(this, c);
  };

  // --- mount the npm tree (same as npm-harness.ts), with one DIAGNOSTIC
  // patch: lib/cli/entry.js's catch block dumps the error to a VFS file
  // (the kernel stream path currently swallows npm's error output). ---
  const OC_PATCH_FROM = '  } catch (err) {\n    return exitHandler.exit(err)\n  }\n}';
  const OC_PATCH_TO = '  } catch (err) {\n' +
    "    try { require('fs').writeFileSync('/tmp/oc-npm-err.txt', 'ENTRY-CATCH\\n' + ((err && err.stack) || String(err))) } catch (_) {}\n" +
    '    return exitHandler.exit(err)\n  }\n}';
  // display.js dump: what do the dynamic imports of chalk / supports-color
  // actually return inside the kernel?
  const OC_IMP_FROM = `    const [{ Chalk }, { createSupportsColor }] = await Promise.all([
      import('chalk'),
      import('supports-color'),
    ])`;
  const OC_IMP_TO = `    const [__ocChalk, __ocSc] = await Promise.all([
      import('chalk'),
      import('supports-color'),
    ])
    try { require('fs').writeFileSync('/tmp/oc-npm-imp.txt',
      'chalk keys: ' + Object.keys(__ocChalk).join(',') + '\\n' +
      'supports-color keys: ' + Object.keys(__ocSc).join(',') + '\\n') } catch (e) {}
    const [{ Chalk }, { createSupportsColor }] = [__ocChalk, __ocSc];`;
  let files = 0;
  const walk = (dir: string, rel: string) => {
    for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        kernel.vfs.mkdir(`${NPM_ROOT_DIAG}/${relPath}`, true);
        walk(nodePath.join(dir, entry.name), relPath);
      } else if (entry.isFile() && relPath !== '.provenance.json') {
        const ext = nodePath.extname(entry.name);
        if (ext !== '' && !DIAG_TEXT_EXT.has(ext)) continue;
        let buf = nodeFs.readFileSync(nodePath.join(dir, entry.name));
        if (buf.includes(0)) continue;
        let text = buf.toString('utf8');
        if (relPath === 'lib/cli/entry.js') {
          if (!text.includes(OC_PATCH_FROM)) {
            hostError('!!! entry.js patch anchor not found — dump disabled');
          } else {
            text = text.replace(OC_PATCH_FROM, OC_PATCH_TO);
          }
        }
        if (relPath === 'lib/utils/display.js' && text.includes(OC_IMP_FROM)) {
          text = text.replace(OC_IMP_FROM, OC_IMP_TO);
        }
        kernel.vfs.writeFile(`${NPM_ROOT_DIAG}/${relPath}`, text);
        files++;
      }
    }
  };
  kernel.vfs.mkdir(NPM_ROOT_DIAG, true);
  walk(NPM_VENDOR_DIAG, '');
  kernel.vfs.writeFile('/home/project/package.json', '{"name":"oc-s2","version":"1.0.0","private":true}\n');
  hostError(`--- mounted ${files} npm files; runMain('${CLI_DIAG}') argv=${JSON.stringify(anyProc.argv)} ---`);

  await kernel.runMain(CLI_DIAG);
  await new Promise((r) => setTimeout(r, 4000));
  // Dump the captured npm entry error (if any) straight to the host console.
  for (const f of ['/tmp/oc-npm-err.txt', '/tmp/oc-npm-imp.txt']) {
    try {
      const errBytes = kernel.vfs.readFile(f);
      hostError(`\n=== CAPTURED ${f} ===`);
      hostError(new TextDecoder().decode(errBytes));
    } catch { /* no file */ }
  }
  hostError('\n--- diag done ---');
  process.exit(0);
}

main().catch((err) => {
  hostError('\n=== PARITY RUNNER FAILURE ===');
  hostError(err && err.stack ? err.stack : err);
  process.exit(1);
});
