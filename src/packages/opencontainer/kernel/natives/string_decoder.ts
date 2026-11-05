import type { Binding } from './index';

/**
 * internalBinding('string_decoder') — node's streaming string decoder.
 *
 * Mirrors src/string_decoder.{h,cc} EXACTLY:
 *   state fields (byte offsets in the 7-byte "native decoder" Buffer):
 *     kIncompleteCharactersStart = 0, kIncompleteCharactersEnd = 4,
 *     kMissingBytes = 4, kBufferedBytes = 5, kEncodingField = 6, kSize = 7
 *   encodings enum order: ascii, utf8, base64, base64url, utf16le, hex,
 *   buffer, latin1 (internal/util builds encodingsMap from this array).
 *
 * decode(sd, buf) → string (complete chars only; incomplete trailing bytes
 *   carried); flush(sd) → string for leftovers (U+FFFD for truncated
 *   multibyte sequences — same observable behavior as node).
 */

const kIncompleteCharactersStart = 0;
const kIncompleteCharactersEnd = 4;
const kMissingBytes = 4;
const kBufferedBytes = 5;
const kEncodingField = 6;
const kNumFields = 7;
const kSize = 7;

const ENCODINGS = [
  'ascii',    // 0
  'utf8',     // 1
  'base64',   // 2
  'base64url', // 3
  'utf16le',  // 4
  'hex',      // 5
  'buffer',   // 6
  'latin1',   // 7
] as const;

interface DecoderState {
  carry: Uint8Array;
  td: TextDecoder | null;
}

const states = new WeakMap<object, DecoderState>();

function stateFor(sd: Uint8Array): DecoderState {
  let st = states.get(sd);
  if (!st) {
    st = { carry: new Uint8Array(0), td: null };
    states.set(sd, st);
  }
  return st;
}

function tdFor(st: DecoderState, name: string): TextDecoder {
  if (!st.td || (st.td as any).__enc !== name) {
    const td = name === 'utf16le' ? new TextDecoder('utf-16le') : new TextDecoder('utf-8');
    (td as any).__enc = name;
    st.td = td;
  }
  return st.td;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Count trailing bytes of an incomplete UTF-8 sequence (0..3). */
function utf8TrailingIncomplete(bytes: Uint8Array): number {
  const n = bytes.length;
  if (n === 0) return 0;
  // Look at the last 4 bytes for a lead byte whose sequence is cut short.
  for (let back = 1; back <= Math.min(4, n); back++) {
    const b = bytes[n - back];
    if (b < 0x80) return 0; // complete ASCII tail
    if (b >= 0xc0) {
      // lead byte: sequence length 2/3/4 — available bytes = back
      const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : 2;
      if (back < need) return back;
      return 0;
    }
    // continuation byte — keep scanning backwards
  }
  return 0;
}

function encodingOf(sd: Uint8Array): string {
  const idx = sd[kEncodingField] ?? 1;
  return ENCODINGS[idx] ?? 'utf8';
}

function decode(sd: Uint8Array, buf: Uint8Array): string {
  if (buf === undefined || buf === null) return '';
  const st = stateFor(sd);
  const enc = encodingOf(sd);
  const input = concat(st.carry, buf instanceof Uint8Array ? buf : new Uint8Array(0));
  st.carry = new Uint8Array(0);

  if (input.length === 0) {
    sd[kMissingBytes] = 0;
    sd[kBufferedBytes] = 0;
    return '';
  }

  switch (enc) {
    case 'utf8':
    case 'utf16le': {
      // Incomplete tail: utf8 → cut multi-byte sequence; utf16le → odd length.
      let pending: number;
      if (enc === 'utf8') pending = utf8TrailingIncomplete(input);
      else pending = input.length % 2;
      const completeLen = input.length - pending;
      let out = '';
      if (completeLen > 0) {
        out = tdFor(st, enc).decode(
          input.subarray(0, completeLen),
          { stream: pending > 0 },
        );
      }
      if (pending > 0) st.carry = input.slice(completeLen);
      sd[kMissingBytes] = pending;
      sd[kBufferedBytes] = pending;
      return out;
    }
    case 'ascii':
    case 'latin1':
    case 'buffer': {
      // No multibyte semantics: map bytes to code units 1:1.
      let out = '';
      const CH = 0x8000;
      for (let i = 0; i < input.length; i += CH) {
        out += String.fromCharCode.apply(
          null,
          Array.from(input.subarray(i, i + CH)) as unknown as number[],
        );
      }
      // ASCII in node masks the high bit — keep 1:1 for latin1 fidelity.
      sd[kMissingBytes] = 0;
      sd[kBufferedBytes] = 0;
      return out;
    }
    case 'hex': {
      // Odd trailing nibble → carry one byte.
      const complete = input.length & ~1;
      let out = '';
      for (let i = 0; i < complete; i += 2) {
        out += HEX_CHARS[input[i] >> 4] + HEX_CHARS[input[i] & 0xf];
      }
      if (input.length & 1) st.carry = input.slice(complete);
      sd[kMissingBytes] = st.carry.length;
      sd[kBufferedBytes] = st.carry.length;
      return out;
    }
    case 'base64':
    case 'base64url': {
      // Carry chars until a multiple of 4 (plus '=' handling like node).
      const url = enc === 'base64url';
      let s = '';
      const CH = 0x8000;
      for (let i = 0; i < input.length; i += CH) {
        s += String.fromCharCode.apply(
          null,
          Array.from(input.subarray(i, i + CH)) as unknown as number[],
        );
      }
      if (url) s = s.replace(/-/g, '+').replace(/_/g, '/');
      // Strip whitespace like atob does.
      s = s.replace(/[\t\n\f\r ]/g, '');
      const carryLen = s.length % 4 === 1 ? s.length - 1 : s.length - (s.length % 4);
      const decodable = s.slice(0, carryLen);
      let out = '';
      if (decodable.length > 0) {
        try { out = atob(decodable); } catch { out = ''; }
      }
      const carried = s.slice(carryLen);
      if (carried.length > 0) {
        const bytes = new Uint8Array(carried.length);
        for (let i = 0; i < carried.length; i++) bytes[i] = carried.charCodeAt(i);
        st.carry = bytes;
      }
      sd[kMissingBytes] = carried.length;
      sd[kBufferedBytes] = carried.length;
      // Return as latin1 string (node returns the decoded bytes as latin1-ish string)
      let outStr = '';
      for (let i = 0; i < out.length; i += CH) {
        outStr += out.slice(i, i + CH);
      }
      return outStr;
    }
    default:
      return '';
  }
}

const HEX_CHARS = '0123456789abcdef';

function flush(sd: Uint8Array): string {
  const st = states.get(sd);
  if (!st || st.carry.length === 0) {
    sd[kMissingBytes] = 0;
    sd[kBufferedBytes] = 0;
    return '';
  }
  const enc = encodingOf(sd);
  const carry = st.carry;
  st.carry = new Uint8Array(0);
  sd[kMissingBytes] = 0;
  sd[kBufferedBytes] = 0;
  if (enc === 'utf8' || enc === 'utf16le') {
    // Truncated sequence → U+FFFD replacement, like node.
    try {
      return tdFor(st, enc).decode(carry);
    } catch {
      return '�'.repeat(enc === 'utf16le' ? Math.ceil(carry.length / 2) : carry.length);
    }
  }
  if (enc === 'hex' && carry.length === 1) {
    return HEX_CHARS[carry[0] >> 4];
  }
  if (enc === 'base64' || enc === 'base64url') {
    let s = '';
    for (let i = 0; i < carry.length; i++) s += String.fromCharCode(carry[i]);
    if (enc === 'base64url') s = s.replace(/-/g, '+').replace(/_/g, '/');
    try { return atob(s); } catch { return ''; }
  }
  return '';
}

export function makeStringDecoderBinding(): Binding {
  return {
    kIncompleteCharactersStart,
    kIncompleteCharactersEnd,
    kMissingBytes,
    kBufferedBytes,
    kEncodingField,
    kNumFields,
    kSize,
    encodings: [...ENCODINGS],
    decode,
    flush,
  };
}
