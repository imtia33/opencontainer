/**
 * OpenContainer — 559-package scale benchmark, BROWSER-FREE (Bun harness).
 *
 * Mirrors the user's WebContainers benchmark: `npm install` of an Expo-sized
 * dependency tree (expo + expo-status-bar + react + react-dom ≈ 550-600
 * packages; WebContainers reports "added 559 packages in 2m").
 *
 * Runs the REAL npm 12.2.1 CLI through the real kernel (same bootKernel the
 * browser worker runs), one kernel, one shared VFS, sequential phases —
 * exactly the browser's install path minus the browser (no tab to crash:
 * the whole point of this harness per the "agent browser will crash"
 * directive).
 *
 * --ignore-scripts: postinstall children need a second kernel, and kernels
 * are globalThis-scoped (one live kernel per isolate — see boot.ts g2.*
 * assignments), so children can't run beside npm here. The browser runtime
 * runs them as fresh workers (runtime.ts onChildSpawn); this benchmark
 * isolates the KERNEL-layer cost: registry metadata + tarball fetch +
 * gunzip + extraction + VFS writes + lockfile, i.e. everything but
 * postinstall scripts.
 *
 * Reports: wall time per phase, RSS trajectory + peak, final tree stats,
 * npm's own "added N packages in Xs" summary.
 *
 *   bun run scripts/test-npm-scale.ts [packages...]   (default: expo set)
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { bootKernel } from '../src/packages/opencontainer/kernel/boot';

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

// ---- RSS sampler (Bun): peak + trajectory ---------------------------------
// Prints each sample INCREMENTALLY so an OOM kill still leaves the curve.
const rssSamples: Array<{ t: number; rss: number }> = [];
let sampling = true;
const tStart = Date.now();
const rssLoop = setInterval(() => {
  try {
    const rss = process.memoryUsage().rss;
    rssSamples.push({ t: Date.now(), rss });
    hostErr(`[rss] t=${Math.round((Date.now() - tStart) / 1000)}s rss=${Math.round(rss / 1048576)}MB`);
  } catch { /* noop */ }
}, 5000);
rssLoop.unref?.();

async function runNpmPhase(
  vfs: any,
  argv: string[],
  mainPath: string,
  label: string,
  timeoutMs = 1_800_000,
): Promise<{ res: BootResult; kernel: any }> {
  let stdout = '';
  let stderr = '';
  let exitResolve!: (c: number | null) => void;
  const exited = new Promise<number | null>((r) => { exitResolve = r; });
  const ESM_TMP = '/tmp/oc-esm-scale';
  const t0 = Date.now();
  const kernel = await bootKernel({
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
  if (!vfs) {
    const mounted = mountNpm(kernel);
    hostErr(`--- mounted npm tree: ${mounted} files ---`);
  }
  await kernel.runMain(mainPath);
  const exitCode = await Promise.race([
    exited,
    new Promise<number | null>((r) => setTimeout(() => r(null), timeoutMs)),
  ]);
  await new Promise((r) => setTimeout(r, 300));
  const res = { exitCode, stdout, stderr };
  hostErr(`--- [${label}] exit=${exitCode} ${((Date.now() - t0) / 1000).toFixed(1)}s ---`);
  return { res, kernel };
}

function summarizeMem(): { peakRssMb: number; finalRssMb: number; startRssMb: number } {
  const vals = rssSamples.map((s) => s.rss);
  return {
    startRssMb: Math.round((vals[0] ?? 0) / 1048576),
    peakRssMb: Math.round(Math.max(...vals, 0) / 1048576),
    finalRssMb: Math.round((vals[vals.length - 1] ?? 0) / 1048576),
  };
}

async function main() {
  const NativeDS = (globalThis as any).DecompressionStream;
  (globalThis as any).__ocHostGunzip = async (gz: Uint8Array): Promise<Uint8Array> => {
    const stream = new Response(gz as any).body!.pipeThrough(new NativeDS('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
  (globalThis as any).__ocUncaught = (err: any, pt: any) =>
    hostErr(`[uncaught${pt ? ' (promise)' : ''}]`, err?.stack ?? String(err));

  const pkgs = process.argv.slice(2);
  const installArgs = pkgs.length > 0 ? pkgs : ['expo', 'expo-status-bar', 'react', 'react-dom'];
  hostErr(`=== SCALE BENCHMARK: npm install ${installArgs.join(' ')} --ignore-scripts ===`);
  hostErr(`    (WebContainers baseline: create-expo-app + npm install = 559 pkgs in ~2m30s total)`);

  const tAll = Date.now();

  // Phase 1: npm init -y
  let vfs: any = undefined;
  const p1 = await runNpmPhase(vfs, [NPM_CLI, 'init', '-y'], NPM_CLI, 'npm init -y', 120_000);
  vfs = p1.kernel.vfs;
  if (p1.res.exitCode !== 0) {
    hostErr('npm init failed:\n' + p1.res.stderr.slice(-1500));
    process.exit(1);
  }

  // Phase 2: THE scale install
  const p2 = await runNpmPhase(
    vfs,
    [NPM_CLI, 'install', ...installArgs, '--ignore-scripts'],
    NPM_CLI,
    `npm install ${installArgs.join(' ')} (scale)`,
    1_800_000,
  );
  sampling = false;
  clearInterval(rssLoop);

  const mem = summarizeMem();
  const summaryLine = (p2.res.stdout + p2.res.stderr).match(/added \d+ packages? in \d+[sm]*/);

  // Tree stats
  let pkgCount = 0;
  let fileCount = 0;
  let byteTotal = 0;
  try {
    const nm = vfs.readdir('/home/project/node_modules');
    pkgCount = nm.length;
    const stack = ['/home/project/node_modules'];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const e of vfs.readdir(dir)) {
        const p = `${dir}/${e}`;
        const st = vfs.stat(p);
        if ((st.mode & 0o170000) === 0o040000) stack.push(p);
        else if ((st.mode & 0o170000) === 0o100000) { fileCount++; byteTotal += Number(st.size); }
      }
    }
  } catch (e) { hostErr('tree walk failed: ' + e); }

  const keyOk = ['expo', 'react', 'react-dom', 'expo-status-bar'].every((k) =>
    vfs.isDirectory(`/home/project/node_modules/${k}`));

  hostErr('\n=================== SCALE RESULTS ===================');
  hostErr(`install exit:        ${p2.res.exitCode}`);
  hostErr(`npm's own summary:   ${summaryLine ? summaryLine[0] : '(not found — see stderr tail)'}`);
  hostErr(`wall (init+install): ${((Date.now() - tAll) / 1000).toFixed(1)}s total`);
  hostErr(`node_modules pkgs:   ${pkgCount}`);
  hostErr(`files under nm:      ${fileCount} (${(byteTotal / 1048576).toFixed(1)} MB)`);
  hostErr(`key packages present: ${keyOk ? 'YES (expo/react/react-dom/expo-status-bar)' : 'NO'}`);
  hostErr(`RSS: start ${mem.startRssMb}MB → peak ${mem.peakRssMb}MB → final ${mem.finalRssMb}MB`);
  hostErr('====================================================');
  if (p2.res.exitCode !== 0) {
    hostErr('\nSTDERR tail:\n' + p2.res.stderr.slice(-3000));
    // npm debug log for diagnosis
    try {
      const logDir = '/home/node/.npm/_logs';
      const logs = vfs.readdir(logDir);
      const last = logs.filter((l: string) => l.endsWith('-debug-0.log')).sort().pop();
      if (last) {
        const text = new TextDecoder().decode(vfs.readFile(`${logDir}/${last}`));
        hostErr(`\n--- npm debug log tail ---\n${text.slice(-3000)}`);
      }
    } catch { /* noop */ }
    process.exit(1);
  }
  hostLog(`SCALE_OK packages=${pkgCount} files=${fileCount} peakRSS=${mem.peakRssMb}MB`);
  process.exit(0);
}

main().catch((e) => { hostErr('FATAL', e); process.exit(1); });
