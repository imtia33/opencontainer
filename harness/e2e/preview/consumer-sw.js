/**
 * consumer-sw.js — ROOT-scope preview SW prototype (experiment E3/E4).
 *
 * The mechanism WebContainer buys with per-port SUBDOMAINS (port in the host,
 * clean guest paths, everything under the SW scope by construction):
 * on our own origin we reproduce it with per-CLIENT port binding:
 *
 *   - navigate to /p/<port>/<path>  → bind resultingClientId → port
 *   - every later request from that client (clientId) → route to that port,
 *     with the ORIGINAL absolute guest path (url.pathname) — no rewrites.
 *   - reload / deep-link navigations without the prefix: inherit the port
 *     from the old client (event.clientId → client.url) or the bound map.
 *
 * Responses are synthetic (this is a routing experiment, not the real bridge).
 */
const portByClient = new Map(); // clientId -> guest port

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const NAV_RE = /^\/p\/(\d+)(\/.*)?$/;

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  const navMatch = NAV_RE.exec(url.pathname);
  let port = navMatch ? Number(navMatch[1]) : null;
  let guestPath = navMatch ? (navMatch[2] || '/') : url.pathname + url.search;
  let src = 'prefix';

  if (port == null) {
    if (event.request.mode === 'navigate') {
      const inherited = portByClient.get(event.clientId);
      if (inherited != null) { port = inherited; src = 'inherit:clientId'; }
      else if (event.resultingClientId) { /* hope: inherit via new client below */ }
    } else {
      const byClient = portByClient.get(event.clientId);
      if (byClient != null) { port = byClient; src = 'client'; }
      else {
        const byReferrer = portFromReferrer(event.referrer);
        if (byReferrer != null) { port = byReferrer; src = 'referrer'; }
      }
    }
  }

  if (event.request.mode === 'navigate' && port != null && event.resultingClientId) {
    portByClient.set(event.resultingClientId, port);
  }
  // Navigations initiated by an already-bound document (location.href='/x'):
  // bind the initiating client too so ITS next navigation inherits.
  if (event.request.mode === 'navigate' && port != null && event.clientId) {
    portByClient.set(event.clientId, port);
  }

  if (port == null) return; // not a preview request — pass through

  event.respondWith(respondVirtual(port, guestPath, url.pathname, src, event.request.mode));
});

function portFromReferrer(referrer) {
  if (!referrer) return null;
  try {
    const u = new URL(referrer);
    const m = NAV_RE.exec(u.pathname);
    return m ? Number(m[1]) : null;
  } catch { return null; }
}

function respondVirtual(port, guestPath, rawPath, src, mode) {
  const route = JSON.stringify({ port, guestPath, rawPath, src, mode });
  if (mode === 'navigate') {
    const html = `<!doctype html><html><head><script src="/app.js"></script></head>
<body><div id="route">${route}</div>
<script>
window.addEventListener('load', () => {
  fetch('/data.json').then(r => r.text()).then(async t => {
    const about = await fetch('/about-data').then(r => r.text());
    // client-side routing: pushState then fetch again
    history.pushState({}, '', '/about');
    const afterPush = await fetch('/after-push').then(r => r.text());
    window.parent.postMessage({ type: 'E3_PAGE', route: window.__route, data: t, about, afterPush,
      pushedPath: location.pathname }, '*');
  }).catch(e => window.parent.postMessage({ type: 'E3_PAGE', error: String(e) }, '*'));
});
</script></body></html>`;
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }
  const body = `/*virtual*/\nwindow.__route = ${route};\n`;
  return new Response(body, {
    headers: {
      'content-type': rawPath.endsWith('.json') ? 'application/json' : 'application/javascript',
    },
  });
}
