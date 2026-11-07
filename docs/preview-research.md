# Preview Architecture — Phase 1 Research Findings (empirically verified)

Date: 2026-11-06 · Chromium (agent-browser sandbox) · harness: `harness/e2e/preview/`

## How WebContainers do same-tab preview (verified sources)

From `@webcontainer/api@1.6.1` dist source (`/tmp/wcapidist` tgz) + webcontainers.io API docs:

1. The npm package is a Comlink RPC client. `boot()` creates a hidden iframe to
   `https://webcontainer.io/headless?version=…` (`internal/iframe-url.js`) with
   `allow="cross-origin-isolated"`. The whole runtime — kernel AND preview
   infrastructure — lives on **StackBlitz's own origin**.
2. `server-ready` / `port` events arrive over that RPC channel; the payload
   `url` points at a **vendor-origin subdomain** (`…-5173-….local-credentialless.
   webcontainer-api.io` — exact shape confirmed from Amplify's
   `PreviewsStore.getPreviewId` regex). Consumer does `iframe.src = url`. Done.
3. Because the port lives in the SUBDOMAIN, every guest URL (absolute paths
   included: `/@vite/client`, `/_next/…`) stays inside the SW scope on that
   origin. A Service Worker on the vendor origin ("localservice" — see
   `LOCALSERVICE_RELOAD_WINDOW` in `dist/utils/reload-preview.js`) intercepts
   all fetches and pipes them into the headless runtime.
4. `setPreviewScript(src)` — "Set a custom script to be injected into all
   previews… every page reload will contain the provided script tag on all HTML
   responses" → **the SW rewrites HTML responses** (script injection). This is
   also how `forwardPreviewErrors` / `preview-message` works.
5. Consumers never copy anything: the SW is hosted by the vendor origin, and the
   preview iframe is same-origin with it. HTTPS required (secure context).
6. `coep` boot option: `'none'` only works with a Chromium Origin Trial —
   i.e. without COOP/COEP, StackBlitz needs a browser trial token; normal usage
   is `require-corp` or `credentialless`.

## How Amplify integrates (verified from /tmp/amplify @ a6a51a2)

- `app/lib/stores/previews.ts`: `on('server-ready')` → `broadcastUpdate(url)`;
  `on('port')` → `PreviewInfo{port, ready, baseUrl}`. Preview id extracted via
  `/^https?:\/\/([^.]+)\.local-credentialless\.webcontainer-api\.io/`.
- `app/routes/webcontainer.preview.$id.tsx`: rebuilds the URL as
  `https://${previewId}.local-credentialless.webcontainer-api.io`, sets
  `iframe.src`; refresh = `iframe.src = ''` then back (same URL). iframe attrs:
  `sandbox="allow-scripts allow-forms allow-popups allow-modals
  allow-storage-access-by-user-activation allow-same-origin"`,
  `allow="cross-origin-isolated"`.
- Amplify is a **Vite app** (vite.config.ts, entry.client.tsx) → the
  `opencontainer/vite` plugin integrates natively.
- ⚠ Drop-in divergence: two lines in Amplify hardcode the WebContainer preview
  domain (`getPreviewId` regex + the `$id` route URL template). With
  opencontainer URLs those two lines must be adapted (patch provided in
  COMPATIBILITY.md). Everything else is API-shape identical.

## Browser capability experiments (E1–E4) — results

| # | Question | Result |
|---|---|---|
| E1 | Can a cross-origin (third-party) iframe register a ServiceWorker on its own origin? | **YES** — `register('/pkg/sw.js')` from an iframe on another origin succeeded, `state: activated` |
| E2 | Is `register(url, {scope})` with scope wider than the script dir rejected without `Service-Worker-Allowed`? | **YES** — "The path of the provided scope ('/') is not under the max scope allowed ('/pkg/')" |
| E3 | Root-scope SW + per-CLIENT port binding: does it give WebContainer-subdomain semantics on one origin? | **YES** — navigate `/p/5173/` once; then absolute-path asset `/app.js`, `fetch('/data.json')`, post-pushState `fetch()`, and parent-initiated deep-link reload (`iframe.src='/deep/link?x=1'`, no prefix) ALL routed to port 5173 via `event.clientId` / `event.resultingClientId` |
| E4 | Same with Amplify's exact sandbox attribute | **YES** — `allow-scripts … allow-same-origin` iframe still SW-controlled |

Harness lessons: never `await navigator.serviceWorker.ready` from a page
outside the SW scope (hangs); `body.textContent +=` destroys sibling iframes.

## Consequences for OpenContainer (the design constraints)

1. **SW script must be same-origin with the page that registers it.** blob:/CDN
   scripts can't be registered from the consumer page.
2. **A CDN origin (jsDelivr) can never host a full-fidelity preview SW**: max
   scope = package path → guest absolute paths (`/@vite/client`) escape scope
   → 404. (E2)
3. **Full fidelity needs the SW on the consumer origin at a root-ish scope.**
   With the script served at `/preview-sw.js` (origin root), the default scope
   IS `/` — no `Service-Worker-Allowed` header needed. Subpath-hosted consumers
   work when the app sets its bundler `base` (standard practice).
4. **Per-client port binding (E3) is our equivalent of WebContainer's
   per-port subdomains**: first navigation carries `/p/<port>/`, everything
   after (including absolute paths and reloads) routes by clientId.
5. **A CDN-origin SW is still viable as a zero-integration fallback** (E1) for
   guests that use relative paths — the bridge page relays SW ⇄ parent runtime
   across origins (postMessage + MessagePort transfer).

---

## Session 2026-11-07 — Vite E2E verified; shim+injection bugs fixed; WS-upgrade lifecycle bug isolated

### What was verified E2E (real browser, real vite 7.3.7, real npm)

- `npm install` (vite + oc-compat WASM swaps: esbuild→esbuild-wasm, rollup→@rollup/wasm-node) — exit 0
- `npm run build` (`vite build`) — exit 0, "✓ built in 1.35s" (regression-fixed vs. the Nov-6 state)
- `npm run dev` (`vite dev`) — listens on :5173, `listen` event, port registry
- Zero-config same-tab preview: iframe auto-wired on `listen`, SW-routed `/p/<sid>/<port>/`,
  HTTP 200 for index.html and transformed modules, per-client binding works from inside the iframe
- HMR round 1: host-side source edit → server serves the new module → WS full-reload →
  the preview iframe re-renders the edited content (verified: "EDITED via HMR" in the iframe body)
- Preview shim executes in guest pages (`__ocPreviewShim`, `WebSocket === OCWebSocket`),
  standards mode preserved

### Bugs found & fixed today

1. **`preview-shim.js` source corruption** (syntax errors → shim never executed):
   `frame[maskOffset]` → `frameaskOffset]` (5×, `[m`/`[h` sequences eaten) and a missing `)`
   in the `btoa(String.fromCharCode.apply(...))` line. Fixed; `node --check` clean.
2. **SW HTML injection before `<!doctype`**: vite's minimal index.html has no `<head>`,
   so the old fallback prepended the shim script BEFORE the doctype → quirks mode + Chrome
   drops the leading script (present in DOM, never executes). Fixed: inject after
   `<head>` | `<html>` | `<!doctype>` (first match).
3. **Build embed step not idempotent**: `sw.replace("'%OC_PREVIEW_SHIM%'", …)` no-ops once
   the placeholder is consumed → a stale (corrupted) shim survived rebuilds. Fixed with a
   regex re-embed of the whole `var OC_PREVIEW_SHIM = …;` assignment
   (scripts/build-opencontainer.sh).

### Known-open: upgraded-socket close breaks the next upgrade on that listener

Repro (all committed under `harness/e2e/`):
- `upgrade-probe2.js` — same-process: first upgrade gets 101; abrupt `destroy()` of the
  client → server-side socket emits `end` while the HTTP parser is still attached →
  `HPE_INVALID_EOF_STATE: premature close` (uncaught) — node never detached the parser
  on the upgrade path → the process dies.
- `upgrade-server.js` + `upgrade-client.js` — cross-process: same crash on the server
  process; a surviving server (vite's ws does its own handling) never answers another
  upgrade — the request bytes never reach the guest server socket.
- `ws-probe.js` — against a running vite dev server after one abrupt WS disconnect:
  every raw upgrade times out (plain HTTP still 200).

Impact on preview HMR: the FIRST WebSocket per listener works (verified full HMR
reload); after that client dies (page navigation/iframe reload), every later WS
(vite client reconnect, new preview client) hangs in CONNECTING silently. Plain HTTP
preview traffic is unaffected. Suspects: `kernel/natives/tcp_wrap.ts` EOF/destroy
propagation for upgraded connections + `_http_server` socket detach path.

### Keeper-VFS anomaly (one occurrence, not reproduced)

First minivite run: host-written files (package.json/index.html/src) vanished from the
KEEPER's VFS mid-session (host snapshot + spawned processes still saw them; OPFS save
inherited the loss). Two clean reproductions (fresh dir + full npm install + build;
host-write into OPFS-hydrated package.json) show no loss. `keeper-loss-driver.js`
committed for the record. Also verified by design: node_modules is ephemeral on reload
(`isEphemeralPath`), reinstall is cache-warm — the oc-sh "vite: command not found"
after a reload is expected until `npm install` re-runs.
