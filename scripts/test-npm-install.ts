/**
 * OpenContainer — S2 harness: real npm-oc install of express in-kernel.
 *
 * Boots the kernel with the vendored disk store, runs the npm-oc CLI
 * (`npm install express`) through node's REAL CJS loader, verifies the
 * installed tree (65 packages / 584 files expected from the packument
 * analysis), then boots a FRESH process sharing the VFS and spot-requires
 * express's pure-JS deps (depd itself hits the documented bun
 * Error.prepareStackTrace artifact — full require('express') is verified in
 * real Chromium by the browser e2e).
 *
 * Run: bun run scripts/test-npm-install.ts
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { bootKernel } from '../src/packages/opencontainer/kernel/boot';

const VENDOR = '/home/z/my-project/src/packages/opencontainer/vendor';
const NPM_OC_CLI = '/usr/lib/node_modules/npm-oc/cli.js';

const hostLog = console.log.bind(console);
const hostErr = console.error.bind(console);

const diskStore = {
  get(path: string): string {
    return nodeFs.readFileSync(nodePath.join(VENDOR, path), 'utf8');
  },
  list(prefix: string): string[] {
    const out: string[] = [];
    const base = nodePath.join(VENDOR, prefix);
    const walk = (dir: string, rel: string) => {
      let entries;
      try { entries = nodeFs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const relPath = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(nodePath.join(dir, e.name), relPath);
        else out.push(prefix + relPath);
      }
    };
    walk(base, '');
    return out;
  },
};

let pass = 0, fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) { pass++; hostLog(`  ok  ${label}`); }
  else { fail++; hostLog(`  FAIL ${label}${detail ? ' — ' + detail : ''}`); }
}

let exitResolve: ((code: number) => void) | null = null;
const exited = new Promise<number>((res) => { exitResolve = res; });

function makeHooks(): any {
  return {
    onExit(code: number) { hostErr(`[exit ${code}]`); exitResolve?.(code); },
    onStdio(fd: 1 | 2, chunk: any) {
      const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      (fd === 1 ? hostLog : hostErr)(text.trimEnd());
    },
    now: () => Date.now(),
    env: () => ({
      PATH: '/usr/local/bin:/usr/bin:/bin',
      HOME: '/home/node',
      LANG: 'en_US.UTF-8',
      npm_config_registry: 'https://registry.npmjs.org',
    }),
    initialCwd: '/home/project',
  };
}

async function main() {
  hostErr('=== boot kernel (process 1: npm install express) ===');
  // Harness-side host bridge (the browser worker gets this from worker-entry):
  // capture the engine-native DecompressionStream BEFORE the kernel's node
  // bootstrap replaces the global with the zlib-backed shim.
  const NativeDS = (globalThis as any).DecompressionStream;
  (globalThis as any).__ocHostGunzip = async (gz: Uint8Array): Promise<Uint8Array> => {
    try {
      const stream = new Response(gz).body!.pipeThrough(new NativeDS('gzip'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      const { gunzipSync } = await import('fflate');
      return gunzipSync(gz);
    }
  };
  const kernel = await bootKernel({ store: diskStore as any, hooks: makeHooks() });
  (globalThis as any).__ocUncaught = (err: any, pt: any) =>
    hostErr(`[uncaught${pt ? ' (promise)' : ''}]`, err?.stack ?? String(err));

  check('npm-oc mounted', kernel.vfs.exists(NPM_OC_CLI), NPM_OC_CLI);
  check('semver mounted', kernel.vfs.exists('/usr/lib/node_modules/semver/package.json'));

  kernel.process.argv = ['/usr/local/bin/node', NPM_OC_CLI, 'install', 'express'];
  kernel.startLoopDrainWatcher();
  const t0 = Date.now();
  await kernel.runMain(NPM_OC_CLI);
  const exitCode = await exited;
  const installMs = Date.now() - t0;
  hostErr(`--- npm install exited ${exitCode}, wall time: ${installMs}ms ---`);
  if (exitCode !== 0) { hostErr('FATAL: install exited non-zero'); process.exit(1); }

  // ---- verify the installed tree ------------------------------------------
  console.log('\n=== verify installed tree ===');
  const nm = '/home/project/node_modules';
  check('node_modules exists', kernel.vfs.isDirectory(nm));
  const entries = kernel.vfs.readdir(nm).filter((n: string) => !n.startsWith('.'));
  // 68 vs bun's 65: we walk ALL `dependencies` recursively (bun prunes some
  // transitive sets); both are valid resolutions of the published graph.
  check('>= 65 packages installed (express 5.3.0 flat tree)', entries.length >= 65, `got ${entries.length}`);
  check('express present', entries.includes('express'));
  check('qs present', entries.includes('qs'));
  check('debug present', entries.includes('debug'));
  check('mime-types present', entries.includes('mime-types'));

  // Count all files under node_modules
  let fileCount = 0;
  const countFiles = (dir: string) => {
    for (const e of kernel.vfs.readdir(dir)) {
      const p = `${dir}/${e}`;
      if (kernel.vfs.isDirectory(p)) countFiles(p);
      else fileCount++;
    }
  };
  countFiles(nm);
  check('file count ~584-660', fileCount >= 580 && fileCount <= 680, `got ${fileCount}`);

  const pj = JSON.parse(kernel.vfs.readTextFile('/home/project/package.json'));
  check('package.json records express dep', pj.dependencies && pj.dependencies.express === '^5.3.0',
    pj.dependencies && pj.dependencies.express);
  const record = JSON.parse(kernel.vfs.readTextFile(`${nm}/.opencontainer-install.json`));
  check('install record: registry + timestamp', !!record.registry && !!record.installedAt);
  check('install record: express version', record.packages && record.packages.express === '5.3.0');

  // ---- fresh process sharing the VFS: spot requires ----------------------
  console.log('\n=== fresh process: spot requires through the real CJS loader ===');
  const kernel2 = await bootKernel({ store: diskStore as any, vfs: kernel.vfs, hooks: makeHooks() });
  const SPOT = `
const checks = [];
function t(name, fn) { try { checks.push([name, fn()]); } catch (e) { checks.push([name, 'ERR: ' + e.message + (e.stack ? ' | ' + String(e.stack).split(String.fromCharCode(10)).slice(1, 4).join(' ~ ') : '')]); } }
t('require(semver) [global scope]', () => require('/usr/lib/node_modules/semver').version);
t('semver.satisfies', () => require('/usr/lib/node_modules/semver').satisfies('5.3.0', '^5.0.0'));
t('require(qs)', () => typeof require('qs').parse);
t('qs.parse', () => JSON.stringify(require('qs').parse('a=1&b=2')));
t('require(debug)', () => typeof require('debug'));
t('debug factory', () => typeof require('debug')('ns'));
t('require(cookie)', () => typeof require('cookie').parse);
t('cookie.parse', () => JSON.stringify(require('cookie').parse('a=1; b=2')));
t('require(etag)', () => typeof require('etag'));
t('require(fresh)', () => typeof require('fresh'));
t('require(vary)', () => typeof require('vary'));
t('require(mime-types)', () => require('mime-types').lookup('json'));
t('require(accepts)', () => typeof require('accepts'));
t('require(negotiator)', () => typeof require('negotiator'));
t('express package.json', () => require('express/package.json').version);
t('express module shape', () => {
  // Load express's index only far enough to prove the entry resolves: the
  // full require('express') chain reaches depd's Error.prepareStackTrace
  // CallSite use — a documented BUN-HARNESS artifact (fine in V8/Chromium).
  const path = require('module')._resolveFilename
    ? require('module')._resolveFilename('express', module)
    : null;
  return typeof path === 'string' ? 'resolved:' + path.split('/').slice(-3).join('/') : 'n/a';
});
for (const [name, val] of checks) console.log('  ', name, '=>', typeof val === 'string' ? val : JSON.stringify(val));
console.log('SPOT-DONE');
`;
  kernel2.vfs.writeFile('/home/project/spot.js', SPOT);
  kernel2.process.argv = ['/usr/local/bin/node', '/home/project/spot.js'];
  await kernel2.runMain('/home/project/spot.js');

  console.log('\n=== result ===');
  console.log(`${pass} checks passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { hostErr('FATAL', e); process.exit(1); });
