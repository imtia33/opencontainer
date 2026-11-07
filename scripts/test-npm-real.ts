/**
 * OpenContainer — REAL npm CLI end-to-end test (genuine upstream npm 12.2.1).
 *
 * Test-2 matrix from the project spec, through the REAL npm CLI mounted at
 * /usr/lib/node_modules/npm (the same blob the browser serves):
 *
 *   npm init -y                → package.json created by the real CLI
 *   npm install lodash         → real registry fetch, real tarball extraction
 *   npm ls --depth=0           → lodash@4 listed by the real CLI
 *   node check.js              → require('lodash').chunk works (fresh process)
 *
 * One kernel boot per command (mirrors the browser process model: one worker
 * per process) with the SAME VFS object threaded through, so state carries
 * exactly like guest-to-guest in the browser runtime.
 *
 * Run: bun run scripts/test-npm-real.ts
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { bootKernel } from '../src/packages/opencontainer/kernel/boot';
import { nativeCoreOpt } from './native-core-loader';

const VENDOR = nodePath.resolve(__dirname, '../src/packages/opencontainer/vendor');
const NPM_VENDOR = nodePath.resolve(__dirname, '../vendor/npm-12.2.1');
const NPM_ROOT = '/usr/lib/node_modules/npm';
const NPM_CLI = `${NPM_ROOT}/bin/npm-cli.js`;

const hostLog = console.log.bind(console);
const hostErr = console.error.bind(console);

const diskStore = {
  get(path: string): string {
    return nodeFs.readFileSync(nodePath.join(VENDOR, path), 'utf8');
  },
};

// Same text-extension policy as the OCRT blob (mirrors npm-harness.ts).
const TEXT_EXT = new Set([
  '.js', '.cjs', '.mjs', '.json', '.md', '.txt', '.ts',
  '.html', '.py', '.mts', '.cts', '.cc', '.yml', '.typed', '.toml',
  '.ninja', '.gypi', '.fish', '.cs', '.bnf', '.bat', '.cmd', '.sh', '.ps1',
  '.1', '.5', '.7', '.BSD', '.APACHE',
]);

function mountNpm(kernel: any): number {
  let files = 0;
  const walk = (dir: string, rel: string) => {
    for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        kernel.vfs.mkdir(`${NPM_ROOT}/${relPath}`, true);
        walk(nodePath.join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        if (relPath === '.provenance.json') continue;
        const ext = nodePath.extname(entry.name);
        if (ext !== '' && !TEXT_EXT.has(ext)) continue;
        const buf = nodeFs.readFileSync(nodePath.join(dir, entry.name));
        if (buf.includes(0)) continue;
        kernel.vfs.writeFile(`${NPM_ROOT}/${relPath}`, buf.toString('utf8'));
        files++;
      }
    }
  };
  kernel.vfs.mkdir(NPM_ROOT, true);
  walk(NPM_VENDOR, '');
  return files;
}

interface BootResult { exitCode: number | null; stdout: string; stderr: string }

async function runNpm(
  vfs: any,
  argv: string[],
  mainPath: string,
  label: string,
): Promise<{ res: BootResult; kernel: any }> {
  let stdout = '';
  let stderr = '';
  let exitResolve: (c: number | null) => void;
  const exited = new Promise<number | null>((r) => { exitResolve = r; });
  // file://-backed ESM transport + identity rewrite (harness twins of the
  // browser /oc-esm transport and the optional /api/oc-net bridge).
  const ESM_TMP = '/tmp/oc-esm-realtest';
  const kernel = await bootKernel({
    nativeCore: nativeCoreOpt(),
    store: diskStore as any,
    vfs,
    argv: ['node', ...argv],
    hooks: {
      esmServing: {
        async serve(nonce: string, entries: Map<string, string>): Promise<Map<string, string>> {
          const urls = new Map<string, string>();
          for (const [p, text] of entries) {
            const real = nodePath.join(ESM_TMP, nonce, p);
            nodeFs.mkdirSync(nodePath.dirname(real), { recursive: true });
            nodeFs.writeFileSync(real, text);
            urls.set(p, `file://${real}`);
          }
          return urls;
        },
      },
      outboundRewrite: (u: string) => u,
      onExit(code: number) { exitResolve(code ?? 0); },
      onStdio(fd: 1 | 2, chunk: any) {
        const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        if (fd === 1) stdout += text; else stderr += text;
      },
      now: () => Date.now(),
      env: () => ({
        PATH: `${NPM_ROOT}/bin:/usr/local/bin:/usr/bin:/bin`,
        HOME: '/home/node',
        LANG: 'en_US.UTF-8',
        TERM: 'xterm-256color',
        npm_config_registry: 'https://registry.npmjs.org',
        npm_config_loglevel: 'notice',
      }),
      initialCwd: '/home/project',
    },
  });
  const t0 = Date.now();
  if (!vfs) {
    const mounted = mountNpm(kernel);
    hostErr(`--- mounted npm tree: ${mounted} files ---`);
  }
  await kernel.runMain(mainPath);
  // Give the exit event + loop drain a moment (same discipline as npm-harness).
  const exitCode = await Promise.race([
    exited,
    new Promise<number | null>((r) => setTimeout(() => r(null), 90_000)),
  ]);
  await new Promise((r) => setTimeout(r, 300));
  const res = { exitCode, stdout, stderr };
  hostErr(`--- [${label}] exit=${exitCode} ${(Date.now() - t0)}ms ---`);
  return { res, kernel };
}

const results: Array<[string, boolean, string]> = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push([name, ok, String(detail).slice(0, 200)]);
  hostLog(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${String(detail).slice(0, 120)}` : ''}`);
};

async function main() {
  // Host gunzip bridge (kernel global replacement safety — same as npm-harness).
  const NativeDS = (globalThis as any).DecompressionStream;
  (globalThis as any).__ocHostGunzip = async (gz: Uint8Array): Promise<Uint8Array> => {
    const stream = new Response(gz as any).body!.pipeThrough(new NativeDS('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
  (globalThis as any).__ocUncaught = (err: any, pt: any) =>
    hostErr(`[uncaught${pt ? ' (promise)' : ''}]`, err?.stack ?? String(err));

  // ---- process 1: npm init -y (empty project dir) -------------------------
  const dumpNpmLog = (v: any, label: string) => {
    try {
      const logDir = '/home/node/.npm/_logs';
      const logs = v.readdir(logDir);
      const last = logs.filter((l: string) => l.endsWith('-debug-0.log')).sort().pop();
      if (last) {
        const text = new TextDecoder().decode(v.readFile(`${logDir}/${last}`));
        hostErr(`\n--- [${label}] npm debug log tail ---\n${text.slice(-2500)}`);
      }
    } catch { /* noop */ }
  };
  let vfs: any = undefined; // first boot creates it
  const p1 = await runNpm(vfs, [NPM_CLI, 'init', '-y'], NPM_CLI, 'npm init -y');
  vfs = p1.kernel.vfs;
  const pj1 = vfs.exists('/home/project/package.json')
    ? JSON.parse(vfs.readTextFile('/home/project/package.json'))
    : null;
  check('npm init -y exit 0', p1.res.exitCode === 0, `exit=${p1.res.exitCode}`);
  if (p1.res.exitCode !== 0) {
    hostErr(`[init stdout] ${p1.res.stdout.slice(-800)}\n[init stderr] ${p1.res.stderr.slice(-800)}`);
    dumpNpmLog(p1.kernel.vfs, 'init');
  }
  check('package.json created by real CLI', !!pj1, pj1 ? `name=${pj1.name}` : 'missing');
  check('Wrote to stdout', /Wrote to|package.json/i.test(p1.res.stdout), p1.res.stdout.trim().split('\n').slice(-2).join(' | '));

  // ---- process 2: npm install lodash (REAL registry) ----------------------
  const p2 = await runNpm(vfs, [NPM_CLI, 'install', 'lodash', '--no-audit', '--no-fund'], NPM_CLI, 'npm install lodash');
  check('npm install exit 0', p2.res.exitCode === 0, `exit=${p2.res.exitCode}`);
  check('node_modules/lodash installed', vfs.isDirectory('/home/project/node_modules/lodash'));
  const lodashPkg = vfs.exists('/home/project/node_modules/lodash/package.json')
    ? JSON.parse(vfs.readTextFile('/home/project/node_modules/lodash/package.json'))
    : null;
  check('lodash package.json readable', !!lodashPkg && !!lodashPkg.version, lodashPkg?.version ?? 'missing');
  const pj2 = JSON.parse(vfs.readTextFile('/home/project/package.json'));
  check('package.json records lodash dep', pj2.dependencies?.lodash === `^${lodashPkg?.version}`, pj2.dependencies?.lodash);
  check('package-lock.json written', vfs.exists('/home/project/package-lock.json'));

  // ---- process 3: npm ls --depth=0 ----------------------------------------
  const p3 = await runNpm(vfs, [NPM_CLI, 'ls', '--depth=0'], NPM_CLI, 'npm ls --depth=0');
  check('npm ls exit 0', p3.res.exitCode === 0, `exit=${p3.res.exitCode}`);
  check('npm ls lists lodash', new RegExp(`lodash@${lodashPkg?.version}`).test(p3.res.stdout), p3.res.stdout.trim().split('\n').slice(-2).join(' | '));

  // ---- process 4: fresh process requires lodash ---------------------------
  vfs.writeFile('/home/project/check.js',
    "const _ = require('lodash');\n" +
    "const out = JSON.stringify(_.chunk([1,2,3,4],2));\n" +
    "console.log('CHUNK=' + out);\n" +
    "process.exit(out === '[[1,2],[3,4]]' ? 0 : 3);\n");
  const p4 = await runNpm(vfs, ['/home/project/check.js'], '/home/project/check.js', 'node check.js (require lodash)');
  check('check.js exit 0', p4.res.exitCode === 0, `exit=${p4.res.exitCode}`);
  check("require('lodash').chunk([[1,2],[3,4]])", p4.res.stdout.includes('CHUNK=[[1,2],[3,4]]'), p4.res.stdout.trim().slice(-80));

  // ---- summary -------------------------------------------------------------
  const pass = results.filter(([, ok]) => ok).length;
  hostLog(`\n=== REAL npm test: ${pass}/${results.length} PASS ===`);
  const failed = pass !== results.length;
  if (failed) {
    hostLog('\nSTDOUT dump (install step):\n' + p2.res.stdout.slice(-2000));
    hostLog('\nSTDERR dump (install step):\n' + p2.res.stderr.slice(-2000));
    dumpNpmLog(vfs, 'install');
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { hostErr('FATAL', e); process.exit(1); });
