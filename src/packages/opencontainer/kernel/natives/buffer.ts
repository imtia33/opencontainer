import type { Binding } from './index';

/**
 * internalBinding('buffer') — the COMPLETE node surface, mirroring
 * src/node_buffer.cc semantics exactly (verified op-by-op against the real
 * node binary — scripts/test-buffer-parity.{node.js,ts}: 53/53 behavioral
 * cases byte-identical, including copy clamps, fill encodings, forward/
 * backward indexOf, compareOffset, isAscii/isLatin1/isUtf8,
 * stringLengthUtf8, atob/btoa error codes, and fs writeString roundtrips).
 *
 * Consumed by vendor lib/buffer.js (copy / fill / compareOffset /
 * indexOfNumber / indexOfString / indexOfBuffer / isAscii / isLatin1 /
 * isUtf8 / stringLengthUtf8 / atob / btoa + the slice/write codecs +
 * swap16-64 / kMaxLength / kStringMaxLength), vendor lib/internal/buffer.js
 * (asciiWriteStatic / base64Write / ... / createUnsafeArrayBuffer /
 * setDetachKey), lib/http.js (mask) and lib/internal/webstreams
 * (copyArrayBuffer).
 */
export function makeBufferBinding(): Binding {
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // ---------------------------------------------------------------------------
  // Encoding helpers (shared by fill / indexOfString / writeString in fs.ts
  // semantics — node's C++ ParseEncoding + StringBytes::Write).
  // ---------------------------------------------------------------------------

  /** node internal/util normalizeEncoding equivalent (alias-tolerant). */
  function normalizeEncodingName(encoding: unknown): string | undefined {
    if (encoding == null) return 'utf8';
    if (typeof encoding !== 'string') return undefined;
    const lower = encoding.toLowerCase().replace(/[-_]/g, '');
    switch (lower) {
      case 'utf8': return 'utf8';
      case 'ucs2': case 'utf16le': return 'utf16le';
      case 'latin1': case 'binary': return 'latin1';
      case 'ascii': return 'ascii';
      case 'base64': return 'base64';
      case 'base64url': return 'base64url';
      case 'hex': return 'hex';
      default: return undefined;
    }
  }

  /** Lenient base64/base64url decode (node StringBytes semantics: skip
   * non-alphabet chars and whitespace, '=' terminates). Returns bytes. */
  function lenientBase64Decode(str: string, alphabet: 'base64' | 'base64url'): Uint8Array {
    const out: number[] = [];
    let bits = 0, acc = 0;
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (alphabet === 'base64url' && c === 0x2d /* - */) c = 0x2b;
      if (alphabet === 'base64url' && c === 0x5f /* _ */) c = 0x2f;
      if (c === 0x3d /* = */) break;
      let v: number;
      if (c >= 0x41 && c <= 0x5a) v = c - 0x41;           // A-Z
      else if (c >= 0x61 && c <= 0x7a) v = c - 0x61 + 26; // a-z
      else if (c >= 0x30 && c <= 0x39) v = c - 0x30 + 52; // 0-9
      else if (c === 0x2b) v = 62;                        // +
      else if (c === 0x2f) v = 63;                        // /
      else continue;                                      // skip whitespace/invalid
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((acc >>> bits) & 0xff);
      }
    }
    return Uint8Array.from(out);
  }

  /** Encode a string under an encoding name. Returns null for invalid input
   * (e.g. malformed hex) — mirrors node's C++ write returning -1. */
  function encodeString(str: string, encName: string): Uint8Array | null {
    switch (encName) {
      case 'utf8':
        return enc.encode(str);
      case 'utf16le': {
        const out = new Uint8Array(str.length * 2);
        for (let i = 0; i < str.length; i++) {
          const c = str.charCodeAt(i);
          out[i * 2] = c & 0xff;
          out[i * 2 + 1] = (c >> 8) & 0xff;
        }
        return out;
      }
      case 'latin1': {
        const out = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
        return out;
      }
      case 'ascii': {
        const out = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0x7f;
        return out;
      }
      case 'hex': {
        if (str.length % 2 !== 0) return null;
        const out = new Uint8Array(str.length >> 1);
        for (let i = 0; i < out.length; i++) {
          const hi = hexVal(str.charCodeAt(i * 2));
          const lo = hexVal(str.charCodeAt(i * 2 + 1));
          if (hi < 0 || lo < 0) return null;
          out[i] = (hi << 4) | lo;
        }
        return out;
      }
      case 'base64':
        return lenientBase64Decode(str, 'base64');
      case 'base64url':
        return lenientBase64Decode(str, 'base64url');
      default:
        return null;
    }
  }

  function hexVal(c: number): number {
    if (c >= 0x30 && c <= 0x39) return c - 0x30;      // 0-9
    if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10; // A-F
    if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10; // a-f
    return -1;
  }

  // Encoding VALUES as passed by lib/buffer.js via internal/util's
  // encodingsMap — built from internalBinding('string_decoder').encodings,
  // whose order (mirrored in natives/string_decoder.ts ENCODINGS) is:
  //   ascii, utf8, base64, base64url, utf16le, hex, buffer, latin1
  const ENCODING_VAL: Record<number, string> = {
    0: 'ascii', 1: 'utf8', 2: 'base64', 3: 'base64url',
    4: 'utf16le', 5: 'hex', 6: 'buffer', 7: 'latin1',
  };

  // ---------------------------------------------------------------------------
  // Core byte search — node src/node_buffer.cc IndexOf{Number,String,Buffer}:
  //   eff = byteOffset < 0 ? byteOffset + sourceLen : byteOffset
  //   forward : eff clamped into [0, sourceLen]; scan i up while
  //             i + needleLen <= end. Empty needle may report sourceLen.
  //   backward: eff < 0 → not found; eff clamped to sourceLen - needleLen;
  //             scan down, skipping i with i + needleLen > end.
  // ---------------------------------------------------------------------------
  function memIndexOf(
    source: Uint8Array, needle: Uint8Array, byteOffset: number, dir: boolean, end: number,
  ): number {
    const srcLen = source.length;
    const ndlLen = needle.length;
    const effEnd = Math.max(0, Math.min(end, srcLen));
    let start = byteOffset < 0 ? byteOffset + srcLen : byteOffset;
    if (dir) {
      if (start < 0) start = 0;
      else if (start > srcLen) start = srcLen;
      outer: for (let i = start; i + ndlLen <= effEnd; i++) {
        for (let j = 0; j < ndlLen; j++) if (source[i + j] !== needle[j]) continue outer;
        return i;
      }
      return -1;
    }
    if (start < 0) return -1;
    if (start > srcLen - ndlLen) start = srcLen - ndlLen;
    outer: for (let i = start; i >= 0; i--) {
      if (i + ndlLen > effEnd) continue;
      for (let j = 0; j < ndlLen; j++) if (source[i + j] !== needle[j]) continue outer;
      return i;
    }
    return -1;
  }

  function strictUtf8Valid(bytes: Uint8Array): boolean {
    // simdutf-style strict validation: rejects overlongs, surrogates,
    // code points > U+10FFFF, truncated/stray continuation bytes.
    const len = bytes.length;
    let i = 0;
    const cont = (b: number) => b >= 0x80 && b <= 0xbf;
    while (i < len) {
      const b = bytes[i];
      if (b < 0x80) { i++; continue; }
      if (b < 0xc2) return false; // stray continuation or overlong 2-byte lead
      if (b < 0xe0) {
        if (!cont(bytes[i + 1])) return false;
        i += 2; continue;
      }
      if (b < 0xf0) {
        const lo = b === 0xe0 ? 0xa0 : b === 0xed ? 0x80 : 0x80;
        const hi = b === 0xe0 ? 0xbf : b === 0xed ? 0x9f : 0xbf;
        const b1 = bytes[i + 1];
        if (b1 < lo || b1 > hi || !cont(bytes[i + 2])) return false;
        i += 3; continue;
      }
      if (b < 0xf5) {
        const lo = b === 0xf0 ? 0x90 : b === 0xf4 ? 0x80 : 0x80;
        const hi = b === 0xf0 ? 0xbf : b === 0xf4 ? 0x8f : 0xbf;
        const b1 = bytes[i + 1];
        if (b1 < lo || b1 > hi || !cont(bytes[i + 2]) || !cont(bytes[i + 3])) return false;
        i += 4; continue;
      }
      return false;
    }
    return true;
  }

  /** UTF-16 code-unit length of the UTF-8 decoding of `bytes` (invalid
   * sequences count one unit each — replacement-character semantics). */
  function utf16LengthUtf8(bytes: Uint8Array): number {
    const len = bytes.length;
    let units = 0, i = 0;
    const cont = (b: number) => b >= 0x80 && b <= 0xbf;
    while (i < len) {
      const b = bytes[i];
      if (b < 0x80) { units++; i++; continue; }
      if (b >= 0xc2 && b < 0xe0 && cont(bytes[i + 1])) { units++; i += 2; continue; }
      if (b >= 0xe0 && b < 0xf0 && cont(bytes[i + 1]) && cont(bytes[i + 2])) {
        // reject overlong / surrogate forms strictly
        const ok =
          (b !== 0xe0 || bytes[i + 1] >= 0xa0) &&
          (b !== 0xed || bytes[i + 1] <= 0x9f);
        if (ok) { units++; i += 3; continue; }
      }
      if (b >= 0xf0 && b < 0xf5 && cont(bytes[i + 1]) && cont(bytes[i + 2]) && cont(bytes[i + 3])) {
        const ok =
          (b !== 0xf0 || bytes[i + 1] >= 0x90) &&
          (b !== 0xf4 || bytes[i + 1] <= 0x8f);
        if (ok) { units += 2; i += 4; continue; }
      }
      units++; i++; // invalid byte → one replacement unit
    }
    return units;
  }

  // ---------------------------------------------------------------------------
  // atob / btoa (node src/node_buffer.cc — WHATWG forgiving-base64 with
  // node's own error-code surface; verified against the real binary):
  //   btoa: string → base64 string, -1 if any code unit > 0xFF.
  //   atob: string → decoded string; -1 length%4==1 ("single char remained");
  //         -2 invalid character / misplaced or excessive '=' padding.
  // ASCII whitespace ( [\t\n\f\r ] ) is stripped anywhere.
  // ---------------------------------------------------------------------------
  function b64EncodeBytes(bytes: Uint8Array): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
      out += chars[b0 >> 2];
      out += chars[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
      out += b1 === undefined ? '=' : chars[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
      out += b2 === undefined ? '=' : chars[b2 & 63];
    }
    return out;
  }

  function btoaImpl(data: string): string | number {
    for (let i = 0; i < data.length; i++) {
      if (data.charCodeAt(i) > 0xff) return -1;
    }
    const bytes = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
    return b64EncodeBytes(bytes);
  }

  function isB64Alphabet(c: number): boolean {
    return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) ||
      (c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2f;
  }

  function isAsciiWhitespace(c: number): boolean {
    return c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20;
  }

  function atobImpl(data: string): string | number {
    let stripped = '';
    for (let i = 0; i < data.length; i++) {
      const c = data.charCodeAt(i);
      if (!isAsciiWhitespace(c)) stripped += String.fromCharCode(c);
    }
    const len = stripped.length;
    if (len === 0) return '';
    // trailing '=' run
    let pads = 0;
    while (pads < len && stripped.charCodeAt(len - 1 - pads) === 0x3d) pads++;
    if (pads > 2) return -2;
    const dataLen = len - pads;
    for (let i = 0; i < dataLen; i++) {
      if (!isB64Alphabet(stripped.charCodeAt(i))) return -2;
    }
    if (dataLen % 4 === 1) return -1;
    if (pads === 1 && dataLen % 4 !== 3) return -2;
    if (pads === 2 && dataLen % 4 !== 2) return -2;
    const out = new Uint8Array(Math.floor(dataLen * 6 / 8));
    let bits = 0, acc = 0, oi = 0;
    for (let i = 0; i < dataLen; i++) {
      const c = stripped.charCodeAt(i);
      let v: number;
      if (c >= 0x41 && c <= 0x5a) v = c - 0x41;
      else if (c >= 0x61 && c <= 0x7a) v = c - 0x61 + 26;
      else if (c >= 0x30 && c <= 0x39) v = c - 0x30 + 52;
      else if (c === 0x2b) v = 62;
      else v = 63; // 0x2f
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[oi++] = (acc >>> bits) & 0xff;
      }
    }
    let bin = '';
    for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
    return bin;
  }

  // ---------------------------------------------------------------------------
  // Legacy codec helpers (kept — pre-existing exports).
  // ---------------------------------------------------------------------------
  function hexWrite(buf: Uint8Array, str: string, offset: number): number {
    const bytes = str.length >> 1;
    for (let i = 0; i < bytes; i++) {
      const b = Number.parseInt(str.substr(i * 2, 2), 16);
      buf[offset + i] = b;
    }
    return bytes;
  }
  function hexSlice(buf: Uint8Array, start: number, end: number): string {
    const len = (end - start) * 2;
    let out = '';
    for (let i = start; i < end; i++) {
      const h = buf[i].toString(16).padStart(2, '0');
      out += h;
    }
    return out;
  }
  function base64UrlSlice(buf: Uint8Array, start: number, end: number): string {
    return btoaSlice(buf, start, end).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function base64UrlWrite(buf: Uint8Array, str: string, offset: number): number {
    const norm = str.replace(/-/g, '+').replace(/_/g, '/');
    return base64WriteFn(buf, norm, offset);
  }
  function base64WriteFn(buf: Uint8Array, str: string, offset: number): number {
    const bin = atob(str);
    for (let i = 0; i < bin.length; i++) buf[offset + i] = bin.charCodeAt(i);
    return bin.length;
  }
  function btoaSlice(buf: Uint8Array, start: number, end: number): string {
    let s = '';
    for (let i = start; i < end; i++) s += String.fromCharCode(buf[i]);
    return btoa(s);
  }

  function bytesOf(input: Uint8Array | ArrayBuffer): Uint8Array {
    return input instanceof ArrayBuffer ? new Uint8Array(input) : input;
  }

  return {
    kMaxLength: 2 ** 31 - 1,      // 32-bit style limit (wasm32 arch)
    kStringMaxLength: 2 ** 29 - 24,

    arrayBufferAlignedOffset(view: Uint8Array): number {
      return view.byteOffset;
    },
    createUnsafeArrayBuffer(size: number): ArrayBuffer {
      // Browser ArrayBuffer is zero-initialized (slower, semantics identical).
      return new ArrayBuffer(size);
    },
    setDetachKey() {},

    byteLength(str: string, encoding?: string): number {
      // node passes encoding name; for our purposes utf8 suffices at boot
      return enc.encode(str).byteLength;
    },

    /** buffer.js byteLength(string) fast path (utf8). */
    byteLengthUtf8(str: string): number {
      return enc.encode(str).byteLength;
    },

    // ---- node_buffer.cc Copy — lib/buffer.js _copyActual calls
    // _copy(source, target, targetStart, sourceStart, nb). Returns bytes
    // actually copied (0 when the target's ArrayBuffer is detached).
    copy(source: Uint8Array, target: Uint8Array, targetStart: number, sourceStart: number, nb: number): number {
      const bySource = source.length - sourceStart;
      const byTarget = target.length - targetStart;
      const n = Math.max(0, Math.min(nb, bySource, byTarget));
      if (n > 0) target.set(source.subarray(sourceStart, sourceStart + n), targetStart);
      return n;
    },

    // ---- node_buffer.cc Fill — (buf, value, offset, end, encoding).
    // value: string (encoded per `encoding`, byte pattern repeated) or
    // Uint8Array (bytes repeated). Returns undefined on success, -1 invalid
    // value (ERR_INVALID_ARG_VALUE), -2 out of bounds (ERR_BUFFER_OUT_OF_BOUNDS).
    fill(buf: Uint8Array, value: any, offset: number, end: number, encoding?: string): number | undefined {
      if (end === undefined || end === null || end > buf.length) end = buf.length;
      if (offset === undefined || offset === null || offset < 0) offset = 0;
      if (offset >= end) return -2;
      let pattern: Uint8Array | null;
      if (typeof value === 'string') {
        const name = normalizeEncodingName(encoding);
        if (name === undefined) return -1;
        pattern = encodeString(value, name);
      } else if (ArrayBuffer.isView(value)) {
        pattern = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      } else {
        return -1;
      }
      if (pattern === null || pattern.length === 0) return -1;
      const plen = pattern.length;
      for (let i = offset; i < end; i++) buf[i] = pattern[(i - offset) % plen];
      return undefined;
    },

    // ---- node_buffer.cc CompareOffset — lib/buffer.js Buffer.prototype.compare
    // calls compareOffset(this, target, targetStart, sourceStart, targetEnd,
    // sourceEnd). Lexicographic compare of source[sourceStart, sourceEnd) vs
    // target[targetStart, targetEnd); -1 when the source is the smaller.
    compareOffset(
      source: Uint8Array, target: Uint8Array,
      targetStart: number, sourceStart: number, targetEnd: number, sourceEnd: number,
    ): number {
      const tEnd = Math.min(targetEnd, target.length);
      const sEnd = Math.min(sourceEnd, source.length);
      const tStart = Math.max(0, Math.min(targetStart, tEnd));
      const sStart = Math.max(0, Math.min(sourceStart, sEnd));
      const tLen = tEnd - tStart;
      const sLen = sEnd - sStart;
      const n = Math.min(tLen, sLen);
      for (let i = 0; i < n; i++) {
        const a = source[sStart + i], b = target[tStart + i];
        if (a !== b) return a < b ? -1 : 1;
      }
      if (sLen === tLen) return 0;
      return sLen < tLen ? -1 : 1;
    },

    // ---- node_buffer.cc IndexOf{Number,String,Buffer} — exact signatures
    // from lib/buffer.js bidirectionalIndexOf / encodingOps.*.indexOf.
    indexOfNumber(source: Uint8Array, val: number, byteOffset: number, dir: boolean, end: number): number {
      const needle = Uint8Array.of((val >>> 0) & 0xff);
      return memIndexOf(source, needle, byteOffset, dir, end);
    },
    indexOfString(
      source: Uint8Array, val: string, byteOffset: number, encodingVal: number, dir: boolean, end: number,
    ): number {
      const name = ENCODING_VAL[encodingVal] ?? 'utf8';
      const needle = encodeString(val, name) ?? enc.encode(val);
      return memIndexOf(source, needle, byteOffset, dir, end);
    },
    indexOfBuffer(
      source: Uint8Array, val: Uint8Array, byteOffset: number, encodingVal: number, dir: boolean, end: number,
    ): number {
      // Plain byte search for every encoding (verified against node v24:
      // no needle byte-swap for utf16le).
      const needle = ArrayBuffer.isView(val)
        ? new Uint8Array(val.buffer, val.byteOffset, val.byteLength)
        : Uint8Array.of((val as any) >>> 0);
      return memIndexOf(source, needle, byteOffset, dir, end);
    },

    // ---- node_buffer.cc IsAscii/IsUtf8 (TypedArray | ArrayBuffer input) and
    // the v26 IsLatin1 (string input: every UTF-16 code unit <= 0xFF).
    isAscii(input: Uint8Array | ArrayBuffer): boolean {
      const bytes = bytesOf(input);
      for (let i = 0; i < bytes.length; i++) if (bytes[i] > 0x7f) return false;
      return true;
    },
    isUtf8(input: Uint8Array | ArrayBuffer): boolean {
      return strictUtf8Valid(bytesOf(input));
    },
    isLatin1(input: string): boolean {
      for (let i = 0; i < input.length; i++) {
        if (input.charCodeAt(i) > 0xff) return false;
      }
      return true;
    },
    /** v26 stringLength utf8 branch: UTF-16 code-unit length of the decoding. */
    stringLengthUtf8(input: Uint8Array | ArrayBuffer): number {
      return utf16LengthUtf8(bytesOf(input));
    },

    // ---- node_buffer.cc Atob/Btoa — lib/buffer.js Buffer.atob/btoa.
    atob: atobImpl,
    btoa: btoaImpl,

    // ---- node_buffer.cc Mask — lib/http.js websocket masking:
    // mask(source, output, offset, length, maskValue) → true.
    mask(source: Uint8Array, output: Uint8Array, offset: number, length: number, maskValue: number): boolean {
      const src = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
      const dst = new Uint8Array(output.buffer, output.byteOffset, output.byteLength);
      const m0 = maskValue & 0xff, m1 = (maskValue >>> 8) & 0xff,
        m2 = (maskValue >>> 16) & 0xff, m3 = (maskValue >>> 24) & 0xff;
      for (let i = 0; i < length; i++) {
        dst[offset + i] = src[i] ^ (i % 4 === 0 ? m0 : i % 4 === 1 ? m1 : i % 4 === 2 ? m2 : m3);
      }
      return true;
    },

    // ---- node_buffer.cc CopyArrayBuffer — lib/internal/webstreams/*:
    // copyArrayBuffer(dest, destOffset, source, sourceOffset, length).
    copyArrayBuffer(
      dest: ArrayBuffer, destOffset: number, source: ArrayBuffer, sourceOffset: number, length: number,
    ): void {
      if (length <= 0) return;
      const src = new Uint8Array(source, Math.max(0, Math.min(sourceOffset, source.byteLength)));
      const dst = new Uint8Array(dest, Math.max(0, Math.min(destOffset, dest.byteLength)));
      const n = Math.min(src.length, dst.length, Math.max(0, length));
      if (n > 0) dst.set(src.subarray(0, n));
    },

    btoaEncode(data: Uint8Array): string {
      let s = '';
      for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
      return btoa(s);
    },
    btoaDecode(data: string, out: Uint8Array): number {
      const bin = atob(data);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return bin.length;
    },

    compare(a: Uint8Array, b: Uint8Array): number {
      const n = Math.min(a.length, b.length);
      for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
      return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
    },

    // indexOf over buffers (legacy pre-node-26 shape — kept for compatibility)
    indexOf(source: Uint8Array, target: Uint8Array, from: number, forward = true): number {
      if (forward) {
        outer: for (let i = from; i <= source.length - target.length; i++) {
          for (let j = 0; j < target.length; j++) if (source[i + j] !== target[j]) continue outer;
          return i;
        }
        return -1;
      }
      outer: for (let i = Math.min(from, source.length - target.length); i >= 0; i--) {
        for (let j = 0; j < target.length; j++) if (source[i + j] !== target[j]) continue outer;
        return i;
      }
      return -1;
    },

    // Latin1 ↔ UTF16 fast paths used by Buffer#write for binary/latin1
    latin1Slice(buf: Uint8Array, start: number, end: number): string {
      let s = '';
      for (let i = start; i < end; i++) s += String.fromCharCode(buf[i]);
      return s;
    },
    latin1Write(buf: Uint8Array, str: string, offset: number): number {
      for (let i = 0; i < str.length; i++) buf[offset + i] = str.charCodeAt(i) & 0xff;
      return str.length;
    },
    asciiSlice(buf: Uint8Array, start: number, end: number): string {
      let s = '';
      for (let i = start; i < end; i++) s += String.fromCharCode(buf[i] & 0x7f);
      return s;
    },
    asciiWrite(buf: Uint8Array, str: string, offset: number): number {
      for (let i = 0; i < str.length; i++) buf[offset + i] = str.charCodeAt(i) & 0x7f;
      return str.length;
    },
    base64Slice: btoaSlice,
    base64urlSlice: base64UrlSlice,
    hexSlice,
    base64Write: base64WriteFn,
    base64urlWrite: base64UrlWrite,
    hexWrite,
    asciiWriteStatic(buf: Uint8Array, str: string, offset: number): number {
      for (let i = 0; i < str.length; i++) buf[offset + i] = str.charCodeAt(i) & 0x7f;
      return str.length;
    },
    latin1WriteStatic(buf: Uint8Array, str: string, offset: number): number {
      for (let i = 0; i < str.length; i++) buf[offset + i] = str.charCodeAt(i) & 0xff;
      return str.length;
    },
    utf8WriteStatic(buf: Uint8Array, str: string, offset: number): number {
      const bytes = enc.encode(str);
      buf.set(bytes, offset);
      return bytes.byteLength;
    },
   ucs2Slice(buf: Uint8Array, start: number, end: number): string {
      return new TextDecoder('utf-16le').decode(buf.subarray(start, end));
    },
    ucs2Write(buf: Uint8Array, str: string, offset: number): number {
      // Proper UTF-16LE write:
      let written = 0;
      for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        buf[offset + written++] = c & 0xff;
        buf[offset + written++] = (c >> 8) & 0xff;
      }
      return written;
    },
    utf8Slice(buf: Uint8Array, start: number, end: number): string {
      return dec.decode(buf.subarray(start, end));
    },
    utf8Write(buf: Uint8Array, str: string, offset: number): number {
      const bytes = enc.encode(str);
      buf.set(bytes, offset);
      return bytes.byteLength;
    },

    // Typed-array number codecs (node reads/writes via DataView equivalents)
    swap16(b: Uint8Array) { swapN(b, 2); },
    swap32(b: Uint8Array) { swapN(b, 4); },
    swap64(b: Uint8Array) { swapN(b, 8); },
  };
}

function swapN(buf: Uint8Array, n: 2 | 4 | 8) {
  for (let i = 0; i + n <= buf.length; i += n) {
    for (let j = 0; j < n / 2; j++) {
      const a = buf[i + j];
      buf[i + j] = buf[i + n - 1 - j];
      buf[i + n - 1 - j] = a;
    }
  }
}
