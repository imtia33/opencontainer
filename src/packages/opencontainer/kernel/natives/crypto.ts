/**
 * OpenContainer Kernel — internalBinding('crypto').
 *
 * Node's C++ crypto layer is OpenSSL. There is no OpenSSL in a browser
 * worker, so this binding backs the most-used primitives with browser/native
 * equivalents and pure-JS implementations, and FAILS LOUDLY (no silent
 * fakes) on the OpenSSL surface we do not implement.
 *
 * REAL (synchronous, pure JS — verified against FIPS/RFC test vectors):
 *   - Hash: md5, sha1, sha224, sha256, sha384, sha512 (incremental + copy)
 *   - Hmac: same set (RFC 2104)
 *   - oneShotDigest, HashJob (WebCrypto subtle.digest passthrough)
 *   - randomFillSync / secureBuffer / RandomBytesJob (crypto.getRandomValues)
 *   - timingSafeEqual, PBKDF2Job (RFC 8018 sync + chunked async)
 *
 * HONEST STUBS (throw on use with a descriptive error):
 *   - Public-key crypto: Sign/Verify, RSA/EC/DSA/DH keygen, KeyObjectHandle
 *   - Ciphers: CipherBase, AES*, ChaCha20-Poly1305, RSA encrypt/decrypt
 *   - X509, SPKAC, PKCS12, SecureContext, root certificates (no TLS stack)
 *   - scrypt, hkdf, argon2, KMAC, cSHAKE, KEM, primes
 *
 * Constants follow node's C++ enums where the values are observable
 * (OpenSSL X509 flags, RSA padding, argon2 types); the inert key-format
 * enums only need self-consistency because every consumer throws first.
 */

import type { Binding } from './index';

// ============================================================================
// Pure-JS hash implementations (incremental, cloneable)
// ============================================================================

export interface IncrementalHash {
  readonly blockSize: number;
  readonly digestLen: number;
  update(data: Uint8Array): void;
  digest(): Uint8Array;
  clone(): IncrementalHash;
}

function rotr32(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}
function rotl32(x: number, n: number): number {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

// ---- SHA-2, 32-bit word size (sha224 / sha256) ----------------------------

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const IV256 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const IV224 = [0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939,
  0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4];

class Sha2_32 implements IncrementalHash {
  readonly blockSize = 64;
  private h: Uint32Array;
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private totalLen = 0;
  private w = new Uint32Array(64);

  constructor(readonly digestLen: number, iv: number[]) {
    this.h = Uint32Array.from(iv);
  }

  update(data: Uint8Array): void {
    this.totalLen += data.length;
    let offset = 0;
    if (this.bufLen > 0) {
      const take = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      offset = take;
      if (this.bufLen < 64) return;
      this.compress(this.buf, 0);
      this.bufLen = 0;
    }
    while (offset + 64 <= data.length) {
      this.compress(data, offset);
      offset += 64;
    }
    if (offset < data.length) {
      this.buf.set(data.subarray(offset), 0);
      this.bufLen = data.length - offset;
    }
  }

  private compress(block: Uint8Array, off: number): void {
    const w = this.w;
    const h = this.h;
    for (let i = 0; i < 16; i++) {
      const o = off + i * 4;
      w[i] = ((block[o] << 24) | (block[o + 1] << 16) |
              (block[o + 2] << 8) | block[o + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = (rotr32(x, 7) ^ rotr32(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr32(y, 17) ^ rotr32(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = (rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }

  digest(): Uint8Array {
    const bits = this.totalLen * 8;
    const tail = new Uint8Array(64);
    tail.set(this.buf.subarray(0, this.bufLen));
    tail[this.bufLen] = 0x80;
    const padLen = this.bufLen < 56 ? 64 : 128;
    const view = padLen === 64 ? tail : (() => {
      const t2 = new Uint8Array(128);
      t2.set(tail);
      return t2;
    })();
    // 64-bit big-endian bit length (safe to 2^53 bytes of input).
    const hi = Math.floor(bits / 4294967296);
    const lo = bits % 4294967296;
    const n = padLen - 8;
    view[n] = (hi >>> 24) & 0xff; view[n + 1] = (hi >>> 16) & 0xff;
    view[n + 2] = (hi >>> 8) & 0xff; view[n + 3] = hi & 0xff;
    view[n + 4] = (lo / 2 ** 24) & 0xff; view[n + 5] = (lo / 2 ** 16) & 0xff;
    view[n + 6] = (lo / 2 ** 8) & 0xff; view[n + 7] = lo % 256;
    this.compress(view, 0);
    if (padLen === 128) this.compress(view, 64);

    const out = new Uint8Array(this.digestLen);
    for (let i = 0; i < this.digestLen; i += 4) {
      const word = this.h[i / 4];
      out[i] = (word >>> 24) & 0xff; out[i + 1] = (word >>> 16) & 0xff;
      out[i + 2] = (word >>> 8) & 0xff; out[i + 3] = word & 0xff;
    }
    return out;
  }

  clone(): Sha2_32 {
    const c = new Sha2_32(this.digestLen, IV256); // IV replaced below
    c.h = Uint32Array.from(this.h);
    c.buf.set(this.buf);
    c.bufLen = this.bufLen;
    c.totalLen = this.totalLen;
    return c;
  }
}

// ---- SHA-1 ------------------------------------------------------------------

const K1 = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];

class Sha1 implements IncrementalHash {
  readonly blockSize = 64;
  readonly digestLen = 20;
  private h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe,
    0x10325476, 0xc3d2e1f0]);
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private totalLen = 0;
  private w = new Uint32Array(80);

  update(data: Uint8Array): void {
    this.totalLen += data.length;
    let offset = 0;
    if (this.bufLen > 0) {
      const take = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      offset = take;
      if (this.bufLen < 64) return;
      this.compress(this.buf, 0);
      this.bufLen = 0;
    }
    while (offset + 64 <= data.length) {
      this.compress(data, offset);
      offset += 64;
    }
    if (offset < data.length) {
      this.buf.set(data.subarray(offset), 0);
      this.bufLen = data.length - offset;
    }
  }

  private compress(block: Uint8Array, off: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) {
      const o = off + i * 4;
      w[i] = ((block[o] << 24) | (block[o + 1] << 16) |
              (block[o + 2] << 8) | block[o + 3]) >>> 0;
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl32(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    }
    let [a, b, c, d, e] = this.h;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20)      { f = ((b & c) | (~b & d)) >>> 0; k = K1[0]; }
      else if (i < 40) { f = (b ^ c ^ d) >>> 0; k = K1[1]; }
      else if (i < 60) { f = ((b & c) | (b & d) | (c & d)) >>> 0; k = K1[2]; }
      else             { f = (b ^ c ^ d) >>> 0; k = K1[3]; }
      const tmp = ((rotl32(a, 5) + f + e + k + w[i]) / 1) >>> 0;
      e = d; d = c; c = rotl32(b, 30); b = a; a = tmp;
    }
    this.h[0] = (this.h[0] + a) >>> 0; this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0; this.h[3] = (this.h[3] + d) >>> 0;
    this.h[4] = (this.h[4] + e) >>> 0;
  }

  digest(): Uint8Array {
    const bits = this.totalLen * 8;
    const tail = new Uint8Array(64);
    tail.set(this.buf.subarray(0, this.bufLen));
    tail[this.bufLen] = 0x80;
    const padLen = this.bufLen < 56 ? 64 : 128;
    const view = padLen === 64 ? tail : (() => {
      const t2 = new Uint8Array(128); t2.set(tail); return t2;
    })();
    const hi = Math.floor(bits / 4294967296);
    const lo = bits % 4294967296;
    const n = padLen - 8;
    view[n] = (hi >>> 24) & 0xff; view[n + 1] = (hi >>> 16) & 0xff;
    view[n + 2] = (hi >>> 8) & 0xff; view[n + 3] = hi & 0xff;
    view[n + 4] = (lo / 2 ** 24) & 0xff; view[n + 5] = (lo / 2 ** 16) & 0xff;
    view[n + 6] = (lo / 2 ** 8) & 0xff; view[n + 7] = lo % 256;
    this.compress(view, 0);
    if (padLen === 128) this.compress(view, 64);
    const out = new Uint8Array(20);
    for (let i = 0; i < 5; i++) {
      out[i * 4] = (this.h[i] >>> 24) & 0xff;
      out[i * 4 + 1] = (this.h[i] >>> 16) & 0xff;
      out[i * 4 + 2] = (this.h[i] >>> 8) & 0xff;
      out[i * 4 + 3] = this.h[i] & 0xff;
    }
    return out;
  }

  clone(): Sha1 {
    const c = new Sha1();
    c.h = Uint32Array.from(this.h);
    c.buf.set(this.buf);
    c.bufLen = this.bufLen;
    c.totalLen = this.totalLen;
    return c;
  }
}

// ---- MD5 --------------------------------------------------------------------

/** MD5's T table is *defined* as floor(2^32 · |sin(i+1)|) (RFC 1321). */
const T_MD5 = new Uint32Array(64);
for (let i = 0; i < 64; i++) {
  T_MD5[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0;
}
const S_MD5 = new Uint8Array(64);
{
  const groups = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]];
  for (let r = 0; r < 4; r++) {
    for (let i = 0; i < 16; i++) S_MD5[r * 16 + i] = groups[r][i % 4];
  }
}

class Md5 implements IncrementalHash {
  readonly blockSize = 64;
  readonly digestLen = 16;
  private h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private totalLen = 0;
  private w = new Uint32Array(16);

  update(data: Uint8Array): void {
    this.totalLen += data.length;
    let offset = 0;
    if (this.bufLen > 0) {
      const take = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      offset = take;
      if (this.bufLen < 64) return;
      this.compress(this.buf, 0);
      this.bufLen = 0;
    }
    while (offset + 64 <= data.length) {
      this.compress(data, offset);
      offset += 64;
    }
    if (offset < data.length) {
      this.buf.set(data.subarray(offset), 0);
      this.bufLen = data.length - offset;
    }
  }

  private compress(block: Uint8Array, off: number): void {
    const w = this.w;
    for (let i = 0; i < 16; i++) { // MD5 is little-endian
      const o = off + i * 4;
      w[i] = (block[o] | (block[o + 1] << 8) | (block[o + 2] << 16) |
              (block[o + 3] << 24)) >>> 0;
    }
    let a = this.h[0], b = this.h[1], c = this.h[2], d = this.h[3];
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16)      { f = ((b & c) | (~b & d)) >>> 0; g = i; }
      else if (i < 32) { f = ((d & b) | (~d & c)) >>> 0; g = (5 * i + 1) % 16; }
      else if (i < 48) { f = (b ^ c ^ d) >>> 0; g = (3 * i + 5) % 16; }
      else             { f = (c ^ (b | ~d)) >>> 0; g = (7 * i) % 16; }
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + T_MD5[i] + w[g]) >>> 0;
      b = (b + rotl32(sum, S_MD5[i])) >>> 0;
      a = tmp;
    }
    this.h[0] = (this.h[0] + a) >>> 0; this.h[1] = (this.h[1] + b) >>> 0;
    this.h[2] = (this.h[2] + c) >>> 0; this.h[3] = (this.h[3] + d) >>> 0;
  }

  digest(): Uint8Array {
    const bits = this.totalLen * 8;
    const tail = new Uint8Array(64);
    tail.set(this.buf.subarray(0, this.bufLen));
    tail[this.bufLen] = 0x80;
    const padLen = this.bufLen < 56 ? 64 : 128;
    const view = padLen === 64 ? tail : (() => {
      const t2 = new Uint8Array(128); t2.set(tail); return t2;
    })();
    const lo = bits % 4294967296; // MD5: little-endian 64-bit length
    const hi = Math.floor(bits / 4294967296);
    const n = padLen - 8;
    view[n] = lo % 256; view[n + 1] = (lo / 2 ** 8) % 256;
    view[n + 2] = (lo / 2 ** 16) % 256; view[n + 3] = (lo / 2 ** 24) % 256;
    view[n + 4] = hi % 256; view[n + 5] = (hi / 2 ** 8) % 256;
    view[n + 6] = (hi / 2 ** 16) % 256; view[n + 7] = (hi / 2 ** 24) % 256;
    this.compress(view, 0);
    if (padLen === 128) this.compress(view, 64);
    const out = new Uint8Array(16);
    for (let i = 0; i < 4; i++) { // little-endian output words
      out[i * 4] = this.h[i] & 0xff;
      out[i * 4 + 1] = (this.h[i] >>> 8) & 0xff;
      out[i * 4 + 2] = (this.h[i] >>> 16) & 0xff;
      out[i * 4 + 3] = (this.h[i] >>> 24) & 0xff;
    }
    return out;
  }

  clone(): Md5 {
    const c = new Md5();
    c.h = Uint32Array.from(this.h);
    c.buf.set(this.buf);
    c.bufLen = this.bufLen;
    c.totalLen = this.totalLen;
    return c;
  }
}

// ---- SHA-2, 64-bit word size (sha384 / sha512) ------------------------------

const M64 = (1n << 64n) - 1n;
const rotr64 = (x: bigint, n: number): bigint =>
  ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64;

const K512 = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
];

const IV512 = [0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n, 0x510e527fade682d1n, 0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n];
const IV384 = [0xcbbb9d5dc1059ed8n, 0x629a292a367cd507n, 0x9159015a3070dd17n,
  0x152fecd8f70e5939n, 0x67332667ffc00b31n, 0x8eb44a8768581511n,
  0xdb0c2e0d64f98fa7n, 0x47b5481dbefa4fa4n];

class Sha2_64 implements IncrementalHash {
  readonly blockSize = 128;
  private h: bigint[];
  private buf = new Uint8Array(128);
  private bufLen = 0;
  private totalLen = 0n;

  constructor(readonly digestLen: number, iv: bigint[]) {
    this.h = [...iv];
  }

  update(data: Uint8Array): void {
    this.totalLen += BigInt(data.length);
    let offset = 0;
    if (this.bufLen > 0) {
      const take = Math.min(128 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen);
      this.bufLen += take;
      offset = take;
      if (this.bufLen < 128) return;
      this.compress(this.buf, 0);
      this.bufLen = 0;
    }
    while (offset + 128 <= data.length) {
      this.compress(data, offset);
      offset += 128;
    }
    if (offset < data.length) {
      this.buf.set(data.subarray(offset), 0);
      this.bufLen = data.length - offset;
    }
  }

  private compress(block: Uint8Array, off: number): void {
    const w = new Array<bigint>(80);
    for (let i = 0; i < 16; i++) {
      let v = 0n;
      const o = off + i * 8;
      for (let j = 0; j < 8; j++) v = (v << 8n) | BigInt(block[o + j]);
      w[i] = v;
    }
    for (let i = 16; i < 80; i++) {
      const x = w[i - 15], y = w[i - 2];
      const s0 = rotr64(x, 1) ^ rotr64(x, 8) ^ (x >> 7n);
      const s1 = rotr64(y, 19) ^ rotr64(y, 61) ^ (y >> 6n);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & M64;
    }
    let [a, b, c, d, e, f, g, hh] = this.h;
    for (let i = 0; i < 80; i++) {
      const S1 = rotr64(e, 14) ^ rotr64(e, 18) ^ rotr64(e, 41);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K512[i] + w[i]) & M64;
      const S0 = rotr64(a, 28) ^ rotr64(a, 34) ^ rotr64(a, 39);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & M64;
      hh = g; g = f; f = e;
      e = (d + t1) & M64;
      d = c; c = b; b = a;
      a = (t1 + t2) & M64;
    }
    const h = this.h;
    h[0] = (h[0] + a) & M64; h[1] = (h[1] + b) & M64;
    h[2] = (h[2] + c) & M64; h[3] = (h[3] + d) & M64;
    h[4] = (h[4] + e) & M64; h[5] = (h[5] + f) & M64;
    h[6] = (h[6] + g) & M64; h[7] = (h[7] + hh) & M64;
  }

  digest(): Uint8Array {
    const bits = this.totalLen * 8n;
    const tail = new Uint8Array(128);
    tail.set(this.buf.subarray(0, this.bufLen));
    tail[this.bufLen] = 0x80;
    const padLen = this.bufLen < 112 ? 128 : 256;
    const view = padLen === 128 ? tail : (() => {
      const t2 = new Uint8Array(256); t2.set(tail); return t2;
    })();
    const n = padLen - 16;
    for (let i = 0; i < 16; i++) { // 128-bit big-endian bit length
      view[n + i] = Number((bits >> BigInt(8 * (15 - i))) & 0xffn);
    }
    this.compress(view, 0);
    if (padLen === 256) this.compress(view, 128);
    const out = new Uint8Array(this.digestLen);
    for (let i = 0; i < this.digestLen; i++) {
      out[i] = Number((this.h[i >> 3] >> BigInt(56 - 8 * (i & 7))) & 0xffn);
    }
    return out;
  }

  clone(): Sha2_64 {
    const c = new Sha2_64(this.digestLen, IV512);
    c.h = [...this.h];
    c.buf.set(this.buf);
    c.bufLen = this.bufLen;
    c.totalLen = this.totalLen;
    return c;
  }
}

// ---- supported algorithm registry -------------------------------------------

type HashFactory = () => IncrementalHash;

const HASHES: Record<string, { make: HashFactory; id: number }> = {};
{
  let nextId = 1;
  const register = (name: string, aliases: string[], make: HashFactory) => {
    for (const n of [name, ...aliases]) {
      HASHES[n] = { make, id: nextId };
    }
    nextId++;
  };
  register('md5', [], () => new Md5());
  register('sha1', ['sha', 'sha-1'], () => new Sha1());
  register('sha224', ['sha-224', 'sha2-224'], () => new Sha2_32(28, IV224));
  register('sha256', ['sha-256', 'sha2-256'], () => new Sha2_32(32, IV256));
  register('sha384', ['sha-384', 'sha2-384'], () => new Sha2_64(48, IV384));
  register('sha512', ['sha-512', 'sha2-512'], () => new Sha2_64(64, IV512));
}
const CANONICAL_HASHES = ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512'];

function lookupHash(name: any): HashFactory {
  const entry = HASHES[String(name ?? '').toLowerCase()];
  if (!entry) {
    throw new Error(`Invalid digest: ${String(name)} ` +
      `(OpenContainer supports: ${CANONICAL_HASHES.join(', ')})`);
  }
  return entry.make;
}

// ---- HMAC (RFC 2104) ---------------------------------------------------------

class HmacImpl {
  private inner: IncrementalHash;
  private outerKey: Uint8Array;
  private factory: HashFactory;

  constructor(factory: HashFactory, key: Uint8Array) {
    const block = factory().blockSize;
    let k = key;
    if (k.length > block) {
      const h = factory();
      h.update(k);
      k = h.digest();
    }
    const padded = new Uint8Array(block);
    padded.set(k);
    this.outerKey = new Uint8Array(block);
    const ipad = new Uint8Array(block);
    for (let i = 0; i < block; i++) {
      ipad[i] = padded[i] ^ 0x36;
      this.outerKey[i] = padded[i] ^ 0x5c;
    }
    this.factory = factory;
    this.inner = factory();
    this.inner.update(ipad);
  }

  update(data: Uint8Array): void { this.inner.update(data); }

  digest(): Uint8Array {
    const innerDigest = this.inner.digest();
    const outer = this.factory();
    outer.update(this.outerKey);
    outer.update(innerDigest);
    return outer.digest();
  }
}

// ---- helpers ------------------------------------------------------------------

function toBytes(data: any, encoding?: any): Uint8Array {
  if (typeof data === 'string') {
    const B = (globalThis as any).Buffer;
    if (typeof B?.from === 'function') return B.from(data, encoding || 'utf8');
    return new TextEncoder().encode(data);
  }
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new TypeError(
    'Expected input to be a string, Buffer, TypedArray, or DataView');
}

/** Wrap digest bytes in a real Buffer view (zero-copy) — node semantics. */
function toBuffer(bytes: Uint8Array): any {
  const B = (globalThis as any).Buffer;
  if (typeof B === 'function') {
    return new B(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return bytes;
}

/** node's CryptoJob mode contract:
 *  - kCryptoJobSync   → run() returns [err, result] synchronously
 *  - kCryptoJobAsync  → run() returns a Promise; if `ondone` is set it is
 *                       also invoked (err, result) — the classic callback mode
 *  - kCryptoJobWebCrypto → like async (promise consumers) */
const K_MODE_ASYNC = 0;
const K_MODE_SYNC = 1;
const K_MODE_WEBCRYPTO = 2;

abstract class CryptoJob {
  ondone: ((err: any, result: any) => void) | null = null;
  constructor(public mode: number) {}

  protected abstract task(): any;

  run(): any {
    if (this.mode === K_MODE_SYNC) {
      try {
        return [undefined, this.task()];
      } catch (err) {
        return [err, undefined];
      }
    }
    const p = (async () => this.task())();
    if (typeof this.ondone === 'function') {
      const cb = this.ondone;
      p.then(
        (r) => { try { cb(null, r); } catch { /* listener error */ } },
        (e) => { try { cb(e, undefined); } catch { /* listener error */ } },
      );
    }
    return p;
  }
}

// ============================================================================
// The binding
// ============================================================================

export function makeCryptoBinding(): Binding {
  // Capture the NATIVE browser getRandomValues BEFORE node's bootstrap
  // (internal/bootstrap/web/exposed-window-or-worker.js) replaces
  // globalThis.crypto with node's webcrypto facade — which itself routes
  // getRandomValues back through internal/crypto/random → THIS binding.
  // Calling the live global from here is an infinite loop; the captured
  // native primitive is the loop's exit.
  const nativeCrypto = (globalThis as any).crypto;
  const nativeGetRandomValues =
    typeof nativeCrypto?.getRandomValues === 'function'
      ? nativeCrypto.getRandomValues.bind(nativeCrypto)
      : null;

  /** crypto.getRandomValues caps at 65536 bytes per call. */
  function randomFillInto(view: Uint8Array): void {
    if (!nativeGetRandomValues) {
      throw new Error('OpenContainer: crypto.getRandomValues unavailable');
    }
    for (let off = 0; off < view.length; off += 65536) {
      nativeGetRandomValues(
        off + 65536 <= view.length ? view.subarray(off, off + 65536)
                                   : view.subarray(off));
    }
  }

  /** crypto.js's Hash / Hmac wrapper classes drive these handles. */
  class CryptoHash {
    private impl: IncrementalHash;
    private finalized = false;

    constructor(algorithm: any, _xofLen?: any, _algorithmId?: any, _cache?: any,
                functionName?: any, customization?: any) {
      if (algorithm instanceof CryptoHash) {         // Hash.prototype.copy()
        this.impl = algorithm.impl.clone();
        return;
      }
      if (functionName !== undefined || customization !== undefined) {
        throw new Error('OpenContainer: cSHAKE not supported ' +
          '(no OpenSSL in the browser runtime)');
      }
      this.impl = lookupHash(algorithm)();
    }

    update(data: any, encoding?: any): boolean {
      if (this.finalized) {
        throw new Error('Digest already called');
      }
      this.impl.update(toBytes(data, encoding));
      return true;
    }

    digest(outputEncoding?: any): any {
      if (this.finalized) {
        throw new Error('Digest already called');
      }
      this.finalized = true;
      const out = toBuffer(this.impl.digest());
      if (outputEncoding && typeof outputEncoding === 'string') {
        return out.toString(outputEncoding);
      }
      return out;
    }
  }

  class CryptoHmac {
    private impl: HmacImpl | null = null;
    private finalized = false;

    init(algorithm: any, key: any): void {
      this.impl = new HmacImpl(lookupHash(algorithm), toBytes(key));
    }

    update(data: any, encoding?: any): boolean {
      if (this.finalized || !this.impl) {
        throw new Error('Hmac already finalized');
      }
      this.impl.update(toBytes(data, encoding));
      return true;
    }

    digest(outputEncoding?: any): any {
      if (this.finalized || !this.impl) {
        throw new Error('Hmac already finalized');
      }
      this.finalized = true;
      const out = toBuffer(this.impl.digest());
      if (outputEncoding && typeof outputEncoding === 'string') {
        return out.toString(outputEncoding);
      }
      return out;
    }
  }

  // ---- jobs ----------------------------------------------------------------

  class RandomBytesJob extends CryptoJob {
    private buf: any; private offset: number; private size: number;
    constructor(mode: number, buf: any, offset = 0, size?: number) {
      super(mode);
      this.buf = buf;
      this.offset = offset;
      this.size = size ?? (buf?.byteLength ?? 0) - offset;
    }
    protected task(): any {
      let view: Uint8Array;
      if (this.buf instanceof ArrayBuffer) {
        view = new Uint8Array(this.buf, this.offset, this.size);
      } else if (ArrayBuffer.isView(this.buf)) {
        view = new Uint8Array(this.buf.buffer, this.buf.byteOffset + this.offset,
                              this.size);
      } else {
        throw new TypeError('RandomBytesJob requires an ArrayBuffer or view');
      }
      randomFillInto(view);
      return view;
    }
  }

  /** subtle.digest() backend (WebCrypto names) — native browser crypto. */
  const SUBTLE_NAMES: Record<string, string> = {
    'sha-1': 'SHA-1', 'sha-256': 'SHA-256', 'sha-384': 'SHA-384',
    'sha-512': 'SHA-512',
  };
  class HashJob extends CryptoJob {
    constructor(mode: number, algorithm: any, ...data: any[]) {
      super(mode);
      this.algorithm = algorithm;
      this.data = data[0];
    }
    private algorithm: any;
    private data: any;
    protected task(): any {
      if (this.mode === K_MODE_WEBCRYPTO) {
        const name = SUBTLE_NAMES[String(this.algorithm).toLowerCase()] ??
          String(this.algorithm);
        const subtle = (globalThis as any).crypto?.subtle;
        if (subtle) return subtle.digest(name, toBytes(this.data));
      }
      const impl = lookupHash(this.algorithm)();
      impl.update(toBytes(this.data));
      return impl.digest().buffer;
    }
  }

  /** PBKDF2 (RFC 8018) on the pure-JS HMAC — sync tuple, async chunked. */
  class PBKDF2Job extends CryptoJob {
    constructor(mode: number, password: any, salt: any,
                private iterations: number, private keylen: number,
                private digestName: any, private outputEncoding?: any) {
      super(mode);
      this.password = toBytes(password);
      this.salt = toBytes(salt);
    }
    private password: Uint8Array;
    private salt: Uint8Array;

    protected task(): any {
      if (!(this.iterations >= 1)) {
        throw new Error('Invalid pbkdf2 iterations value');
      }
      if (this.keylen < 0) {
        throw new Error('Invalid pbkdf2 key length');
      }
      const factory = lookupHash(this.digestName);
      const proto = factory();
      const hLen = proto.digestLen;
      const block = proto.blockSize;
      const dk = new Uint8Array(this.keylen);
      // Precompute ipad/opad hash states once, clone per HMAC invocation.
      let key = this.password;
      if (key.length > block) {
        const kh = factory(); kh.update(key); key = kh.digest();
      }
      const padded = new Uint8Array(block);
      padded.set(key);
      const ipad = new Uint8Array(block);
      const opad = new Uint8Array(block);
      for (let i = 0; i < block; i++) {
        ipad[i] = padded[i] ^ 0x36;
        opad[i] = padded[i] ^ 0x5c;
      }
      const innerState = factory(); innerState.update(ipad);
      const outerState = factory(); outerState.update(opad);

      const hmacOnce = (data: Uint8Array): Uint8Array => {
        const inner = innerState.clone();
        inner.update(data);
        const outer = outerState.clone();
        outer.update(inner.digest());
        return outer.digest();
      };

      const blocks = Math.ceil(this.keylen / hLen) || 1;
      const be32 = new Uint8Array(4);
      for (let b = 1; b <= blocks; b++) {
        be32[0] = (b >>> 24) & 0xff; be32[1] = (b >>> 16) & 0xff;
        be32[2] = (b >>> 8) & 0xff; be32[3] = b & 0xff;
        const seed = new Uint8Array(this.salt.length + 4);
        seed.set(this.salt);
        seed.set(be32, this.salt.length);
        let u = hmacOnce(seed);
        const t = Uint8Array.from(u);
        for (let c = 1; c < this.iterations; c++) {
          u = hmacOnce(u);
          for (let i = 0; i < hLen; i++) t[i] ^= u[i];
        }
        const start = (b - 1) * hLen;
        const take = Math.min(hLen, this.keylen - start);
        dk.set(t.subarray(0, take), start);
      }
      if (this.outputEncoding && typeof this.outputEncoding === 'string') {
        return toBuffer(dk).toString(this.outputEncoding);
      }
      return dk;
    }
  }

  // ---- stub factory: honest, loud failure ---------------------------------

  const unsupportedMsg = (what: string) =>
    `OpenContainer: node:crypto ${what} is not supported in the browser ` +
    `runtime (no OpenSSL backend). Tracked for a future WASM crypto build.`;
  const unsupported = (what: string) => (..._args: any[]) => {
    throw new Error(unsupportedMsg(what));
  };
  const unsupportedClass = (what: string) => {
    const C = class {
      constructor(..._args: any[]) {
        throw new Error(unsupportedMsg(what));
      }
    };
    return C;
  };
  const todoJob = (what: string) => class extends CryptoJob {
    protected task(): any {
      throw new Error(unsupportedMsg(what));
    }
  };

  // X509Certificate's native base — x509.js destructures these 28 methods off
  // the prototype at load time, so they must exist (they fail loudly on call).
  const NativeX509Certificate = class {
    constructor(..._args: any[]) {
      throw new Error('OpenContainer: X.509 certificates are not supported ' +
        'in the browser runtime (no OpenSSL backend).');
    }
  };
  {
    const proto = (NativeX509Certificate as any).prototype as Record<string, any>;
    for (const m of ['checkCA', 'checkEmail', 'checkHost', 'checkIP',
      'checkIssued', 'checkPrivateKey', 'fingerprint', 'fingerprint256',
      'fingerprint512', 'getIssuerCert', 'infoAccess', 'issuer', 'keyUsage',
      'pem', 'publicKey', 'raw', 'serialNumber', 'signatureAlgorithm',
      'signatureAlgorithmOid', 'subject', 'subjectAltName', 'toLegacy',
      'validFrom', 'validFromDate', 'validTo', 'validToDate', 'verify']) {
      proto[m] = unsupported(`X509Certificate.${m}`);
    }
  }

  // The three class factories run at require('crypto') load time; the
  // callbacks (node's own JS) build the public classes on our bases.
  const kNativeSlotKey = '__ocNativeKeyObject';
  const createNativeKeyObjectClass = (cb: (Native: any) => any): any => {
    const NativeKeyObject = class {
      constructor(handle: any) { (this as any)[kNativeSlotKey] = handle; }
    };
    return cb(NativeKeyObject);
  };
  const createCryptoKeyClass = (cb: (Native: any) => any): any => {
    const NativeCryptoKey = class {
      constructor(handle: any, algorithm: any, usagesMask: any,
                  extractable: any, secondaryHandle: any, seedData: any) {
        (this as any)[kNativeSlotKey] =
          { handle, algorithm, usagesMask, extractable, secondaryHandle, seedData };
      }
    };
    return cb(NativeCryptoKey);
  };
  const createX509CertificateClass = (cb: (Native: any) => any): any =>
    cb(NativeX509Certificate);

  // Alias caches (hash-name → numeric id, node's getCachedAliases shape).
  const aliasCache: Record<string, number> = {};
  for (const [name, entry] of Object.entries(HASHES)) aliasCache[name] = entry.id;

  return {
    // ---- real implementations ----
    randomFillSync(buf: any, offset: number, size: number): void {
      if (buf instanceof ArrayBuffer) {
        randomFillInto(new Uint8Array(buf, offset, size));
      } else if (ArrayBuffer.isView(buf)) {
        randomFillInto(new Uint8Array(buf.buffer, buf.byteOffset + offset, size));
      } else {
        throw new TypeError('randomFillSync requires an ArrayBuffer or view');
      }
    },
    secureBuffer(n: number): any {
      const B = (globalThis as any).Buffer;
      return typeof B?.alloc === 'function' ? B.alloc(n) : new Uint8Array(n);
    },
    RandomBytesJob,
    getFipsCrypto: () => 0,
    getFipsCryptoGeneration: () => 0,
    setFipsCrypto: () => 0,
    timingSafeEqual(a: any, b: any): boolean {
      const av = a instanceof Uint8Array ? a
        : ArrayBuffer.isView(a) ? new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
        : a instanceof ArrayBuffer ? new Uint8Array(a) : null;
      const bv = b instanceof Uint8Array ? b
        : ArrayBuffer.isView(b) ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
        : b instanceof ArrayBuffer ? new Uint8Array(b) : null;
      if (!av || !bv) {
        throw new TypeError('Expected input to be an ArrayBuffer or view');
      }
      if (av.byteLength !== bv.byteLength) {
        throw new RangeError('Input buffers must have the same byte length');
      }
      // Best-effort constant-time compare (true CT is not expressible in JS).
      let acc = 0;
      for (let i = 0; i < av.byteLength; i++) acc |= av[i] ^ bv[i];
      return acc === 0;
    },
    getCachedAliases: () => aliasCache,
    getCachedMacAliases: () => aliasCache,
    getHashes: () => [...CANONICAL_HASHES, 'sha-1', 'sha-224', 'sha-256',
      'sha-384', 'sha-512'],
    getMacs: () => [...CANONICAL_HASHES],
    getCurves: () => [],
    getCiphers: () => [],
    getSSLCiphers: () => [],
    getCipherInfo: () => undefined,
    secureHeapUsed: () => undefined,
    getOpenSSLSecLevelCrypto: () => -1,
    isKeyAlgorithmAvailable: () => false,
    isKeyObject: () => false,
    isCryptoKey: () => false,
    isX509Certificate: () => false,
    setupFipsIndicatorChannel: () => {},
    resetRootCertStore: () => {},
    startLoadingCertificatesOffThread: () => Promise.resolve(),
    getBundledRootCertificates: () => [],
    getExtraCACertificates: () => [],
    getSystemCACertificates: () => [],
    getUserRootCertificates: () => [],
    getCertificateCompressionAlgorithms: () => [],
    Hash: CryptoHash,
    Hmac: CryptoHmac,
    HashJob,
    PBKDF2Job,
    oneShotDigest(algorithm: any, _id: any, _cache: any, data: any,
                  outputEncoding?: any, _enc?: any, outputLength?: any): any {
      if (outputLength !== undefined && outputLength !== null) {
        throw new Error('OpenContainer: XOF digests (outputLength) are not supported');
      }
      const impl = lookupHash(algorithm)();
      impl.update(toBytes(data));
      const out = toBuffer(impl.digest());
      if (typeof outputEncoding === 'string' && outputEncoding) {
        return out.toString(outputEncoding);
      }
      return out;
    },
    setEngine: unsupported('setEngine'),
    certExportChallenge: unsupported('Certificate.exportChallenge'),
    certExportPublicKey: unsupported('Certificate.exportPublicKey'),
    certVerifySpkac: unsupported('Certificate.verifySpkac'),
    privateDecrypt: unsupported('privateDecrypt'),
    privateEncrypt: unsupported('privateEncrypt'),
    publicDecrypt: unsupported('publicDecrypt'),
    publicEncrypt: unsupported('publicEncrypt'),
    parsePKCS12: unsupported('parsePKCS12'),

    // ---- classes: constructed only when the feature is used ----
    CipherBase: unsupportedClass('CipherBase (createCipheriv/Decipheriv)'),
    KeyObjectHandle: unsupportedClass('KeyObjectHandle (key generation/export)'),
    Sign: unsupportedClass('Sign (createSign)'),
    Verify: unsupportedClass('Verify (createVerify)'),
    Mac: unsupportedClass('Mac (createMac)'),
    DiffieHellman: unsupportedClass('DiffieHellman'),
    DiffieHellmanGroup: unsupportedClass('DiffieHellmanGroup (modp groups)'),
    ECDH: unsupportedClass('ECDH'),
    ECDHConvertKey: unsupportedClass('ECDHConvertKey'),
    SecureContext: unsupportedClass('SecureContext (TLS)'),
    createCryptoKeyClass,
    createNativeKeyObjectClass,
    createX509CertificateClass,

    // ---- jobs for unsupported operations ----
    RandomPrimeJob: todoJob('generatePrime'),
    CheckPrimeJob: todoJob('checkPrime'),
    ScryptJob: todoJob('scrypt'),
    HKDFJob: todoJob('hkdf'),
    HmacJob: todoJob('WebCrypto HMAC (subtle.sign)'),
    SignJob: todoJob('sign/verify (public-key crypto)'),
    RSACipherJob: todoJob('RSA cipher'),
    AESCipherJob: todoJob('AES cipher'),
    ChaCha20Poly1305CipherJob: todoJob('ChaCha20-Poly1305 cipher'),
    DHBitsJob: todoJob('diffieHellman bits'),
    Argon2Job: todoJob('argon2'),
    KmacJob: todoJob('KMAC'),
    KangarooTwelveJob: todoJob('KangarooTwelve'),
    TurboShakeJob: todoJob('TurboShake'),
    KEMEncapsulateJob: todoJob('KEM encapsulate'),
    KEMDecapsulateJob: todoJob('KEM decapsulate'),
    DhKeyPairGenJob: todoJob('DH key generation'),
    DsaKeyPairGenJob: todoJob('DSA key generation'),
    EcKeyPairGenJob: todoJob('EC key generation'),
    NamedKeyPairGenJob: todoJob('key generation'),
    RsaKeyPairGenJob: todoJob('RSA key generation'),
    SecretKeyGenJob: todoJob('createSecretKey'),

    // ---- constants ----
    kCryptoJobAsync: K_MODE_ASYNC,
    kCryptoJobSync: K_MODE_SYNC,
    kCryptoJobWebCrypto: K_MODE_WEBCRYPTO,
    kSignJobModeSign: 0,
    kSignJobModeVerify: 1,
    kSigEncDER: 0,
    kSigEncP1363: 1,
    kKeyEncodingPKCS1: 1,
    kKeyEncodingPKCS8: 2,
    kKeyEncodingSEC1: 3,
    kKeyEncodingSPKI: 4,
    kKeyFormatDER: 1,
    kKeyFormatPEM: 2,
    kKeyFormatJWK: 3,
    kKeyFormatRawPrivate: 4,
    kKeyFormatRawPublic: 5,
    kKeyFormatRawSeed: 6,
    kKeyFormatStore: 7,
    kKeyTypeSecret: 0,
    kKeyTypePublic: 1,
    kKeyTypePrivate: 2,
    kKeyVariantAES_CBC_128: 0, kKeyVariantAES_CBC_192: 1, kKeyVariantAES_CBC_256: 2,
    kKeyVariantAES_CTR_128: 3, kKeyVariantAES_CTR_192: 4, kKeyVariantAES_CTR_256: 5,
    kKeyVariantAES_GCM_128: 6, kKeyVariantAES_GCM_192: 7, kKeyVariantAES_GCM_256: 8,
    kKeyVariantAES_KW_128: 9,  kKeyVariantAES_KW_192: 10, kKeyVariantAES_KW_256: 11,
    kKeyVariantAES_OCB_128: 12, kKeyVariantAES_OCB_192: 13, kKeyVariantAES_OCB_256: 14,
    kKeyVariantRSA_OAEP: 15,
    kKeyVariantRSA_PSS: 16,
    kKeyVariantRSA_SSA_PKCS1_v1_5: 17,
    kWebCryptoCipherEncrypt: 0,
    kWebCryptoCipherDecrypt: 1,
    kWebCryptoKeyFormatRaw: 0,
    kWebCryptoKeyFormatSPKI: 1,
    kWebCryptoKeyFormatPKCS8: 2,
    kTypeArgon2d: 0,
    kTypeArgon2i: 1,
    kTypeArgon2id: 2,
    OPENSSL_EC_EXPLICIT_CURVE: 0x000,
    OPENSSL_EC_NAMED_CURVE: 0x001,
    RSA_PKCS1_PSS_PADDING: 6,
    X509_CHECK_FLAG_ALWAYS_CHECK_SUBJECT: 0x1,
    X509_CHECK_FLAG_NO_WILDCARDS: 0x2,
    X509_CHECK_FLAG_MULTI_LABEL_WILDCARDS: 0x4,
    X509_CHECK_FLAG_SINGLE_LABEL_SUBDOMAINS: 0x8,
    X509_CHECK_FLAG_NEVER_CHECK_SUBJECT: 0x10,
    X509_CHECK_FLAG_NO_PARTIAL_WILDCARDS: 0x20,
  };
}
