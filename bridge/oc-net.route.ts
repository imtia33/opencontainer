import { NextRequest, NextResponse } from 'next/server';

/**
 * OpenContainer — npm registry network bridge (server side).
 *
 * Why this exists: the guest kernel runs real npm, whose networking goes
 * make-fetch-happen → @npmcli/agent → node `http`/`https`. In a browser
 * worker there is no TCP — outbound HTTP runs on worker `fetch()`, and
 * direct browser fetch to registry.npmjs.org fails CORS on preflighted
 * POSTs (confirmed: `/-/npm/v1/security/advisories/bulk`). This route is
 * the same-origin hop the guest's fetch-backed http client rewrites
 * registry URLs onto (see kernel/http-fetch-client.ts).
 *
 * This is an npm-registry bridge, NOT a general proxy. The destination
 * host allowlist is hard-coded below (registry.npmjs.org +
 * registry.npmjs.com) and only https URLs are accepted, so SSRF is
 * impossible by construction — there is no knob to point it anywhere
 * else.
 *
 * Auth model: guest npm is ANONYMOUS through this bridge. `authorization`
 * and `cookie` request headers are never forwarded; only a safe
 * content-negotiation subset (`accept*`, `content-type`), read-only
 * conditional-GET validators (`if-none-match`/`if-modified-since`) and
 * npm's own `npm-*` advisory headers pass through. `accept-encoding` is
 * NOT forwarded — the server-side fetch owns transport compression, exactly
 * like a browser does for a same-origin request.
 *
 * GET/HEAD/POST  /api/oc-net?u=<absolute https registry URL>
 *   → upstream status + streamed body, content-type/etag/npm-* passthrough,
 *     `x-oc-bridge: oc-net`, `cache-control: no-store`
 *   → 400 {error}  missing/invalid/non-https `u`
 *   → 403 {error}  host outside the allowlist
 *   → 405 {error}  method not GET/HEAD/POST (PUT/PATCH/DELETE/OPTIONS explicit,
 *                  anything else gets Next's automatic 405)
 *   → 413 {error}  POST body over the 10MB cap
 *   → 502 {error}  upstream network failure (gh-import style)
 *   → 504 {error}  upstream timeout (15s)
 */

export const dynamic = 'force-dynamic';

/** Hard-coded destination allowlist — the whole SSRF story. */
const ALLOWED_HOSTS = new Set(['registry.npmjs.org', 'registry.npmjs.com']);

/** Forwarded request headers (lowercased). Registry semantics only:
 * content negotiation, body typing, npm advisory headers, and read-only
 * conditional-GET validators (so cacache's etag revalidation can 304).
 * `authorization`/`cookie` are deliberately absent — guest npm is anonymous
 * through this bridge — and `accept-encoding` is owned by the server fetch. */
const FORWARD_REQUEST_HEADERS = new Set([
  'accept',
  'accept-charset',
  'accept-language',
  'content-type',
  'if-none-match',
  'if-modified-since',
]);

/** Upstream response headers passed through to the guest. */
function isPassthroughResponseHeader(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n === 'content-type' ||
    n === 'etag' ||
    n === 'last-modified' ||
    n === 'vary' ||
    n.startsWith('npm-')
  );
}

const MAX_POST_BYTES = 10 * 1024 * 1024; // 10MB body cap
const UPSTREAM_TIMEOUT_MS = 15_000;

const json = (error: string, status: number) =>
  NextResponse.json({ error }, { status });

async function bridge(req: NextRequest): Promise<Response> {
  // ---- validate the destination ------------------------------------------
  const raw = req.nextUrl.searchParams.get('u') ?? '';
  let upstream: URL;
  try {
    upstream = new URL(raw);
  } catch {
    return json('Missing or malformed `u` query parameter (absolute https URL expected)', 400);
  }
  if (upstream.protocol !== 'https:') {
    return json(`Only https URLs are bridged, got ${upstream.protocol || '(none)'}`, 400);
  }
  if (!ALLOWED_HOSTS.has(upstream.hostname)) {
    return json(
      `Host not allowed: ${upstream.hostname} — this bridge only serves registry.npmjs.org / registry.npmjs.com`,
      403,
    );
  }

  // ---- request body (POST passthrough, 10MB cap) --------------------------
  let body: ArrayBuffer | undefined;
  if (req.method === 'POST') {
    const declared = Number(req.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > MAX_POST_BYTES) {
      return json(`POST body exceeds the ${MAX_POST_BYTES} byte bridge cap`, 413);
    }
    const buf = await req.arrayBuffer().catch(() => null);
    if (buf === null) {
      return json('Unreadable POST body', 400);
    }
    if (buf.byteLength > MAX_POST_BYTES) {
      return json(`POST body exceeds the ${MAX_POST_BYTES} byte bridge cap`, 413);
    }
    if (buf.byteLength > 0) body = buf;
  }

  // ---- request headers: allowlist only, auth/cookie NEVER forwarded -------
  const fwd = new Headers();
  req.headers.forEach((value, name) => {
    const n = name.toLowerCase();
    if (FORWARD_REQUEST_HEADERS.has(n) || n.startsWith('npm-')) {
      fwd.set(name, value);
    }
  });

  // ---- upstream fetch ------------------------------------------------------
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(upstream, {
      method: req.method,
      headers: fwd,
      body,
      redirect: 'manual', // make-fetch-happen follows redirects ITSELF
      signal: controller.signal,
      cache: 'no-store', // never let Next's data cache touch the registry
    });
  } catch (e) {
    clearTimeout(timer);
    const err = e as Error;
    // Our only abort source is the timeout timer.
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      return json(`Upstream timeout after ${UPSTREAM_TIMEOUT_MS}ms: ${upstream.hostname}`, 504);
    }
    return json(`Registry unreachable (${err?.message ?? 'network error'})`, 502);
  }
  clearTimeout(timer);

  // ---- response: original status + streamed body ---------------------------
  // 404/304/etc. statuses are REAL registry answers (npm depends on them for
  // "package not found" and etag revalidation) — they pass through untouched.
  const out = new Headers();
  res.headers.forEach((value, name) => {
    if (isPassthroughResponseHeader(name)) out.set(name, value);
  });
  out.set('x-oc-bridge', 'oc-net');
  out.set('cache-control', 'no-store'); // the browser must not cache bridge replies
  // content-encoding/content-length are intentionally dropped: the server-side
  // fetch owns transport compression/framing and may already have decoded.

  const responseBody: ReadableStream<Uint8Array> | null =
    res.body && req.method !== 'HEAD' ? (res.body as ReadableStream<Uint8Array>) : null;
  return new NextResponse(responseBody, { status: res.status, headers: out });
}

export async function GET(req: NextRequest) {
  return bridge(req);
}
export async function HEAD(req: NextRequest) {
  return bridge(req);
}
export async function POST(req: NextRequest) {
  return bridge(req);
}

// Anything else → explicit JSON 405 (methods not listed here still get
// Next's automatic 405, just without our JSON body).
async function methodNotAllowed(): Promise<Response> {
  return json('Method not allowed — this bridge supports GET, HEAD and POST only', 405);
}
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
