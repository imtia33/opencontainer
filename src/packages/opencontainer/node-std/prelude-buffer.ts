/**
 * OpenContainer — Node compat prelude: Buffer.
 * Pure-JS Buffer on top of Uint8Array with utf8/latin1/ascii/hex/base64
 * codecs, from/alloc/concat/slice and inspection.
 */
export const PRELUDE_BUFFER = String.raw`
/* ============================= Buffer ============================= */
(function () {
  'use strict';

  var textEncode = globalThis.__ocUtf8Encode;
  var textDecode = globalThis.__ocUtf8Decode;

  var BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var HEX_CHARS = '0123456789abcdef';

  function utf8WriteTo(bytes, offset, str) {
    var encoded = textEncode(str);
    bytes.set(encoded, offset);
    return encoded.length;
  }

  function latin1WriteTo(bytes, offset, str, length) {
    var n = Math.min(str.length, length);
    for (var i = 0; i < n; i++) {
      bytes[offset + i] = str.charCodeAt(i) & 0xff;
    }
    return n;
  }

  function decodeString(bytes, encoding, start, end) {
    start = start === undefined ? 0 : start;
    end = end === undefined ? bytes.length : end;
    var view = bytes.subarray(start, end);
    encoding = (encoding || 'utf8').toLowerCase();
    if (encoding === 'utf8' || encoding === 'utf-8' || encoding === 'utf16le' || encoding === 'ucs2' || encoding === 'ucs-2') {
      return textDecode(view);
    }
    if (encoding === 'latin1' || encoding === 'binary' || encoding === 'ascii') {
      var out = '';
      for (var i = 0; i < view.length; i++) {
        out += String.fromCharCode(encoding === 'ascii' ? (view[i] & 0x7f) : view[i]);
      }
      return out;
    }
    if (encoding === 'hex') {
      var h = '';
      for (var j = 0; j < view.length; j++) {
        h += HEX_CHARS[view[j] >> 4] + HEX_CHARS[view[j] & 15];
      }
      return h;
    }
    if (encoding === 'base64') {
      return base64Encode(view);
    }
    throw new TypeError('Buffer: encoding "' + encoding + '" is not supported');
  }

  function base64Encode(bytes) {
    var out = '';
    var i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += BASE64_CHARS[(n >> 18) & 63] + BASE64_CHARS[(n >> 12) & 63] + BASE64_CHARS[(n >> 6) & 63] + BASE64_CHARS[n & 63];
    }
    var rem = bytes.length - i;
    if (rem === 1) {
      var b = bytes[i];
      out += BASE64_CHARS[b >> 2] + BASE64_CHARS[(b & 3) << 4] + '==';
    } else if (rem === 2) {
      var b2 = (bytes[i] << 8) | bytes[i + 1];
      out += BASE64_CHARS[b2 >> 10] + BASE64_CHARS[(b2 >> 4) & 63] + BASE64_CHARS[(b2 & 15) << 2] + '=';
    }
    return out;
  }

  function base64Decode(str) {
    str = String(str).replace(/[\t\n\f\r ]+/g, '');
    if (str.startsWith('=')) throw new TypeError('Invalid base64 input');
    var len = str.length;
    var out = [];
    var i = 0;
    var buffer = 0;
    var bits = 0;
    for (; i < len; i++) {
      var c = BASE64_CHARS.indexOf(str.charAt(i));
      if (c === -1) {
        if (str.charAt(i) === '=') break;
        throw new TypeError('Invalid base64 character: ' + str.charAt(i));
      }
      buffer = (buffer << 6) | c;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out.push((buffer >> bits) & 0xff);
      }
    }
    return new Uint8Array(out);
  }

  function byteLength(str, encoding) {
    encoding = (encoding || 'utf8').toLowerCase();
    if (typeof str !== 'string') {
      if (str && typeof str === 'object' && typeof str.length === 'number') return str.length;
      return Number(str) || 0;
    }
    if (encoding === 'utf8' || encoding === 'utf-8') return textEncode(str).length;
    if (encoding === 'latin1' || encoding === 'binary' || encoding === 'ascii') return str.length;
    if (encoding === 'hex') return str.length >> 1;
    if (encoding === 'base64') return base64Decode(str).length;
    if (encoding === 'utf16le' || encoding === 'ucs2') return str.length * 2;
    return textEncode(str).length;
  }

  function BufferShim(arg, encodingOrOffset, length) {
    if (!(this instanceof BufferShim)) return BufferShim.from(arg, encodingOrOffset, length);
    if (typeof arg === 'number') {
      var arr = new Uint8Array(arg);
      arr.__proto__ = BufferShim.prototype;
      return arr;
    }
    if (arg instanceof Uint8Array || arg instanceof ArrayBuffer) {
      var u8 = arg instanceof Uint8Array ? arg : new Uint8Array(arg);
      var off = typeof encodingOrOffset === 'number' ? encodingOrOffset : 0;
      var len = typeof length === 'number' ? length : (u8.length - off);
      var copy = new Uint8Array(len);
      copy.set(u8.subarray(off, off + len));
      copy.__proto__ = BufferShim.prototype;
      return copy;
    }
    if (typeof arg === 'string') {
      var bytes = encodeString(arg, encodingOrOffset || 'utf8');
      bytes.__proto__ = BufferShim.prototype;
      return bytes;
    }
    throw new TypeError('Buffer: invalid arguments');
  }

  function encodeString(str, encoding) {
    encoding = (encoding || 'utf8').toLowerCase();
    if (encoding === 'utf8' || encoding === 'utf-8') return textEncode(str);
    if (encoding === 'latin1' || encoding === 'binary' || encoding === 'ascii') {
      var out = new Uint8Array(str.length);
      for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
      return out;
    }
    if (encoding === 'hex') {
      var bytes = [];
      for (var j = 0; j + 1 < str.length; j += 2) {
        bytes.push(parseInt(str.substr(j, 2), 16) || 0);
      }
      return new Uint8Array(bytes);
    }
    if (encoding === 'base64') return base64Decode(str);
    return textEncode(str);
  }

  BufferShim.prototype = Object.create(Uint8Array.prototype);
  BufferShim.prototype.constructor = BufferShim;

  BufferShim.prototype.__ocIsBuffer = true;
  BufferShim.prototype.inspect = function (depth, options) {
    var max = 50;
    var parts = [];
    for (var i = 0; i < Math.min(this.length, max); i++) {
      parts.push(this[i] < 16 ? '0' + this[i].toString(16) : this[i].toString(16));
    }
    if (this.length > max) parts.push('... ' + (this.length - max) + ' more bytes');
    return '<Buffer ' + parts.join(' ') + '>';
  };
  BufferShim.prototype.toString = function (encoding, start, end) {
    return decodeString(this, encoding, start, end);
  };
  BufferShim.prototype.write = function (string, offset, length, encoding) {
    if (typeof offset === 'string') { encoding = offset; offset = 0; length = this.length; }
    else if (typeof length === 'string') { encoding = length; length = this.length; }
    offset = offset || 0;
    length = length === undefined ? this.length - offset : Math.min(length, this.length - offset);
    encoding = (encoding || 'utf8').toLowerCase();
    if (encoding === 'utf8' || encoding === 'utf-8') {
      var encoded = textEncode(string);
      var n = Math.min(encoded.length, length);
      this.set(encoded.subarray(0, n), offset);
      return n;
    }
    if (encoding === 'latin1' || encoding === 'binary' || encoding === 'ascii') {
      return latin1WriteTo(this, offset, string, length);
    }
    if (encoding === 'hex') {
      var n2 = Math.min(string.length >> 1, length);
      for (var i = 0; i < n2; i++) {
        this[offset + i] = parseInt(string.substr(i * 2, 2), 16) || 0;
      }
      return n2;
    }
    throw new TypeError('Buffer.write: encoding not supported: ' + encoding);
  };
  BufferShim.prototype.subarray = function (start, end) {
    var u8 = Uint8Array.prototype.subarray.call(this, start, end);
    u8.__proto__ = BufferShim.prototype;
    return u8;
  };
  BufferShim.prototype.slice = function (start, end) {
    var u8 = Uint8Array.prototype.slice.call(this, start, end);
    u8.__proto__ = BufferShim.prototype;
    return u8;
  };
  BufferShim.prototype.equals = function (other) { return BufferShim.compare(this, other) === 0; };
  BufferShim.prototype.compare = function (other, targetStart, targetEnd, sourceStart, sourceEnd) { return BufferShim.compare(this, other, targetStart, targetEnd, sourceStart, sourceEnd); };
  BufferShim.prototype.fill = function (value, start, end) {
    var v = typeof value === 'string' ? encodeString(value, 'utf8')[0] || 0 : Number(value) || 0;
    start = start || 0;
    end = end === undefined ? this.length : end;
    for (var i = start; i < end; i++) this[i] = v;
    return this;
  };
  BufferShim.prototype.indexOf = function (value, byteOffset, encoding) {
    var needle;
    if (typeof value === 'string') needle = encodeString(value, encoding || 'utf8');
    else if (value instanceof Uint8Array) needle = value;
    else needle = new Uint8Array([Number(value) || 0]);
    byteOffset = byteOffset === undefined ? 0 : (byteOffset < 0 ? this.length + byteOffset : byteOffset);
    outer: for (var i = byteOffset; i <= this.length - needle.length; i++) {
      for (var j = 0; j < needle.length; j++) {
        if (this[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  };
  BufferShim.prototype.lastIndexOf = function (value, byteOffset, encoding) {
    var needle;
    if (typeof value === 'string') needle = encodeString(value, encoding || 'utf8');
    else if (value instanceof Uint8Array) needle = value;
    else needle = new Uint8Array([Number(value) || 0]);
    byteOffset = byteOffset === undefined ? this.length - needle.length : byteOffset;
    outer: for (var i = byteOffset; i >= 0; i--) {
      for (var j = 0; j < needle.length; j++) {
        if (this[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  };
  BufferShim.prototype.includes = function (value, byteOffset, encoding) { return this.indexOf(value, byteOffset, encoding) !== -1; };
  BufferShim.prototype.copy = function (target, targetStart, sourceStart, sourceEnd) {
    targetStart = targetStart || 0;
    sourceStart = sourceStart || 0;
    sourceEnd = sourceEnd === undefined ? this.length : sourceEnd;
    var n = Math.min(sourceEnd - sourceStart, target.length - targetStart);
    for (var i = 0; i < n; i++) target[targetStart + i] = this[sourceStart + i];
    return n;
  };
  BufferShim.prototype.readUInt8 = function (offset) { return this[offset]; };
  BufferShim.prototype.readUInt16LE = function (offset) { return this[offset] | (this[offset + 1] << 8); };
  BufferShim.prototype.readUInt16BE = function (offset) { return (this[offset] << 8) | this[offset + 1]; };
  BufferShim.prototype.readUInt32LE = function (offset) { return ((this[offset]) | (this[offset + 1] << 8) | (this[offset + 2] << 16) | (this[offset + 3] << 24)) >>> 0; };
  BufferShim.prototype.readUInt32BE = function (offset) { return ((this[offset] << 24) | (this[offset + 2] << 16) | (this[offset + 1] << 8) | (this[offset + 3])) >>> 0; };
  BufferShim.prototype.readInt8 = function (offset) { return (this[offset] << 24) >> 24; };
  BufferShim.prototype.readInt16LE = function (offset) { return (this[offset] | (this[offset + 1] << 8)) << 16 >> 16; };
  BufferShim.prototype.readInt32LE = function (offset) { return (this[offset] | (this[offset + 1] << 8) | (this[offset + 2] << 16) | (this[offset + 3] << 24)); };
  BufferShim.prototype.readDoubleLE = function (offset) {
    var b = this.slice(offset, offset + 8);
    var f = 0; var s = 1;
    for (var i = 0; i < 8; i++) { f += b[i] * s; s *= 256; }
    // simple little-endian double decode
    var buf = new ArrayBuffer(8);
    var u8 = new Uint8Array(buf);
    for (var j = 0; j < 8; j++) u8[j] = b[j];
    return new Float64Array(buf)[0];
  };
  BufferShim.prototype.writeUInt8 = function (value, offset) { this[offset] = value & 0xff; return offset + 1; };
  BufferShim.prototype.writeUInt16LE = function (value, offset) { this[offset] = value & 0xff; this[offset + 1] = (value >> 8) & 0xff; return offset + 2; };
  BufferShim.prototype.writeUInt16BE = function (value, offset) { this[offset] = (value >> 8) & 0xff; this[offset + 1] = value & 0xff; return offset + 2; };
  BufferShim.prototype.writeUInt32LE = function (value, offset) { this[offset] = value & 0xff; this[offset + 1] = (value >> 8) & 0xff; this[offset + 2] = (value >> 16) & 0xff; this[offset + 3] = (value >> 24) & 0xff; return offset + 4; };
  BufferShim.prototype.writeUInt32BE = function (value, offset) { this[offset] = (value >> 24) & 0xff; this[offset + 1] = (value >> 16) & 0xff; this[offset + 2] = (value >> 8) & 0xff; this[offset + 3] = value & 0xff; return offset + 4; };
  BufferShim.prototype.writeInt32LE = BufferShim.prototype.writeUInt32LE;
  BufferShim.prototype.toJSON = function () { return { type: 'Buffer', data: Array.from(this) }; };
  BufferShim.prototype.swap16 = function () { for (var i = 0; i + 1 < this.length; i += 2) { var t = this[i]; this[i] = this[i + 1]; this[i + 1] = t; } return this; };
  BufferShim.prototype.readUInt32BE; // noop reference

  BufferShim.from = function (value, encodingOrOffset, length) {
    if (typeof value === 'string') return new BufferShim(value, encodingOrOffset);
    if (value instanceof Uint8Array) {
      var off = typeof encodingOrOffset === 'number' ? encodingOrOffset : 0;
      var len = typeof length === 'number' ? length : value.length - off;
      var copy = new Uint8Array(len);
      copy.set(value.subarray(off, off + len));
      copy.__proto__ = BufferShim.prototype;
      return copy;
    }
    if (value instanceof ArrayBuffer) return new BufferShim(value, encodingOrOffset, length);
    if (Array.isArray(value)) {
      var out = new Uint8Array(value.length);
      for (var i = 0; i < value.length; i++) out[i] = value[i] & 0xff;
      out.__proto__ = BufferShim.prototype;
      return out;
    }
    if (value && typeof value === 'object' && typeof value.length === 'number') return BufferShim.from(Array.from(value));
    if (value && typeof value === 'object' && value.type === 'Buffer' && Array.isArray(value.data)) return BufferShim.from(value.data);
    throw new TypeError('Buffer.from: invalid arguments');
  };
  BufferShim.of = function () { return BufferShim.from(Array.prototype.slice.call(arguments)); };
  BufferShim.alloc = function (size, fill, encoding) {
    size = Number(size) || 0;
    var out = new Uint8Array(size);
    out.__proto__ = BufferShim.prototype;
    if (fill !== undefined && size > 0) {
      if (typeof fill === 'string') {
        var bytes = encodeString(fill, encoding || 'utf8');
        if (bytes.length === 0) return out;
        for (var i = 0; i < size; i++) out[i] = bytes[i % bytes.length];
      } else if (typeof fill === 'number') {
        out.fill(fill);
      } else if (fill instanceof Uint8Array) {
        for (var j = 0; j < size; j++) out[j] = fill[j % fill.length];
      }
    }
    return out;
  };
  BufferShim.allocUnsafe = function (size) { return BufferShim.alloc(size); };
  BufferShim.allocUnsafeSlow = function (size) { return BufferShim.alloc(size); };
  BufferShim.concat = function (list, totalLength) {
    var total = totalLength === undefined ? list.reduce(function (a, b) { return a + b.length; }, 0) : totalLength;
    var out = new Uint8Array(total);
    var offset = 0;
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (offset >= total) break;
      out.set(item.subarray(0, Math.min(item.length, total - offset)), offset);
      offset += item.length;
    }
    out.__proto__ = BufferShim.prototype;
    return out;
  };
  BufferShim.isBuffer = function (obj) {
    return obj instanceof Uint8Array && obj.__ocIsBuffer === true;
  };
  BufferShim.isEncoding = function (encoding) {
    return ['utf8', 'utf-8', 'utf16le', 'latin1', 'binary', 'ascii', 'hex', 'base64', 'ucs2'].indexOf(String(encoding).toLowerCase()) !== -1;
  };
  BufferShim.byteLength = byteLength;
  BufferShim.compare = function (a, b) {
    if (!a || !b) throw new TypeError('Arguments must be Buffers');
    var len = Math.min(a.length, b.length);
    for (var i = 0; i < len; i++) {
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return a.length === b.length ? 0 : (a.length < b.length ? -1 : 1);
  };
  BufferShim.poolSize = 8192;

  globalThis.Buffer = BufferShim;
  globalThis.__ocBase64Encode = base64Encode;
  globalThis.__ocBase64Decode = base64Decode;
  globalThis.__ocEncodeString = encodeString;
  globalThis.__ocDecodeString = decodeString;
  globalThis.__ocModules.buffer = { Buffer: BufferShim, INSPECT_MAX_BYTES: 50, kMaxLength: 0x7fffffff };
})();
`;
