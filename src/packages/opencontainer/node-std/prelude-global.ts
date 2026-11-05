/**
 * OpenContainer — Node compat prelude: core globals.
 *
 * Runs inside the QuickJS VM at process start. Provides the browser-missing
 * globals (TextEncoder/TextDecoder, URL, console, performance) plus Node's
 * util / events / path / os / assert modules.
 *
 * NOTE: no template literals or ${} inside this string (it is embedded in a
 * TS template below via String.raw-free concatenation).
 */
export const PRELUDE_GLOBAL = String.raw`
/* ============================= globals ============================= */

(function () {
  'use strict';

  /* ------------------------- UTF-8 codecs ------------------------- */
  function utf8Encode(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        var next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          i++;
        }
      }
      if (code < 0x80) {
        out.push(code);
      } else if (code < 0x800) {
        out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
      } else if (code < 0x10000) {
        out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      } else {
        out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
      }
    }
    return new Uint8Array(out);
  }

  function utf8Decode(bytes) {
    var out = '';
    var i = 0;
    while (i < bytes.length) {
      var b = bytes[i];
      var code;
      if (b < 0x80) {
        code = b; i += 1;
      } else if (b < 0xe0) {
        code = ((b & 31) << 6) | (bytes[i + 1] & 63); i += 2;
      } else if (b < 0xf0) {
        code = ((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63); i += 3;
      } else {
        code = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63); i += 4;
      }
      if (code > 0xffff) {
        code -= 0x10000;
        out += String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
      } else {
        out += String.fromCharCode(code);
      }
    }
    return out;
  }

  globalThis.__ocUtf8Encode = utf8Encode;
  globalThis.__ocUtf8Decode = utf8Decode;

  class TextEncoderShim {
    constructor() { this.encoding = 'utf-8'; }
    encode(input) { return utf8Encode(String(input ?? '')); }
    encodeInto(source, destination) {
      var bytes = utf8Encode(String(source ?? ''));
      var written = Math.min(bytes.length, destination.length);
      destination.set(bytes.subarray(0, written));
      return { read: written, written: written };
    }
  }

  class TextDecoderShim {
    constructor(encoding) {
      this.encoding = (encoding || 'utf-8').toLowerCase();
      if (this.encoding !== 'utf-8' && this.encoding !== 'utf8') {
        throw new Error('TextDecoder: only utf-8 is supported by OpenContainer');
      }
      this.fatal = false; this.ignoreBOM = false;
    }
    decode(input) {
      if (!input) return '';
      var bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
      if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        bytes = bytes.subarray(3);
      }
      return utf8Decode(bytes);
    }
  }

  globalThis.TextEncoder = TextEncoderShim;
  globalThis.TextDecoder = TextDecoderShim;

  /* ------------------------- URL (WHATWG subset) ------------------------- */
  var URL_PATTERN = /^([a-zA-Z][a-zA-Z0-9+.-]*:)?(?:\/\/([^/?#]*))?([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/;

  class URLSearchParamsShim {
    constructor(init) {
      this.__pairs = [];
      if (typeof init === 'string') {
        this.__parse(init);
      } else if (init && typeof init.forEach === 'function') {
        init.forEach(function (value, key) {
          this.append(String(key), String(value));
        }, this);
      } else if (init && typeof init === 'object') {
        Object.keys(init).forEach(function (key) {
          this.append(key, String(init[key]));
        }, this);
      }
    }
    __parse(qs) {
      if (qs.charAt(0) === '?') qs = qs.slice(1);
      if (!qs) return;
      var parts = qs.split('&');
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (!part) continue;
        var eq = part.indexOf('=');
        if (eq === -1) {
          this.__pairs.push([__decodeURIComponent(part.replace(/\+/g, ' ')), '']);
        } else {
          this.__pairs.push([__decodeURIComponent(part.slice(0, eq).replace(/\+/g, ' ')), __decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '))]);
        }
      }
    }
    append(key, value) { this.__pairs.push([String(key), String(value)]); }
    delete(key) { key = String(key); this.__pairs = this.__pairs.filter(function (p) { return p[0] !== key; }); }
    get(key) { key = String(key); for (var i = 0; i < this.__pairs.length; i++) { if (this.__pairs[i][0] === key) return this.__pairs[i][1]; } return null; }
    getAll(key) { key = String(key); return this.__pairs.filter(function (p) { return p[0] === key; }).map(function (p) { return p[1]; }); }
    has(key) { return this.get(String(key)) !== null; }
    set(key, value) { key = String(key); var found = false; var out = []; for (var i = 0; i < this.__pairs.length; i++) { if (this.__pairs[i][0] === key) { if (!found) { out.push([key, String(value)]); found = true; } } else { out.push(this.__pairs[i]); } } if (!found) out.push([key, String(value)]); this.__pairs = out; }
    sort() { this.__pairs.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; }); }
    toString() {
      return this.__pairs.map(function (p) {
        return __encodeURIComponent(p[0]).replace(/%20/g, '+') + '=' + __encodeURIComponent(p[1]).replace(/%20/g, '+');
      }).join('&');
    }
    forEach(cb, thisArg) {
      this.__pairs.slice().forEach(function (p) { cb.call(thisArg, p[1], p[0], this); }, this);
    }
    entries() { var idx = 0; var pairs = this.__pairs.slice(); return { next: function () { return idx < pairs.length ? { value: pairs[idx++], done: false } : { value: undefined, done: true }; }, [Symbol.iterator]: function () { return this; } }; }
    keys() { var idx = 0; var pairs = this.__pairs.map(function (p) { return p[0]; }); return { next: function () { return idx < pairs.length ? { value: pairs[idx++], done: false } : { value: undefined, done: true }; }, [Symbol.iterator]: function () { return this; } }; }
    values() { var idx = 0; var pairs = this.__pairs.map(function (p) { return p[1]; }); return { next: function () { return idx < pairs.length ? { value: pairs[idx++], done: false } : { value: undefined, done: true }; }, [Symbol.iterator]: function () { return this; } }; }
    get size() { return this.__pairs.length; }
    [Symbol.iterator]() { return this.entries(); }
  }

  function __encodeURIComponent(s) {
    return encodeURIComponent(String(s));
  }
  function __decodeURIComponent(s) {
    try { return decodeURIComponent(String(s)); } catch (e) { return String(s); }
  }

  class URLShim {
    constructor(input, base) {
      input = String(input);
      if (base !== undefined) {
        base = new URLShim(base);
        input = URLShim.__resolve(base, input);
      }
      var m = URL_PATTERN.exec(input);
      if (!m) throw new TypeError('Invalid URL: ' + input);
      this.__protocol = (m[1] || 'http:').toLowerCase();
      var authority = m[2] || '';
      this.__path = m[3] || (authority ? '/' : '');
      this.__query = m[4] === undefined ? null : m[4];
      this.__fragment = m[5] === undefined ? null : m[5];
      var userinfo = '';
      var hostport = authority;
      var at = authority.lastIndexOf('@');
      if (at !== -1) {
        userinfo = authority.slice(0, at);
        hostport = authority.slice(at + 1);
      }
      this.__username = userinfo ? userinfo.split(':')[0] : '';
      this.__password = userinfo && userinfo.indexOf(':') !== -1 ? userinfo.slice(userinfo.indexOf(':') + 1) : '';
      var portIdx = -1;
      var ipv6 = hostport.indexOf(']') !== -1;
      if (ipv6) {
        var close = hostport.indexOf(']');
        portIdx = hostport.indexOf(':', close);
      } else {
        portIdx = hostport.indexOf(':');
      }
      if (portIdx === -1) {
        this.__hostname = hostport;
        this.__port = '';
      } else {
        this.__hostname = hostport.slice(0, portIdx);
        this.__port = hostport.slice(portIdx + 1);
      }
      var protoName = this.__protocol.slice(0, -1);
      if ((protoName === 'http' && this.__port === '80') || (protoName === 'https' && this.__port === '443')) {
        this.__port = '';
      }
      this.searchParams = new URLSearchParamsShim(this.__query === null ? '' : this.__query);
    }

    static __resolve(base, rel) {
      if (rel === '') return base.href;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(rel)) return rel;
      if (rel.startsWith('//')) return base.protocol + rel;
      if (rel.startsWith('/')) return base.protocol + '//' + (base.username ? base.username + (base.password ? ':' + base.password : '') + '@' : '') + base.host + rel;
      var dir = base.pathname.substring(0, base.pathname.lastIndexOf('/') + 1);
      return base.protocol + '//' + (base.username ? base.username + (base.password ? ':' + base.password : '') + '@' : '') + base.host + __normalizePathJoin(dir + rel);
    }

    get href() { return this.toString(); }
    set href(v) { var u = new URLShim(String(v)); this.__copy(u); }
    get protocol() { return this.__protocol; }
    set protocol(v) { this.__protocol = String(v).endsWith(':') ? String(v) : String(v) + ':'; }
    get username() { return this.__username; }
    set username(v) { this.__username = String(v); }
    get password() { return this.__password; }
    set password(v) { this.__password = String(v); }
    get host() { return this.__hostname + (this.__port ? ':' + this.__port : ''); }
    set host(v) {
      var s = String(v);
      var idx = s.lastIndexOf(':');
      if (idx !== -1 && s.indexOf(']') > idx) idx = -1;
      this.__hostname = idx === -1 ? s : s.slice(0, idx);
      this.__port = idx === -1 ? '' : s.slice(idx + 1);
    }
    get hostname() { return this.__hostname; }
    set hostname(v) { this.__hostname = String(v); }
    get port() { return this.__port; }
    set port(v) { this.__port = String(v); }
    get pathname() { return this.__path || (this.__hostish() ? '/' : ''); }
    set pathname(v) { this.__path = String(v).startsWith('/') ? String(v) : '/' + String(v); }
    get search() { return this.__query === null || this.__query === '' ? '' : '?' + this.__query; }
    set search(v) {
      var s = String(v);
      this.__query = s === '' || s === '?' ? null : (s.startsWith('?') ? s.slice(1) : s);
      this.searchParams = new URLSearchParamsShim(this.__query === null ? '' : this.__query);
    }
    get hash() { return this.__fragment === null || this.__fragment === '' ? '' : '#' + this.__fragment; }
    set hash(v) { var s = String(v); this.__fragment = s === '' || s === '#' ? null : (s.startsWith('#') ? s.slice(1) : s); }
    get origin() { return this.__protocol + '//' + this.host; }
    get searchParams() { return this.__searchParams; }
    set searchParams(v) { this.__searchParams = v; }
    __hostish() { return this.__hostname !== '' || this.__port !== ''; }
    __copy(u) {
      this.__protocol = u.__protocol; this.__username = u.__username; this.__password = u.__password;
      this.__hostname = u.__hostname; this.__port = u.__port; this.__path = u.__path;
      this.__query = u.__query; this.__fragment = u.__fragment;
      this.searchParams = u.searchParams;
    }
    toString() {
      var auth = this.__username ? this.__username + (this.__password ? ':' + this.__password : '') + '@' : '';
      var s = this.__protocol + '//' + auth + this.host + this.pathname + this.search + this.hash;
      return s;
    }
    toJSON() { return this.toString(); }
    static canParse(input, base) {
      try { if (base !== undefined) new URLShim(input, base); else new URLShim(input); return true; } catch (e) { return false; }
    }
  }

  function __normalizePathJoin(p) {
    var parts = p.split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '' || parts[i] === '.') continue;
      if (parts[i] === '..') { out.pop(); continue; }
      out.push(parts[i]);
    }
    return '/' + out.join('/');
  }

  globalThis.URL = URLShim;
  globalThis.URLSearchParams = URLSearchParamsShim;

  /* ------------------------- console ------------------------- */
  function consoleFormat(args) {
    var out = [];
    for (var i = 0; i < args.length; i++) {
      out.push(__ocInspect(args[i], { depth: 4 }));
    }
    return out.join(' ');
  }

  globalThis.console = {
    log: function () { __host_stdout(consoleFormat(arguments) + '\n'); },
    info: function () { __host_stdout(consoleFormat(arguments) + '\n'); },
    debug: function () { __host_stdout(consoleFormat(arguments) + '\n'); },
    warn: function () { __host_stderr(consoleFormat(arguments) + '\n'); },
    error: function () { __host_stderr(consoleFormat(arguments) + '\n'); },
    trace: function () { __host_stderr('Trace: ' + consoleFormat(arguments) + '\n' + (__ocStack() || '') + '\n'); },
    dir: function (obj) { __host_stdout(__ocInspect(obj, { depth: Infinity }) + '\n'); },
    dirxml: function (obj) { __host_stdout(__ocInspect(obj, { depth: Infinity }) + '\n'); },
    table: function (obj) { __host_stdout(__ocInspect(obj, { depth: 2 }) + '\n'); },
    assert: function (condition) {
      if (!condition) {
        var args = Array.prototype.slice.call(arguments, 1);
        __host_stderr('Assertion failed: ' + consoleFormat(args) + '\n');
      }
    },
    time: function (label) { __ocTimers['t:' + label] = __host_hrtime_ms(); },
    timeEnd: function (label) {
      var key = 't:' + label;
      var start = __ocTimers[key];
      if (start === undefined) { __host_stderr('Warning: No such label \'' + label + '\' for console.timeEnd()\n'); return; }
      delete __ocTimers[key];
      __host_stdout(label + ': ' + (__host_hrtime_ms() - start).toFixed(3) + 'ms\n');
    },
    timeLog: function (label) {
      var start = __ocTimers['t:' + label];
      if (start === undefined) { __host_stderr('Warning: No such label \'' + label + '\' for console.timeLog()\n'); return; }
      __host_stdout(label + ': ' + (__host_hrtime_ms() - start).toFixed(3) + 'ms\n');
    },
    count: function (label) {
      label = label === undefined ? 'default' : String(label);
      __ocCounters[label] = (__ocCounters[label] || 0) + 1;
      __host_stdout(label + ': ' + __ocCounters[label] + '\n');
    },
    countReset: function (label) { label = label === undefined ? 'default' : String(label); delete __ocCounters[label]; },
    group: function () { __ocIndent += '  '; __host_stdout(consoleFormat(arguments) + '\n'); },
    groupEnd: function () { __ocIndent = __ocIndent.slice(0, -2); },
    groupCollapsed: function () { __ocIndent += '  '; __host_stdout(consoleFormat(arguments) + '\n'); },
    clear: function () { __host_stdout('\x1b[2J\x1b[H'); },
  };

  var __ocTimers = {};
  var __ocCounters = {};
  var __ocIndent = '';

  /* ------------------------- performance ------------------------- */
  globalThis.performance = {
    now: function () { return __host_hrtime_ms(); },
    timeOrigin: 0,
    mark: function () {},
    measure: function () {},
  };

  globalThis.queueMicrotask = function (cb) {
    Promise.resolve().then(cb);
  };

  globalThis.setTimeout = function (cb, delay) {
    var args = Array.prototype.slice.call(arguments, 2);
    var fn = typeof cb === 'function' ? cb : function () { eval(String(cb)); };
    var wrapped = args.length ? function () { fn.apply(undefined, args); } : fn;
    return __host_set_timeout(wrapped, Number(delay) || 0);
  };
  globalThis.clearTimeout = function (id) { __host_clear_timer(Number(id)); };
  globalThis.setInterval = function (cb, delay) {
    var args = Array.prototype.slice.call(arguments, 2);
    var fn = typeof cb === 'function' ? cb : function () { eval(String(cb)); };
    var wrapped = args.length ? function () { fn.apply(undefined, args); } : fn;
    return __host_set_interval(wrapped, Number(delay) || 0);
  };
  globalThis.clearInterval = function (id) { __host_clear_timer(Number(id)); };

  /* ============================= events ============================= */
  function EventEmitter() {
    this._events = Object.create(null);
    this._maxListeners = EventEmitter.defaultMaxListeners;
  }
  EventEmitter.defaultMaxListeners = 10;
  EventEmitter.prototype._events = undefined;
  EventEmitter.prototype._maxListeners = undefined;

  EventEmitter.prototype.eventNames = function () {
    var names = [];
    for (var k in this._events) { if (Object.prototype.hasOwnProperty.call(this._events, k)) names.push(k); }
    return names;
  };
  EventEmitter.prototype.setMaxListeners = function (n) { this._maxListeners = n; return this; };
  EventEmitter.prototype.getMaxListeners = function () { return this._maxListeners; };
  EventEmitter.prototype.listenerCount = function (type) {
    var evts = this._events[type];
    if (!evts) return 0;
    if (typeof evts === 'function') return 1;
    return evts.length;
  };
  EventEmitter.prototype.listeners = function (type) {
    var evts = this._events[type];
    if (!evts) return [];
    return typeof evts === 'function' ? [evts] : evts.slice();
  };
  EventEmitter.prototype.rawListeners = function (type) { return this.listeners(type); };

  EventEmitter.prototype.on = EventEmitter.prototype.addListener = function (type, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    var evts = this._events[type];
    if (!evts) {
      this._events[type] = listener;
    } else if (typeof evts === 'function') {
      this._events[type] = [evts, listener];
    } else {
      evts.push(listener);
    }
    if (typeof this._maxListeners === 'number' && this.listenerCount(type) > this._maxListeners && this._maxListeners !== 0) {
      // warning, not fatal
    }
    this.emit('newListener', type, listener);
    return this;
  };
  EventEmitter.prototype.prependListener = function (type, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    var evts = this._events[type];
    if (!evts) { this._events[type] = listener; }
    else if (typeof evts === 'function') { this._events[type] = [listener, evts]; }
    else { evts.unshift(listener); }
    return this;
  };
  EventEmitter.prototype.once = function (type, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    var self = this;
    function fired() {
      self.removeListener(type, fired);
      listener.apply(self, arguments);
    }
    fired.listener = listener;
    return this.on(type, fired);
  };
  EventEmitter.prototype.prependOnceListener = function (type, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    var self = this;
    function fired() {
      self.removeListener(type, fired);
      listener.apply(self, arguments);
    }
    fired.listener = listener;
    return this.prependListener(type, fired);
  };
  EventEmitter.prototype.removeListener = EventEmitter.prototype.off = function (type, listener) {
    var evts = this._events[type];
    if (!evts) return this;
    if (typeof evts === 'function') {
      if (evts === listener || evts.listener === listener) delete this._events[type];
    } else {
      for (var i = 0; i < evts.length; i++) {
        if (evts[i] === listener || evts[i].listener === listener) {
          evts.splice(i, 1);
          if (evts.length === 0) delete this._events[type];
          break;
        }
      }
    }
    this.emit('removeListener', type, listener);
    return this;
  };
  EventEmitter.prototype.removeAllListeners = function (type) {
    if (type === undefined) { this._events = Object.create(null); }
    else { delete this._events[type]; }
    return this;
  };
  EventEmitter.prototype.emit = function (type) {
    var evts = this._events[type];
    var had = !!evts;
    if (type !== 'newListener' && type !== 'removeListener') this.emit('newListener', type, undefined);
    if (!evts) {
      if (type === 'error') {
        var arg = arguments[1];
        throw arg instanceof Error ? arg : new Error('Unhandled "error" event: ' + __ocInspect(arg, { depth: 2 }));
      }
      return had;
    }
    var args = Array.prototype.slice.call(arguments, 1);
    if (typeof evts === 'function') {
      evts.apply(this, args);
    } else {
      var list = evts.slice();
      for (var i = 0; i < list.length; i++) list[i].apply(this, args);
    }
    return had;
  };
  EventEmitter.prototype.addOnceListener = EventEmitter.prototype.once;
  EventEmitter.listenerCount = function (emitter, type) { return emitter.listenerCount(type); };
  EventEmitter.EventEmitter = EventEmitter;

  /* ============================= util ============================= */
  var util = {};
  util.format = function (f) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (typeof f !== 'string') {
      return [__ocInspect(f, { depth: 4 })].concat(args.map(function (a) { return __ocInspect(a, { depth: 4 }); })).join(' ');
    }
    var out = '';
    var i = 0;
    var start = 0;
    while (i < f.length) {
      if (f.charAt(i) === '%' && i + 1 < f.length) {
        var c = f.charAt(i + 1);
        var spec = { s: 1, d: 1, i: 1, f: 1, j: 1, o: 1, O: 1, x: 1, X: 1, c: 1, '%': 1 }[c];
        if (spec) {
          out += f.slice(start, i);
          if (c === '%') { out += '%'; }
          else if (c === 's') { out += String(args.shift()); }
          else if (c === 'd' || c === 'i') { out += String(parseInt(args.shift(), 10)); }
          else if (c === 'f') { out += String(parseFloat(args.shift())); }
          else if (c === 'j') { try { out += JSON.stringify(args.shift()); } catch (e) { out += '[Circular]'; } }
          else if (c === 'o' || c === 'O') { out += __ocInspect(args.shift(), { depth: c === 'O' ? Infinity : 4 }); }
          else if (c === 'x') { out += '0x' + (parseInt(args.shift(), 10) >>> 0).toString(16); }
          else if (c === 'X') { out += '0x' + (parseInt(args.shift(), 10) >>> 0).toString(16).toUpperCase(); }
          else if (c === 'c') { args.shift(); }
          i += 2;
          start = i;
          continue;
        }
      }
      i++;
    }
    out += f.slice(start);
    if (args.length > 0) out += ' ' + args.map(function (a) { return typeof a === 'string' ? a : __ocInspect(a, { depth: 4 }); }).join(' ');
    return out;
  };

  util.inspect = function (obj, options) { return __ocInspect(obj, options || { depth: 2 }); };
  util.inspect.custom = Symbol('nodejs.util.inspect.custom');
  util.inspect.defaultOptions = { depth: 2 };

  util.types = {
    isDate: function (v) { return v instanceof Date; },
    isRegExp: function (v) { return v instanceof RegExp; },
    isPrimitive: function (v) { return v === null || (typeof v !== 'object' && typeof v !== 'function'); },
    isPromise: function (v) { return v && typeof v.then === 'function'; },
    isTypedArray: function (v) { return v instanceof Uint8Array; },
    isArgumentsObject: function (v) { return false; },
    isMap: function (v) { return v instanceof Map; },
    isSet: function (v) { return v instanceof Set; },
    isWeakMap: function (v) { return v instanceof WeakMap; },
    isWeakSet: function (v) { return v instanceof WeakSet; },
    isError: function (v) { return v instanceof Error; },
    isNativeError: function (v) { return v instanceof Error; },
    isBoolean: function (v) { return typeof v === 'boolean'; },
    isNumber: function (v) { return typeof v === 'number'; },
    isString: function (v) { return typeof v === 'string'; },
    isSymbol: function (v) { return typeof v === 'symbol'; },
    isBigInt: function (v) { return typeof v === 'bigint'; },
    isUndefined: function (v) { return v === undefined; },
    isNull: function (v) { return v === null; },
  };

  util.inherits = function (ctor, superCtor) {
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
      constructor: { value: ctor, enumerable: false, writable: true, configurable: true },
    });
  };

  var promisifyCustom = Symbol('util.promisify.custom');
  util.promisify = function (original) {
    if (original && original[promisifyCustom]) return original[promisifyCustom];
    return function promisified() {
      var args = Array.prototype.slice.call(arguments);
      var self = this;
      return new Promise(function (resolve, reject) {
        args.push(function (err, value) {
          if (err) reject(err);
          else resolve(arguments.length > 2 ? Array.prototype.slice.call(arguments, 1) : value);
        });
        original.apply(self, args);
      });
    };
  };
  util.promisify.custom = promisifyCustom;

  util.callbackify = function (fn) {
    return function callbackified() {
      var args = Array.prototype.slice.call(arguments);
      var cb = args.pop();
      var self = this;
      fn.apply(this, args).then(
        function (value) { cb(null, value); },
        function (err) { cb(err); }
      );
    };
  };

  util.deprecate = function (fn, msg) { return fn; };
  util.log = function (msg) { __host_stdout(msg + '\n'); };
  util.isArray = Array.isArray;
  util.isBoolean = function (v) { return typeof v === 'boolean'; };
  util.isBuffer = function (v) { return globalThis.Buffer && Buffer.isBuffer(v); };
  util.isFunction = function (v) { return typeof v === 'function'; };
  util.isNull = function (v) { return v === null; };
  util.isNullOrUndefined = function (v) { return v === null || v === undefined; };
  util.isNumber = function (v) { return typeof v === 'number'; };
  util.isObject = function (v) { return v !== null && typeof v === 'object'; };
  util.isString = function (v) { return typeof v === 'string'; };
  util.isSymbol = function (v) { return typeof v === 'symbol'; };
  util.isUndefined = function (v) { return v === undefined; };
  util.isDate = function (v) { return v instanceof Date; };
  util.isError = function (v) { return v instanceof Error; };
  util.isRegExp = function (v) { return v instanceof RegExp; };
  util.isPrimitive = function (v) { return v === null || (typeof v !== 'object' && typeof v !== 'function'); };
  util.isDeepStrictEqual = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };
  util.formatWithOptions = function (options) { return util.format.apply(null, Array.prototype.slice.call(arguments, 1)); };
  util.getSystemErrorName = function (code) { return 'Error'; };
  util.styleText = function (style, text) { return text; };

  /* ============================= path (posix) ============================= */
  var path = {};
  var sep = '/';
  var delimiter = ':';

  function assertPath(p) {
    if (typeof p !== 'string') throw new TypeError('Path must be a string. Received ' + __ocInspect(p, { depth: 1 }));
  }

  function normalizeStringPosix(p, allowAboveRoot) {
    var isAbsolute = p.charAt(0) === sep;
    var trailingSep = p.charAt(p.length - 1) === sep;
    var up = 0;
    var segments = p.split(sep);
    var out = [];
    for (var i = 0; i < segments.length; i++) {
      var seg = segments[i];
      if (seg === '' || seg === '.') { continue; }
      if (seg === '..') {
        if (out.length > 0 && out[out.length - 1] !== '..') { out.pop(); }
        else if (!allowAboveRoot) { up++; }
        continue;
      }
      out.push(seg);
    }
    if (!allowAboveRoot) {
      for (; up > 0; up--) { out.unshift('..'); }
    }
    var result = out.join(sep);
    if (isAbsolute && result.charAt(0) !== sep) result = sep + result;
    if (trailingSep && result.length > 1 && result.charAt(result.length - 1) !== sep) result += sep;
    return result === '' ? '.' : result;
  }

  path.resolve = function () {
    var resolvedPath = '';
    var resolvedAbsolute = false;
    for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
      var p;
      if (i >= 0) { p = arguments[i]; }
      else { p = globalThis.process ? process.cwd() : '/'; }
      assertPath(p);
      if (p === '') continue;
      resolvedPath = p + '/' + resolvedPath;
      resolvedAbsolute = p.charAt(0) === sep;
    }
    resolvedPath = normalizeStringPosix(resolvedPath, !resolvedAbsolute);
    if (resolvedAbsolute && resolvedPath.charAt(0) !== sep) return sep + resolvedPath;
    if (!resolvedAbsolute && resolvedPath.length > 0 && resolvedPath.charAt(0) !== sep) return resolvedPath;
    return resolvedAbsolute ? '/' + resolvedPath : resolvedPath;
  };
  path.normalize = function (p) { assertPath(p); return normalizeStringPosix(p, false); };
  path.isAbsolute = function (p) { assertPath(p); return p.length > 0 && p.charAt(0) === sep; };
  path.join = function () {
    var joined = null;
    for (var i = 0; i < arguments.length; i++) {
      var arg = arguments[i];
      assertPath(arg);
      if (arg !== '') {
        if (joined === null) joined = arg;
        else joined += sep + arg;
      }
    }
    if (joined === null) return '.';
    return path.normalize(joined);
  };
  path.relative = function (from, to) {
    assertPath(from); assertPath(to);
    from = path.resolve(from);
    to = path.resolve(to);
    if (from === to) return '';
    var fromParts = from.split(sep);
    var toParts = to.split(sep);
    var length = Math.min(fromParts.length, toParts.length);
    var sameParts = 0;
    for (var i = 0; i < length; i++) {
      if (fromParts[i] !== toParts[i]) break;
      sameParts++;
    }
    var out = [];
    for (var j = sameParts; j < fromParts.length; j++) { out.push('..'); }
    for (var k = sameParts; k < toParts.length; k++) { out.push(toParts[k]); }
    return out.join(sep);
  };
  path.dirname = function (p) {
    assertPath(p);
    if (p === '') return '.';
    var code = p.charCodeAt(0);
    var hasRoot = code === 47;
    var end = -1;
    var matchedSlash = true;
    for (var i = p.length - 1; i >= 1; i--) {
      if (p.charCodeAt(i) === 47) {
        if (!matchedSlash) { end = i; break; }
      } else { matchedSlash = false; }
    }
    if (end === -1) return hasRoot ? '/' : '.';
    if (hasRoot && end === 1) return '//';
    return p.slice(0, end);
  };
  path.basename = function (p, ext) {
    assertPath(p);
    if (p === '') return '';
    var start = 0;
    var end = -1;
    var matchedSlash = true;
    for (var i = p.length - 1; i >= 0; i--) {
      if (p.charCodeAt(i) === 47) {
        if (i === start) break;
        if (!matchedSlash) { start = i + 1; break; }
      } else if (end === -1) { matchedSlash = false; end = i + 1; }
    }
    var base = p.slice(start, end === -1 ? undefined : end);
    if (ext !== undefined && typeof ext === 'string' && base.endsWith(ext) && base.length > ext.length) {
      base = base.slice(0, base.length - ext.length);
    }
    return base;
  };
  path.extname = function (p) {
    assertPath(p);
    var startDot = -1;
    var startPart = 0;
    var end = -1;
    var matchedSlash = true;
    for (var i = p.length - 1; i >= 0; --i) {
      var code = p.charAt(i);
      if (code === sep) {
        if (!matchedSlash) { startPart = i + 1; break; }
        continue;
      }
      if (end === -1) { matchedSlash = false; end = i + 1; }
      if (code === '.') {
        if (startDot === -1) startDot = i;
        else if (startPart !== i) break;
      }
    }
    if (startDot === -1 || end === -1 || startDot === startPart - 1) { return ''; }
    return p.slice(startDot, end);
  };
  path.parse = function (p) {
    assertPath(p);
    var ret = { root: '', dir: '', base: '', ext: '', name: '' };
    if (p === '') return ret;
    var code = p.charCodeAt(0);
    var isAbsolute = code === 47;
    if (isAbsolute) { ret.root = '/'; start = 1; } else { var start = 0; }
    var start = 0;
    var startDot = -1;
    var startPart = 0;
    var end = -1;
    var matchedSlash = true;
    var i = p.length - 1;
    for (; i >= start; --i) {
      code = p.charAt(i);
      if (code === sep) {
        if (!matchedSlash) { startPart = i + 1; break; }
        continue;
      }
      if (end === -1) { matchedSlash = false; end = i + 1; }
      if (code === '.') {
        if (startDot === -1) startDot = i;
        else if (startPart !== i) break;
      }
    }
    if (startDot === -1) { ret.name = p.slice(startPart, end); ret.base = ret.name; }
    else {
      ret.base = p.slice(startPart, end);
      ret.name = p.slice(startPart, startDot);
      ret.ext = p.slice(startDot, end);
    }
    ret.dir = startPart === 0 ? (isAbsolute ? '/' : '.') : p.slice(0, startPart - 1);
    return ret;
  };
  path.format = function (obj) {
    if (obj === null || typeof obj !== 'object') throw new TypeError('The "pathObject" argument must be of type object');
    var dir = obj.dir || obj.root || '';
    var base = obj.base || ((obj.name || '') + (obj.ext || ''));
    if (dir && !dir.endsWith(sep)) return dir + sep + base;
    return dir + base;
  };
  path.sep = sep;
  path.delimiter = delimiter;
  path.posix = path;
  path.win32 = path;
  path.toNamespacedPath = function (p) { return p; };
  path._makeLong = function (p) { return p; };

  /* ============================= os ============================= */
  var os = {};
  os.EOL = '\n';
  os.platform = function () { return 'linux'; };
  os.arch = function () { return 'wasm32'; };
  os.type = function () { return 'Linux'; };
  os.release = function () { return '5.15.0-opencontainer'; };
  os.hostname = function () { return 'opencontainer'; };
  os.homedir = function () { return globalThis.process ? (process.env.HOME || '/home/nodeuser') : '/home/nodeuser'; };
  os.tmpdir = function () { return '/tmp'; };
  os.devNull = '/dev/null';
  os.cpus = function () {
    var n = 4;
    var out = [];
    for (var i = 0; i < n; i++) out.push({ model: 'OpenContainer vCPU', speed: 2400, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 } });
    return out;
  };
  os.totalmem = function () { return 4 * 1024 * 1024 * 1024; };
  os.freemem = function () { return 2 * 1024 * 1024 * 1024; };
  os.uptime = function () { return (__host_hrtime_ms() / 1000) | 0; };
  os.loadavg = function () { return [0, 0, 0]; };
  os.userInfo = function () { return { username: 'nodeuser', uid: 1000, gid: 1000, shell: '/bin/ocsh', homedir: os.homedir() }; };
  os.getPriority = function () { return 0; };
  os.setPriority = function () {};
  os.networkInterfaces = function () { return {}; };
  os.constants = { UV_UDP_REUSEADDR: 1, signals: {}, errno: {} };
  os.availableParallelism = function () { return 4; };
  os.getegid = function () { return 1000; };
  os.geteuid = function () { return 1000; };
  os.getgid = function () { return 1000; };
  os.getuid = function () { return 1000; };
  os.endianness = function () { return 'LE'; };

  /* ============================= assert ============================= */
  var assert = function assert(value, message) {
    if (!value) fail(message || 'The expression evaluated to a falsy value');
  };
  function fail(message) {
    throw new Error(message === undefined ? 'Assertion failed' : ('Assertion failed: ' + message));
  }
  assert.fail = fail;
  assert.ok = assert;
  assert.equal = function (actual, expected, message) { if (actual != expected) fail(message || (actual + ' == ' + expected)); };
  assert.notEqual = function (actual, expected, message) { if (actual == expected) fail(message || (actual + ' != ' + expected)); };
  assert.strictEqual = function (actual, expected, message) { if (actual !== expected) fail(message || (actual + ' === ' + expected)); };
  assert.notStrictEqual = function (actual, expected, message) { if (actual === expected) fail(message || (actual + ' !== ' + expected)); };
  assert.deepEqual = function (actual, expected, message) { if (!__ocDeepEqual(actual, expected, false)) fail(message || (__ocInspect(actual, { depth: 2 }) + ' deepEqual ' + __ocInspect(expected, { depth: 2 }))); };
  assert.notDeepEqual = function (actual, expected, message) { if (__ocDeepEqual(actual, expected, false)) fail(message || 'notDeepEqual'); };
  assert.deepStrictEqual = function (actual, expected, message) { if (!__ocDeepEqual(actual, expected, true)) fail(message || (__ocInspect(actual, { depth: 2 }) + ' deepStrictEqual ' + __ocInspect(expected, { depth: 2 }))); };
  assert.notDeepStrictEqual = function (actual, expected, message) { if (__ocDeepEqual(actual, expected, true)) fail(message || 'notDeepStrictEqual'); };
  assert.throws = function (fn, expected, message) {
    try { fn(); } catch (e) {
      if (expected === undefined) return;
      if (typeof expected === 'function' && e instanceof expected) return;
      if (typeof expected === 'RegExp' && expected.test(e.message)) return;
      if (typeof expected === 'string' && e.message.includes(expected)) return;
      if (expected && typeof expected === 'object' && typeof expected.message === 'string' && e.message.includes(expected.message)) return;
      if (typeof expected === 'function' && expected.name === 'ValidationError' && e.name === 'ValidationError') return;
      if (typeof expected === 'function' && typeof e === 'string' && expected === String) return;
      if (expected && typeof expected === 'object' && expected.name && e.name === expected.name) return;
      fail(message || 'The error is not matching the expected one');
    }
    fail(message || 'Missing expected exception');
  };
  assert.doesNotThrow = function (fn, message) {
    try { fn(); } catch (e) { fail(message || ('Got unwanted exception: ' + e.message)); }
  };
  assert.ifError = function (err) { if (err) throw err; };
  var assertStrict = {};
  ['equal', 'notEqual', 'deepEqual', 'notDeepEqual'].forEach(function (m) {
    assertStrict[m] = assert[m === 'equal' ? 'strictEqual' : m === 'notEqual' ? 'notStrictEqual' : m === 'deepEqual' ? 'deepStrictEqual' : 'notDeepStrictEqual'];
  });
  assertStrict.ok = assert.ok;
  assertStrict.throws = assert.throws;
  assertStrict.doesNotThrow = assert.doesNotThrow;
  assertStrict.ifError = assert.ifError;
  assertStrict.fail = assert.fail;
  assert.strict = assertStrict;

  /* ============================= querystring ============================= */
  var querystring = {};
  querystring.parse = function (qs, sepChar, eqChar) {
    sepChar = sepChar || '&';
    eqChar = eqChar || '=';
    var out = Object.create(null);
    if (!qs) return out;
    if (qs.charAt(0) === '?') qs = qs.slice(1);
    var parts = qs.split(sepChar);
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part) continue;
      var eq = part.indexOf(eqChar);
      var key, value;
      if (eq === -1) { key = querystring.unescape(part); value = ''; }
      else { key = querystring.unescape(part.slice(0, eq)); value = querystring.unescape(part.slice(eq + eqChar.length)); }
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        if (!Array.isArray(out[key])) out[key] = [out[key]];
        out[key].push(value);
      } else {
        out[key] = value;
      }
    }
    return out;
  };
  querystring.stringify = function (obj, sepChar, eqChar) {
    sepChar = sepChar || '&';
    eqChar = eqChar || '=';
    var out = [];
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      var value = obj[key];
      var k = querystring.escape(String(key));
      if (Array.isArray(value)) {
        for (var i = 0; i < value.length; i++) out.push(k + eqChar + querystring.escape(String(value[i])));
      } else {
        out.push(k + eqChar + querystring.escape(String(value ?? '')));
      }
    }
    return out.join(sepChar);
  };
  querystring.escape = function (s) { return encodeURIComponent(String(s)); };
  querystring.unescape = function (s) {
    try { return decodeURIComponent(String(s).replace(/\+/g, ' ')); } catch (e) { return String(s); }
  };

  /* ============================= punycode (minimal) ============================= */
  var punycode = {
    decode: function (input) { return input; },
    encode: function (input) { return input; },
    toUnicode: function (domain) { return domain; },
    toASCII: function (domain) { return domain; },
    ucs2: { decode: function (s) { var out = []; for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); return out; }, encode: function (cps) { var out = ''; for (var i = 0; i < cps.length; i++) out += String.fromCharCode(cps[i]); return out; } },
    version: '2.1.0',
  };

  /* ============================= inspect ============================= */
  globalThis.__ocInspect = function inspect(value, options) {
    options = options || {};
    var depth = options.depth === undefined ? 2 : options.depth;
    var seen = [];
    function format(v, d) {
      if (v === null) return 'null';
      if (v === undefined) return 'undefined';
      if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
      if (typeof v === 'bigint') return String(v) + 'n';
      if (typeof v === 'string') return d === 0 ? v : ('\'' + v.replace(/'/g, "\\'") + '\'');
      if (typeof v === 'symbol') return v.toString();
      if (typeof v === 'function') {
        var name = v.name ? ': ' + v.name : '';
        var isClass = /^\s*class\s/.test(Function.prototype.toString.call(v));
        return isClass ? ('[class' + name + ']') : ('[Function' + name + ']');
      }
      if (typeof v === 'object') {
        if (v instanceof Error) return (v.stack ? String(v.stack).split('\n').slice(0, 4).join('\n') : (v.name + ': ' + v.message));
        if (v instanceof Date) return v.toISOString();
        if (v instanceof RegExp) return String(v);
        if (globalThis.Buffer && Buffer.isBuffer(v)) return v.inspect ? v.inspect() : ('<Buffer ' + Array.from(v).join(' ') + '>');
        if (seen.indexOf(v) !== -1) return '[Circular]';
        if (d > depth) return Array.isArray(v) ? '[Array]' : '[Object]';
        seen.push(v);
        var out;
        try {
          if (Array.isArray(v)) {
            out = '[' + v.map(function (item) { return format(item, d + 1); }).join(', ') + ']';
            if (v.length > 100) out = '[Array(' + v.length + ')]';
          } else if (v instanceof Map) {
            out = 'Map(' + v.size + ') { ' + Array.from(v.entries()).map(function (e) { return format(e[0], d + 1) + ' => ' + format(e[1], d + 1); }).join(', ') + ' }';
          } else if (v instanceof Set) {
            out = 'Set(' + v.size + ') { ' + Array.from(v.values()).map(function (item) { return format(item, d + 1); }).join(', ') + ' }';
          } else if (v instanceof Promise) {
            out = 'Promise { }';
          } else {
            var prefix = '';
            if (v.constructor && v.constructor.name && v.constructor.name !== 'Object') prefix = v.constructor.name + ' ';
            var keys = Object.keys(v);
            out = prefix + '{ ' + keys.map(function (k) { return k + ': ' + format(v[k], d + 1); }).join(', ') + ' }';
            if (keys.length > 30) out = prefix + '{ … ' + keys.length + ' keys }';
          }
        } finally {
          seen.pop();
        }
        return out;
      }
      return String(v);
    }
    return format(value, 0);
  };

  globalThis.__ocDeepEqual = function deepEqual(a, b, strict) {
    if (strict ? a === b : (a == b)) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (a instanceof Date || b instanceof Date) {
      return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    }
    if (a instanceof RegExp || b instanceof RegExp) {
      return a instanceof RegExp && b instanceof RegExp && String(a) === String(b);
    }
    if (a instanceof Error || b instanceof Error) {
      return a instanceof Error && b instanceof Error && a.message === b.message && a.name === b.name;
    }
    var ka = Object.keys(a);
    var kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(b, ka[i])) return false;
      if (!deepEqual(a[ka[i]], b[ka[i]], strict)) return false;
    }
    return true;
  };

  globalThis.__ocStack = function () { return ''; };

  globalThis.__ocModules = globalThis.__ocModules || {};
  globalThis.__ocModules.events = EventEmitter;
  globalThis.__ocModules.EventEmitter = EventEmitter;
  globalThis.__ocModules.util = util;
  globalThis.__ocModules.path = path;
  globalThis.__ocModules.os = os;
  globalThis.__ocModules.assert = assert;
  globalThis.__ocModules.querystring = querystring;
  globalThis.__ocModules.punycode = punycode;
})();
`;
