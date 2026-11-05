/**
 * OpenContainer browser E2E harness server.
 *
 * A minimal HOST APP standing in for the lost demo pages — serves the
 * package exactly as an embedder would today (legacy /opencontainer/ paths):
 *
 *   /                        harness page (xterm + runtime + SW glue)
 *   /opencontainer/*         public/opencontainer/* (worker, SW, runtime blobs)
 *                            — preview-sw.js gets Service-Worker-Allowed: /
 *   /opencontainer.mjs       dist/opencontainer.mjs (the published entry)
 *   /xterm.js|/xterm.css     vendored xterm
 *   /e2e/*                   browser drivers
 *   /api/oc-net?u=<enc>      OPTIONAL same-origin registry bridge (allow-list:
 *                            registry.npmjs.org/.com, https-only, anonymous) —
 *                            the reference implementation from bridge/.
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

const ALLOWED_REGISTRY_HOSTS = new Set(['registry.npmjs.org', 'registry.npmjs.com']);

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

    // ---- optional registry bridge (bridge/oc-net.route.ts reference) ----
    if (p === '/api/oc-net') {
      const target = url.searchParams.get('u');
      if (!target) return new Response('missing u', { status: 400 });
      let t: URL;
      try { t = new URL(target); } catch { return new Response('bad url', { status: 400 }); }
      if (t.protocol !== 'https:' || !ALLOWED_REGISTRY_HOSTS.has(t.hostname)) {
        return new Response('bridge: host not allowed', { status: 403 });
      }
      try {
        const upstream = await fetch(t.href, {
          method: req.method,
          headers: {
            accept: req.headers.get('accept') ?? '*/*',
            ...(req.headers.get('accept-encoding') ? { 'accept-encoding': req.headers.get('accept-encoding')! } : {}),
            'user-agent': req.headers.get('user-agent') ?? 'opencontainer-harness',
          },
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
        });
        const headers = new Headers();
        upstream.headers.forEach((v, k) => {
          // bun's fetch already decompressed the body — forwarding
          // content-encoding/content-length would make the browser's fetch
          // decode it a second time.
          if (k !== 'set-cookie' && k !== 'transfer-encoding'
            && k !== 'content-encoding' && k !== 'content-length') headers.set(k, v);
        });
        headers.set('access-control-allow-origin', '*');
        return new Response(upstream.body, { status: upstream.status, headers });
      } catch (e: any) {
        return new Response(`bridge upstream error: ${e?.message ?? e}`, { status: 502 });
      }
    }

    // ---- the app page + assets ----
    if (p === '/' || p === '/index.html') return serveFile(req, nodePath.join(HARNESS, 'index.html'));
    if (p === '/app.js') return serveFile(req, nodePath.join(HARNESS, 'app.js'));
    if (p === '/xterm.js') return serveFile(req, nodePath.join(HARNESS, 'node_modules/xterm/lib/xterm.js'));
    if (p === '/xterm.css') return serveFile(req, nodePath.join(HARNESS, 'node_modules/xterm/css/xterm.css'));
    if (p === '/opencontainer.mjs') return serveFile(req, nodePath.join(ROOT, 'dist/opencontainer.mjs'));
    if (p === '/ide.mjs') return serveFile(req, nodePath.join(ROOT, 'dist/ide.mjs'));
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

console.log(`[harness] http://localhost:${server.port}  (SW scope '/', oc-net bridge on)`);
