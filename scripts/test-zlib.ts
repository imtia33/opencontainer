/**
 * OpenContainer — zlib binding test (fflate-backed handle protocol).
 *
 * Runs inside the kernel through node's REAL lib/zlib.js (the same path npm's
 * tar → minizlib uses), then verifies kernel-produced bytes against Bun's
 * native node:zlib on the host side (ground truth).
 *
 *   bun run scripts/test-zlib.ts
 */
import * as nodeZlib from 'node:zlib';
import { bootKernel } from '../src/packages/opencontainer/kernel/boot';
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

const VENDOR = nodePath.resolve(__dirname, '../src/packages/opencontainer/vendor');

const hostLog = console.log.bind(console);
const hostErr = console.error.bind(console);

const diskStore = {
  get(path: string): string {
    return nodeFs.readFileSync(nodePath.join(VENDOR, path), 'utf8');
  },
};

const CHECKS = `
const zlib = require('zlib');
void (async () => {
const out = [];
const check = (name, fn) => {
  try { const v = fn(); out.push(name + '|PASS|' + String(v)); console.log(name + '|PASS|' + String(v)); }
  catch (e) { out.push(name + '|FAIL|' + e.message); console.log(name + '|FAIL|' + e.message); }
};

// 1. sync roundtrips (all four formats)
const data = Buffer.from('hello opencontainer zlib ' + 'x'.repeat(70000));
check('gzipSync', () => zlib.gunzipSync(zlib.gzipSync(data)).equals(data) ? 'ok' : 'mismatch');
check('deflateSync(zlib)', () => zlib.inflateSync(zlib.deflateSync(data)).equals(data) ? 'ok' : 'mismatch');
check('deflateRawSync', () => zlib.inflateRawSync(zlib.deflateRawSync(data)).equals(data) ? 'ok' : 'mismatch');
check('gzipSync-level9', () => zlib.gunzipSync(zlib.gzipSync(data, { level: 9 })).equals(data) ? 'ok' : 'mismatch');

// 2. crc32 known vector
check('crc32', () => (zlib.crc32('123456789') === 0xCBF43926 ? 'ok' : 'wrong:' + zlib.crc32('123456789')));

// 3. async streaming: createGunzip fed in odd-sized chunks
const gz = zlib.gzipSync(data);
const chunks = [];
const gun = zlib.createGunzip();
gun.on('data', (c) => chunks.push(c));
const gunDone = new Promise((res, rej) => { gun.on('end', res); gun.on('error', rej); });
for (let i = 0; i < gz.length; i += 7777) gun.write(gz.subarray(i, i + 7777));
gun.end();
await gunDone;
check('createGunzip-stream', () => Buffer.concat(chunks).equals(data) ? 'ok' : 'mismatch:' + Buffer.concat(chunks).length + '/' + data.length);

// 4. async streaming: createGzip → collect → gunzip
const gchunks = [];
const g = zlib.createGzip({ level: 6 });
g.on('data', (c) => gchunks.push(c));
const gDone = new Promise((res, rej) => { g.on('end', res); g.on('error', rej); });
for (let i = 0; i < data.length; i += 4096) g.write(data.subarray(i, i + 4096));
g.end();
await gDone;
const gbuf = Buffer.concat(gchunks);
check('createGzip-stream', () => zlib.gunzipSync(gbuf).equals(data) ? 'ok' : 'mismatch');

// 5. pipe: createGzip | createGunzip
const pout = [];
const pDone = new Promise((res, rej) => {
  const gz2 = zlib.createGzip();
  const gun2 = zlib.createGunzip();
  gz2.pipe(gun2);
  gun2.on('data', (c) => pout.push(c));
  gun2.on('end', res); gun2.on('error', rej);
  gz2.end(data);
});
await pDone;
check('gzip-pipe-gunzip', () => Buffer.concat(pout).equals(data) ? 'ok' : 'mismatch');

// 6. Unzip auto-detect on gzip bytes
const uchunks = [];
const uDone = new Promise((res, rej) => {
  const u = zlib.createUnzip();
  u.on('data', (c) => uchunks.push(c));
  u.on('end', res); u.on('error', rej);
  u.end(gz);
});
await uDone;
check('createUnzip-autodetect', () => Buffer.concat(uchunks).equals(data) ? 'ok' : 'mismatch');

// 7. corrupt input must throw
check('garbage-throws', () => { try { zlib.gunzipSync(Buffer.from('not gzip at all')); return 'no-throw(bad)'; } catch (e) { return 'threw:' + (e.code || e.message.slice(0, 30)); } });

// 8. dictionary roundtrip (zlib format)
const dict = Buffer.from('opencontainer dictionary bytes');
const withDict = zlib.deflateSync(data, { dictionary: dict });
check('deflate-dictionary', () => zlib.inflateSync(withDict, { dictionary: dict }).equals(data) ? 'ok' : 'mismatch');

// 9. gzip trailer byte-compat marker (host re-verifies the actual bytes)
console.log('ZLIB-CHECKS-START');
for (const line of out) console.log(line);
console.log('ZLIB-GZ-B64:' + gbuf.toString('base64'));
console.log('ZLIB-CHECKS-END');
})();
`;

async function main() {
  let stdout = '';
  let stderr = '';
  const kernel = await bootKernel({
    store: diskStore as any,
    argv: ['node', '/home/project/zcheck.js'],
    hooks: {
      onExit() { /* observed below */ },
      onStdio(fd: 1 | 2, chunk: any) {
        const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        if (fd === 1) stdout += text; else stderr += text;
      },
      now: () => Date.now(),
      env: () => ({ PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/node', LANG: 'en_US.UTF-8' }),
      initialCwd: '/home/project',
    },
  });
  kernel.vfs.writeFile('/home/project/zcheck.js', CHECKS);
  await kernel.runMain('/home/project/zcheck.js');
  // Pump the guest's tick queue until the async IIFE finishes. The harness
  // deliberately does NOT arm the loop-drain watcher: in a single-process
  // harness the guest's process.exit IS the host's exit — it would kill this
  // test mid-summary. (The browser worker arms the watcher; it only exits
  // the worker there.)
  const deadline = Date.now() + 20000;
  while (!stdout.includes('ZLIB-CHECKS-END') && Date.now() < deadline) {
    try { (globalThis as any).__ocDrainTicks?.(); } catch { /* guest tick error */ }
    await new Promise((r) => setTimeout(r, 25));
  }

  hostErr(stderr.slice(-3000));
  const lines = stdout.split('\n').filter((l) => l.includes('|') || l.startsWith('ZLIB-'));
  const results: Array<[string, boolean, string]> = [];
  for (const line of lines) {
    const [name, status, detail] = line.split('|');
    if (name && status) results.push([name, status === 'PASS', detail ?? '']);
  }
  // Host-side ground truth: kernel-produced gzip must decompress with REAL node zlib.
  const gzB64 = stdout.match(/ZLIB-GZ-B64:(.+)/)?.[1] ?? '';
  let pass = 0;
  for (const [name, ok, detail] of results) {
    hostErr(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
    if (ok) pass++;
  }
  hostErr(`=== zlib kernel-side: ${pass}/${results.length} ===`);
  // Host-side ground truth, fully synchronous: kernel-produced gzip must
  // decompress with the REAL node:zlib.
  if (gzB64.length > 0) {
    try {
      const kernelGz = Buffer.from(gzB64, 'base64');
      const hostGunzip = nodeZlib.gunzipSync(kernelGz);
      const expected = Buffer.from('hello opencontainer zlib ' + 'x'.repeat(70000));
      const ok = hostGunzip.equals(expected);
      hostErr(`${ok ? '✓' : '✗'} host gunzipSync(kernel gzip) — ${kernelGz.length}B gz`);
      if (ok) pass++;
      results.push(['host-gunzip', ok, '']);
    } catch (e: any) {
      hostErr(`✗ host gunzipSync(kernel gzip) — ${e.message}`);
      results.push(['host-gunzip', false, e.message]);
    }
  } else {
    hostErr('✗ host gunzipSync(kernel gzip) — no gzip bytes emitted');
    results.push(['host-gunzip', false, 'no bytes']);
  }
  const total = results.length;
  hostErr(`=== zlib test: ${pass}/${total} ${pass === total ? 'ALL PASS' : 'FAIL'} ===`);
  process.exitCode = pass === total ? 0 : 1;
}

main().catch((e) => { hostErr('FATAL', e); process.exit(1); });
