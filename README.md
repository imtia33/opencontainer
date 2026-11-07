# OpenContainer

**A browser-native Node.js runtime.** An open-source, MIT-licensed drop-in alternative to StackBlitz WebContainers: real Node.js stdlib, the real `npm` CLI, real servers — running entirely in the browser. No remote development VM, no COOP/COEP headers, no license.

```bash
npm install opencontainer
```

```ts
import { WebContainer } from 'opencontainer';

const wc = await WebContainer.boot();
await wc.mount(files);
const p = await wc.spawn('npm', ['install']);
p.output.pipeTo(new WritableStream({ write: console.log }));
await p.exit;
await wc.spawn('npm', ['run', 'start']);
wc.on('server-ready', (port, url) => { iframe.src = url; });
```

That's the whole setup. Code written against `@webcontainer/api` runs by changing the import.

## What runs inside

- **Real Node, not a look-alike.** Node's own `lib/*.js` standard library (511 modules, vendored unmodified from v26.13.0) executes on the browser's own JS engine, on a shim that implements the ~40 C++ `internalBinding` surfaces (fs → virtual filesystem, uv → browser event loop, zlib, http_parser, tcp/pipe wraps → virtual sockets) on browser primitives. No Node binary, no WASM Node.
- **Real npm.** The unmodified upstream npm CLI (v12.2.1) runs as a guest process; `npm install` talks to the real registry directly from the browser.
- **A real filesystem.** In-memory virtual filesystem with Node semantics (wx/EEXIST, atomic rename, symlinks, watchers). Session-scoped by design — the temporary-environment contract: the host supplies project files at boot, guests mutate them in memory, nothing survives a reload.
- **Real child processes and servers.** `child_process.spawn` between guest processes, guest `http` servers, and a ServiceWorker-based preview bridge.

Every intentional divergence from Node.js and from WebContainer is documented in [COMPATIBILITY.md](./COMPATIBILITY.md). Nothing is mocked to make a demo pass.

## Zero hosting, by design

Like WebContainer (whose runtime is fetched at boot from StackBlitz's own origin), the npm package is just the API. The runtime assets — kernel worker + Node/npm blobs — are fetched at boot from the jsDelivr CDN, pinned to the installed version, and cached via the browser's Cache API:

```ts
// default: https://cdn.jsdelivr.net/npm/opencontainer@<version>/public/opencontainer
const wc = await WebContainer.boot();
```

Self-hosting instead (offline, air-gapped, or you just prefer your own origin):

```ts
const wc = await WebContainer.boot({ assetsBase: '/opencontainer' });
// serve node_modules/opencontainer/public/opencontainer/ from that path
```

No cross-origin isolation is required (no SharedArrayBuffer anywhere) — your app keeps loading cross-origin images, fonts, and iframes untouched.

## Preview URLs (the one same-origin file)

Your guest servers (the `server-ready` event) are reachable at `/opencontainer/p/<port>/` — loadable in an iframe, exactly like the starter's `iframe.src = url`. The bridge is a ServiceWorker, and by browser spec a service worker must live on your own origin. The runtime registers it automatically at boot; the only setup step for previews is having the file on your origin:

```bash
cp -r node_modules/opencontainer/public/opencontainer ./public/
```

Without it, everything except preview URLs works (a console warning explains the same). `setPreviewScript`, `server-ready`, `port`, and `preview-message` follow the upstream contracts (`forwardPreviewErrors: true` injects a built-in error forwarder). Previews route to the page whose runtime owns the port — a second tab of your app gets its own previews independently.

**Self-hosting note:** serve the runtime blobs (`.ocrt` files) as-is — `application/octet-stream`, no `Content-Encoding`. Static hosts that auto-gzip `.gz`-suffixed files were the reason for the `.ocrt` naming.

## Status

| Capability | State |
|---|---|
| `node -v` (vendored Node v26.13.0 lib tree) | ✅ |
| `npm -v` → 12.2.1 (upstream CLI, unmodified) | ✅ |
| `npm init` / `npm view` / `npm install` from the real registry | ✅ |
| `npx create-vite` / `npx create-expo-app` end-to-end | ✅ |
| Guest `http` servers through the preview bridge | ✅ |
| Buffer binding parity vs native Node | ✅ 53/53 byte-identical |
| Temporary session-scoped VFS (no cross-reload restore) | ✅ by design |
| ESM entry points + dynamic `import()` (esm-graph, in-worker blob modules) | ✅ verified by create-vite/create-expo-app E2E |
| `vite` dev server (real vite 7.3.7 via npm) | ✅ 20/20 HMR edits, kill+restart reconnect, reload churn (E2E) |
| pnpm (genuine CLI, vendored) | 🚧 P2 |
| Lifecycle scripts | 🔒 off by default (permission model pending) |

## Repository layout

```
src/packages/opencontainer/
  kernel/                     worker entry, VFS, natives, ESM graph, HTTP client
  node-std/                   main-thread node std shapes
  webcontainer-api.ts         the @webcontainer/api-compatible facade
  runtime.ts                  OpenContainerRuntime (process manager, preview bridge)
  vendor/node-v26.13.0/       vendored Node lib tree
public/opencontainer/         served assets: kernel-worker.js, runtime blobs, preview-sw.js
vendor/npm-12.2.1/            vendored upstream npm CLI (unmodified; Artistic-2.0)
harness/                      browser E2E harness (a minimal host app)
scripts/                      build, pack, harness, drivers, parity tests
docs/webcontainer-research.md primary-source WebContainer API reference (parity target)
```

## Legal

- OpenContainer's own code: **MIT** (see [LICENSE](./LICENSE)).
- The vendored Node.js library tree: Node's license (see `src/packages/opencontainer/vendor/node-v26.13.0/LICENSE.node`).
- The vendored npm CLI: **Artistic-2.0** (see `vendor/npm-12.2.1/LICENSE`), redistributed unmodified with provenance recorded in `vendor/npm-12.2.1/.provenance.json`.

## Development

```bash
bun install
npm run build          # kernel worker + runtime blobs + dist bundle
npm run test:harness   # boots the vendored npm CLI in the kernel harness
bun run harness/server.ts   # browser E2E harness at http://localhost:7800
```

The kernel harness (`scripts/npm-harness.ts`) runs the exact worker code path under Bun — the fastest way to debug binding-surface gaps ("crash-driven porting").
