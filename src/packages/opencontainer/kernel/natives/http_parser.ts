import type { Binding, NativesContext } from './index';

/**
 * internalBinding('http_parser') — a REAL incremental HTTP/1.1 parser (JS).
 *
 * Replaces the llhttp C++ binding with the same JS-visible contract that
 * node's _http_common.js/_http_server.js/_http_client.js drive:
 *
 *   - `new HTTPParser()` + `parser.initialize(HTTPParser.REQUEST|RESPONSE, …)`
 *   - `parser.execute(buf) → consumed | Error` (loops over pipelined messages;
 *     pauses with leftover only on upgrade, where node slices the body head)
 *   - `parser.finish() → 0 | Error`
 *   - callbacks on the parser object, addressed by the kOn* index constants:
 *     kOnHeadersComplete(major, minor, [k,v,k,v…], methodNum, url,
 *                        statusCode, statusMessage, upgrade, shouldKeepAlive)
 *     → returns non-zero to skip the body (node's contract)
 *     kOnBody(chunk) / kOnMessageComplete() / kOnExecute(consumed)
 *
 * Supported: request & response modes, content-length and chunked bodies,
 * keep-alive + pipelining, upgrade detection, maxHeaderSize limits, trailer
 * sections, CRLF-safe incremental feeding (lines may span execute() calls).
 */

// llhttp's method enum order (head is http_parser's legacy order — the
// numbers node's own lib maps through allMethods[…]).
const METHODS = [
  'DELETE', 'GET', 'HEAD', 'POST', 'PUT', 'CONNECT', 'OPTIONS', 'TRACE',
  'COPY', 'LOCK', 'MKCOL', 'MOVE', 'PROPFIND', 'PROPPATCH', 'SEARCH',
  'UNLOCK', 'BIND', 'REBIND', 'UNBIND', 'ACL', 'REPORT', 'MKACTIVITY',
  'CHECKOUT', 'MERGE', 'M-SEARCH', 'NOTIFY', 'PATCH', 'PURGE', 'MKCALENDAR',
  'LINK', 'UNLINK', 'SOURCE', 'MKREDIRECTREF', 'QUERY', 'SUBSCRIBE',
  'UNSUBSCRIBE',
];
const ALL_METHODS = [...METHODS, 'PRI'];
const METHOD_INDEX = new Map(METHODS.map((m, i) => [m, i]));

const K_ON_MESSAGE_BEGIN = 0;
const K_ON_HEADERS = 1;
const K_ON_HEADERS_COMPLETE = 2;
const K_ON_BODY = 3;
const K_ON_MESSAGE_COMPLETE = 4;
const K_ON_EXECUTE = 5;
const K_ON_TIMEOUT = 6;

const S_IDLE = 0;
const S_HEADERS = 1;
const S_BODY_LEN = 2;
const S_BODY_CHUNK_SIZE = 3;
const S_BODY_CHUNK_DATA = 4;
const S_BODY_CHUNK_CRLF = 5;
const S_TRAILERS = 6;

const MAX_HEADER_BYTES_DEFAULT = 16 * 1024; // node's default

function parseError(code: string, message: string): Error {
  const err: any = new Error(message);
  err.code = 'HPE_' + code;
  return err;
}

/** Latin-1 decode of a byte range — ONE native decode per line, never per
 *  byte (the per-byte `String.fromCharCode` loop was the S3.1 hot path). */
const latin1Decoder = typeof TextDecoder !== 'undefined'
  ? new TextDecoder('latin1') : null;
function latin1Range(buf: Uint8Array, from: number, to: number): string {
  if (to <= from) return '';
  if (latin1Decoder) {
    try { return latin1Decoder.decode(buf.subarray(from, to)); }
    catch { /* fall through to manual */ }
  }
  let out = '';
  for (let i = from; i < to; i++) out += String.fromCharCode(buf[i]);
  return out;
}

class HTTPParser {
  static REQUEST = 1;
  static RESPONSE = 2;
  static kOnMessageBegin = K_ON_MESSAGE_BEGIN;
  static kOnHeaders = K_ON_HEADERS;
  static kOnHeadersComplete = K_ON_HEADERS_COMPLETE;
  static kOnBody = K_ON_BODY;
  static kOnMessageComplete = K_ON_MESSAGE_COMPLETE;
  static kOnExecute = K_ON_EXECUTE;
  static kOnTimeout = K_ON_TIMEOUT;
  static kLenientNone = 0;
  static kLenientHeaderValueRelaxed = 1;
  static kLenientAll = 0xffffffff;

  /** Callback slots — node's lib assigns parser[HTTPParser.kOnBody] = fn. */
  [slot: number]: any;

  type = 0;
  private state = S_IDLE;
  /** Partial line text (latin1) — lets CRLF span execute() boundaries. */
  private partial = '';
  private headerBytes = 0;
  private maxHeaderSize = MAX_HEADER_BYTES_DEFAULT;
  private method = 0;
  private url = '';
  private statusCode = 0;
  private statusMessage = '';
  private versionMajor = 1;
  private versionMinor = 1;
  private upgrade = false;
  private shouldKeepAlive = true;
  private contentLength = -1;
  private bodyRemaining = 0;
  private chunkRemaining = 0;
  private messageDone = false;
  private finished = false;
  private currentBuffer: Uint8Array | null = null;

  constructor() {
    // callback slots default to null like llhttp's
  }

  initialize(type: number, _resource: any, maxHeaderSize: number | undefined,
             _lenientFlags?: number, _connections?: number): void {
    this.type = type;
    this.maxHeaderSize = maxHeaderSize && maxHeaderSize > 0
      ? maxHeaderSize : MAX_HEADER_BYTES_DEFAULT;
    this.reset();
  }

  private reset(): void {
    this.state = S_IDLE;
    this.partial = '';
    this.headerBytes = 0;
    this.method = 0;
    this.url = '';
    this.statusCode = 0;
    this.statusMessage = '';
    this.versionMajor = 1;
    this.versionMinor = 1;
    this.upgrade = false;
    this.shouldKeepAlive = true;
    this.contentLength = -1;
    this.bodyRemaining = 0;
    this.chunkRemaining = 0;
    this.messageDone = false;
    this.finished = false;
  }

  getCurrentBuffer(): Uint8Array {
    return this.currentBuffer ?? new Uint8Array(0);
  }

  // ---- lifecycle surface the lib calls ------------------------------------
  consume(_handle: any): void { /* StreamBase consumption not provided */ }
  unconsume(): void {}
  remove() {}
  free() {}
  close() {}
  resume() {}
  pause() {}
  timeout(_msecs: number, _cb?: () => void) {}

  /**
   * Feed bytes. Returns the number of bytes consumed, or an Error. Complete
   * messages are dispatched in order (pipelining). An upgraded request
   * pauses at its message boundary: the return value is the offset of the
   * body head, and kOnExecute(consumed) fires — exactly the contract
   * node's server uses to slice the upgrade payload.
   */
  execute(buf: Uint8Array): number | Error {
    if (this.finished) return 0;
    this.currentBuffer = buf;
    let pos = 0;
    let guard = 0;

    while (pos < buf.length || this.messageDone) {
      if (this.messageDone) {
        // A message just completed — dispatch completion, then continue.
        this.messageDone = false;
        if (this.upgrade) {
          // llhttp contract (verified against real node v24 http.Server,
          // /tmp ground-truth): for an Upgrade request the parser fires
          // on_message_complete at the end of the message (headers + any
          // body) and THEN pauses with the leftover as the upgrade payload.
          // node's onParserExecuteCommon reads parser.incoming.complete —
          // set by kOnMessageComplete — to decide between handing the app
          // the RAW socket (complete) or an UpgradeStream wrapper that only
          // activates after the body finishes (incomplete). Skipping the
          // completion callback here left req.complete=false: the app got
          // the wrapper, the old parser stayed attached to the socket and
          // silently ate every post-handshake byte (all WS frames).
          this.emitMessageComplete();
          const cb = this[K_ON_EXECUTE];
          if (typeof cb === 'function') {
            try { cb.call(this, pos); } catch { /* surfaced by node's own error paths */ }
          }
          return pos;
        }
        this.emitMessageComplete();
        if (this.state !== S_IDLE) continue; // e.g. skip-body path advanced
        continue;
      }
      const before = pos;
      const r = this.step(buf, pos);
      if (r instanceof Error) return r;
      pos = r;
      if (pos === before && !this.messageDone) break; // need more bytes
      if (++guard > 1_000_000) return parseError('INVALID_STATE', 'parser loop guard');
    }
    return pos;
  }

  /** Socket EOF: mid-message = premature-close error; otherwise fine. */
  finish(): number | Error {
    if (this.messageDone) {
      this.messageDone = false;
      this.emitMessageComplete();
    }
    if (this.state === S_IDLE && this.partial === '') {
      this.finished = true;
      return 0;
    }
    if (this.state === S_BODY_LEN && this.bodyRemaining === Infinity) {
      // Read-until-close body: EOF IS the message terminator.
      this.finished = true;
      return 0;
    }
    return parseError('INVALID_EOF_STATE', 'premature close');
  }

  // ------------------------------------------------------------------ states
  private step(buf: Uint8Array, pos: number): number | Error {
    switch (this.state) {
      case S_IDLE: {
        const line = this.takeLine(buf, pos);
        if (line === null) return buf.length;
        if (!this.parseFirstLine(line.line)) {
          return parseError('INVALID_VERSION', 'malformed HTTP start line');
        }
        this.state = S_HEADERS;
        this.headerBytes = 0;
        this.headersAccum = [];
        return line.nextPos;
      }
      case S_HEADERS: {
        const line = this.takeLine(buf, pos);
        if (line === null) return buf.length;
        if (line.line === '') {
          const err = this.completeHeaders();
          if (err) return err;
          return line.nextPos;
        }
        this.headerBytes += line.line.length + 2;
        if (this.headerBytes > this.maxHeaderSize) {
          return parseError('HEADER_OVERFLOW', 'header size exceeds maximum');
        }
        this.pushHeader(line.line);
        return line.nextPos;
      }
      case S_BODY_LEN: {
        const available = buf.length - pos;
        if (available <= 0) return pos;
        if (this.bodyRemaining === Infinity) {
          this.emitBody(buf.subarray(pos));
          return buf.length;
        }
        const take = Math.min(available, this.bodyRemaining);
        if (take > 0) this.emitBody(buf.subarray(pos, pos + take));
        this.bodyRemaining -= take;
        if (this.bodyRemaining === 0) this.messageDone = true;
        return pos + take;
      }
      case S_BODY_CHUNK_SIZE: {
        const line = this.takeLine(buf, pos);
        if (line === null) return buf.length;
        const text = line.line.trim();
        const semi = text.indexOf(';');
        const sizeStr = semi >= 0 ? text.slice(0, semi) : text;
        const size = parseInt(sizeStr, 16);
        if (!/^[0-9a-fA-F]+$/.test(sizeStr) || !Number.isFinite(size)) {
          return parseError('INVALID_CHUNK_SIZE', 'invalid chunk size');
        }
        if (size === 0) {
          this.state = S_TRAILERS;
        } else {
          this.chunkRemaining = size;
          this.state = S_BODY_CHUNK_DATA;
        }
        return line.nextPos;
      }
      case S_BODY_CHUNK_DATA: {
        const available = buf.length - pos;
        if (available <= 0) return pos;
        const take = Math.min(available, this.chunkRemaining);
        if (take > 0) this.emitBody(buf.subarray(pos, pos + take));
        this.chunkRemaining -= take;
        if (this.chunkRemaining === 0) this.state = S_BODY_CHUNK_CRLF;
        return pos + take;
      }
      case S_BODY_CHUNK_CRLF: {
        if (buf.length - pos < 2) return pos;
        if (buf[pos] !== 0x0d || buf[pos + 1] !== 0x0a) {
          return parseError('INVALID_CHUNK', 'missing CRLF after chunk data');
        }
        this.state = S_BODY_CHUNK_SIZE;
        return pos + 2;
      }
      case S_TRAILERS: {
        const line = this.takeLine(buf, pos);
        if (line === null) return buf.length;
        if (line.line === '') {
          this.messageDone = true;
          return line.nextPos;
        }
        // Trailer lines are consumed and ignored (node appends them as
        // trailing headers only via _headers; safe to drop here).
        return line.nextPos;
      }
      default:
        return parseError('INVALID_STATE', 'unknown parser state');
    }
  }

  /** Pull one CRLF-terminated line; null when incomplete. The leftover
   *  input after the line stays in `buf` (re-fed by the next step call);
   *  `partial` only ever carries text from a PREVIOUS execute() input.
   *
   *  PERF (S3.1): the previous implementation appended the ENTIRE remaining
   *  buffer to `partial` one byte at a time on every call — O(headers ×
   *  bodySize) string building (measured 1.87 ms parsing a 16 KB response;
   *  ~200 ms class on MB-scale Vite bundles). This version scans for the
   *  CRLF bytes directly and only stringifies the line itself, so body
   *  bytes are never touched and each call is O(line length). */
  private takeLine(buf: Uint8Array, pos: number): { line: string; nextPos: number } | null {
    // Fast path: complete CRLF inside this input.
    let idx = -1;
    for (let i = pos; i < buf.length; i++) {
      if (buf[i] !== 0x0d) continue;
      if (i + 1 < buf.length) {
        if (buf[i + 1] === 0x0a) { idx = i; break; }
        continue; // bare CR — not a terminator, keep scanning
      }
      break; // trailing CR: may be the first half of a split CRLF — fall to carry
    }
    if (idx >= 0) {
      const line = this.partial + latin1Range(buf, pos, idx);
      this.partial = '';
      return { line, nextPos: idx + 2 };
    }
    // No complete CRLF: carry the unconsumed bytes as partial text (a line
    // spanning execute() boundaries).
    this.partial += latin1Range(buf, pos, buf.length);
    return null;
  }

  // ------------------------------------------------------------------ pieces
  private parseFirstLine(line: string): boolean {
    if (this.type === HTTPParser.REQUEST) {
      const sp1 = line.indexOf(' ');
      if (sp1 < 0) return false;
      const sp2 = line.indexOf(' ', sp1 + 1);
      if (sp2 < 0) return false;
      const method = line.slice(0, sp1);
      this.url = line.slice(sp1 + 1, sp2);
      const version = line.slice(sp2 + 1);
      const m = /^HTTP\/(\d)\.(\d)$/.exec(version);
      if (!m) return false;
      const idx = METHOD_INDEX.get(method);
      if (idx === undefined) return false;
      this.method = idx;
      this.versionMajor = Number(m[1]);
      this.versionMinor = Number(m[2]);
    } else {
      const m = /^HTTP\/(\d)\.(\d)\s+(\d{3})(?:\s(.*))?$/.exec(line);
      if (!m) return false;
      this.versionMajor = Number(m[1]);
      this.versionMinor = Number(m[2]);
      this.statusCode = Number(m[3]);
      this.statusMessage = m[4] ?? '';
    }
    return true;
  }

  private pushHeader(line: string): void {
    const colon = line.indexOf(':');
    if (colon < 0) return;
    this.headersAccum.push(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }
  private headersAccum: string[] = [];

  private headerValue(name: string): string | undefined {
    const lower = name.toLowerCase();
    for (let i = 0; i + 1 < this.headersAccum.length; i += 2) {
      if (this.headersAccum[i].toLowerCase() === lower) return this.headersAccum[i + 1];
    }
    return undefined;
  }

  private completeHeaders(): Error | null {
    // Upgrade requests must carry upgrade=true INTO the headers-complete
    // callback (node checks parser.incoming.upgrade immediately).
    if (this.type === HTTPParser.REQUEST && this.upgradeRequested()) {
      this.upgrade = true;
    }
    // Read body-framing headers BEFORE dispatch clears the accumulator.
    const te = (this.headerValue('transfer-encoding') ?? '').toLowerCase();
    const isChunked = te.includes('chunked');
    const clRaw = this.headerValue('content-length');
    const skip = this.dispatchHeadersComplete();
    if (skip !== 0) {
      // Caller asked to skip the body (CONNECT etc.) → message complete.
      this.messageDone = true;
      return null;
    }

    if (this.type === HTTPParser.REQUEST && this.upgrade) {
      this.messageDone = true; // pause with body-head leftover
      return null;
    }
    if (this.type === HTTPParser.RESPONSE) {
      const noBody = (this.statusCode >= 100 && this.statusCode < 200) ||
        this.statusCode === 204 || this.statusCode === 304;
      if (noBody) {
        this.messageDone = true;
        return null;
      }
    }
    if (isChunked) {
      this.state = S_BODY_CHUNK_SIZE;
    } else if (clRaw !== undefined) {
      const cl = parseInt(clRaw.trim(), 10);
      if (!Number.isFinite(cl) || cl < 0) {
        return parseError('INVALID_CONTENT_LENGTH', 'invalid content-length');
      }
      this.contentLength = cl;
      this.bodyRemaining = cl;
      if (cl === 0) this.messageDone = true;
      else this.state = S_BODY_LEN;
    } else if (this.type === HTTPParser.RESPONSE) {
      this.bodyRemaining = Infinity; // read until close
      this.state = S_BODY_LEN;
    } else {
      this.messageDone = true; // request without body
    }
    return null;
  }

  private upgradeRequested(): boolean {
    const conn = (this.headerValue('connection') ?? '').toLowerCase();
    return conn.includes('upgrade') && !!this.headerValue('upgrade');
  }

  private dispatchHeadersComplete(): number {
    const cb = this[K_ON_HEADERS_COMPLETE];
    const conn = (this.headerValue('connection') ?? '').toLowerCase();
    this.shouldKeepAlive =
      this.versionMajor === 1 && this.versionMinor === 1
        ? !conn.includes('close')
        : conn.includes('keep-alive');
    if (typeof cb !== 'function') {
      this.headersAccum = [];
      return 0;
    }
    const headers = this.headersAccum;
    this.headersAccum = [];
    const result = cb.call(this,
      this.versionMajor, this.versionMinor, headers,
      this.type === HTTPParser.REQUEST ? this.method : undefined,
      this.type === HTTPParser.REQUEST ? this.url : undefined,
      this.type === HTTPParser.RESPONSE ? this.statusCode : undefined,
      this.type === HTTPParser.RESPONSE ? this.statusMessage : undefined,
      this.upgrade, this.shouldKeepAlive,
    );
    return typeof result === 'number' ? result : 0;
  }

  private emitMessageComplete(): void {
    this.state = S_IDLE;
    this.partial = '';
    const cb = this[K_ON_MESSAGE_COMPLETE];
    if (typeof cb === 'function') {
      try { cb.call(this); } catch { /* surfaced by node's error paths */ }
    }
  }

  private emitBody(bytes: Uint8Array): void {
    const cb = this[K_ON_BODY];
    if (typeof cb !== 'function') return;
    const B = (globalThis as any).Buffer;
    const chunk = B && typeof B.from === 'function' ? B.from(bytes) : bytes;
    try { cb.call(this, chunk); } catch { /* node's own paths surface these */ }
  }
}

/** node's C++ ConnectionsList: tracks live/idle connections for the
 *  connections-checking interval. JS implementation over a Set. */
class ConnectionsList {
  private connections = new Set<any>();
  addConnection(connection: any): void { this.connections.add(connection); }
  removeConnection(connection: any): void { this.connections.delete(connection); }
  idle(): any[] {
    return [...this.connections].filter((c: any) => c.writable && !c.writableEnded);
  }
  all(): any[] { return [...this.connections]; }
  expired(_headersTimeout: number, _requestTimeout: number): any[] { return []; }
}

export function makeHttpParserBinding(_ctx: NativesContext): Binding {
  return {
    HTTPParser,
    ConnectionsList,
    methods: METHODS,
    allMethods: ALL_METHODS,
    modes: { lenient: 1, strict: 0 },
    version: '9.1.0',
    isHeaderFieldValueValid(value: string): boolean {
      return !/[^\t\x20-\x7e\x80-\xff]/.test(value);
    },
  };
}
