/**
 * OpenContainer preview Service Worker — the browser-networking bridge.
 *
 * Scope: /opencontainer/. Intercepts preview URLs:
 *   /opencontainer/p/<port>/<path>
 *
 * For every matching fetch it synthesizes a REAL HTTP/1.1 request byte
 * stream (exactly what a TCP peer would write) and pipes it through a
 * MessagePort to the host page, which routes it into the kernel's virtual
 * TCP stack. Node's real http.Server parses and answers; the raw response
 * bytes flow back and THIS worker parses the status line + headers to
 * construct the browser Response. Nothing is faked — the bytes on the wire
 * are the bytes node wrote.
 *
 * WebSockets cannot be intercepted by a Service Worker (platform limit);
 * HMR sockets need the injected client shim (documented divergence).
 */

const PREVIEW_RE = /^\/opencontainer\/p\/(\d+)(\/.*)?$/;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const m = PREVIEW_RE.exec(url.pathname);
  if (!m) return; // not a preview URL — default network/cache behavior
  const port = Number(m[1]);
  const pathAndQuery = (m[2] || '/') + url.search;
  event.respondWith(proxyFetch(event.request, port, pathAndQuery));
});

async function proxyFetch(request, port, pathAndQuery) {
  // ---- build the raw HTTP/1.1 request (what a TCP client would send) ----
  const headers = [];
  for (const [k, v] of request.headers.entries()) {
    // Host is rewritten below; content-length recomputed for bodies.
    if (k === 'host' || k === 'content-length' || k === 'connection') continue;
    headers.push([k, v]);
  }
  const bodyBytes = ['GET', 'HEAD'].includes(request.method)
    ? null : new Uint8Array(await request.arrayBuffer().catch(() => new ArrayBuffer(0)));

  let head = `${request.method} ${pathAndQuery} HTTP/1.1\r\n`;
  head += `Host: localhost:${port}\r\n`;
  for (const [k, v] of headers) head += `${k}: ${v}\r\n`;
  head += bodyBytes ? `content-length: ${bodyBytes.byteLength}\r\n` : '';
  head += 'connection: close\r\n\r\n';

  const headBytes = new TextEncoder().encode(head);
  const reqBytes = bodyBytes
    ? concatBytes(headBytes, bodyBytes)
    : headBytes;

  // ---- pipe through the host page into the kernel's virtual TCP ---------
  const channel = new MessageChannel();
  const reply = channel.port1;
  const hostClient = await matchHostClient();
  if (hostClient === null) {
    return new Response('OpenContainer: no host page available for the preview bridge', {
      status: 503, headers: { 'content-type': 'text/plain' },
    });
  }
  const payload = {
    type: 'oc-preview-fetch',
    port,
    method: request.method,
    bytes: reqBytes,
    replyTo: channel.port2,
  };
  try {
    hostClient.postMessage(payload, [channel.port2]);
  } catch {
    // Cached client went away (page navigated/closed) — refresh and retry once.
    clientCache = null;
    const retry = await matchHostClient();
    if (retry === null) {
      return new Response('OpenContainer: no host page available for the preview bridge', {
        status: 503, headers: { 'content-type': 'text/plain' },
      });
    }
    retry.postMessage(payload, [channel.port2]);
  }

  // ---- consume the response: status line + headers, then a body stream --
  return new Promise((resolve) => {
    const chunks = [];
    let headerText = '';
    let headerDone = false;
    let resolved = false;
    let bodyController = null;
    let closed = false;
    // S3.1: clear the guard when it is no longer needed AND close the reply
    // port when the kernel ends the connection — the old code leaked one
    // 60 s timer + one open MessagePort per preview request.
    let guardTimer = null;
    const clearGuard = () => {
      if (guardTimer !== null) { clearTimeout(guardTimer); guardTimer = null; }
    };
    const closeReply = () => {
      clearGuard();
      try { reply.close(); } catch { /* already closed */ }
    };

    reply.onmessage = (ev) => {
      const msg = ev.data;
      if (msg.type === 'data') {
        const bytes = new Uint8Array(msg.bytes);
        if (!headerDone) {
          headerText += latin1(bytes);
          const idx = headerText.indexOf('\r\n\r\n');
          if (idx >= 0) {
            const headPart = headerText.slice(0, idx);
            // Body bytes that arrived in THIS chunk (everything after the
            // header terminator; earlier chunks were all header).
            const bodyLen = headerText.length - (idx + 4);
            const bodyInChunk = bodyLen > 0 ? bytes.subarray(bytes.length - bodyLen) : new Uint8Array(0);
            finishHeadersNow(headPart, bodyInChunk);
            return;
          }
          if (headerText.length > 64 * 1024) {
            clearGuard();
            resolve(new Response('OpenContainer: response header too large', { status: 502 }));
          }
        } else if (bodyController) {
          bodyController.enqueue(bytes);
        } else {
          chunks.push(bytes);
        }
      } else if (msg.type === 'end') {
        closed = true;
        if (bodyController) { try { bodyController.close(); } catch { /* already closed */ } }
        closeReply();
        if (!resolved) {
          clearGuard();
          resolve(new Response('OpenContainer: upstream closed before responding', { status: 502 }));
        }
      }
    };

    function finishHeadersNow(headPart, bodyInChunk) {
      headerDone = true;
      clearGuard(); // response head arrived — the no-response guard is moot
      const { status, statusText, headerLines } = parseResponseHead(headPart);
      const responseHeaders = new Headers();
      for (const line of headerLines) {
        const colon = line.indexOf(':');
        if (colon > 0) {
          try { responseHeaders.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim()); }
          catch { /* skip malformed */ }
        }
      }
      const isChunked = (responseHeaders.get('transfer-encoding') ?? '').includes('chunked');
      const bodyStream = new ReadableStream({
        start(controller) {
          bodyController = controller;
          if (bodyInChunk && bodyInChunk.length > 0) controller.enqueue(bodyInChunk);
          for (const c of chunks) controller.enqueue(c);
          chunks.length = 0;
          if (closed) controller.close();
        },
      });
      resolved = true;
      resolve(new Response(
        request.method === 'HEAD' ? null : dechunk(bodyStream, isChunked),
        { status, statusText: statusText || undefined, headers: responseHeaders },
      ));
    }

    // Safety timeout: 60s with zero response bytes → 502.
    guardTimer = setTimeout(() => {
      guardTimer = null;
      if (!resolved) {
        resolve(new Response('OpenContainer: preview bridge timeout', { status: 502 }));
        try { reply.close(); } catch { /* noop */ }
      }
    }, 60000);
  });
}

// ---- host client cache (S3.1) ------------------------------------------------
// `clients.matchAll()` was awaited on EVERY preview fetch; the host page
// client is effectively session-stable, so cache it for a short TTL and
// refresh on expiry or postMessage failure. Falls back to the old scan on
// any doubt — never a behavior change, only fewer awaits.
let clientCache = null; // { client, at }
const CLIENT_CACHE_TTL = 5000;
async function matchHostClient() {
  const now = Date.now();
  if (clientCache && now - clientCache.at < CLIENT_CACHE_TTL) {
    return clientCache.client;
  }
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (list.length === 0) return null;
  // Prefer the OpenContainer host page (NOT a preview iframe — its URL is a
  // /opencontainer/p/<port>/ path and it has no message listener).
  const client = list.find((c) => !/\/opencontainer\/p\/\d+/.test(c.url ?? '')) ?? list[0];
  clientCache = { client, at: now };
  return client;
}

/** Parse "HTTP/1.1 200 OK\r\nheaders…" into parts. */
function parseResponseHead(text) {
  const lines = text.split('\r\n');
  const statusLine = lines.shift() ?? '';
  const m = /^HTTP\/(\d)\.(\d)\s+(\d{3})(?:\s(.*))?$/.exec(statusLine);
  return {
    status: m ? Number(m[3]) : 502,
    statusText: m ? (m[4] ?? '') : '',
    headerLines: lines,
  };
}

/** Remove HTTP/1.1 chunked framing from a raw byte stream. */
function dechunk(stream, enabled) {
  if (!enabled) return stream;
  let buffer = new Uint8Array(0);
  let done = false;
  return new ReadableStream({
    async pull(controller) {
      while (true) {
        // try to extract a complete chunk from the buffer
        const dec = new TextDecoder('latin1');
        let text = '';
        for (const b of buffer) text += String.fromCharCode(b);
        const crlf = text.indexOf('\r\n');
        if (crlf < 0) break;
        const sizeStr = text.slice(0, crlf).split(';')[0].trim();
        const size = parseInt(sizeStr, 16);
        if (!Number.isFinite(size)) { controller.close(); done = true; return; }
        const chunkStart = crlf + 2;
        if (size === 0) {
          controller.close();
          done = true;
          return;
        }
        if (buffer.length >= chunkStart + size + 2) {
          controller.enqueue(buffer.subarray(chunkStart, chunkStart + size));
          buffer = buffer.subarray(chunkStart + size + 2);
          return; // one chunk per pull
        }
        break;
      }
      if (done) return;
      const reader = stream.getReader();
      try {
        const { value, done: rDone } = await reader.read();
        if (value) {
          const merged = new Uint8Array(buffer.length + value.length);
          merged.set(buffer);
          merged.set(value, buffer.length);
          buffer = merged;
        }
        if (rDone && buffer.length === 0) { controller.close(); done = true; return; }
      } finally {
        reader.releaseLock();
      }
    },
  });
}

function latin1(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
