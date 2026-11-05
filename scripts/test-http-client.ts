/**
 * OpenContainer — standalone test for the fetch-backed node http/https client.
 *
 * No kernel involved: imports plain node:http/node:https (bun), installs
 * `installFetchHttpClient` on them, and drives REAL requests against the
 * REAL registry (live network — no mocks).
 *
 *   1. https.get packument        → 200 JSON, every chunk Uint8Array
 *   2. https.get tarball          → 200, >100KB bytes, gzip/tar magic check
 *   3. https.request POST         → advisories/bulk with JSON body (the
 *                                    endpoint whose CORS failure in the
 *                                    browser is exactly why the bridge exists)
 *   4. abort/destroy              → 'error'/'abort', no crash, no unhandled rejection
 *   5. loopback delegation        → real node stack via isLoopback ()=>true
 *   6. (OC_BRIDGE=1 only)         → same traffic through the dev-server
 *                                    bridge /api/oc-net — full chain check
 *
 * Run:  bun run scripts/test-http-client.ts
 * With: OC_BRIDGE=1 bun run scripts/test-http-client.ts   (needs `bun run dev`
 *       answering on localhost:3000 first)
 */
import * as httpNs from 'node:http';
import * as httpsNs from 'node:https';
import { gunzipSync } from 'node:zlib';
import {
  installFetchHttpClient,
  defaultOutboundRewrite,
} from '../src/packages/opencontainer/kernel/http-fetch-client';

// ESM module namespaces are frozen — patch a mutable copy instead (this is
// exactly the shape the guest kernel hands over: a plain module-registry
// object, whose http.request/get are assignable).
const http: any = { ...httpNs };
const https: any = { ...httpsNs };

const BRIDGE = process.env.OC_BRIDGE === '1';
const BRIDGE_BASE = 'http://localhost:3000';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ok  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  }
}
function section(name: string) {
  console.log(`\n${name}`);
}

const unhandled: unknown[] = [];
process.on('unhandledRejection', (e) => unhandled.push(e));
process.on('uncaughtException', (e) => unhandled.push(e));

async function waitFor(cond: () => boolean, ms = 15000, every = 25): Promise<boolean> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) return false;
    await new Promise((r) => setTimeout(r, every));
  }
  return true;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  let len = 0;
  for (const c of chunks) len += c.byteLength;
  const out = new Uint8Array(len);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

interface Collected {
  chunks: Uint8Array[];
  total: number;
  nonUint8: number;
}
function collect(res: any): Promise<Collected> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let nonUint8 = 0;
    res.on('data', (c: any) => {
      if (!(c instanceof Uint8Array)) nonUint8++; // a string chunk is THE bug
      chunks.push(c);
    });
    res.on('end', () =>
      resolve({ chunks, total: chunks.reduce((n, c) => n + c.byteLength, 0), nonUint8 }),
    );
    res.on('error', reject);
    res.on('aborted', () => reject(new Error('response aborted')));
  });
}

/** https.get → response (waits for the 'response' event). */
async function doGet(url: string): Promise<{ req: any; res: any }> {
  let res: any = null;
  const req = https.get(url, (r: any) => {
    res = r;
  });
  if (!(await waitFor(() => res !== null))) throw new Error(`no response for ${url}`);
  return { req, res };
}

async function main() {
  console.log('test-http-client — fetch-backed node http/https client (bun, live network, no mocks)');
  console.log(
    BRIDGE
      ? `mode: OC_BRIDGE=1 → registry traffic rewrites to ${BRIDGE_BASE}/api/oc-net (defaultOutboundRewrite)`
      : 'mode: direct bun fetch to registry.npmjs.org (rewrite: identity)',
  );

  const rewrite = BRIDGE
    ? (url: string) => {
        const r = defaultOutboundRewrite(url);
        return r === url ? url : BRIDGE_BASE + r;
      }
    : undefined;

  const handleA = installFetchHttpClient({
    http,
    https,
    isLoopback: () => false,
    fetchImpl: fetch,
    rewrite,
  });

  // ---- [1] packument ------------------------------------------------------
  section('[1] https.get https://registry.npmjs.org/express');
  {
    let socketStub: any = null;
    let res: any = null;
    const req = https.get('https://registry.npmjs.org/express', (r: any) => {
      res = r;
    });
    req.on('socket', (s: any) => {
      socketStub = s;
    });
    check('response event arrived', await waitFor(() => res !== null));
    check('statusCode 200', res.statusCode === 200, String(res.statusCode));
    check(
      'content-type application/json',
      /application\/json/.test(res.headers['content-type'] || ''),
      String(res.headers['content-type']),
    );
    check('httpVersion 1.1', res.httpVersion === '1.1');
    check(
      'rawHeaders is a flat array',
      Array.isArray(res.rawHeaders) && res.rawHeaders.length % 2 === 0,
    );
    check(
      "'socket' event carried a stub (remoteAddress/remotePort/destroy)",
      !!socketStub &&
        typeof socketStub.remoteAddress === 'string' &&
        typeof socketStub.remotePort === 'number' &&
        typeof socketStub.destroy === 'function',
    );
    check('req.res wired (minipass-fetch error-forwarding contract)', req.res === res);
    const { chunks, total, nonUint8 } = await collect(res);
    check('every chunk is a Uint8Array', nonUint8 === 0, `${nonUint8} bad chunks`);
    const text = new TextDecoder().decode(concat(chunks));
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* leave null */
    }
    check('body parses as JSON', !!parsed);
    check('JSON name === "express"', parsed?.name === 'express', String(parsed?.name));
    check(`body size plausible (${total} bytes)`, total > 10000);
    if (BRIDGE) {
      check('x-oc-bridge: oc-net (through the bridge)', res.headers['x-oc-bridge'] === 'oc-net');
      check('cache-control: no-store (bridge)', res.headers['cache-control'] === 'no-store');
    } else {
      check('no x-oc-bridge header (direct fetch)', res.headers['x-oc-bridge'] === undefined);
    }
  }

  // ---- [2] tarball ---------------------------------------------------------
  section('[2] https.get https://registry.npmjs.org/express/-/express-5.3.0.tgz');
  {
    const { res } = await doGet('https://registry.npmjs.org/express/-/express-5.3.0.tgz');
    check('statusCode 200', res.statusCode === 200, String(res.statusCode));
    const { chunks, total, nonUint8 } = await collect(res);
    check('every chunk is a Uint8Array', nonUint8 === 0, `${nonUint8} bad chunks`);
    // express is a small package: the real .tgz is ~23KB on the registry.
    check(`byte length > 20000 (${total} bytes)`, total > 20000);
    const all = concat(chunks);
    if (all[0] === 0x1f && all[1] === 0x8b) {
      console.log('       tarball arrived as RAW gzip bytes (1f 8b magic — .tgz file bytes, not transport-decoded)');
      check('first two bytes are gzip magic 1f 8b', true);
      // Full byte-level validation: gunzip + confirm a ustar archive is inside.
      const tar = gunzipSync(all);
      const tarMagic = String.fromCharCode(...tar.slice(257, 262));
      check('gunzip → ustar tar magic at offset 257', tarMagic === 'ustar', tarMagic);
      check(`decompressed tar size plausible (${tar.byteLength} bytes)`, tar.byteLength > 50000);
    } else {
      const tarMagic = String.fromCharCode(...all.slice(257, 262));
      console.log(`       tarball arrived DECOMPRESSED (transport gzip was auto-decoded) — tar magic at 257: "${tarMagic}"`);
      check('decompressed tar carries ustar magic at offset 257', tarMagic === 'ustar', tarMagic);
    }
  }

  // ---- [3] POST (the CORS-killing endpoint in the browser) ------------------
  section('[3] POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk');
  {
    let res: any = null;
    await new Promise<void>((resolve, reject) => {
      const req = https.request(
        'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk',
        { method: 'POST', headers: { 'content-type': 'application/json' } },
        (r: any) => {
          res = r;
          resolve();
        },
      );
      req.on('error', reject);
      req.end('{"lodash":["1.0.0"]}');
    });
    check('response event arrived', !!res);
    check('statusCode 200', res?.statusCode === 200, String(res?.statusCode));
    const { chunks, nonUint8 } = await collect(res);
    check('every chunk is a Uint8Array', nonUint8 === 0, `${nonUint8} bad chunks`);
    const text = new TextDecoder().decode(concat(chunks));
    let parsed: any = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* leave null */
    }
    check('body parses as JSON', !!parsed);
    check("JSON has a 'lodash' key (POST body reached the endpoint)", !!parsed && 'lodash' in parsed, text.slice(0, 120));
    const advisoryCount = Array.isArray(parsed?.lodash) ? parsed.lodash.length : 1;
    console.log(`       advisories for lodash@1.0.0: ${Array.isArray(parsed?.lodash) ? advisoryCount : 'object'}`);
  }

  // ---- [4] abort / destroy ---------------------------------------------------
  section('[4] destroy() 5ms into a request → error/abort, no crash');
  {
    const req = https.get('https://registry.npmjs.org/express/-/express-5.3.0.tgz');
    const events: string[] = [];
    let errCode = '';
    req.on('response', () => events.push('response'));
    req.on('abort', () => events.push('abort'));
    req.on('error', (e: any) => {
      events.push('error');
      errCode = String(e?.code ?? '');
    });
    req.on('close', () => events.push('close'));
    setTimeout(() => req.destroy(), 5);
    check("'error' and/or 'abort' arrived", await waitFor(() => events.includes('error') || events.includes('abort')));
    check('error code is ECONNABORTED', errCode === 'ECONNABORTED', errCode);
    await new Promise((r) => setTimeout(r, 200)); // let stragglers surface
    check('no unhandled rejection / uncaught exception', unhandled.length === 0, String(unhandled[0] ?? ''));
    console.log(`       events seen: ${events.join(', ') || '(none)'}`);
  }

  // ---- [5] loopback delegation (node's REAL stack) ----------------------------
  section('[5] isLoopback ()=>true → real node client to a local http server');
  {
    handleA.uninstall();
    const handleB = installFetchHttpClient({
      http,
      https,
      isLoopback: () => true,
      fetchImpl: fetch,
    });

    let served = 0;
    const server = http.createServer((rq: any, rs: any) => {
      served++;
      rs.writeHead(200, { 'content-type': 'text/plain', 'x-loopback': 'yes' });
      rs.end('hello-from-real-node');
    });
    await new Promise<void>((resolve) => server.listen(0, () => resolve()));
    const port = (server.address() as any).port;

    let res: any = null;
    const req = http.get(`http://localhost:${port}/x`, (r: any) => {
      res = r;
    });
    check('response event arrived', await waitFor(() => res !== null));
    check('statusCode 200', res.statusCode === 200, String(res.statusCode));
    const { chunks, nonUint8 } = await collect(res);
    check('chunks are Uint8Array (node Buffers qualify)', nonUint8 === 0, `${nonUint8} bad chunks`);
    const body = new TextDecoder().decode(concat(chunks));
    check('body from the real server', body === 'hello-from-real-node', body);
    check(
      'response is a REAL node IncomingMessage (true stack, not the fetch fake)',
      res instanceof http.IncomingMessage,
    );
    check('server actually saw the request', served === 1, String(served));

    await new Promise<void>((resolve) => server.close(() => resolve()));
    handleB.uninstall();
  }

  // ---- summary -----------------------------------------------------------------
  await new Promise((r) => setTimeout(r, 100));
  console.log('\n---------------------------------------------');
  console.log(`PASS ${pass}  FAIL ${fail}  unhandled=${unhandled.length}`);
  if (unhandled.length > 0) {
    console.log('unhandled events:', unhandled);
  }
  if (fail > 0 || unhandled.length > 0) process.exit(1);
  console.log('ALL PASS');
}

const watchdog = setTimeout(() => {
  console.error('TIMEOUT — test did not finish in 90s');
  process.exit(2);
}, 90000);
(watchdog as any).unref?.();

main().catch((e) => {
  console.error('test crashed:', e);
  process.exit(2);
});
