import type { Binding } from './index';

/**
 * internalBinding('zlib') — compression.
 *
 * REAL: crc32 (table-based IEEE CRC-32, zlib chaining convention) — used by
 * lib/zlib.js, internal/zip/{archive,entry,dos}.js and installable packages.
 * LOADABLE: the Zlib/Brotli/Zstd handle classes exist so node's lib/zlib.js
 * and internal/zip.js load completely (require('zlib') works — express's
 * body-parser chain needs exactly that).
 * HONEST STUB: handle.init() throws — compression STREAMS (createGzip,
 * createInflate, ...and the sync convenience methods which drive the same
 * handle protocol) land in S3 backed by fflate. Until then every actual
 * compression operation fails loudly; nothing fakes success.
 */

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

// ---- handle classes (loadable; init() is the honest boundary) -------------

const STUB_MESSAGE =
  'OpenContainer: node:zlib compression streams are not implemented yet ' +
  '(S3 — fflate-backed Zlib handle protocol). crc32 is real; require(\'zlib\') ' +
  'loads; every compression operation throws.';

abstract class ZlibHandleBase {
  constructor(public mode: number) {}
  onerror: ((err: any) => void) | null = null;
  init(..._args: any[]): never {
    const err: any = new Error(STUB_MESSAGE);
    err.code = 'ENOSYS';
    err.errno = 38;
    throw err;
  }
}

class ZlibHandle extends ZlibHandleBase {}
class BrotliDecoderHandle extends ZlibHandleBase {}
class BrotliEncoderHandle extends ZlibHandleBase {}
class ZstdCompressHandle extends ZlibHandleBase {}
class ZstdDecompressHandle extends ZlibHandleBase {}

export function makeZlibBinding(): Binding {
  return {
    crc32,
    Zlib: ZlibHandle,
    BrotliDecoder: BrotliDecoderHandle,
    BrotliEncoder: BrotliEncoderHandle,
    ZstdCompress: ZstdCompressHandle,
    ZstdDecompress: ZstdDecompressHandle,
    zlibConstants: {},
  };
}
