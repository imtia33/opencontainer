import type { Binding } from './index';

/**
 * internalBinding('encoding_binding') & ('string_decoder').
 *
 * The natives are captured at MODULE LOAD: guest code (Go's wasm_exec glue —
 * esbuild-wasm — and others) legitimately assigns
 * `globalThis.TextEncoder = require('util').TextEncoder` (node semantics:
 * same object). After this binding, the vendored util's classes WORK, so the
 * assignment is harmless — but the capture also guards against any guest
 * that swaps in something exotic mid-process.
 */
const NativeTextEncoder: typeof TextEncoder =
  (globalThis as any).TextEncoder ?? class TextEncoder { encode(): any { throw new Error('no TextEncoder'); } };
const NativeTextDecoder: typeof TextDecoder =
  (globalThis as any).TextDecoder ?? class TextDecoder { decode(): any { throw new Error('no TextDecoder'); } };
const nativeEncoder = new NativeTextEncoder();
const nativeDecoder = new NativeTextDecoder();

export function makeEncodingBinding(): Binding {
  const decoderCache = new Map<string, TextDecoder>();

  function getDecoder(enc: string): TextDecoder {
    let d = decoderCache.get(enc);
    if (!d) {
      try { d = new NativeTextDecoder(enc); } catch { d = new NativeTextDecoder('utf-8'); }
      decoderCache.set(enc, d);
    }
    return d;
  }

  /** node's encodeIntoResults: [read, written] tuple the C++ binding updates
   *  and internal/encoding.js re-reads after each call. */
  const encodeIntoResults = [0, 0];

  return {
    TextDecoder: class BindingTextDecoder {
      decode(buf: Uint8Array | ArrayBuffer, opts?: any) {
        return getDecoder((this as any).encoding ?? 'utf-8').decode(buf as any, opts);
      }
    },
    // node's internal/string_decoder uses:
    kEndOfBuffer: Symbol('nodejs.stringdecoder.end_of_buffer'),
    encodings: ['utf8', 'utf16le', 'latin1', 'ascii', 'base64', 'hex'],
    getDecoder: (enc: string) => getDecoder(enc),
    encodingNames: ['utf8', 'utf-8', 'latin1', 'binary', 'base64', 'hex', 'ucs2', 'utf16le'],
    internalEndOfStream: Symbol('nodejs.stringdecoder.eos'),
    // ---- WHATWG TextEncoder/TextDecoder engine (internal/encoding.js) ----
    // encodeUtf8String: node returns a FastBuffer; a Uint8Array is the
    // browser-observable subset (Buffer extends Uint8Array) — the vendored
    // TextEncoder returns it directly from encode().
    encodeUtf8String: (s: string): Uint8Array => nativeEncoder.encode(s),
    /** decodeUTF8(input, ignoreBOM, fatal) — the internal/encoding.js call
     *  shape (BOM stripping is handled by the caller's prefix logic; the
     *  native decoder's ignoreBOM option covers it). */
    decodeUTF8: (input: Uint8Array, ignoreBom?: boolean, _fatal?: boolean): string => {
      try {
        return nativeDecoder.decode(input as any, ignoreBom ? { ignoreBOM: true } : undefined);
      } catch {
        // fatal decoding of invalid UTF-8: mirror node by throwing — but a
        // decode failure with fatal=false must never throw.
        return nativeDecoder.decode(input as any);
      }
    },
    encodeInto: (src: string, dest: Uint8Array): void => {
      const r = nativeEncoder.encodeInto(src, dest as any);
      encodeIntoResults[0] = r.read;
      encodeIntoResults[1] = r.written;
    },
    encodeIntoResults,
  };
}
