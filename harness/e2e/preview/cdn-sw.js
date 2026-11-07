/**
 * cdn-sw.js — CDN-origin (package-path-scope) preview SW prototype.
 * Scope will be /pkg/ (script at /pkg/sw.js). Serves /pkg/p/<port>/* pages
 * with RELATIVE asset paths (the only kind that stay under this scope).
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

const NAV_RE = /^\/pkg\/p\/(\d+)(\/.*)?$/;

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const m = NAV_RE.exec(url.pathname);
  if (m && event.request.mode === 'navigate') {
    const port = Number(m[1]);
    const guestPath = (m[2] || '/') + url.search;
    const html = `<!doctype html><html><head><script src="./app.js"></script></head>
<body><div id="cdn-route">port=${port} guest=${guestPath}</div>
<script>
window.addEventListener('load', () => {
  window.parent.postMessage({ type: 'E1_PAGE', port: ${port}, guest: ${JSON.stringify(guestPath)},
    asset: window.__asset ?? null }, '*');
});
</script></body></html>`;
    event.respondWith(new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    return;
  }
  if (m && (url.pathname.endsWith('/app.js'))) {
    event.respondWith(new Response('/*cdn*/\nwindow.__asset = "cdn-app";\n', {
      headers: { 'content-type': 'application/javascript' },
    }));
  }
});
