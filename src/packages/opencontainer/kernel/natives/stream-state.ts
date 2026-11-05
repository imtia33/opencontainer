/**
 * Shared StreamBase state + node's stream_wrap.cc enum — the single source
 * for both the stream_wrap binding and tty_wrap's stdin pump.
 *
 * Indexes (node v26.13.0 src/stream_base.h StreamBaseStateFields, exact):
 *   0 kReadBytesOrError, 1 kArrayBufferOffset, 2 kBytesWritten,
 *   3 kLastWriteWasAsync, 4 kLastWriteErr
 * (kLastWriteWasAsync sits BEFORE kLastWriteErr — getting this backwards
 * makes child_process.js read the wrong slot for async-write detection.)
 */
export const kReadBytesOrError = 0;
export const kArrayBufferOffset = 1;
export const kBytesWritten = 2;
export const kLastWriteWasAsync = 3;
export const kLastWriteErr = 4;
/** Legacy/compat slots (not in v26's enum; kept for any consumer that reads
 *  them — indices 5+ never collide with node's fields). */
export const kUvErrno = 5;
export const kIsBigEndian = 6;

/** UV_EOF — signals end-of-stream in onread (nread < 0 path). */
export const UV_EOF = -4095;

const streamBaseState = new Int32Array(16);

export function getStreamBaseState(): Int32Array {
  return streamBaseState;
}

/** Encode one writev chunk honoring its encoding (node's writevGeneric
 *  passes chunks interleaved with their encoding strings when not all
 *  chunks are Buffers: [chunk, encoding, chunk, encoding, ...]). */
const utf8Encoder = new TextEncoder();
export function encodeChunk(chunk: unknown, encoding?: unknown): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  const str = typeof chunk === 'string' ? chunk : String(chunk);
  const enc = typeof encoding === 'string' ? encoding.toLowerCase() : 'utf8';
  if (enc === 'latin1' || enc === 'binary') {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }
  if (enc === 'ascii') {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0x7f;
    return out;
  }
  if (enc === 'ucs2' || enc === 'utf16le' || enc === 'utf-16le') {
    const out = new Uint8Array(str.length * 2);
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      out[i * 2] = code & 0xff;
      out[i * 2 + 1] = code >> 8;
    }
    return out;
  }
  return utf8Encoder.encode(str); // utf8 / utf-8 / default
}

/** Concatenate encoded writev chunks (either [Buffer...] with allBuffers,
 *  or the interleaved [chunk, encoding, ...] form). */
export function encodeWritevList(chunks: Array<unknown>, allBuffers: boolean): Uint8Array {
  const parts: Uint8Array[] = [];
  if (allBuffers) {
    for (const c of chunks) parts.push(encodeChunk(c));
  } else {
    for (let i = 0; i + 1 < chunks.length; i += 2) {
      parts.push(encodeChunk(chunks[i], chunks[i + 1]));
    }
    if (chunks.length % 2 === 1) parts.push(encodeChunk(chunks[chunks.length - 1]));
  }
  let size = 0;
  for (const p of parts) size += p.byteLength;
  const out = new Uint8Array(size);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}
