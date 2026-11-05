/**
 * OpenContainer — Node compat prelude: process, module system, bootstrap.
 *
 * This is the final prelude part. It defines the `process` object, the
 * CommonJS require() implementation with ESM interop, the builtin module
 * registry, and __ocBootstrap which the engine invokes to run the entry.
 */
export const PRELUDE_MAIN = String.raw`
/* ============================= process / modules / bootstrap ============================= */
(function () {
  'use strict';

  var EventEmitter = globalThis.__ocModules.events;
  var Readable = globalThis.__ocModules.Readable;
  var Writable = globalThis.__ocModules.Writable;
  var util = globalThis.__ocModules.util;

  globalThis.__ocExitCode = null;

  /* ------------------------------ stdout/stderr ------------------------------ */
  function StdioWriteStream(fd) {
    Writable.call(this, {});
    this.fd = fd;
    this._isTTY = true;
    this.columns = 80;
    this.rows = 24;
    this._destroyed = false;
  }
  globalThis.__ocInherits(StdioWriteStream, Writable);
  StdioWriteStream.prototype._write = function (chunk, encoding, cb) {
    var text;
    if (typeof chunk === 'string') text = chunk;
    else text = globalThis.__ocDecodeString(chunk, encoding || 'utf8');
    if (this.fd === 1) __host_stdout(text);
    else __host_stderr(text);
    cb();
    return true;
  };
  Object.defineProperty(StdioWriteStream.prototype, 'isTTY', { get: function () { return this._isTTY; } });
  Object.defineProperty(StdioWriteStream.prototype, 'destroyed', { get: function () { return this._destroyed; } });
  StdioWriteStream.prototype.getColorDepth = function () { return 4; };
  StdioWriteStream.prototype.hasColors = function () { return false; };
  StdioWriteStream.prototype.cursorTo = function () {};
  StdioWriteStream.prototype.moveCursor = function () {};
  StdioWriteStream.prototype.clearLine = function () {};
  StdioWriteStream.prototype.clearScreenDown = function () {};

  var stdout = new StdioWriteStream(1);
  var stderr = new StdioWriteStream(2);

  /* ------------------------------ stdin ------------------------------ */
  var stdin = new Readable({});
  stdin.fd = 0;
  stdin.isTTY = true;
  var stdinHooked = false;
  function hookStdin() {
    if (stdinHooked) return;
    stdinHooked = true;
    __host_process_on('stdin-data', function (dataStr) {
      var buf = Buffer.from(dataStr, 'utf8');
      stdin.push(buf);
    });
    __host_stdin_resume();
  }
  var origStdinOn = stdin.on.bind(stdin);
  stdin.on = function (ev, cb) {
    if (ev === 'data') hookStdin();
    return origStdinOn(ev, cb);
  };
  var origStdinOnce = stdin.once.bind(stdin);
  stdin.once = function (ev, cb) {
    if (ev === 'data') hookStdin();
    return origStdinOnce(ev, cb);
  };
  var origStdinResume = stdin.resume.bind(stdin);
  stdin.resume = function () {
    hookStdin();
    return origStdinResume();
  };
  stdin.setEncoding = function (enc) { stdin._readableState.encoding = enc; return stdin; };
  stdin.setRawMode = function () { return stdin; };
  stdin.ref = function () { return stdin; };
  stdin.unref = function () { return stdin; };

  /* ------------------------------ process ------------------------------ */
  var process = new EventEmitter();
  process.title = 'node';
  process.browser = true;
  process.argv = ['node'];
  process.env = {};
  process.execArgv = [];
  process.exitCode = undefined;
  process.stdin = stdin;
  process.stdout = stdout;
  process.stderr = stderr;

  process.cwd = function () { return __host_cwd(); };
  process.chdir = function (dir) { __ocHostCall(function () { return __host_chdir(dir); }); };
  process.umask = function () { return 0o022; };
  process.exit = function (code) {
    if (code !== undefined) globalThis.__ocExitCode = typeof code === 'number' ? code : 0;
    else if (process.exitCode !== undefined) globalThis.__ocExitCode = process.exitCode;
    else globalThis.__ocExitCode = 0;
    __host_exit(globalThis.__ocExitCode);
  };
  process.abort = function () { __host_exit(134); };
  process.kill = function (pid, signal) {
    if (pid === process.pid) { __host_exit(137); return true; }
    try { __host_child_kill(Number(pid)); return true; } catch (e) { return false; }
  };
  process.pid = 0;
  process.ppid = 0;
  process.getuid = function () { return 1000; };
  process.getgid = function () { return 1000; };
  process.geteuid = function () { return 1000; };
  process.getegid = function () { return 1000; };
  process.setuid = function () {};
  process.setgid = function () {};
  process.nextTick = function (cb) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (args.length > 0) {
      __host_next_tick(function () { cb.apply(null, args); });
    } else {
      __host_next_tick(cb);
    }
  };
  process.hrtime = function (time) {
    var ms = __host_hrtime_ms();
    if (time) {
      var diff = ms - time[1];
      return [(diff / 1000) | 0, Math.floor(diff % 1000 * 1000)];
    }
    return [(ms / 1000) | 0, Math.floor((ms % 1000) * 1000000)];
  };
  process.hrtime.bigint = function () { return BigInt(Math.floor(__host_hrtime_ms() * 1000000)); };
  process.uptime = function () { return __host_hrtime_ms() / 1000; };
  process.memoryUsage = function () {
    try {
      var info = JSON.parse(__host_memory_usage());
      return { rss: info.memory_used || 0, heapTotal: info.memory_allocated || 0, heapUsed: info.memory_used || 0, external: 0, arrayBuffers: 0 };
    } catch (e) {
      return { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };
    }
  };
  process.report = { getReport: function () { return {}; }, writeReport: function () {} };
  process.allowedNodeEnvironmentFlags = new Set();
  process.release = { name: 'opencontainer-node', sourceUrl: '', headersUrl: '' };
  process.config = { variables: {} };
  process.features = { inspector: false, debug: false, uv: false, ipv6: false, tls: false, typed_arrays: true };
  process._eventsCount = 0;
  process.binding = function (name) { throw new Error('process.binding is not supported by OpenContainer'); };
  process.dlopen = function () { throw new Error('Native addons (process.dlopen) are not supported inside the browser sandbox'); };
  process.assert = function (cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); };
  Object.defineProperty(process, 'version', { value: '', writable: true });
  Object.defineProperty(process, 'versions', { value: {}, writable: true });
  Object.defineProperty(process, 'platform', { value: 'linux', writable: true });
  Object.defineProperty(process, 'arch', { value: 'wasm32', writable: true });
  Object.defineProperty(process, 'execPath', { value: '/usr/local/bin/node', writable: true });
  Object.defineProperty(process, 'argv0', { value: 'node', writable: true });
  Object.defineProperty(process, 'env', { value: {}, writable: true });
  globalThis.process = process;

  /* ------------------------------ ESM interop helpers ------------------------------ */
  globalThis.__ocInterop = function (mod) {
    if (mod && mod.__esModule) return mod;
    var out = {};
    Object.defineProperty(out, '__esModule', { value: true });
    if (mod !== null && mod !== undefined && (typeof mod === 'object' || typeof mod === 'function')) {
      out.default = mod;
      var keys = Object.keys(mod);
      for (var i = 0; i < keys.length; i++) {
        (function (key) {
          if (key === 'default') return;
          Object.defineProperty(out, key, {
            get: function () { return mod[key]; },
            enumerable: true,
          });
        })(keys[i]);
      }
    } else {
      out.default = mod;
    }
    return out;
  };
  globalThis.__ocDefine = function (obj, name, getter) {
    Object.defineProperty(obj, name, { get: getter, enumerable: true, configurable: true });
  };
  globalThis.__ocExportStar = function (target, source) {
    if (!source) return;
    var keys = Object.keys(source);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key === 'default') continue;
      (function (k) {
        Object.defineProperty(target, k, {
          get: function () { return source[k]; },
          enumerable: true,
          configurable: true,
        });
      })(key);
    }
  };

  /* ------------------------------ module system ------------------------------ */
  var Module = {
    _cache: {},
    _extensions: {},
    _resolveFilename: null,
    _pathCache: {},
    globalPaths: [],
    wrapper: ['(function (exports, require, module, __filename, __dirname) { ', '\n});'],
  };

  function dirnameOf(p) {
    var path = globalThis.__ocModules.path;
    return path.dirname(p);
  }

  var BUILTIN_FACTORIES = {
    'assert': function () { return globalThis.__ocModules.assert; },
    'buffer': function () { return globalThis.__ocModules.buffer; },
    'child_process': function () { return globalThis.__ocModules.child_process; },
    'console': function () { return console; },
    'constants': function () { return { fs: globalThis.__ocModules.fs.constants }; },
    'crypto': function () { return builtinCrypto(); },
    'dgram': function () { return unsupportedModule('dgram'); },
    'dns': function () { return builtinDns(); },
    'domain': function () { return unsupportedModule('domain'); },
    'events': function () { return globalThis.__ocModules.events; },
    'fs': function () { return globalThis.__ocModules.fs; },
    'http': function () { return globalThis.__ocModules.http; },
    'http2': function () { return unsupportedModule('http2'); },
    'https': function () { return globalThis.__ocModules.https; },
    'inspector': function () { return unsupportedModule('inspector'); },
    'module': function () { return Module; },
    'net': function () { return globalThis.__ocModules.net; },
    'os': function () { return globalThis.__ocModules.os; },
    'path': function () { return globalThis.__ocModules.path; },
    'perf_hooks': function () { return { performance: globalThis.performance, PerformanceObserver: function () { this.observe = function () {}; } }; },
    'process': function () { return process; },
    'punycode': function () { return globalThis.__ocModules.punycode; },
    'querystring': function () { return globalThis.__ocModules.querystring; },
    'readline': function () { return globalThis.__ocModules.readline; },
    'repl': function () { return unsupportedModule('repl'); },
    'stream': function () { return globalThis.__ocModules.stream; },
    'stream/web': function () { return unsupportedModule('stream/web'); },
    'string_decoder': function () { return builtinStringDecoder(); },
    'sys': function () { return globalThis.__ocModules.util; },
    'timers': function () { return builtinTimers(); },
    'timers/promises': function () { return builtinTimersPromises(); },
    'tls': function () { return unsupportedModule('tls'); },
    'tty': function () { return builtinTty(); },
    'url': function () { return builtinUrl(); },
    'util': function () { return globalThis.__ocModules.util; },
    'v8': function () { return builtinV8(); },
    'vm': function () { return builtinVm(); },
    'wasi': function () { return unsupportedModule('wasi'); },
    'worker_threads': function () { return builtinWorkerThreads(); },
    'zlib': function () { return unsupportedModule('zlib'); },
  };
  var builtinCache = {};

  function builtinCryptoRandomUUID() {
    var b = new Uint8Array(__host_random_bytes(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var hex = Array.from(b).map(function (x) { return (x < 16 ? '0' : '') + x.toString(16); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function builtinCrypto() {
    return {
      randomBytes: function (size, cb) {
        var buf = new Uint8Array(__host_random_bytes(size));
        buf.__proto__ = Buffer.prototype;
        if (cb) { process.nextTick(function () { cb(null, buf); }); return; }
        return buf;
      },
      randomUUID: function () { return builtinCryptoRandomUUID(); },
      getRandomValues: function (view) {
        var b = new Uint8Array(__host_random_bytes(view.length));
        view.set(b);
        return view;
      },
      webcrypto: {
        randomUUID: function () { return builtinCryptoRandomUUID(); },
        getRandomValues: function (view) {
          var b = new Uint8Array(__host_random_bytes(view.length));
          view.set(b);
          return view;
        },
      },
      createHash: function () { throw new Error('crypto.createHash is not supported by OpenContainer (no native hashing yet; see COMPATIBILITY.md)'); },
      createHmac: function () { throw new Error('crypto.createHmac is not supported by OpenContainer'); },
      createCipheriv: function () { throw new Error('crypto.createCipheriv is not supported by OpenContainer'); },
      createDecipheriv: function () { throw new Error('crypto.createDecipheriv is not supported by OpenContainer'); },
      pbkdf2: function () { throw new Error('crypto.pbkdf2 is not supported by OpenContainer'); },
      scrypt: function () { throw new Error('crypto.scrypt is not supported by OpenContainer'); },
    };
  }
  function builtinDns() {
    function lookup(hostname, options, cb) {
      if (typeof options === 'function') { cb = options; options = null; }
      var family = options && options.family;
      if (hostname === 'localhost') {
        var result = { address: '127.0.0.1', family: 4 };
        if (cb) process.nextTick(function () { cb(null, family === 6 ? '::1' : '127.0.0.1'); });
        return;
      }
      if (cb) process.nextTick(function () {
        var e = new Error('getaddrinfo ENOTFOUND ' + hostname);
        e.code = 'ENOTFOUND';
        e.errno = -3008;
        cb(e);
      });
    }
    return { lookup: lookup, resolve: lookup, Resolver: function () { this.lookup = lookup; }, promises: { lookup: function (h) { return new Promise(function (res, rej) { lookup(h, function (e, a) { e ? rej(e) : res({ address: a }); }); }); } } };
  }
  function builtinStringDecoder() {
    function StringDecoder(encoding) { this.encoding = encoding || 'utf8'; }
    StringDecoder.prototype.write = function (buf) { return globalThis.__ocDecodeString(buf, this.encoding); };
    StringDecoder.prototype.end = function (buf) { return buf ? globalThis.__ocDecodeString(buf, this.encoding) : ''; };
    return { StringDecoder: StringDecoder };
  }
  function builtinTimers() {
    return {
      setTimeout: setTimeout, clearTimeout: clearTimeout,
      setInterval: setInterval, clearInterval: clearInterval,
      setImmediate: function (cb) { return setTimeout(cb, 0); },
      clearImmediate: function (id) { return clearTimeout(id); },
      active: function () {}, unref: function () {}, refresh: function () {},
    };
  }
  function builtinTimersPromises() {
    return {
      setTimeout: function (ms, value) { return new Promise(function (resolve) { setTimeout(function () { resolve(value); }, ms); }); },
      setInterval: function () { throw new Error('timers/promises.setInterval not supported'); },
    };
  }
  function builtinTty() {
    return {
      isatty: function (fd) { return true; },
      WriteStream: StdioWriteStream,
      ReadStream: Readable,
    };
  }
  function builtinUrl() {
    var legacy = {
      parse: function (urlStr, parseQueryString, slashesDenoteHost) {
        var u = new URL(urlStr, 'http://localhost');
        var out = {
          href: urlStr, protocol: u.protocol, slashes: true,
          host: u.host, hostname: u.hostname, port: u.port,
          pathname: u.pathname, path: u.pathname + u.search, search: u.search,
          query: parseQueryString ? globalThis.__ocModules.querystring.parse(u.search.slice(1)) : u.search.slice(1),
          hash: u.hash, auth: u.username ? (u.username + ':' + u.password) : null,
        };
        return out;
      },
      format: function (obj) {
        if (typeof obj === 'string') return obj;
        return (obj.protocol || 'http:') + '//' + (obj.auth ? obj.auth + '@' : '') + (obj.host || ((obj.hostname || 'localhost') + (obj.port ? ':' + obj.port : ''))) + (obj.path || obj.pathname || '/') + (obj.search || '');
      },
      resolve: function (from, to) { return new URL(to, new URL(from, 'http://localhost')).href; },
      Url: function () {},
    };
    var mod = { URL: URL, URLSearchParams: URLSearchParams };
    Object.assign(mod, legacy);
    return mod;
  }
  function builtinV8() {
    return {
      getHeapStatistics: function () { try { return JSON.parse(__host_memory_usage()); } catch (e) { return {}; } },
      getHeapSpaceStatistics: function () { return []; },
      setFlagsFromString: function () {},
      serialize: function () { throw new Error('v8.serialize not supported'); },
    };
  }
  function builtinVm() {
    return {
      Script: function (code) { this.runInThisContext = function () { return eval(String(code)); }; },
      runInThisContext: function (code) { return eval(String(code)); },
      runInNewContext: function (code) { return eval(String(code)); },
      createContext: function (obj) { return obj || {}; },
      isContext: function () { return false; },
      compileFunction: function (code) { return new Function(code); },
    };
  }
  function builtinWorkerThreads() {
    function Worker() { throw new Error('worker_threads are not supported by OpenContainer (single QuickJS runtime per process)'); }
    return {
      isMainThread: true, parentPort: null, workerData: null, threadId: 0,
      MessageChannel: function () { throw new Error('worker_threads not supported'); },
      Worker: Worker,
      markAsUntransferable: function () {},
      moveMessagePortToContext: function () {},
      receiveMessageOnPort: function () { return undefined; },
    };
  }
  function unsupportedModule(name) {
    function thrower() { throw new Error("The '" + name + "' module is not supported by OpenContainer (see COMPATIBILITY.md)"); }
    return new Proxy({}, {
      get: function (target, prop) {
        if (prop === 'then') return undefined;
        return thrower;
      },
    });
  }

  function nodeModulesPaths(from) {
    var paths = [];
    var path = globalThis.__ocModules.path;
    var parts = path.resolve(from).split('/');
    for (var i = parts.length; i >= 1; i--) {
      if (parts[i - 1] === 'node_modules') continue;
      var dir = parts.slice(0, i).join('/') || '/';
      paths.push(dir + '/node_modules');
    }
    return paths;
  }

  function loadModule(spec, parentDir) {
    var bare = spec.startsWith('node:') ? spec.slice(5) : spec;
    if (BUILTIN_FACTORIES[bare]) {
      if (!builtinCache[bare]) builtinCache[bare] = BUILTIN_FACTORIES[bare]();
      return { builtin: true, exports: builtinCache[bare] };
    }
    var res = JSON.parse(__host_load_module(spec, parentDir));
    if (!res.ok) {
      var err = new Error(res.error);
      err.code = res.code || 'MODULE_NOT_FOUND';
      throw err;
    }
    return { builtin: false, filename: res.filename, code: res.code, type: res.type };
  }

  function makeRequire(parentFilename) {
    var parentDir = parentFilename ? dirnameOf(parentFilename) : process.cwd();
    function require(spec) {
      var loaded = loadModule(spec, parentDir);
      if (loaded.builtin) return loaded.exports;
      var filename = loaded.filename;
      var cached = Module._cache[filename];
      if (cached) return cached.exports;
      if (loaded.type === 'json') {
        var module = { id: filename, exports: JSON.parse(loaded.code), filename: filename, loaded: true, paths: nodeModulesPaths(dirnameOf(filename)) };
        Module._cache[filename] = module;
        return module.exports;
      }
      var module = {
        id: filename,
        exports: {},
        filename: filename,
        loaded: false,
        children: [],
        paths: nodeModulesPaths(dirnameOf(filename)),
        require: null,
      };
      Module._cache[filename] = module;
      var localRequire = makeRequire(filename);
      module.require = localRequire;
      localRequire.main = require.main;
      localRequire.cache = Module._cache;
      localRequire.resolve = function (spec) {
        var l = loadModule(spec, dirnameOf(filename));
        if (l.builtin) return 'builtin:' + spec;
        return l.filename;
      };
      localRequire.resolve.paths = nodeModulesPaths;
      var fn = new Function('exports', 'require', 'module', '__filename', '__dirname', '__ocImportMetaUrl',
        'var __exports = module.exports;\n' + loaded.code + '\n');
      try {
        fn.call(module.exports, module.exports, localRequire, module, filename, dirnameOf(filename), 'file://' + filename);
      } catch (e) {
        delete Module._cache[filename];
        if (e && typeof e.message === 'string' && e.message.indexOf('__OCERR__') !== -1) {
          throw globalThis.__ocDecodeHostError(e);
        }
        throw e;
      }
      module.loaded = true;
      return module.exports;
    }
    require.cache = Module._cache;
    require.resolve = function (spec) {
      var l = loadModule(spec, parentDir);
      return l.builtin ? 'builtin:' + spec : l.filename;
    };
    require.resolve.paths = nodeModulesPaths;
    require.main = null;
    return require;
  }

  globalThis.require = null; // set per-module; NOT a real global in Node semantics
  globalThis.__ocMakeRequire = makeRequire;
  globalThis.__ocModule = Module;

  /* ------------------------------ uncaught handling ------------------------------ */
  globalThis.__ocUncaught = function (jsonStr) {
    var parsed;
    try { parsed = JSON.parse(jsonStr); } catch (e) { parsed = { message: String(jsonStr) }; }
    var err = new Error(parsed.message);
    if (parsed.stack) err.stack = parsed.stack;
    if (parsed.name) err.name = parsed.name;
    var has = false;
    if (process && typeof process.listenerCount === 'function') {
      has = process.listenerCount('uncaughtException') > 0 || process.listenerCount('uncaughtExceptionMonitor') > 0;
    }
    if (has) {
      process.emit('uncaughtException', err);
      return;
    }
    __host_stderr((parsed.stack || parsed.message || String(err)) + '\n');
    globalThis.__ocExitCode = 1;
    __host_exit(1);
  };

  globalThis.__ocResize = function (cols, rows) {
    stdout.columns = cols;
    stdout.rows = rows;
    stderr.columns = cols;
    stderr.rows = rows;
  };

  /* ------------------------------ bootstrap ------------------------------ */
  globalThis.__ocBootstrap = function (bootJson) {
    var boot = JSON.parse(bootJson);
    var identity = boot.identity || {};
    process.argv = boot.argv || ['node'];
    process.pid = boot.pid || 1;
    process.ppid = 0;
    process.env = boot.env || {};
    process.argv0 = process.argv[0] || 'node';
    // honest engine identity (see version.ts / COMPATIBILITY.md)
    process.version = 'v' + (identity.version || '0.0.0');
    process.versions = {
      node: identity.version || '0.0.0',
      opencontainer: identity.version || '0.0.0',
      quickjs: '2024-01-13',
      quickjs_emscripten: '0.32.0',
      v8: undefined,
      uv: undefined,
      zlib: undefined,
      ares: undefined,
      modules: '131',
      http_parser: undefined,
    };
    process.platform = identity.platform || 'linux';
    process.arch = identity.arch || 'wasm32';
    process.report.onWarning = function () {};
    if (typeof __host_set_title === 'function') { /* title setter unused here */ }

    var entry = boot.entry || { kind: 'version' };
    var cwd = boot.cwd || '/';

    // process.exit redirects through the host
    process.exit = function (code) {
      if (code !== undefined) globalThis.__ocExitCode = typeof code === 'number' ? code : 0;
      else if (process.exitCode !== undefined) globalThis.__ocExitCode = process.exitCode;
      else globalThis.__ocExitCode = 0;
      __host_exit(globalThis.__ocExitCode);
    };
    // forward 'exit' listeners to the host-managed callback registry
    __host_process_on('exit', function (code) {
      process.emit('exit', code);
    });

    try {
      if (entry.kind === 'version') {
        __host_stdout(process.version + '\n');
        globalThis.__ocExitCode = 0;
        return;
      }
      if (entry.kind === 'check') {
        try {
          new Function(entry.code);
        } catch (e) {
          __host_stderr(String((e && e.message) || e) + '\n');
          globalThis.__ocExitCode = 1;
          return;
        }
        globalThis.__ocExitCode = 0;
        return;
      }
      if (entry.kind === 'eval') {
        var reqEval = makeRequire(null);
        var fnEval = new Function('exports', 'require', 'module', '__filename', '__dirname',
          'var __exports = module.exports;\n' + entry.code + '\n');
        var moduleEval = { id: '[eval]', exports: {}, filename: '[eval]', loaded: true, paths: nodeModulesPaths(cwd) };
        reqEval.main = moduleEval;
        fnEval.call(moduleEval.exports, moduleEval.exports, reqEval, moduleEval, '[eval]', cwd);
        globalThis.__ocExitCode = 0;
        return;
      }
      if (entry.kind === 'print') {
        var reqPrint = makeRequire(null);
        var fnPrint = new Function('require', 'module',
          'var exports = module.exports; return eval(' + JSON.stringify(entry.code) + ');');
        var result = fnPrint(reqPrint, { exports: {} });
        var out = result === undefined ? 'undefined' : util.inspect(result, { depth: 2 });
        __host_stdout(out + '\n');
        globalThis.__ocExitCode = 0;
        return;
      }
      if (entry.kind === 'script') {
        var loaded2 = loadModule(entry.filename, cwd);
        if (loaded2.builtin) {
          __host_stderr('Error: Cannot load builtin module as main\n');
          globalThis.__ocExitCode = 1;
          return;
        }
        var reqMain = makeRequire(loaded2.filename);
        if (loaded2.type === 'json') {
          globalThis.__ocExitCode = 0;
          return;
        }
        var moduleMain = {
          id: loaded2.filename,
          exports: {},
          filename: loaded2.filename,
          loaded: false,
          children: [],
          paths: nodeModulesPaths(dirnameOf(loaded2.filename)),
        };
        Module._cache[loaded2.filename] = moduleMain;
        reqMain.main = moduleMain;
        globalThis.__ocMainModule = moduleMain;
        process.mainModule = moduleMain;
        var fnMain = new Function('exports', 'require', 'module', '__filename', '__dirname', '__ocImportMetaUrl',
          'var __exports = module.exports;\n' + loaded2.code + '\n');
        fnMain.call(moduleMain.exports, moduleMain.exports, reqMain, moduleMain, loaded2.filename, dirnameOf(loaded2.filename), 'file://' + loaded2.filename);
        moduleMain.loaded = true;
        globalThis.__ocExitCode = 0;
        return;
      }
      globalThis.__ocExitCode = 0;
    } catch (e) {
      if (e && typeof e.message === 'string' && e.message.indexOf('__OCERR__') !== -1) {
        e = globalThis.__ocDecodeHostError(e);
      }
      var msg = (e && e.stack) || (e && e.message) || String(e);
      __host_stderr(msg + '\n');
      globalThis.__ocExitCode = 1;
    }
  };
})();
`;
