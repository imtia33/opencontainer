/**
 * Phase-1c browser capability experiments for the OpenContainer preview design.
 *
 *   E1  A cross-origin iframe CAN register a ServiceWorker on its own origin
 *       (the CDN "bridge page" linchpin).
 *   E2  register(url, {scope}) with a scope WIDER than the script dir fails
 *       without a Service-Worker-Allowed header (confirms the scope rule).
 *   E3  A ROOT-scope SW can bind port routing per-client: navigate to
 *       /p/<port>/... once, then absolute-path asset requests (/app.js),
 *       fetch() calls and client-side routed reloads all stay routed to the
 *       right virtual port via event.clientId / event.resultingClientId.
 *   E4  Same as E3 but the iframe carries Amplify's exact sandbox attribute.
 *
 * Run:  node harness/e2e/preview/sw-experiments.mjs
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** Origin A = "consumer" (127.0.0.1:8090). Origin B = "CDN stand-in" (127.0.0.1:8091). */
function serve(port, originRole, extra = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    let p = url.pathname;
    if (p === '/') p = '/index.html';

    if (originRole === 'cdn' && (p === '/sw.js' || p === '/pkg/sw.js')) {
      res.writeHead(200, { 'content-type': MIME['.js'], ...extra.swHeaders });
      res.end(readFileSync(path.join(dir, 'cdn-sw.js'), 'utf8'));
      return;
    }
    if (originRole === 'consumer' && p === '/sw.js') {
      res.writeHead(200, { 'content-type': MIME['.js'] });
      res.end(readFileSync(path.join(dir, 'consumer-sw.js'), 'utf8'));
      return;
    }
    if (originRole === 'cdn' && p === '/host.html') {
      res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
      res.end(readFileSync(path.join(dir, 'host.html'), 'utf8'));
      return;
    }

    try {
      const file = path.join(dir, path.basename(p));
      const body = readFileSync(file, 'utf8');
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] ?? 'text/plain',
        'cache-control': 'no-store',
        ...extra.staticHeaders,
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(`not found: ${p}`);
    }
  });
  server.listen(port, '127.0.0.1');
  return server;
}

serve(8090, 'consumer'); // Origin A
serve(8091, 'cdn');      // Origin B
console.log('consumer: http://127.0.0.1:8090/x/parent.html');
console.log('cdn:      http://127.0.0.1:8091/host.html');
