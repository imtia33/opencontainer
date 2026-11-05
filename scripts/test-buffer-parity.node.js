#!/usr/bin/env node
/**
 * OpenContainer — buffer/fs binding parity GROUND TRUTH (real node side).
 *
 * Run with the sandbox's real node binary:
 *   node scripts/test-buffer-parity.node.js
 *
 * Computes ~44 behavioral cases with REAL node Buffers + fs and prints one
 * JSON object (case id → serialized result) on stdout. The companion script
 * scripts/test-buffer-parity.ts boots OUR kernel with the same vendored node
 * v26 lib tree, runs the identical case list, and diffs against this output.
 *
 * The CASES section below must stay in lockstep with test-buffer-parity.ts
 * (same ids, same call shapes — only the `api` plumbing differs).
 *
 * node v24 lacks two v26 surface items (they were added upstream after v24):
 *   - buffer.isLatin1      → v26 lib/buffer.js: "true if every UTF-16 code
 *                            unit of input is <= 0xFF" (spec-computed here)
 *   - Buffer.stringLength  → v26 bindingStringLengthUtf8 = UTF-16 code-unit
 *                            length of the utf-8 decoding; for the VALID
 *                            utf-8 inputs used here that is exactly
 *                            Buffer.from(bytes).toString('utf8').length
 *                            (real node decoding — not a mock).
 * Every other case goes through the real node C++ binding ops
 * (copy / fill / compareOffset / indexOfNumber / indexOfString /
 * indexOfBuffer / isAscii / isUtf8 / atob / btoa + fs
 * writeString/writeBuffers via writeSync/writevSync).
 */
'use strict';

const nodeFs = require('node:fs');
const nodeOs = require('node:os');
const nodePath = require('node:path');
const bufferMod = require('node:buffer');

// ---------------------------------------------------------------------------
// API plumbing (kernel side mirrors this exact shape).
// ---------------------------------------------------------------------------
const api = {
  Buffer: bufferMod.Buffer,
  btoa: bufferMod.btoa,
  atob: bufferMod.atob,
  isAscii: bufferMod.isAscii,
  isUtf8: bufferMod.isUtf8,
  // v24 lacks these two v26 APIs — spec/decoding equivalents (see header):
  isLatin1(str) {
    for (let i = 0; i < str.length; i++) {
      if (str.charCodeAt(i) > 0xff) return false;
    }
    return true;
  },
  stringLength(bytes) {
    return bufferMod.Buffer.from(bytes).toString('utf8').length;
  },
  fs: nodeFs,
};

let tmpSeq = 0;
/** Fresh scratch file path per case (node: os tmpdir; kernel: VFS /tmp). */
function tmp(name) {
  return nodePath.join(nodeOs.tmpdir(), `oc-parity-${process.pid}-${tmpSeq++}-${name}`);
}

const hex = (b) => b.toString('hex');
const B = (str, enc) => api.Buffer.from(str, enc);

/** Run fn, capture thrown DOMException name/message instead of throwing. */
function throws(fn) {
  try {
    return { threw: false, value: fn() };
  } catch (e) {
    return { threw: true, name: e && e.name, message: e && e.message };
  }
}

// ---------------------------------------------------------------------------
// CASES — 45 behavioral cases. KEEP IN SYNC with test-buffer-parity.ts.
// ---------------------------------------------------------------------------
const CASES = [
  // ---- copy (node_buffer.cc Copy: _copy(source, target, targetStart,
  //      sourceStart, nb) → bytes copied, node clamping rules) --------------
  ['copy-basic', () => {
    const dst = api.Buffer.alloc(6);
    const ret = B('abcdef').copy(dst);
    return [ret, hex(dst)];
  }],
  ['copy-subrange', () => {
    const dst = api.Buffer.alloc(6);
    const ret = B('abcdef').copy(dst, 1, 2, 4);
    return [ret, hex(dst)];
  }],
  ['copy-target-clamp', () => {
    const dst = api.Buffer.alloc(4);
    const ret = B('abcdef').copy(dst, 2, 0);
    return [ret, hex(dst)];
  }],
  ['copy-srcstart-ge-end', () => {
    const dst = api.Buffer.alloc(6);
    const ret = B('abcdef').copy(dst, 0, 4, 2);
    return [ret, hex(dst)];
  }],
  ['copy-sourceend-clamp', () => {
    const dst = api.Buffer.alloc(8);
    const ret = B('abc').copy(dst, 0, 0, 100);
    return [ret, hex(dst)];
  }],
  ['copy-multibyte', () => {
    const dst = api.Buffer.alloc(9);
    const ret = B('h\u00e9llo\u20ac').copy(dst);
    return [ret, hex(dst)];
  }],

  // ---- fill (bindingFill(buf, value, offset, end, encoding)) --------------
  ['fill-number', () => hex(api.Buffer.alloc(4).fill(0x61))],
  ['fill-string-repeat', () => hex(api.Buffer.alloc(5).fill('ab'))],
  ['fill-utf8-2byte', () => hex(api.Buffer.alloc(5).fill('\u00e9'))],
  ['fill-hex-encoding', () => hex(api.Buffer.alloc(4).fill('0102', 'hex'))],
  ['fill-uint8-value', () => hex(api.Buffer.alloc(5).fill(Uint8Array.of(1, 2, 3)))],

  // ---- indexOf / lastIndexOf (indexOfNumber / indexOfString /
  //      indexOfBuffer — forward + backward, clamps, not-found) -------------
  ['indexOf-number', () => B('abcdef').indexOf(100)],
  ['indexOf-number-negoffset', () => B('abcdef').indexOf(100, -3)],
  ['indexOf-number-notfound', () => B('abcdef').indexOf(122)],
  ['indexOf-string-mb', () => B('a\u00e9bc').indexOf('\u00e9')],
  ['indexOf-string-hex', () => B('abcdef').indexOf('6364', 'hex')],
  ['indexOf-string-ucs2', () => B('a\u00e9bc', 'utf16le').indexOf('\u00e9', 'ucs2')],
  ['indexOf-buffer', () => B('abcdef').indexOf(B('cd'))],
  ['indexOf-buffer-notfound', () => B('abcdef').indexOf(B('xy'))],
  ['lastIndexOf-number', () => B('abcabc').lastIndexOf(99)],
  ['lastIndexOf-string-offset', () => B('aabaab').lastIndexOf('aab', 3)],
  ['lastIndexOf-negoffset', () => B('canal').lastIndexOf('a', -2)],
  ['indexOf-empty-string', () => B('abc').indexOf('')],
  ['lastIndexOf-empty-string', () => B('abc').lastIndexOf('')],

  // ---- compare / compareOffset (Buffer.compare → _compare;
  //      buf.compare(t, ts, te, ss, se) → compareOffset(this, t, ts, ss, te, se)) --
  ['compare-full', () => api.Buffer.compare(B('abc'), B('abd'))],
  ['compareOffset-mismatch', () => B('abcdef').compare(B('abddef'), 2, 4, 2, 4)],
  ['compareOffset-len', () => B('ab').compare(B('ab'), 0, 1, 0, 2)],

  // ---- isAscii / isLatin1 / isUtf8 ----------------------------------------
  ['isAscii-true', () => api.isAscii(Uint8Array.of(0x00, 0x7f, 0x41))],
  ['isAscii-false', () => api.isAscii(Uint8Array.of(0x00, 0x80))],
  ['isAscii-arraybuffer', () => api.isAscii(new Uint8Array([65, 66]).buffer)],
  ['isLatin1-true', () => api.isLatin1('caf\u00e9')],
  ['isLatin1-false', () => api.isLatin1('\u011b')],
  ['isUtf8-valid', () => api.isUtf8(B('h\u00e9llo\u20ac'))],
  ['isUtf8-invalid', () => api.isUtf8(Uint8Array.of(0xc3, 0x28))],
  ['isUtf8-overlong', () => api.isUtf8(Uint8Array.of(0xc0, 0x80))],
  ['isUtf8-surrogate', () => api.isUtf8(Uint8Array.of(0xed, 0xa0, 0x80))],

  // ---- stringLengthUtf8 (v26 Buffer.stringLength, utf8 branch) ------------
  ['stringLength-ascii', () => api.stringLength(Uint8Array.of(0x68, 0x65, 0x6c, 0x6c, 0x6f))],
  ['stringLength-multibyte', () => api.stringLength(B('h\u00e9llo\u20ac'))],

  // ---- atob / btoa (module-level WHATWG forgiving-base64) -----------------
  ['btoa-basic', () => api.btoa('hello')],
  ['btoa-binary', () => api.btoa('\u0000\u00ff\u0010')],
  ['btoa-invalid', () => throws(() => api.btoa('\u0100'))],
  ['atob-basic', () => api.atob('aGVsbG8=')],
  ['atob-whitespace', () => api.atob(' YQ== ')],
  ['atob-single-char', () => throws(() => api.atob('a'))],
  ['atob-invalid-char', () => throws(() => api.atob('a=c'))],

  // ---- fs writeString / writeBuffers (lib/fs.js string form:
  //      binding.writeString(fd, str, POSITION, ENCODING)) -------------------
  ['writeString-pos0', () => {
    const p = tmp('w1');
    const fd = api.fs.openSync(p, 'w');
    const n = api.fs.writeSync(fd, 'hello world', 0);
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
  ['writeString-mid-position', () => {
    const p = tmp('w2');
    const fd = api.fs.openSync(p, 'w');
    api.fs.writeSync(fd, 'A'.repeat(20), 0);
    const n = api.fs.writeSync(fd, 'hello', 8);
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
  ['writeString-null-append', () => {
    const p = tmp('w3');
    const fd = api.fs.openSync(p, 'w');
    api.fs.writeSync(fd, 'foo', 0);
    const n = api.fs.writeSync(fd, 'bar', null);
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
  ['writeString-utf8', () => {
    const p = tmp('w4');
    const fd = api.fs.openSync(p, 'w');
    const n = api.fs.writeSync(fd, 'h\u00e9llo', 0);
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
  ['writeString-latin1', () => {
    const p = tmp('w5');
    const fd = api.fs.openSync(p, 'w');
    const n = api.fs.writeSync(fd, '\u00e9\u00e9', 0, 'latin1');
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
  ['writev-position', () => {
    const p = tmp('w6');
    const fd = api.fs.openSync(p, 'w');
    api.fs.writeSync(fd, 'XXXXXX', 0);
    const n = api.fs.writevSync(fd, [B('ab'), B('cd')], 2);
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
  ['writeBuffer-slice', () => {
    const p = tmp('w8');
    const fd = api.fs.openSync(p, 'w');
    api.fs.writeSync(fd, 'A'.repeat(10), 0);
    // buffer form: binding.writeBuffer(fd, buffer, offset, length, position)
    // — writes buffer[offset, offset+length) at the FILE position.
    const n = api.fs.writeSync(fd, B('abcdef'), 1, 3, 4);
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
  ['writeString-sparse', () => {
    const p = tmp('w7');
    const fd = api.fs.openSync(p, 'w');
    const n = api.fs.writeSync(fd, 'Z', 10);
    api.fs.closeSync(fd);
    const out = hex(api.fs.readFileSync(p));
    api.fs.unlinkSync(p);
    return [n, out];
  }],
];

// ---------------------------------------------------------------------------
// Run + print.
// ---------------------------------------------------------------------------
const results = {};
for (const [id, run] of CASES) {
  try {
    results[id] = run();
  } catch (e) {
    results[id] = { __caseThrew: true, name: e && e.name, message: e && e.message };
  }
}
process.stdout.write(JSON.stringify(results) + '\n');
