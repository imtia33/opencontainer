import type { Binding } from './index';

/** internalBinding('encoding_binding') & ('string_decoder') — TextDecoder. */
export function makeEncodingBinding(): Binding {
  const decoderCache = new Map<string, TextDecoder>();

  function getDecoder(enc: string): TextDecoder {
    let d = decoderCache.get(enc);
    if (!d) {
      try { d = new TextDecoder(enc); } catch { d = new TextDecoder('utf-8'); }
      decoderCache.set(enc, d);
    }
    return d;
  }

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
  };
}
