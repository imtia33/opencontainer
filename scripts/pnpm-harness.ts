/**
 * OpenContainer — S2 pnpm harness: run the REAL pnpm CLI (10.34.9, vendored
 * unmodified at repo-root vendor/pnpm-10.34.9 — see its .provenance.json)
 * inside the kernel, from the vendored tree mounted into the VFS at
 * /usr/lib/node_modules/pnpm (node's prefix layout).
 *
 *   bun run scripts/pnpm-harness.ts ['pnpm-args...' as one string, default '-v']
 *
 * pnpm >= 11 ships a native binary no browser container can execute (its own
 * wrapper refuses under WebContainers), so 10.x — the last pure-JS upstream
 * line — is the vendored target. Same kernel code path the browser worker
 * runs; crashes here identify missing binding surface (crash-driven porting).
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { bootKernel } from '../src/packages/opencontainer/kernel/boot';
import type { EsmServing } from '../src/packages/opencontainer/kernel/esm-graph';

const VENDOR = nodePath.resolve(__dirname, '../src/packages/opencontainer/vendor');
const PNPM_VENDOR = nodePath.resolve(__dirname, '../vendor/pnpm-10.34.9');
const PNPM_ROOT = '/usr/lib/node_modules/pnpm';
const CLI = `${PNPM_ROOT}/bin/pnpm.cjs`;

const pnpmArgs = process.argv[2] ?? '-v';

const hostLog = console.log.bind(console);
const hostError = console.error.bind(console);

const diskStore = {
  get(path: string): string {
    return nodeFs.readFileSync(nodePath.join(VENDOR, path), 'utf8');
  },
};

/** Mount the vendored pnpm tree: every TEXT file (UTF-8, no NUL) — mirrors
 *  the OCRT blob's exclusion rules 1:1 (binaries are excluded there too). */
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
        if (relPath === '.provenance.json') continue; // our bookkeeping, not upstream
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
  // Fetch probe: log every outbound request the guest makes (through the
  // kernel's fetch-backed http client) with status/error.
  const rawFetch = globalThis.fetch.bind(globalThis);
  (globalThis as any).fetch = async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    try {
      const res = await rawFetch(input, init);
      hostError(`[fetch] ${init?.method ?? 'GET'} ${url} → ${res.status}`);
      return res;
    } catch (e: any) {
      hostError(`[fetch] ${init?.method ?? 'GET'} ${url} → THREW ${e?.message ?? e}`);
      throw e;
    }
  };
  const ESM_TMP = '/tmp/oc-esm-harness-pnpm';
  nodeFs.rmSync(ESM_TMP, { recursive: true, force: true });
  const fileServing: EsmServing = {
    async publish(nonce: string, entries: Map<string, string>): Promise<void> {
      for (const [p, text] of entries) {
        const real = nodePath.join(ESM_TMP, nonce, p);
        nodeFs.mkdirSync(nodePath.dirname(real), { recursive: true });
        nodeFs.writeFileSync(real, text);
      }
    },
    prefix(nonce: string): string {
      return `file://${ESM_TMP}/${nonce}`;
    },
  };
  const kernel = await bootKernel({
    store: diskStore as any,
    argv: ['node', CLI, ...pnpmArgs.split(' ')],
    hooks: {
      esmServing: fileServing,
      outboundRewrite: (u: string) => u,
      onExit(code) { hostError(`\n[exit ${code}]`); },
      onStdio(fd: 1 | 2, chunk: any) {
        const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        (fd === 1 ? hostLog : hostError)(text.endsWith('\n') ? text.slice(0, -1) : text);
      },
      now: () => Date.now(),
      env: () => ({
        PATH: `${PNPM_ROOT}/bin:/usr/local/bin:/usr/bin:/bin`,
        HOME: '/home/node',
        LANG: 'en_US.UTF-8',
        TERM: 'xterm-256color',
      }),
      initialCwd: '/home/project',
    },
  });
  (globalThis as any).__ocUncaught = (err: any, promiseType: any) => {
    hostError(`\n[uncaught${promiseType ? ' (promise)' : ''}]`, err?.stack ?? String(err));
  };
  // ENOENT probe (see vfs.ts VfsError): every ENOENT with origin stack.
  (globalThis as any).__ocVfsEnoentLog = [];
  // Worker-message probe (see messaging-ports.ts): log the worker protocol.
  (globalThis as any).__ocWorkerMsgDebug = (m: string) => hostError('[wmsg] ' + m);
  const tBoot = Date.now();

  const { files, bytes, skipped } = mountTree(kernel, PNPM_VENDOR, PNPM_ROOT);
  hostError(
    `--- mounted pnpm tree: ${files} files, ${(bytes / 1048576).toFixed(1)}MB (${Date.now() - tBoot}ms) ---`,
  );
  if (skipped.length > 0) {
    hostError(`--- skipped ${skipped.length} binary file(s): ${skipped.join(', ')} ---`);
  }
  kernel.vfs.writeFile('/home/project/package.json', '{"name":"oc-pnpm","version":"1.0.0","private":true}\n');

  hostError(`--- kernel.runMain('${CLI}') argv=${JSON.stringify(kernel.process.argv)} ---`);
  await kernel.runMain(CLI);
  await new Promise((r) => setTimeout(r, 3000));
  // Post-run: dump the store/home tree (silent ENOENT diagnosis — pnpm wraps
  // missing store paths as ERR_PNPM_ENOENT on the tarball write path).
  try {
    const dump = (dir: string, depth = 0): string[] => {
      const out: string[] = [];
      if (depth > 4) return out;
      let entries: string[];
      try { entries = kernel.vfs.readdir(dir); } catch { return out; }
      for (const e of entries.slice(0, 30)) {
        const p = `${dir}/${e}`;
        out.push('  '.repeat(depth) + e);
        try { if (kernel.vfs.stat(p).mode! & 0o040000) out.push(...dump(p, depth + 1)); } catch { /* skip */ }
      }
      return out;
    };
    hostError('--- /home/project tree ---\n' + dump('/home/project', 0).slice(0, 40).join('\n'));
    hostError('--- /home/node tree ---\n' + dump('/home/node').join('\n'));
    hostError('--- /tmp tree ---\n' + dump('/tmp').join('\n'));
  } catch (e: any) {
    hostError(`--- tree dump failed: ${e?.message ?? e} ---`);
  }
  const enoentLog: any[] = (globalThis as any).__ocVfsEnoentLog ?? [];
  hostError(`--- ENOENT log (${enoentLog.length}) ---`);
  for (const e of enoentLog.slice(-25)) {
    hostError(`  ${e.syscall} ${e.path}\n    ${e.stack}`);
  }
  hostError(`\n--- total ${Date.now() - t0}ms ---`);
}

main().catch((err) => {
  hostError('\n=== KERNEL BOOT/RUN FAILURE ===');
  hostError(err && err.stack ? err.stack : err);
  process.exit(1);
});
