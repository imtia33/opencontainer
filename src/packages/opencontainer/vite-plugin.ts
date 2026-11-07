/**
 * opencontainer/vite — zero-setup preview for Vite apps.
 *
 * One line in vite.config.js unlocks full-fidelity same-tab previews:
 *
 *   import opencontainer from 'opencontainer/vite'
 *   export default { plugins: [opencontainer()] }
 *
 * What it does (and nothing more):
 *   dev:  serves the OpenContainer preview Service Worker at
 *         /preview-sw.js (origin ROOT — the default scope is then '/', the
 *         requirement for routing absolute guest paths like /@vite/client).
 *   build: emits the same file into the build output root, so static
 *         deployments get identical preview behavior.
 *
 * The runtime's boot() finds /preview-sw.js automatically (ladder step 1
 * in registerPreview) — no other configuration exists.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

function swSource(): string {
  // Layouts: dist-plugins/vite.mjs (built), src (dev), or package root.
  const candidates = [
    join(HERE, '..', '..', 'public', 'opencontainer', 'preview-sw.js'),
    join(HERE, '..', 'public', 'opencontainer', 'preview-sw.js'),
    join(HERE, 'public', 'opencontainer', 'preview-sw.js'),
  ];
  for (const p of candidates) {
    try { return readFileSync(p, 'utf8'); } catch { /* try next */ }
  }
  throw new Error(
    '[opencontainer/vite] preview-sw.js not found — the plugin must run from ' +
    'an installed opencontainer package (public/opencontainer/preview-sw.js).');
}

export default function opencontainer() {
  let cachedSw: string | null = null;
  const getSw = () => (cachedSw ??= swSource());
  return {
    name: 'opencontainer',
    enforce: 'pre' as const,
    configureServer(server: any) {
      server.middlewares.use('/preview-sw.js', (_req: any, res: any, next: any) => {
        try {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(getSw());
        } catch (err: any) {
          next(err);
        }
      });
    },
    configurePreviewServer(server: any) {
      server.middlewares.use('/preview-sw.js', (_req: any, res: any, next: any) => {
        try {
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.end(getSw());
        } catch (err: any) {
          next(err);
        }
      });
    },
    generateBundle(_options: any, bundle: Record<string, any>) {
      // Root of the output — the SW's default scope is then '/'.
      bundle['preview-sw.js'] = {
        type: 'asset',
        name: 'preview-sw.js',
        fileName: 'preview-sw.js',
        source: getSw(),
      } as any;
    },
  };
}
