/**
 * OpenContainer browser E2E harness server.
 *
 * A minimal HOST APP standing in for an embedder — serves the package the
 * SELF-HOSTED way (same-origin /opencontainer/ paths, like an app that
 * passed { assetsBase: '/opencontainer' }):
 *
 *   /                        harness page (xterm + runtime; the library
 *                            registers the preview SW itself at boot)
 *   /opencontainer/*         public/opencontainer/* (worker, SW, runtime blobs)
 *                            — preview-sw.js gets Service-Worker-Allowed: /
 *   /opencontainer.mjs       dist/opencontainer.mjs (the published entry)
 *   /xterm.js|/xterm.css     vendored xterm
 *   /e2e/*                   browser drivers
 *
 *   bun run harness/server.ts   (then http://localhost:7800)
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

const ROOT = nodePath.resolve(import.meta.dir, '..');
const HARNESS = import.meta.dir;
const PORT = Number(process.env.PORT ?? 7800);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gz': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function serveFile(req: Request, path: string, extraHeaders: Record<string, string> = {}): Response | null {
  try {
    const body = nodeFs.readFileSync(path);
    const headers: Record<string, string> = {
      'content-type': MIME[nodePath.extname(path)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
      ...extraHeaders,
    };
    return new Response(body, { status: 200, headers });
  } catch {
    return new Response(`harness: not found (${path})`, { status: 404, headers: { 'content-type': 'text/plain' } });
  }
}

const server = Bun.serve({
  port: PORT,
  async fetch(req): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;

    // ---- the app page + assets ----
    if (p === '/' || p === '/index.html') return serveFile(req, nodePath.join(HARNESS, 'index.html'));
    if (p === '/app.js') return serveFile(req, nodePath.join(HARNESS, 'app.js'));
    if (p === '/xterm.js') return serveFile(req, nodePath.join(HARNESS, 'node_modules/xterm/lib/xterm.js'));
    if (p === '/xterm.css') return serveFile(req, nodePath.join(HARNESS, 'node_modules/xterm/css/xterm.css'));
    if (p === '/opencontainer.mjs') return serveFile(req, nodePath.join(ROOT, 'dist/opencontainer.mjs'));
    if (p.startsWith('/e2e/')) return serveFile(req, nodePath.join(HARNESS, p));
    if (p.startsWith('/opencontainer/')) {
      const rel = p.slice('/opencontainer/'.length);
      const base = nodePath.join(ROOT, 'public/opencontainer', rel);
      // The preview SW is registered with scope '/' — needs the header.
      const extra = rel === 'preview-sw.js' ? { 'service-worker-allowed': '/' } : {};
      return serveFile(req, base, extra);
    }
    return new Response('harness: no route', { status: 404, headers: { 'content-type': 'text/plain' } });
  },
});

console.log(`[harness] http://localhost:${server.port}  (self-hosted /opencontainer assets, preview SW auto-registered by the library)`);
