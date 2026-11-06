/**
 * OpenContainer — S2 npm harness: run the REAL npm CLI (12.2.1, vendored
 * unmodified at repo-root vendor/npm-12.2.1 — see its .provenance.json)
 * inside the kernel, from the vendored tree mounted into the VFS at
 * /usr/lib/node_modules/npm (node's prefix layout).
 *
 *   bun run scripts/npm-harness.ts ['npm-args...' as one string, default '-v']
 *
 * This is the same kernel code path the browser worker runs. Crashes here
 * identify the exact missing binding surface for npm (crash-driven porting).
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { bootKernel } from '../src/packages/opencontainer/kernel/boot';
import type { EsmServing } from '../src/packages/opencontainer/kernel/esm-graph';

const VENDOR = nodePath.resolve(__dirname, '../src/packages/opencontainer/vendor');
const NPM_VENDOR = nodePath.resolve(__dirname, '../vendor/npm-12.2.1');
const NPM_ROOT = '/usr/lib/node_modules/npm';
const CLI = `${NPM_ROOT}/bin/npm-cli.js`;

const npmArgs = process.argv[2] ?? '-v';

const hostLog = console.log.bind(console);
const hostError = console.error.bind(console);

const diskStore = {
  get(path: string): string {
    return nodeFs.readFileSync(nodePath.join(VENDOR, path), 'utf8');
  },
};

/**
 * Text extensions we mount — every extension present in the upstream npm
 * 12.2.1 tarball tree is text, so ALL of them are listed (js/json/md/docs
 * html, man pages .1/.5/.7, node-gyp's gyp tooling .py/.cc/.gypi/.ninja/
 * .toml/.yml/.typed/.cs/.bnf, shells .sh/.cmd/.bat/.fish/.ps1, LICENSE.*
 * variants, .mts/.cts decls). Extensionless files (LICENSE, AUTHORS, ...) are
 * text too and get mounted. The tree's single binary (a PNG in
 * node_modules/qrcode-terminal/example/) is rejected by the NUL-byte guard —
 * the same file the OCRT npm blob excludes. Mirrors the blob 1:1 (1941 files).
 */
const TEXT_EXT = new Set([
  '.js', '.cjs', '.mjs', '.json', '.md', '.txt', '.ts',
  '.html', '.py', '.mts', '.cts', '.cc', '.yml', '.typed', '.toml',
  '.ninja', '.gypi', '.fish', '.cs', '.bnf', '.bat', '.cmd', '.sh', '.ps1',
  '.1', '.5', '.7', '.BSD', '.APACHE',
]);

function mountTree(
  kernel: any,
  srcDir: string,
  destRoot: string,
): { files: number; bytes: number; skipped: string[] } {
  let files = 0;
  let bytes = 0;
  const skipped: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of nodeFs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        kernel.vfs.mkdir(`${destRoot}/${relPath}`, true);
        walk(nodePath.join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        if (relPath === '.provenance.json') continue; // our bookkeeping file, not upstream npm
        const ext = nodePath.extname(entry.name);
        if (ext !== '' && !TEXT_EXT.has(ext)) {
          skipped.push(relPath);
          continue;
        }
        const buf = nodeFs.readFileSync(nodePath.join(dir, entry.name));
        if (buf.includes(0)) {
          skipped.push(relPath); // binary — the OCRT blob excludes it too
          continue;
        }
        kernel.vfs.writeFile(`${destRoot}/${relPath}`, buf.toString('utf8'));
        files++;
        bytes += buf.length;
      }
    }
  };
  kernel.vfs.mkdir(destRoot, true);
  walk(srcDir, '');
  return { files, bytes, skipped };
}

async function main() {
  const t0 = Date.now();
  // file://-backed ESM transport (harness twin of the browser /oc-esm one):
  // guest CJS dynamic import() — npm's display.js `await import('chalk')` —
  // routes through the kernel ESM graph importer, never the host resolver.
  const ESM_TMP = '/tmp/oc-esm-harness';
  nodeFs.rmSync(ESM_TMP, { recursive: true, force: true });
  const fileServing: EsmServing = {
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
  };
  const kernel = await bootKernel({
    store: diskStore as any,
    argv: ['node', CLI, ...npmArgs.split(' ')],
    hooks: {
      esmServing: fileServing,
      // bun harness: no /api/oc-net bridge — fetch the registry directly
      // (no CORS outside browsers). The browser worker passes the bridge.
      outboundRewrite: (u: string) => u,
      onExit(code) { hostError(`\n[exit ${code}]`); },
      onStdio(fd: 1 | 2, chunk: any) {
        const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        (fd === 1 ? hostLog : hostError)(text.endsWith('\n') ? text.slice(0, -1) : text);
      },
      now: () => Date.now(),
      env: () => ({
        PATH: `${NPM_ROOT}/bin:/usr/local/bin:/usr/bin:/bin`,
        HOME: '/home/node',
        LANG: 'en_US.UTF-8',
        TERM: 'xterm-256color',
        npm_config_loglevel: 'notice',
      }),
      initialCwd: '/home/project',
    },
  });
  (globalThis as any).__ocDumpExit = (err: any) => {
    hostError('[npm exit-handler err]', err && (err.stack || err.message || String(err)));
    if (err && err.cause) hostError('[cause]', err.cause && (err.cause.stack || err.cause.message || String(err.cause)));
  };
  (globalThis as any).__ocUrlDebug = (d: any) => hostError('[url-debug]', JSON.stringify(d));
  (globalThis as any).__ocUncaught = (err: any, promiseType: any) => {
    hostError(`\n[uncaught${promiseType ? ' (promise)' : ''}]`, err?.stack ?? String(err));
  };
  const tBoot = Date.now();

  const { files, bytes, skipped } = mountTree(kernel, NPM_VENDOR, NPM_ROOT);
  hostError(
    `--- mounted npm tree: ${files} files, ${(bytes / 1048576).toFixed(1)}MB (${Date.now() - tBoot}ms) ---`,
  );
  if (skipped.length > 0) {
    hostError(`--- skipped ${skipped.length} non-text file(s): ${skipped.join(', ')} ---`);
  }
  // Minimal project package.json so npm treats /home/project as a project dir.
  kernel.vfs.writeFile('/home/project/package.json', '{"name":"oc-s2","version":"1.0.0","private":true}\n');

  const anyProc: any = kernel.process;
  const origExit = anyProc.exit;
  anyProc.exit = function (c?: number) {
    hostError('[trace process.exit(' + c + ') from:\n' + new Error('trace').stack);
    return origExit.call(this, c);
  };
  anyProc.on('exit', (c: number) => hostError('[trace exit event code=' + c + ']'));
  hostError(`--- kernel.runMain('${CLI}') argv=${JSON.stringify(kernel.process.argv)} ---`);
  await kernel.runMain(CLI);
  await new Promise((r) => setTimeout(r, 3000));
  // Dump npm's own debug log from the guest VFS (silent exit-1 diagnosis).
  try {
    const logDir = '/home/node/.npm/_logs';
    const logs = kernel.vfs.readdir(logDir);
    const last = logs.filter((l: string) => l.endsWith('-debug-0.log')).sort().pop();
    if (last) {
      const text = new TextDecoder().decode(kernel.vfs.readFile(`${logDir}/${last}`));
      hostError(`\n--- npm debug log (${last}) tail ---\n${text.slice(-4000)}`);
    } else {
      hostError(`\n--- no npm debug logs (${logs.join(', ') || 'none'}) ---`);
    }
  } catch (e: any) {
    hostError(`\n--- log dump failed: ${e?.message ?? e} ---`);
  }
  hostError(`\n--- total ${Date.now() - t0}ms ---`);
}

main().catch((err) => {
  hostError('\n=== KERNEL BOOT/RUN FAILURE ===');
  hostError(err && err.stack ? err.stack : err);
  process.exit(1);
});
// --- post-run: dump npm's own debug log from the guest VFS ---
