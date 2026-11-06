/**
 * require(esm) repro — the ESM→CJS transform path (boot.ts require_esm)
 * crashing on real-world graphs: require('chalk') dies in transformEsmToCjs
 * ("Cannot read properties of undefined (reading 'type')", chalk's
 * #ansi-styles/#supports-color package imports). The ESM-entry and
 * dynamic-import() paths are verified (create-vite/create-expo-app E2E).
 *
 *   bun run scripts/test-req-esm.ts
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import { bootKernel } from '/home/z/my-project/opencontainer/src/packages/opencontainer/kernel/boot';
import type { EsmServing } from '/home/z/my-project/opencontainer/src/packages/opencontainer/kernel/esm-graph';

const VENDOR = nodePath.resolve('/home/z/my-project/opencontainer/src/packages/opencontainer/vendor');
const NPM_VENDOR = nodePath.resolve('/home/z/my-project/opencontainer/vendor/npm-12.2.1');
const ESM_TMP = '/tmp/oc-esm-reqtest';
nodeFs.rmSync(ESM_TMP, { recursive: true, force: true });

const diskStore = {
  get(path: string): string { return nodeFs.readFileSync(nodePath.join(VENDOR, path), 'utf8'); },
};

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
  argv: ['node'],
  hooks: {
    esmServing: fileServing,
    onExit(code: number) { console.log(`[exit ${code}]`); },
    onStdio(_fd: 1 | 2, chunk: any) {
      const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      console.log(text.endsWith('\n') ? text.slice(0, -1) : text);
    },
    now: () => Date.now(),
    env: () => ({ PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/node', LANG: 'C', TERM: 'xterm' }),
    initialCwd: '/home/project',
  },
} as any);

const mountDir = (src: string, dest: string) => {
  kernel.vfs.mkdir(dest, true);
  for (const ent of nodeFs.readdirSync(src, { withFileTypes: true })) {
    const real = nodePath.join(src, ent.name);
    const v = `${dest}/${ent.name}`;
    if (ent.isDirectory()) mountDir(real, v);
    else if (/\.(js|cjs|mjs|json)$/.test(ent.name)) kernel.vfs.writeFile(v, nodeFs.readFileSync(real, 'utf8'));
  }
};
mountDir(nodePath.join(NPM_VENDOR, 'node_modules/chalk'), '/usr/lib/node_modules/npm/node_modules/chalk');
mountDir(nodePath.join(NPM_VENDOR, 'node_modules/supports-color'), '/usr/lib/node_modules/npm/node_modules/supports-color');

await kernel.runEval("const c = require('/usr/lib/node_modules/npm/node_modules/chalk'); console.log('REQ-ESM:', typeof c.default, typeof c.blue);");
kernel.startLoopDrainWatcher();
await new Promise((r) => setTimeout(r, 2500));
process.exit(0);
