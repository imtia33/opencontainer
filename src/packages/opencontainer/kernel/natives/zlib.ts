import type { Binding } from './index';

import {
  Zlib as FflateZlib,
  Unzlib as FflateUnzlib,
  Gzip as FflateGzip,
  Gunzip as FflateGunzip,
  Deflate as FflateDeflate,
  Inflate as FflateInflate,
} from 'fflate';

/**
 * zlib-as-loop-handle accounting (same discipline as net-pending.ts): an
 * async compression write that has not called its completion callback yet
 * is a live uv req in real node — the loop-drain watcher must not reap the
 * process under it. boot.ts consults zlibPendingCount() in its census.
 */
let zlibPending = 0;
/** Number of guest zlib writes currently awaiting completion. */
export function zlibPendingCount(): number {
  return zlibPending;
}

/**
 * internalBinding('zlib') — compression, fflate-backed.
 *
 * REAL (fflate, MIT — inlined into the kernel worker bundle):
 *   - crc32 (table-based IEEE CRC-32, zlib chaining convention)
 *   - the full Zlib handle protocol for all 7 classic modes driven by node's
 *     lib/zlib.js: DEFLATE / INFLATE (zlib format), GZIP / GUNZIP,
 *     DEFLATERAW / INFLATERAW, UNZIP (auto-detect). This is what npm's
 *     tar → minizlib extraction path runs on.
 *
 * The handle implements the exact protocol lib/zlib.js drives:
 *   new binding.Zlib(mode)
 *   handle.init(windowBits, level, memLevel, strategy, writeState,
 *               processCallback, dictionary, rejectGarbageAfterEnd)
 *   handle.write(flushFlag, in, inOff, inLen, out, outOff, outLen)   // async
 *   handle.writeSync(...)                                            // sync
 *   handle.close() / handle.reset() / handle.params(level, strategy)
 * plus expando properties lib/zlib.js sets ([owner_symbol], .onerror,
 * .buffer, .cb, .availInBefore, .availOutBefore, .inOff, .flushFlag) and
 * the `jsref` accessor lib/zlib.js defines on the prototype at module load.
 *
 * Documented divergences (see COMPATIBILITY.md):
 *   - windowBits / memLevel / strategy are accepted and ignored (fflate picks
 *     its own windowing; level IS honored).
 *   - params(level) takes effect at the next emitted block (no mid-stream
 *     flush point is inserted); strategy is ignored.
 *   - Z_SYNC_FLUSH/Z_FULL_FLUSH/Z_BLOCK on compression sides force fflate's
 *     flush() — an empty stored block is emitted for sync flushes (matching
 *     zlib framing); decompression sides ignore flush flags (as zlib does).
 *   - Brotli / Zstd handles remain honest ENOSYS stubs (fflate has none).
 *
 * NOTE: every class here is created INSIDE makeZlibBinding(). They must never
 * be hoisted to module scope: node's lib/zlib.js defines a NON-configurable
 * `jsref` accessor on binding.Zlib.prototype at module load, so a shared
 * prototype breaks the second kernel boot in the same JS realm (the bun
 * harness boots several kernels per process; the browser uses one worker per
 * process but worker recycling would hit the same wall).
 */

// ---- flush-flag constants (mirror zlib) ------------------------------------
const Z_NO_FLUSH = 0;
const Z_SYNC_FLUSH = 2;
const Z_FULL_FLUSH = 3;
const Z_FINISH = 4;
const Z_BLOCK = 5;
const Z_TREES = 6;

// ---- mode constants (must match internalBinding('constants').zlib) ---------
const MODE_DEFLATE = 1;
const MODE_INFLATE = 2;
const MODE_GZIP = 3;
const MODE_GUNZIP = 4;
const MODE_DEFLATERAW = 5;
const MODE_INFLATERAW = 6;
const MODE_UNZIP = 7;

const EMPTY = new Uint8Array(0);

/**
 * node's UNZIP mode auto-detects gzip vs zlib from the first two bytes
 * (0x1f 0x8b → gzip). fflate's own `Unzip` class is a ZIP-archive reader
 * (requires registered file handlers), NOT this — so we sniff and delegate.
 */
function makeUnzipAutoStream(): any {
  const wrapper: any = {
    ondata: null as ((data: Uint8Array) => void) | null,
    _buf: [] as Uint8Array[],
    _bufLen: 0,
    _inner: null as any,
    push(chunk: Uint8Array, final: boolean): void {
      if (this._inner) return this._inner.push(chunk, final);
      if (chunk.length > 0) { this._buf.push(chunk); this._bufLen += chunk.length; }
      if (this._bufLen < 2) {
        if (final) {
          const inner: any = new FflateUnzlib();
          inner.ondata = (d: Uint8Array) => { if (d && d.length) wrapper.ondata?.(d); };
          this._inner = inner;
          for (const c of this._buf) inner.push(c, false);
          inner.push(EMPTY, true);
        }
        return;
      }
      const head = new Uint8Array(2);
      let n = 0;
      for (const c of this._buf) {
        const take = Math.min(c.length, 2 - n);
        head.set(c.subarray(0, take), n);
        n += take;
        if (n >= 2) break;
      }
      const inner: any = (head[0] === 0x1f && head[1] === 0x8b)
        ? new FflateGunzip()
        : new FflateUnzlib();
      inner.ondata = (d: Uint8Array) => { if (d && d.length) wrapper.ondata?.(d); };
      this._inner = inner;
      for (const c of this._buf) inner.push(c, false);
      if (final) inner.push(EMPTY, true);
    },
  };
  return wrapper;
}

// ---- CRC-32 (IEEE 802.3, reflected, poly 0xEDB88320) ----------------------
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

/**
 * zlib's crc32(crc, buf, len) convention: callers pass the previous return
 * value to chain; 0 starts fresh. Internally zlib keeps the complemented
 * state, so we invert on entry/exit exactly like zlib's crc32().
 */
function crc32(data: Uint8Array | string, value = 0): number {
  let crc = (value >>> 0) ^ 0xffffffff;
  // Strings encode as UTF-8 (node's C++ feeds the raw string bytes).
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const BROTLI_ZSTD_STUB =
  'OpenContainer: node:zlib Brotli/Zstd streams are not implemented (no ' +
  'browser-side brotli/zstd codec is vendored). DEFLATE/GZIP/RAW/UNZIP are real.';

export function makeZlibBinding(): Binding {
  /** Normalize an fflate error into a zlib-shaped one. */
  const zerr = (e: any): { message: string; errno: number; code: string } => {
    const message = String(e?.message ?? e ?? 'zlib error');
    return { message: `OpenContainer: ${message}`, errno: -3, code: 'Z_DATA_ERROR' };
  };

  abstract class HandleBase {
    /** Set by lib/zlib.js (zlibOnError). */
    onerror: ((message: string, errno: number, code: string) => void) | null = null;

    protected writeState: Uint32Array | null = null;
    protected processCb: ((this: HandleBase) => void) | null = null;
    protected rejectGarbageAfterEnd = false;
    protected pending: Uint8Array[] = [];
    protected finished = false;
    protected closed = false;

    init(
      _windowBits: number,
      _level: number | undefined,
      _memLevel: number | undefined,
      _strategy: number | undefined,
      writeState: Uint32Array,
      processCallback: (this: HandleBase) => void,
      _dictionary?: Uint8Array | null,
      rejectGarbageAfterEnd?: boolean,
    ): void {
      this.writeState = writeState;
      this.processCb = processCallback;
      this.rejectGarbageAfterEnd = rejectGarbageAfterEnd === true;
    }

    /** Feed input into the codec. Throws on corrupt data. */
    protected abstract process(
      flushFlag: number, in_: Uint8Array, inOff: number, inLen: number,
    ): void;

    /** Copy pending output into the caller's buffer, update writeState. */
    protected drain(out: Uint8Array, outOff: number, outLen: number): void {
      let copied = 0;
      while (this.pending.length > 0 && copied < outLen) {
        const head = this.pending[0];
        const take = Math.min(head.length, outLen - copied);
        if (take === head.length) {
          out.set(head, outOff + copied);
          this.pending.shift();
        } else {
          out.set(head.subarray(0, take), outOff + copied);
          this.pending[0] = head.subarray(take);
        }
        copied += take;
      }
      if (this.writeState) {
        this.writeState[0] = outLen - copied; // avail_out_after
        this.writeState[1] = 0;               // input fully consumed
      }
    }

    protected raise(e: any): never {
      const { message, errno, code } = zerr(e);
      // Mirror node's flow: zlibOnError destroys the stream with the error;
      // writeSync additionally throws (node_zlib.cc raises a JS exception).
      this.onerror?.(message, errno, code);
      const err: any = new Error(message);
      err.errno = errno;
      err.code = code;
      throw err;
    }

    close(): void {
      this.closed = true;
      this.pending = [];
    }

    reset(): void {
      this.pending = [];
      this.finished = false;
    }

    params(_level: number, _strategy: number): void { /* documented no-op */ }
  }

  /** The 7 classic modes — one fflate streaming codec each. */
  class ZlibHandle extends HandleBase {
    private mode: number;
    private stream: any = null;
    private opts: any;

    constructor(mode: number) {
      super();
      this.mode = mode;
    }

    init(
      windowBits: number,
      level: number | undefined,
      memLevel: number | undefined,
      strategy: number | undefined,
      writeState: Uint32Array,
      processCallback: (this: HandleBase) => void,
      dictionary?: Uint8Array | null,
      rejectGarbageAfterEnd?: boolean,
    ): void {
      super.init(windowBits, level, memLevel, strategy, writeState,
        processCallback as () => void, dictionary, rejectGarbageAfterEnd);
      const opts: any = {};
      if (typeof level === 'number' && level >= 0 && level <= 9) opts.level = level;
      if (dictionary && dictionary.byteLength > 0) {
        opts.dictionary = dictionary instanceof Uint8Array
          ? dictionary : new Uint8Array(dictionary);
      }
      this.opts = opts;
      this.stream = this.makeStream(opts);
    }

    private makeStream(opts: any): any {
      let stream: any;
      switch (this.mode) {
        case MODE_DEFLATE: stream = new FflateZlib(opts); break;      // zlib format
        case MODE_INFLATE: stream = new FflateUnzlib(opts); break;
        case MODE_GZIP: stream = new FflateGzip(opts); break;
        case MODE_GUNZIP: stream = new FflateGunzip(opts); break;
        case MODE_DEFLATERAW: stream = new FflateDeflate(opts); break; // raw
        case MODE_INFLATERAW: stream = new FflateInflate(opts); break;
        case MODE_UNZIP: stream = makeUnzipAutoStream(); break;       // sniff → gunzip/zlib
        default: {
          const err: any = new Error(`OpenContainer: unsupported zlib mode ${this.mode}`);
          err.code = 'ENOSYS';
          throw err;
        }
      }
      // fflate sync stream classes: ondata(data, final) — errors are THROWN
      // synchronously by push() (the constructor cb is the (err, data, final)
      // variant, which we deliberately don't use).
      stream.ondata = (data: Uint8Array) => {
        if (data && data.length > 0) this.pending.push(data);
      };
      return stream;
    }

    protected process(flushFlag: number, in_: Uint8Array, inOff: number, inLen: number): void {
      if (this.closed || !this.stream) return;
      const chunk = inLen > 0 ? in_.subarray(inOff, inOff + inLen) : EMPTY;
      if (this.finished) {
        // Stream finalized earlier — trailing bytes.
        if (chunk.length > 0 && this.rejectGarbageAfterEnd) {
          this.onerror?.(
            'OpenContainer: trailing junk after end of stream',
            -3, 'ERR_TRAILING_JUNK_AFTER_STREAM_END');
        }
        return; // node's default (rejectGarbageAfterEnd=false) ignores them
      }
      const final = flushFlag === Z_FINISH;
      try {
        if (final) {
          this.stream.push(chunk, true);
          this.finished = true;
        } else if (chunk.length > 0) {
          this.stream.push(chunk, false);
        }
        // Compression-side flush flags: force emission of buffered input so
        // the peer can decompress everything pushed so far (zlib framing).
        if (!final && this.mode !== MODE_INFLATE && this.mode !== MODE_GUNZIP
          && this.mode !== MODE_INFLATERAW && this.mode !== MODE_UNZIP
          && (flushFlag === Z_SYNC_FLUSH || flushFlag === Z_FULL_FLUSH
            || flushFlag === Z_BLOCK || flushFlag === Z_TREES)
          && typeof this.stream.flush === 'function') {
          this.stream.flush(flushFlag === Z_SYNC_FLUSH);
        }
      } catch (e) {
        this.finished = true; // there is no way to cleanly recover
        this.raise(e);
      }
    }

    write(
      flushFlag: number, in_: Uint8Array, inOff: number, inLen: number,
      out: Uint8Array, outOff: number, outLen: number,
    ): void {
      try {
        this.process(flushFlag, in_, inOff, inLen);
      } catch {
        // Async path: never throw synchronously — the error already went
        // through onerror (stream destroyed); processCallback observes
        // `destroyed` and completes the pending callback. This mirrors
        // node's threadpool completion ordering.
        this.drain(out, outOff, 0);
        this.writeState![0] = outLen;
        this.writeState![1] = 0;
        const cb = this.processCb;
        if (cb) {
          zlibPending++;
          queueMicrotask(() => { zlibPending--; (cb as () => void).call(this); });
        }
        return;
      }
      this.drain(out, outOff, outLen);
      const cb = this.processCb;
      if (cb) {
        zlibPending++;
        queueMicrotask(() => { zlibPending--; (cb as () => void).call(this); });
      }
    }

    writeSync(
      flushFlag: number, in_: Uint8Array, inOff: number, inLen: number,
      out: Uint8Array, outOff: number, outLen: number,
    ): void {
      this.process(flushFlag, in_, inOff, inLen);
      this.drain(out, outOff, outLen);
    }

    reset(): void {
      super.reset();
      if (this.opts !== undefined) this.stream = this.makeStream(this.opts);
    }

    params(level: number, _strategy: number): void {
      // fflate reads opts at each emitted block: a level change applies to
      // the next block (no mid-stream flush point — documented divergence).
      if (this.stream?.o && typeof level === 'number') this.stream.o.level = level;
    }
  }

  // ---- Brotli / Zstd: honest ENOSYS stubs (no vendored codec) --------------
  class EnosysHandle {
    onerror: ((m: string, e: number, c: string) => void) | null = null;
    init(..._args: any[]): never {
      const err: any = new Error(BROTLI_ZSTD_STUB);
      err.code = 'ENOSYS';
      err.errno = 38;
      throw err;
    }
  }

  return {
    crc32,
    Zlib: ZlibHandle,
    BrotliDecoder: EnosysHandle,
    BrotliEncoder: EnosysHandle,
    ZstdCompress: EnosysHandle,
    ZstdDecompress: EnosysHandle,
  };
}
