# ADR-001 — Preview networking: Service Worker bridge over virtual TCP

**Status:** Accepted (implemented + verified in real Chromium, 2026-11-03)
**Scope:** S3 milestone — `node server.js`, `npm run dev`, preview URLs, multi-server, port conflicts.
**Companion evidence:** `public/opencontainer/preview-sw.js`, `kernel/natives/tcp_wrap.ts`, `kernel/natives/http_parser.ts`, `runtime.ts` (process manager), E2E driver 23/23.

## Context

A developer runs `node server.js` (or `npm run dev`) inside OpenContainer. The guest
code calls `http.createServer(...).listen(3000)`. In a browser there is no TCP socket,
no listening syscall, and no way for a *page* to receive connections. We must make
node's real `net.Server`/`http.Server` machinery work and expose the server through a
URL a browser can actually fetch.

## Options considered

| Option | Mechanism | Verdict |
|---|---|---|
| **A. Service Worker + virtual TCP** (chosen) | SW intercepts preview fetches, synthesizes the real HTTP/1.1 wire bytes a TCP peer would send, pipes them through a MessageChannel into the kernel's virtual TCP stack; node's real `http_parser`/`net`/`http` code parses and answers; raw response bytes flow back and the SW builds the browser `Response` | Real node stack end-to-end; works for any framework built on node's http; no per-tool shims |
| B. Fetch-bridge client only | Guest code rewritten/patched to answer `fetch()` directly (no wire bytes) | Rejected: bypasses node's parser and socket semantics; "ready" without real HTTP; frameworks (express middleware, keep-alive, chunking) would diverge |
| C. WebSocket forwarding | A WS tunnel to a companion server; requests tunneled | Rejected for the default engine: needs a companion server (violates browser-native goal); still can't serve plain `fetch()` previews |
| D. Real TCP via WASI/libuv compiled stack | Full socket API in WASM | Rejected: browsers do not expose TCP to WASM either; no gain over A |

**Why A is faithful:** the bytes on the wire are the bytes node writes. The SW does
exactly what a TCP peer does — request-line, headers, `content-length`, `connection:
close` — and parses the status line + headers back. Chunked transfer is de-chunked in
the SW. Node's keep-alive/pipelining semantics were verified in the harness (two
responses on one connection).

## The selected architecture

```
Browser page                    Service Worker (scope "/")            Kernel worker (process N)
─────────────                   ───────────────────────────           ─────────────────────────
fetch('/opencontainer/          fetch event → match /p/<port>/…       tcp_wrap.TCP (virtual)
  p/3000/api')          ──────► build HTTP/1.1 request bytes  ──────► acceptConnection(port, connId)
                                MessageChannel port2 ──┐              net.Server 'connection' →
preview <iframe>                (postMessage to page)  │              http.Server 'request' →
  src=/opencontainer/p/…        ◄──────────────────────┘              app handler (express)
                                SW parses response head  ◄──────────  socket.write(bytes) →
                                + dechunk → Response                  'tcp-write' → preview port
```

Key components (all implemented this milestone):

1. **`tcp_wrap` binding (kernel)** — virtual TCP handles. `bind`/`listen` register the
   port with the host process manager (with a synchronous EADDRINUSE mirror of ALL
   ports in the session); `connect` is localhost-only (honest ENOSYS for external
   hosts); accepted sockets speak node's uv StreamBase `onread` protocol so
   `lib/net.js` runs unmodified.
2. **`http_parser` binding (kernel)** — real HTTP parsing for the server request path
   and the client response path (node's `lib/_http_*.js` consume it).
3. **Process manager (main thread, `runtime.ts`)** — the virtual port registry
   (`port → pid`), connection routing table, pipe table, child-spawn fan-out, kill
   trees. Preview connections attach a MessagePort directly to the owning process.
4. **Preview Service Worker (`/opencontainer/preview-sw.js`)** — root scope
   (requires `Service-Worker-Allowed: /` on the script response — see the S3 postmortem
   below); request synthesis; response head parsing; chunked de-framing; 60 s guard.

## Critical implementation lessons (verified by failure first)

1. **The SW scope must be `/`.** A SW only intercepts fetches from clients it
   *controls*, and control requires the client URL to be inside the SW scope. Our
   first registration used `/opencontainer/` (the script's directory) — the host page
   at `/` was never controlled and preview fetches sailed straight to the app server
   (404s). Root scope needs the `Service-Worker-Allowed: /` response header (set in
   `next.config.ts`).
2. **The request bytes ride with the connect message.** The SW sends the full request
   wire-bytes in the `oc-preview-fetch` payload. The page must feed them into the
   virtual connection (`tcp-data` after `tcp-connect`) — otherwise the http.Server
   sees an accepted connection that never speaks and the request hangs forever.
3. **EADDRINUSE must be synchronous in `bind()`.** The port mirror travels in the
   boot message (`initialPorts`); a later `ports-update` races user code's `listen()`.
4. **`emitErrorNT` (nextTick) throws must route to node's fatal machinery.** A listen
   error on a server with no `error` listener is an uncaught exception: stack on
   stderr + exit 1. Swallowing it in the tick-drain made the process exit 0 silently.
5. **A throwing `new ShutdownWrap()` was silently eaten for weeks** — the same
   swallow hid that `stream_wrap` never exported the ReqWrap classes. The moment
   nextTick throws were routed correctly, the latent bug surfaced (fixed: classes +
   node-exact `kLastWriteWasAsync`/`kLastWriteErr` enum order).

## Limitations (honest, by design)

- **WebSockets cannot be proxied by a Service Worker** — the platform does not let a
  SW intercept WS upgrades. Consequences: Vite HMR over WS, `ws`-based apps, and
  anything socket.io are not reachable through the preview URL in S3. Mitigation
  path (S4): an injected client shim that replaces the guest's WS constructor with a
  MessageChannel-backed transport inside the kernel.
- **Single origin.** All ports share the OpenContainer origin (`/opencontainer/p/<port>/…`);
  `Host` headers are synthesized. Cookies/CSP of the host origin apply to previews —
  origin isolation is the S4 security milestone.
- **`connection: close` per preview fetch** (the SW closes after each response);
  keep-alive exists between guest processes but not across the SW boundary.
- **60 s no-response guard** → 502 (a stuck guest cannot hang the page forever).
- **Ephemeral ports** are picked from 40000–60000 by the kernel (uv would ask the OS).

## Alternatives revisit triggers

- If the platform ever ships SW-interceptable WebSockets → revisit the HMR shim.
- If multi-origin isolation (S4) requires it → the SW may move to a dedicated preview
  origin with its own scope.
