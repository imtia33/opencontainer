/**
 * OpenContainer — fetch-backed node `http`/`https` CLIENT for the guest kernel.
 *
 * Browser reality: a worker cannot open TCP sockets. Guest loopback TCP
 * (guest↔guest, guest↔preview — see natives/tcp_wrap.ts) keeps node's REAL
 * stack; everything OUTBOUND must ride the only real network primitive,
 * worker `fetch()`. npm's networking (make-fetch-happen → @npmcli/agent →
 * node http/https) therefore needs an `http.request` that speaks fetch.
 *
 * === The contract this implements (extracted from vendored npm 12.2.1) ===
 *
 * `make-fetch-happen/lib/remote.js` builds an options object via
 * `minipass-fetch`'s `Request.getNodeRequestOptions()` and calls
 * `(protocol === 'https:' ? https : http).request(options)` — ONE plain
 * options object: { auth, host, hostname, path (pathname+search), port,
 * protocol, method, headers, agent, timeout, ...TLS opts }.
 *
 * ClientRequest surface consumed (minipass-fetch/lib/index.js + body.js):
 *   - req.on('response', res)            — the response event
 *   - req.on('error', er)                — checks `req.res` and forwards the
 *                                           error to `req.res.emit('error')`
 *   - req.once('socket', ...)            — armed only when options.timeout is
 *                                           set (network timeout). The socket
 *                                           object itself is never touched.
 *   - req.abort()                        — called by finalize() on error/abort/
 *                                           redirect-follow; must be an
 *                                           idempotent no-op after completion
 *   - req.end() / req.end(body)          — Buffer/string body
 *   - req.write(chunk) + req.end()       — piped stream bodies
 *   - `req.res` property                 — set once the response starts
 *
 * IncomingMessage surface consumed:
 *   - res.statusCode, res.statusMessage, res.headers (plain object,
 *     lowercased keys), res.trailers (read AFTER 'end')
 *   - res.on('data', chunk) — chunks are written straight into a Minipass;
 *     they MUST be Buffer/Uint8Array, never strings (a string chunk is the
 *     exact bug that once crashed tar extraction: "The list[1] argument must
 *     be an instance of Buffer or Uint8Array. Received type string ('LICENSE')")
 *   - res.on('end'), res.on('error'), res.once('data') (raw-deflate sniff:
 *     `chunk[0] & 0x0F` — chunks must be byte-indexable)
 *
 * Agents: @npmcli/agent's Agent object flows in as `options.agent` and is
 * consumed ONLY inside node's real _http_client (`agent.addRequest`). This
 * client ignores `options.agent` — the Agent stays constructed-but-inert,
 * which is exactly what we want (no sockets, no keep-alive timers). We do
 * NOT touch Agents, globalAgent, servers, or node's IncomingMessage class.
 *
 * Redirects: `redirect: 'manual'`. make-fetch-happen passes redirect:'manual'
 * down to minipass-fetch and follows 3xx + Location ITSELF (lib/fetch.js) —
 * so we surface the 3xx status and location header honestly and let it do
 * its own retry/redirect dance.
 *
 * === Documented divergences from real node http ==========================
 *
 * 1. Dropped request headers (silently): accept-encoding, connection,
 *    transfer-encoding, upgrade, host, keep-alive, te, trailer, expect,
 *    cookie variants, origin, referer, date, dnt, content-length,
 *    proxy-/sec- prefixed names, and user-agent. Browsers forbid/own these — fetch either
 *    ignores them or the browser sends its own (user-agent: browsers ignore
 *    attempts to override it in fetch, so we drop it and the browser/undici
 *    sends its own; npm's `npm/12.2.1 node/vX` UA does not survive). A
 *    POST/PUT with a zero-byte body sends no content-length: 0 (fetch can't
 *    set it); registry endpoints that require it are unheard of.
 * 2. gzip: the transport auto-decompresses and strips content-encoding, so
 *    make-fetch-happen sees decompressed bytes with no content-encoding
 *    header — its own gunzip/deflate/br path is skipped, consistently.
 * 3. statusMessage: fetch does not expose the reason phrase; we fall back to
 *    http.STATUS_CODES (via the passed-in `http` module object).
 * 4. rawHeaders: fetch lowercases all header names, so rawHeaders carry
 *    lowercased names (repeated headers still appear as separate pairs).
 * 5. The 'socket' event carries a minimal stub (remoteAddress/remotePort/
 *    destroy/ref/unref/setNoDelay/setKeepAlive) — no real socket exists.
 * 6. 'timeout' fires on transport idleness; per task spec it DESTROYS the
 *    request (real node only emits and leaves cleanup to the listener).
 * 7. Request bodies are fully buffered before the fetch fires (fetch needs
 *    the whole body up front; npm's bodies are packuments/JSON, all small).
 *
 * Self-contained by design: no imports, no kernel globals. The integration
 * owner wires `installFetchHttpClient({ http, https, rewrite, ... })` into
 * the guest's http/https modules — nothing else in the kernel changes.
 */

// ---------------------------------------------------------------------------
// options
// ---------------------------------------------------------------------------

export interface FetchHttpClientOptions {
  /** The guest's `http` module object (patched in place). */
  http: any;
  /** The guest's `https` module object (patched in place). */
  https: any;
  /**
   * URL rewrite applied to the absolute outbound URL right before fetch.
   * Default: identity. The integration owner passes something built on
   * `defaultOutboundRewrite` (registry → same-origin bridge), usually
   * `(url) => location.origin + defaultOutboundRewrite(url)` since the
   * helper returns a relative path.
   */
  rewrite?: (url: string) => string;
  /** fetch implementation to use (default: globalThis.fetch). */
  fetchImpl?: typeof fetch;
  /**
   * Loopback seam: called with the request's intended destination
   * (host, port) BEFORE rewriting. Loopback destinations delegate to the
   * captured REAL node request, preserving the guest's loopback servers.
   * Default: localhost / 127.0.0.1 / ::1 / 0.0.0.0 / ::.
   */
  isLoopback?: (host: string, port: number) => boolean;
  /** Clock (kept injectable for future tests). */
  now?: () => number;
}

/** Registry hosts that must be routed over the same-origin server bridge. */
const REGISTRY_HOSTS = new Set(['registry.npmjs.org', 'registry.npmjs.com']);

/**
 * Default rewrite: registry URLs → relative `/api/oc-net?u=<enc>` bridge URL
 * (prefix the worker's own origin when installing). Everything else is
 * returned untouched — direct fetch, honest CORS failure if the host does
 * not allow it. Only https URLs are rewritten (the bridge rejects non-https).
 */
export function defaultOutboundRewrite(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' && REGISTRY_HOSTS.has(u.hostname)) {
      return `/api/oc-net?u=${encodeURIComponent(url)}`;
    }
  } catch {
    // not a parseable absolute URL — leave it alone
  }
  return url;
}

// ---------------------------------------------------------------------------
// small utilities (no imports — self-contained)
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0.0.0.0',
  '::',
]);

function defaultIsLoopback(host: string): boolean {
  return LOOPBACK_HOSTS.has(String(host).trim().toLowerCase());
}

const encoder = new TextEncoder();

/** Convert ANY incoming chunk to bytes — strings are NEVER passed through. */
function toBytes(chunk: unknown, encoding?: string): Uint8Array | null {
  if (chunk === null || chunk === undefined) return null;
  if (typeof chunk === 'string') {
    const enc = String(encoding ?? 'utf8').toLowerCase();
    if (enc === 'latin1' || enc === 'binary') {
      const out = new Uint8Array(chunk.length);
      for (let i = 0; i < chunk.length; i++) out[i] = chunk.charCodeAt(i) & 0xff;
      return out;
    }
    if (enc === 'base64') {
      const bin = atob(chunk);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    if (enc === 'hex') {
      const out = new Uint8Array(chunk.length >> 1);
      for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(chunk.slice(i * 2, i * 2 + 2), 16) || 0;
      }
      return out;
    }
    return encoder.encode(chunk); // utf8 (node default)
  }
  if (chunk instanceof Uint8Array) return chunk;
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) {
    return new Uint8Array((chunk as any).buffer, (chunk as any).byteOffset, (chunk as any).byteLength);
  }
  return encoder.encode(String(chunk));
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
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

function nodeError(code: string, message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  (err as any).code = code;
  return err;
}

/** Map a fetch rejection to a node-style client error. */
function mapFetchError(err: unknown, url: string): Error & { code: string } {
  const e = err as any;
  const name = String(e?.name ?? '');
  const message = String(e?.message ?? err ?? 'network error');
  if (name === 'TimeoutError') {
    return nodeError('ETIMEDOUT', `network timeout at: ${url}`);
  }
  if (name === 'AbortError') {
    return nodeError('ECONNABORTED', `The user aborted a request: ${url}`);
  }
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN|dns|resolve|lookup/i.test(message)) {
    return nodeError('ENOTFOUND', `request to ${url} failed, reason: getaddrinfo ENOTFOUND (${message})`);
  }
  return nodeError('ECONNRESET', `request to ${url} failed, reason: ${message}`);
}

/**
 * Headers a browser fetch refuses (or silently ignores) — the browser owns
 * them. user-agent is dropped deliberately: browsers ignore attempts to
 * override it in fetch, so npm's UA never survives anyway (divergence #1).
 */
const DROPPED_REQUEST_HEADERS = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'via',
]);

function isDroppedRequestHeader(name: string): boolean {
  const n = name.toLowerCase();
  return DROPPED_REQUEST_HEADERS.has(n) || n.startsWith('proxy-') || n.startsWith('sec-');
}

// ---------------------------------------------------------------------------
// tiny EventEmitter (self-contained; mirrors the node surface we need)
// ---------------------------------------------------------------------------

type Listener = (...args: any[]) => void;

class TinyEmitter {
  private _listeners: Record<string, Listener[]> = Object.create(null);

  on(event: string, fn: Listener): this {
    (this._listeners[event] ??= []).push(fn);
    return this;
  }
  once(event: string, fn: Listener): this {
    // Route through this.on() so subclasses overriding on() (flowing-mode
    // switches on 'data') see once() registrations too.
    const wrapped: Listener = (...args: any[]) => {
      this.off(event, wrapped);
      fn(...args);
    };
    return this.on(event, wrapped);
  }
  addListener(event: string, fn: Listener): this {
    return this.on(event, fn);
  }
  off(event: string, fn: Listener): this {
    const list = this._listeners[event];
    if (list) {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }
    return this;
  }
  removeListener(event: string, fn: Listener): this {
    return this.off(event, fn);
  }
  removeAllListeners(event?: string): this {
    if (event) delete this._listeners[event];
    else this._listeners = Object.create(null);
    return this;
  }
  listenerCount(event: string): number {
    return (this._listeners[event] ?? []).length;
  }
  emit(event: string, ...args: any[]): boolean {
    const list = this._listeners[event];
    if (!list || list.length === 0) {
      // node throws on unhandled 'error'; in a worker an async throw becomes
      // an unhandled rejection, which is worse. Log instead (divergence).
      if (event === 'error') {
        const err = args[0] as any;
        // eslint-disable-next-line no-console
        console.error(`http-fetch-client: unhandled 'error' event:`, err?.code ?? '', err?.message ?? err);
      }
      return false;
    }
    for (const fn of [...list]) {
      try {
        fn(...args);
      } catch (e) {
        // A listener bug must not break the stream machinery.
        // eslint-disable-next-line no-console
        console.error('http-fetch-client: response listener threw:', e);
      }
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// minimal fake socket (agents/libraries may listen for socket events)
// ---------------------------------------------------------------------------

class FakeSocket extends TinyEmitter {
  remoteAddress: string;
  remotePort: number;
  destroyed = false;

  constructor(remoteAddress: string, remotePort: number) {
    super();
    this.remoteAddress = remoteAddress;
    this.remotePort = remotePort;
  }
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('close');
  }
  ref(): void {}
  unref(): void {}
  setNoDelay(_msecs?: boolean | number): void {}
  setKeepAlive(_enable?: boolean, _initialDelay?: number): void {}
  setTimeout(_msecs?: number, _cb?: () => void): void {}
}

// ---------------------------------------------------------------------------
// fake IncomingMessage
// ---------------------------------------------------------------------------

class FetchIncomingMessage extends TinyEmitter {
  statusCode: number;
  statusMessage: string;
  /** Lowercased keys; repeated headers joined ', ' EXACTLY like node. */
  headers: Record<string, string>;
  /** Flat [k1, v1, k2, v2, ...] — fetch lowercases names (divergence #4). */
  rawHeaders: string[];
  httpVersion = '1.1';
  url: string;
  method: string;
  complete = false;
  socket: FakeSocket;
  /** fetch cannot read HTTP trailers — always empty (node reads on 'end'). */
  trailers: Record<string, string> = {};
  req: any;

  private _reader: ReadableStreamDefaultReader<Uint8Array> | null;
  private _queue: Uint8Array[] = [];
  private _flowing = false;
  private _pumpScheduled = false;
  private _pumping = false;
  private _destroyed = false;
  private _gate: Promise<void> | null = null;
  private _gateResolve: (() => void) | null = null;
  /** Wired by the owning request to re-arm its idle timeout on activity. */
  _touch: (() => void) | null = null;

  constructor(response: Response, init: { method: string; url: string; socket: FakeSocket; statusCodes: any }) {
    super();
    this.statusCode = response.status;
    this.statusMessage = String(init.statusCodes?.[response.status] ?? '');
    this.method = init.method;
    this.url = init.url;
    this.socket = init.socket;

    // headers: fold duplicates with ', ' (node semantics); rawHeaders keep
    // one pair per original header line.
    const folded: Record<string, string[]> = Object.create(null);
    const raw: string[] = [];
    if (response.headers) {
      response.headers.forEach((value, name) => {
        const n = name.toLowerCase();
        (folded[n] ??= []).push(value);
        raw.push(n, value);
      });
    }
    const headers: Record<string, string> = Object.create(null);
    for (const key of Object.keys(folded)) {
      headers[key] = folded[key].join(', ');
    }
    this.headers = headers;
    this.rawHeaders = raw;

    // 204/304/HEAD → response.body is null → immediate 'end'.
    this._reader = response.body ? response.body.getReader() : null;
  }

  /** Called by the owning ClientRequest right after 'response' is emitted. */
  _start(): void {
    if (this._destroyed) return;
    if (this._reader === null) {
      this._finish();
      return;
    }
    // node paused-mode semantics: with no consumer attached yet, nothing
    // flows — a late 'data' listener/resume()/read() starts the pump, and
    // nothing is lost in between (chunks buffer on the reader side).
    if (this._flowing) this._schedulePump();
  }

  on(event: string, fn: Listener): this {
    super.on(event, fn);
    if (event === 'data') {
      // node switches to flowing mode when a 'data' listener attaches.
      // Drain anything buffered while paused on the next microtask — never
      // synchronously inside .on() (node never re-enters the listener).
      this._flowing = true;
      this._releaseGate();
      queueMicrotask(() => {
        this._drainQueue();
        this._schedulePump();
      });
    } else if (event === 'end' || event === 'readable') {
      // Attaching 'end'/'readable' must also make progress (node resumes
      // IncomingMessages on 'end'); data buffers for read() in paused mode.
      queueMicrotask(() => this._schedulePump());
    }
    return this;
  }

  resume(): void {
    this._flowing = true;
    this._releaseGate();
    queueMicrotask(() => {
      this._drainQueue();
      this._schedulePump();
    });
  }
  pause(): void {
    this._flowing = false;
    if (!this._gate) this._gate = new Promise<void>((r) => (this._gateResolve = r));
  }
  /** Non-flowing pull. Returns buffered bytes or null (node semantics). */
  read(): Uint8Array | null {
    if (this._queue.length === 0 && this._reader && !this._pumping && !this._destroyed) {
      // paused-mode fill: pump buffers chunks into the queue for read()
      this._schedulePump();
    }
    return this._queue.shift() ?? null;
  }
  pipe(dest: any): any {
    this.on('data', (chunk: Uint8Array) => {
      const ok = dest.write(chunk);
      if (!ok) this.pause(); // let dest's 'drain' resume us
    });
    if (typeof dest.on === 'function') {
      dest.on('drain', () => this.resume());
    }
    this.on('end', () => {
      if (typeof dest.end === 'function') dest.end();
    });
    this.on('error', (err: any) => {
      if (typeof dest.emit === 'function') dest.emit('error', err);
      else if (typeof dest.destroy === 'function') dest.destroy(err);
    });
    return dest;
  }
  destroy(err?: any): void {
    if (this._destroyed) return;
    this._destroyed = true;
    const reader = this._reader;
    this._reader = null;
    if (reader) {
      try {
        reader.cancel().catch(() => {});
      } catch {
        /* already closed */
      }
    }
    if (err) this.emit('error', err);
    if (!this.complete) {
      this.emit('aborted');
    }
    this.emit('close');
  }

  private _releaseGate(): void {
    if (this._gateResolve) {
      const r = this._gateResolve;
      this._gate = null;
      this._gateResolve = null;
      r();
    }
  }
  private _drainQueue(): void {
    while (this._queue.length > 0 && this._flowing) {
      const chunk = this._queue.shift()!;
      this.emit('data', chunk);
    }
  }
  private _schedulePump(): void {
    if (this._pumpScheduled) return;
    this._pumpScheduled = true;
    queueMicrotask(() => {
      this._pumpScheduled = false;
      this._pump();
    });
  }

  private async _pump(): Promise<void> {
    // Exactly one pump may run — pause/resume must not stack concurrent
    // loops (reader.read() is FIFO-safe, but one loop keeps this simple).
    if (this._pumping) return;
    if (!this._reader || this._destroyed) return;
    this._pumping = true;
    try {
      for (;;) {
        if (this._gate) await this._gate;
        if (this._destroyed || !this._reader) return;
        const { done, value } = await this._reader.read();
        if (this._destroyed || !this._reader) return;
        if (done) break;
        // ALWAYS deliver bytes. A string chunk is the historical tar bug.
        const raw: any = value;
        let bytes: Uint8Array;
        if (raw instanceof Uint8Array) bytes = raw;
        else if (typeof raw === 'string') bytes = encoder.encode(raw);
        else if (raw?.buffer) bytes = new Uint8Array(raw.buffer, raw.byteOffset ?? 0, raw.byteLength ?? raw.buffer.byteLength);
        else bytes = encoder.encode(String(raw ?? ''));
        this._touch?.();
        if (this._flowing) this.emit('data', bytes);
        else this._queue.push(bytes);
      }
      this._finish();
    } catch (err: any) {
      if (this._destroyed) return;
      this._reader = null;
      this.emit('error', mapFetchError(err, this.url || ''));
      this.emit('close');
    } finally {
      this._pumping = false;
    }
  }

  private _finish(): void {
    if (this.complete) return;
    this._reader = null;
    this.complete = true;
    // Deliver anything buffered in non-flowing mode first, then end.
    this._drainQueue();
    this.emit('end');
    this.emit('close');
  }
}

// ---------------------------------------------------------------------------
// fake ClientRequest
// ---------------------------------------------------------------------------

interface RequestInitLike {
  method: string;
  protocol: string;
  host: string;
  port: number;
  path: string;
  absoluteUrl: string;
  headers: Record<string, unknown>;
  auth?: string;
  timeout?: number;
}

class FetchClientRequest extends TinyEmitter {
  // node-ish public state
  aborted = false;
  destroyed = false;
  finished = false;
  headersSent = false;
  res: FetchIncomingMessage | null = null;
  socket: FakeSocket | null = null;
  method: string;
  path: string;
  host: string;
  port: number;
  protocol: string;

  private _init: RequestInitLike;
  private _rewrite?: (url: string) => string;
  private _fetchImpl?: typeof fetch;
  private _statusCodes: any;
  private _headers: Record<string, unknown>;
  private _bodyChunks: Uint8Array[] = [];
  private _started = false;
  private _ended = false;
  private _done = false;
  private _errorEmitted = false;
  private _destroyAfterResponse = false;
  private _controller = new AbortController();
  private _timeoutMs = 0;
  private _timeoutCb: (() => void) | null = null;
  private _idleTimer: any = null;
  private _targetUrl = '';

  constructor(
    init: RequestInitLike,
    ctx: {
      rewrite?: (url: string) => string;
      fetchImpl?: typeof fetch;
      statusCodes: any;
    },
  ) {
    super();
    this._init = init;
    this._rewrite = ctx.rewrite;
    this._fetchImpl = ctx.fetchImpl;
    this._statusCodes = ctx.statusCodes;
    this._headers = { ...init.headers };
    this.method = init.method;
    this.path = init.path;
    this.host = init.host;
    this.port = init.port;
    this.protocol = init.protocol;
    if (typeof init.timeout === 'number' && init.timeout > 0) {
      this._timeoutMs = init.timeout;
    }
  }

  // ---- header surface ------------------------------------------------------
  setHeader(name: string, value: unknown): this {
    this._headers[name] = value;
    return this;
  }
  getHeader(name: string): unknown {
    return this._headers[name];
  }
  getHeaders(): Record<string, unknown> {
    return { ...this._headers };
  }
  removeHeader(name: string): this {
    delete this._headers[name];
    return this;
  }
  hasHeader(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this._headers, name);
  }

  // ---- writable surface ------------------------------------------------------
  write(chunk?: any, encoding?: any, cb?: any): boolean {
    if (typeof encoding === 'function') {
      cb = encoding;
      encoding = undefined;
    }
    if (this._ended || this.destroyed) {
      const err = nodeError('ERR_STREAM_WRITE_AFTER_END', 'write after end');
      this.emit('error', err);
      if (typeof cb === 'function') queueMicrotask(() => cb(err));
      return false;
    }
    const bytes = toBytes(chunk, typeof encoding === 'string' ? encoding : undefined);
    if (bytes) this._bodyChunks.push(bytes);
    if (typeof cb === 'function') queueMicrotask(() => cb());
    return true;
  }

  end(chunk?: any, encoding?: any, cb?: any): this {
    if (typeof chunk === 'function') {
      cb = chunk;
      chunk = undefined;
    } else if (typeof encoding === 'function') {
      cb = encoding;
      encoding = undefined;
    }
    if (chunk !== null && chunk !== undefined) {
      const bytes = toBytes(chunk, typeof encoding === 'string' ? encoding : undefined);
      if (bytes && !this._ended) this._bodyChunks.push(bytes);
    }
    if (!this._ended) {
      this._ended = true;
      this.finished = true;
      // The fetch (and every subsequent event) fires asynchronously —
      // NEVER synchronously inside .end().
      queueMicrotask(() => this._startFetch());
    }
    if (typeof cb === 'function') {
      if (this._done) queueMicrotask(() => cb());
      else this.once('close', () => cb());
    }
    return this;
  }

  /**
   * node flushes headers early. Here: fire the fetch immediately ONLY for a
   * bodyless GET/HEAD that has not been started yet (covers code paths that
   * flushHeaders() and never end()); otherwise a no-op — .end() is the real
   * trigger. Idempotent either way.
   */
  flushHeaders(): void {
    if (this._started) return;
    if ((this.method === 'GET' || this.method === 'HEAD') && this._bodyChunks.length === 0) {
      this._ended = true;
      this.finished = true;
      queueMicrotask(() => this._startFetch());
    }
  }

  // ---- destruction surface ---------------------------------------------------
  abort(): void {
    this._destroy(nodeError('ECONNABORTED', `The user aborted a request: ${this._targetUrl || this.path}`));
  }

  destroy(err?: any): void {
    // Task spec: destroy()/abort() → 'error' with code ECONNABORTED (node
    // would stay silent on a bare destroy(); we follow the spec).
    this._destroy(
      err ?? nodeError('ECONNABORTED', `The user aborted a request: ${this._targetUrl || this.path}`),
    );
  }

  destroySoon(): void {
    // node: destroy after pending writes flush. Our writes flush into the
    // fetch body instantly, so: end() now, destroy after the response ends.
    if (!this._ended) this.end();
    this._destroyAfterResponse = true;
    if (this._done) this._destroyQuietly();
  }

  setTimeout(msecs: number, cb?: () => void): this {
    this._timeoutMs = msecs > 0 ? msecs : 0;
    this._timeoutCb = cb ?? null;
    if (this._started && this._timeoutMs) this._armIdle();
    return this;
  }

  // ---- no-op knobs (agents/sockets are not ours to manage) -------------------
  setNoDelay(_noDelay?: boolean): this {
    return this;
  }
  setSocketKeepAlive(_enable?: boolean, _initialDelay?: number): this {
    return this;
  }
  setAgent(_agent?: any): this {
    return this;
  }

  // ---- internals ---------------------------------------------------------------

  private _armIdle(): void {
    if (!this._timeoutMs) return;
    if (this._idleTimer) clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => this._onTimeout(), this._timeoutMs);
  }

  private _onTimeout(): void {
    if (this.destroyed || this._done) return;
    this.emit('timeout');
    if (this._timeoutCb) {
      try {
        this._timeoutCb();
      } catch (e) {
        this.emit('error', e as Error);
      }
    }
    // node only emits; per task spec we also destroy (divergence #6).
    this._destroy(nodeError('ETIMEDOUT', `network timeout at: ${this._targetUrl || this._init.absoluteUrl}`));
  }

  private _buildHeaders(): Headers {
    const out = new Headers();
    const apply = (name: string, value: unknown) => {
      if (isDroppedRequestHeader(name)) return; // silent drop (divergence #1)
      if (value === null || value === undefined) return;
      try {
        if (Array.isArray(value)) {
          for (const v of value) out.append(name, String(v));
        } else {
          out.append(name, String(value));
        }
      } catch {
        // illegal header name/value — node would throw on write; we skip.
      }
    };
    // _headers is the single store: seeded from options.headers at
    // construction, mutated by setHeader/removeHeader. Each name is applied
    // EXACTLY ONCE — appending twice would corrupt values ("a/json, a/json").
    for (const name of Object.keys(this._headers)) apply(name, this._headers[name]);
    if (this._init.auth) {
      try {
        apply('authorization', `Basic ${btoa(this._init.auth)}`);
      } catch {
        /* invalid auth — skip */
      }
    }
    return out;
  }

  private _startFetch(): void {
    if (this._started || this.destroyed) return;
    this._started = true;
    this.headersSent = true;

    const absUrl = this._init.absoluteUrl;
    this._targetUrl = this._rewrite ? this._rewrite(absUrl) : absUrl;

    const headers = this._buildHeaders();
    let body: BodyInit | undefined;
    if (this.method !== 'GET' && this.method !== 'HEAD' && this._bodyChunks.length > 0) {
      body = concatBytes(this._bodyChunks) as unknown as BodyInit;
    }

    const socket = new FakeSocket(this.host, this.port);
    this.socket = socket;
    // minipass-fetch arms its network timeout on req.once('socket') —
    // emit before the fetch so timers behave like node's.
    this.emit('socket', socket);
    this._armIdle();

    const fetchFn = this._fetchImpl ?? (globalThis as any).fetch;
    const opts: RequestInit & { redirect: 'manual' } = {
      method: this.method,
      headers,
      redirect: 'manual', // make-fetch-happen follows redirects itself
      signal: this._controller.signal,
    };
    if (body) opts.body = body;

    fetchFn(this._targetUrl, opts)
      .then((response: Response) => {
        if (this.destroyed) {
          try {
            response.body?.cancel().catch(() => {});
          } catch {
            /* noop */
          }
          return;
        }
        this._armIdle(); // any progress resets the idle timer
        queueMicrotask(() => this._deliverResponse(response));
      })
      .catch((err: unknown) => {
        if (this.destroyed || this._errorEmitted) return; // already surfaced
        const mapped = mapFetchError(err, this._targetUrl || absUrl);
        queueMicrotask(() => this._emitError(mapped));
      });
  }

  private _deliverResponse(response: Response): void {
    if (this.destroyed || this._done) return;
    const res = new FetchIncomingMessage(response, {
      method: this.method,
      url: this.path,
      socket: this.socket!,
      statusCodes: this._statusCodes,
    });
    res.req = this;
    res._touch = () => this._armIdle(); // body activity re-arms the idle timer
    this.res = res;
    this._watchResponse(res);
    this.emit('response', res);
    res._start();
  }

  private _emitError(err: Error & { code: string }): void {
    if (this._errorEmitted || this._done) return;
    this._errorEmitted = true;
    // minipass-fetch's error handler forwards errors to req.res — we set
    // this.res, matching node, so its `if (req.res)` branch behaves.
    this.emit('error', err);
    this._closeAll();
  }
  private _destroy(err?: any): void {
    if (this.destroyed) return;
    // Post-completion abort/destroy is a silent no-op, exactly like node
    // (minipass-fetch's finalize() calls req.abort() after the body ends).
    if (this._done) {
      this.destroyed = true;
      this.aborted = true;
      return;
    }
    this.destroyed = true;
    this.aborted = true;
    this.emit('abort');
    try {
      this._controller.abort();
    } catch {
      /* noop */
    }
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    const res = this.res;
    if (res && !res.complete) {
      // Node semantics: the response stream dies with the request.
      res.destroy();
    }
    if (err && !this._errorEmitted) {
      this._errorEmitted = true;
      this.emit('error', err);
    }
    this._closeAll();
  }

  private _destroyQuietly(): void {
    if (this.destroyed || this._done) return;
    this.destroyed = true;
    this.aborted = true;
    try {
      this._controller.abort();
    } catch {
      /* noop */
    }
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    if (this.res && !this.res.complete) this.res.destroy();
    this.emit('close');
  }

  private _closeAll(): void {
    this._done = true;
    this.emit('close');
    this.socket?.destroy();
  }

  /** Response stream finished (or died) — close out the request side. */
  private _watchResponse(res: FetchIncomingMessage): void {
    res.once('close', () => {
      if (this._done || this.destroyed) return;
      this._done = true;
      if (this._destroyAfterResponse) {
        // destroySoon(): everything flushed — destroy without an error.
        this.destroyed = true;
        this.aborted = true;
        try {
          this._controller.abort();
        } catch {
          /* noop */
        }
        this.emit('close');
        this.socket?.destroy();
      } else {
        this.emit('close');
        this.socket?.destroy();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// argument normalization (mirrors lib/_http_client.js basics)
// ---------------------------------------------------------------------------

interface ResolvedArgs {
  urlInput: string | URL | null;
  options: Record<string, any>;
  cb: ((res: any) => void) | null;
}

function normalizeArgs(a?: any, b?: any, c?: any): ResolvedArgs {
  let urlInput: string | URL | null = null;
  let options: any = {};
  let cb: ((res: any) => void) | null = null;

  if (typeof a === 'string' || a instanceof URL) {
    urlInput = a;
    if (typeof b === 'function') {
      cb = b;
    } else if (b && typeof b === 'object') {
      options = b;
      if (typeof c === 'function') cb = c;
    }
  } else if (a && typeof a === 'object') {
    options = a;
    if (typeof b === 'function') cb = b;
  }
  return { urlInput, options: { ...options }, cb };
}

/** URL → the http.request option fields node's urlToHttpOptions maps. */
function urlToHttpOptions(u: URL): Record<string, any> {
  const o: Record<string, any> = {};
  o.protocol = u.protocol;
  o.hostname = u.hostname; // unbracketed
  o.host = u.host;
  o.auth = u.username || u.password ? `${u.username}:${u.password}` : '';
  if (u.port) o.port = u.port;
  o.path = `${u.pathname}${u.search}` || '/';
  return o;
}

interface Target {
  host: string;
  port: number;
  protocol: string;
  path: string;
}

/**
 * Resolve (host, port) exactly as node's client would — the loopback seam
 * must see the guest's INTENDED destination, before any rewriting.
 */
function resolveTarget(
  urlInput: string | URL | null,
  options: Record<string, any>,
  moduleDefaultProto: 'http' | 'https',
): Target {
  const fromUrl: Record<string, any> = {};
  if (typeof urlInput === 'string' && urlInput) {
    try {
      Object.assign(fromUrl, urlToHttpOptions(new URL(urlInput)));
    } catch {
      // Not an absolute URL. node would throw ERR_INVALID_URL here; we are
      // lenient and treat it as a path on localhost (documented divergence).
      fromUrl.path = urlInput.startsWith('/') ? urlInput : `/${urlInput}`;
    }
  } else if (urlInput instanceof URL) {
    Object.assign(fromUrl, urlToHttpOptions(urlInput));
  }

  const protocol = String(
    options.protocol ?? fromUrl.protocol ?? `${moduleDefaultProto}:`,
  ).replace(/:$/, '');

  // options.host wins, then options.hostname, then URL host (node order is
  // hostname→host; both mean the same thing for us).
  let host = String(options.hostname ?? options.host ?? fromUrl.hostname ?? fromUrl.host ?? 'localhost');
  if (host.includes(':') && !host.startsWith('[')) {
    // "host:port" style string — node rejects this; we split leniently.
    const idx = host.lastIndexOf(':');
    const maybePort = host.slice(idx + 1);
    if (/^\d+$/.test(maybePort)) {
      host = host.slice(0, idx);
      if (options.port === undefined && fromUrl.port === undefined) options.port = maybePort;
    } else if (protocol === 'https' || protocol === 'http') {
      host = `[${host}]`; // bare IPv6 literal
    }
  }

  const port =
    Number(options.port ?? fromUrl.port ?? 0) ||
    (protocol === 'https' ? 443 : 80);

  const path = String(options.path ?? fromUrl.path ?? '/');
  return { host, port, protocol, path };
}

function buildAbsoluteUrl(t: Target): string {
  let h = t.host;
  if (h.includes(':') && !h.startsWith('[')) h = `[${h}]`;
  const defaultPort = t.protocol === 'https' ? 443 : 80;
  const portPart = t.port && t.port !== defaultPort ? `:${t.port}` : '';
  const p = t.path.startsWith('/') ? t.path : `/${t.path}`;
  return `${t.protocol}://${h}${portPart}${p}`;
}

// ---------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------

export interface FetchHttpClientHandle {
  /** Restore the original http/https request/get. */
  uninstall(): void;
}

export function installFetchHttpClient(opts: FetchHttpClientOptions): FetchHttpClientHandle {
  const { http, https } = opts;
  if (!http || !https) throw new Error('installFetchHttpClient: `http` and `https` module objects are required');

  const rewrite = opts.rewrite;
  const fetchImpl = opts.fetchImpl;
  const isLoopback = opts.isLoopback ?? defaultIsLoopback;
  const statusCodes = http.STATUS_CODES ?? https.STATUS_CODES ?? {};

  const orig = {
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
  };

  const ctx = { rewrite, fetchImpl, statusCodes };

  const makeRequest = (moduleDefaultProto: 'http' | 'https') =>
    function patchedRequest(this: any, a?: any, b?: any, c?: any): any {
      const { urlInput, options, cb } = normalizeArgs(a, b, c);
      let target: Target;
      try {
        target = resolveTarget(urlInput, options, moduleDefaultProto);
      } catch {
        // Malformed input → let the REAL node client produce node's error.
        const fn = moduleDefaultProto === 'https' ? orig.httpsRequest : orig.httpRequest;
        return fn.call(this, a, b, c);
      }

      const checkHost = target.host.replace(/^\[|\]$/g, ''); // compare unbracketed
      if (isLoopback(checkHost, target.port)) {
        // Guest loopback (its own servers, preview bridge): node's TRUE stack.
        const fn = moduleDefaultProto === 'https' ? orig.httpsRequest : orig.httpRequest;
        return fn.call(this, a, b, c);
      }

      const headers: Record<string, unknown> = {};
      const raw = options.headers;
      if (raw && typeof raw === 'object') {
        if (Array.isArray(raw) || raw instanceof Map || typeof (raw as any)[Symbol.iterator] === 'function') {
          for (const pair of raw as Iterable<[string, unknown]>) {
            const [k, v] = Array.isArray(pair) ? pair : [String(pair), undefined];
            headers[k] = v;
          }
        } else {
          Object.assign(headers, raw);
        }
      }

      const init: RequestInitLike = {
        method: String(options.method ?? 'GET').toUpperCase(),
        protocol: target.protocol,
        host: target.host,
        port: target.port,
        path: target.path,
        absoluteUrl: buildAbsoluteUrl(target),
        headers,
        auth: options.auth ?? undefined,
        timeout: typeof options.timeout === 'number' ? options.timeout : undefined,
      };

      const req = new FetchClientRequest(init, ctx);
      if (cb) req.once('response', cb as (res: any) => void);
      return req;
    };

  const httpRequest = makeRequest('http');
  const httpsRequest = makeRequest('https');
  // node: get() === request() + immediate end(). Delegation is preserved
  // because patchedRequest returns the real node request for loopback.
  const httpGet = function patchedGet(this: any, a?: any, b?: any, c?: any): any {
    const req = httpRequest.call(this, a, b, c);
    if (typeof req?.end === 'function') req.end();
    return req;
  };
  const httpsGet = function patchedGetHttps(this: any, a?: any, b?: any, c?: any): any {
    const req = httpsRequest.call(this, a, b, c);
    if (typeof req?.end === 'function') req.end();
    return req;
  };

  http.request = httpRequest;
  http.get = httpGet;
  https.request = httpsRequest;
  https.get = httpsGet;

  return {
    uninstall() {
      http.request = orig.httpRequest;
      http.get = orig.httpGet;
      https.request = orig.httpsRequest;
      https.get = orig.httpsGet;
    },
  };
}
