/**
 * OpenContainer — Node compat prelude: fs.
 * Bridges Node's fs API onto the host virtual filesystem via
 * __host_fs (sync) and __host_fs_async (promise) dispatchers.
 */
export const PRELUDE_FS = String.raw`
/* ============================= fs ============================= */
(function () {
  'use strict';

  function hostFsSync(op, a, b, c) {
    return __ocHostCall(function () { return __host_fs(op, a, b, c); });
  }

  function hostFsAsync(op, a, b, c) {
    return __host_fs_async(op, a, b, c).catch(function (e) {
      throw __ocDecodeHostError(e);
    });
  }

  function Stats(data) {
    this.dev = 0;
    this.ino = 0;
    this.mode = data.mode;
    this.nlink = 1;
    this.uid = 1000;
    this.gid = 1000;
    this.rdev = 0;
    this.size = data.size;
    this.blksize = 4096;
    this.blocks = Math.ceil(data.size / 512);
    this.atimeMs = data.mtimeMs;
    this.mtimeMs = data.mtimeMs;
    this.ctimeMs = data.mtimeMs;
    this.birthtimeMs = data.mtimeMs;
    this.atime = new Date(data.mtimeMs);
    this.mtime = new Date(data.mtimeMs);
    this.ctime = new Date(data.mtimeMs);
    this.birthtime = new Date(data.mtimeMs);
    var isFile = data.isFile, isDir = data.isDirectory, isSymlink = data.isSymbolicLink;
    this.isFile = function () { return isFile; };
    this.isDirectory = function () { return isDir; };
    this.isSymbolicLink = function () { return isSymlink; };
    this.isBlockDevice = function () { return false; };
    this.isCharacterDevice = function () { return false; };
    this.isFIFO = function () { return false; };
    this.isSocket = function () { return false; };
  }

  function decodeStats(json) { return new Stats(JSON.parse(json)); }

  function makeBytes(result) {
    if (result instanceof ArrayBuffer) return new Uint8Array(result);
    if (result instanceof Uint8Array) return result;
    return new Uint8Array(0);
  }

  function toBufferLike(data) {
    if (data instanceof ArrayBuffer) {
      var buf = new Uint8Array(data);
      buf.__proto__ = Buffer.prototype;
      return buf;
    }
    return data;
  }

  var fs = {};

  fs.constants = {
    F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1,
    O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_EXCL: 128, O_TRUNC: 512, O_APPEND: 1024,
    COPYFILE_EXCL: 1, COPYFILE_FICLONE: 2, COPYFILE_FICLONE_FORCE: 4,
  };

  /* ------------------------------ sync ------------------------------ */

  fs.existsSync = function (path) {
    try { return hostFsSync('exists', path) === 1; } catch (e) { return false; }
  };
  fs.statSync = function (path, options) { return decodeStats(hostFsSync('stat', path)); };
  fs.lstatSync = function (path, options) { return decodeStats(hostFsSync('lstat', path)); };
  fs.readdirSync = function (path, options) {
    var list = JSON.parse(hostFsSync('readdir', path));
    if (options && (options.withFileTypes || options === true)) {
      return list.map(function (name) {
        var isDir = false, isFile = false, isSymlink = false;
        try { var s = fs.statSync(path + '/' + name); isDir = s.isDirectory(); isFile = s.isFile(); } catch (e) {}
        try { var l = fs.lstatSync(path + '/' + name); isSymlink = l.isSymbolicLink(); } catch (e) {}
        return { name: name, isDirectory: function () { return isDir; }, isFile: function () { return isFile; }, isSymbolicLink: function () { return isSymlink; } };
      });
    }
    return list;
  };
  fs.readFileSync = function (path, options) {
    var encoding = null;
    if (typeof options === 'string') encoding = options;
    else if (options && options.encoding) encoding = options.encoding;
    var result = hostFsSync('readFile', path);
    var buf = toBufferLike(result);
    if (encoding) return globalThis.__ocDecodeString(buf, encoding);
    return buf;
  };
  fs.writeFileSync = function (path, data, options) {
    var encoding = null;
    if (typeof options === 'string') encoding = options;
    else if (options && options.encoding) encoding = options.encoding;
    if (typeof data === 'string') {
      hostFsSync('writeFile', path, data, encoding || 'utf8');
    } else if (data instanceof Uint8Array) {
      // convert to ArrayBuffer handle for the host
      var copy = new Uint8Array(data.length);
      copy.set(data);
      hostFsSync('writeFile', path, copy.buffer);
    } else if (data && data.type === 'Buffer' && Array.isArray(data.data)) {
      hostFsSync('writeFile', path, Buffer.from(data.data).buffer);
    } else {
      hostFsSync('writeFile', path, String(data));
    }
    return undefined;
  };
  fs.appendFileSync = function (path, data, options) {
    var encoding = null;
    if (typeof options === 'string') encoding = options;
    else if (options && options.encoding) encoding = options.encoding;
    if (typeof data === 'string') hostFsSync('appendFile', path, data, encoding || 'utf8');
    else hostFsSync('appendFile', path, new Uint8Array(data).buffer);
  };
  fs.mkdirSync = function (path, options) {
    hostFsSync('mkdir', path, options && options.recursive ? 1 : 0);
    return undefined;
  };
  fs.rmdirSync = function (path) { hostFsSync('rmdir', path); };
  fs.rmSync = function (path, options) { hostFsSync('rm', path, options && options.force ? 1 : 0, options && options.recursive ? 1 : 0); };
  fs.unlinkSync = function (path) { hostFsSync('unlink', path); };
  fs.renameSync = function (a, b) { hostFsSync('rename', a, b); };
  fs.rename = function (a, b, cb) { hostFsAsync('rename', a, b).then(function () { cb(null); }, function (e) { cb(e); }); };
  fs.copyFileSync = function (a, b) { hostFsSync('copyFile', a, b); };
  fs.chmodSync = function (path, mode) { hostFsSync('chmod', path, mode); };
  fs.symlinkSync = function (target, path) { hostFsSync('symlink', target, path); };
  fs.readlinkSync = function (path) { return hostFsSync('readlink', path); };
  fs.realpathSync = function (path) { return hostFsSync('realpath', path); };
  fs.truncateSync = function (path, len) { hostFsSync('truncate', path, len || 0); };
  fs.accessSync = function (path, mode) {
    if (!fs.existsSync(path)) {
      var e = new Error("EACCES: permission denied, access '" + path + "'");
      e.code = 'EACCES'; throw e;
    }
  };
  fs.mkdir = function (path, options, cb) {
    if (typeof options === 'function') { cb = options; options = null; }
    hostFsAsync('mkdir', path, options && options.recursive ? 1 : 0).then(function () { cb(null); }, function (e) { cb(e); });
  };
  fs.stat = function (path, cb) { hostFsAsync('stat', path).then(function (s) { cb(null, new Stats(s)); }, function (e) { cb(e); }); };
  fs.lstat = function (path, cb) { hostFsAsync('lstat', path).then(function (s) { cb(null, new Stats(s)); }, function (e) { cb(e); }); };
  fs.readdir = function (path, options, cb) {
    if (typeof options === 'function') { cb = options; options = null; }
    hostFsAsync('readdir', path).then(function (list) { cb(null, list); }, function (e) { cb(e); });
  };
  fs.readFile = function (path, options, cb) {
    if (typeof options === 'function') { cb = options; options = null; }
    var encoding = null;
    if (typeof options === 'string') encoding = options;
    else if (options && options.encoding) encoding = options.encoding;
    hostFsAsync('readFile', path).then(function (data) {
      var buf = toBufferLike(data);
      cb(null, encoding ? globalThis.__ocDecodeString(buf, encoding) : buf);
    }, function (e) { cb(e); });
  };
  fs.writeFile = function (path, data, options, cb) {
    if (typeof options === 'function') { cb = options; options = null; }
    var encoding = null;
    if (typeof options === 'string') encoding = options;
    else if (options && options.encoding) encoding = options.encoding;
    if (typeof data === 'string') {
      hostFsAsync('writeFile', path, data, encoding || 'utf8').then(function () { cb(null); }, function (e) { cb(e); });
    } else {
      var copy = new Uint8Array(data.length);
      copy.set(data);
      hostFsAsync('writeFile', path, copy.buffer, encoding || '').then(function () { cb(null); }, function (e) { cb(e); });
    }
  };
  fs.appendFile = function (path, data, options, cb) {
    if (typeof options === 'function') { cb = options; options = null; }
    if (typeof data === 'string') {
      hostFsAsync('appendFile', path, data).then(function () { cb(null); }, function (e) { cb(e); });
    } else {
      hostFsAsync('appendFile', path, new Uint8Array(data).buffer).then(function () { cb(null); }, function (e) { cb(e); });
    }
  };
  fs.rm = function (path, options, cb) {
    if (typeof options === 'function') { cb = options; options = null; }
    hostFsAsync('rm', path, options && options.force ? 1 : 0, options && options.recursive ? 1 : 0).then(function () { cb(null); }, function (e) { cb(e); });
  };
  fs.rmdir = function (path, cb) { hostFsAsync('rmdir', path).then(function () { cb(null); }, function (e) { cb(e); }); };
  fs.unlink = function (path, cb) { hostFsAsync('unlink', path).then(function () { cb(null); }, function (e) { cb(e); }); };
  fs.copyFile = function (a, b, cb) { hostFsAsync('copyFile', a, b).then(function () { cb(null); }, function (e) { cb(e); }); };
  fs.access = function (path, mode, cb) {
    if (typeof mode === 'function') { cb = mode; }
    fs.existsSync(path) ? cb(null) : cb(Object.assign(new Error("ENOENT: no such file or directory, access '" + path + "'"), { code: 'ENOENT' }));
  };
  fs.exists = function (path, cb) { cb(fs.existsSync(path)); };
  fs.mkdtempSync = function (prefix) {
    var name = prefix + 'XXXXXX'.replace(/X/g, function () { return ((Math.random() * 16) | 0).toString(16); });
    fs.mkdirSync(name, { recursive: true });
    return name;
  };
  fs.mkdtemp = function (prefix, cb) {
    try { cb(null, fs.mkdtempSync(prefix)); } catch (e) { cb(e); }
  };

  /* ------------------------------ promises ------------------------------ */
  function denodeify(fn) {
    return function () {
      var args = Array.prototype.slice.call(arguments);
      return new Promise(function (resolve, reject) {
        args.push(function (err, value) { err ? reject(err) : resolve(value); });
        fn.apply(null, args);
      });
    };
  }

  var promises = {
    readFile: function (path, options) {
      return new Promise(function (resolve, reject) {
        fs.readFile(path, options, function (err, data) { err ? reject(err) : resolve(data); });
      });
    },
    writeFile: function (path, data, options) {
      return new Promise(function (resolve, reject) {
        fs.writeFile(path, data, options, function (err) { err ? reject(err) : resolve(); });
      });
    },
    appendFile: function (path, data, options) {
      return new Promise(function (resolve, reject) {
        fs.appendFile(path, data, options, function (err) { err ? reject(err) : resolve(); });
      });
    },
    mkdir: function (path, options) {
      return new Promise(function (resolve, reject) {
        fs.mkdir(path, options, function (err) { err ? reject(err) : resolve(); });
      });
    },
    readdir: function (path, options) {
      return new Promise(function (resolve, reject) {
        fs.readdir(path, options, function (err, files) { err ? reject(err) : resolve(files); });
      });
    },
    stat: function (path) {
      return new Promise(function (resolve, reject) {
        fs.stat(path, function (err, stats) { err ? reject(err) : resolve(stats); });
      });
    },
    lstat: function (path) {
      return new Promise(function (resolve, reject) {
        fs.lstat(path, function (err, stats) { err ? reject(err) : resolve(stats); });
      });
    },
    rm: function (path, options) {
      return new Promise(function (resolve, reject) {
        fs.rm(path, options, function (err) { err ? reject(err) : resolve(); });
      });
    },
    rmdir: function (path) {
      return new Promise(function (resolve, reject) {
        fs.rmdir(path, function (err) { err ? reject(err) : resolve(); });
      });
    },
    unlink: function (path) {
      return new Promise(function (resolve, reject) {
        fs.unlink(path, function (err) { err ? reject(err) : resolve(); });
      });
    },
    rename: function (a, b) {
      return new Promise(function (resolve, reject) {
        fs.rename(a, b, function (err) { err ? reject(err) : resolve(); });
      });
    },
    copyFile: function (a, b) {
      return new Promise(function (resolve, reject) {
        fs.copyFile(a, b, function (err) { err ? reject(err) : resolve(); });
      });
    },
    access: function (path) {
      return new Promise(function (resolve, reject) {
        fs.access(path, function (err) { err ? reject(err) : resolve(); });
      });
    },
    mkdtemp: denodeify(fs.mkdtemp),
  };
  fs.promises = promises;
  fs.realpath = function (path, cb) { cb(null, fs.realpathSync(path)); };
  fs.realpathSync.native = fs.realpathSync;
  fs.openSync = function () { throw new Error('fs.open (fd-based) is not supported by OpenContainer; use readFile/writeFile'); };
  fs.createReadStream = function (path, options) {
    options = options || {};
    var Readable = globalThis.__ocModules.Readable;
    var stream = new Readable({ highWaterMark: options.highWaterMark || 64 * 1024 });
    process.nextTick(function () {
      try {
        var data = fs.readFileSync(path);
        stream.push(data);
        stream.push(null);
      } catch (e) {
        stream.emit('error', e);
      }
    });
    stream.path = path;
    return stream;
  };
  fs.createWriteStream = function (path, options) {
    options = options || {};
    var Writable = globalThis.__ocModules.Writable;
    var chunks = [];
    var stream = new Writable({
      write: function (chunk, enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
      final: function (cb) {
        try {
          fs.writeFileSync(path, options.flags === 'a' || options.flags === 'a+' ? (fs.existsSync(path) ? Buffer.concat([fs.readFileSync(path)].concat(chunks)) : Buffer.concat(chunks)) : Buffer.concat(chunks));
          cb();
        } catch (e) { cb(e); }
      },
    });
    stream.path = path;
    return stream;
  };
  fs.watch = function (path, options, listener) {
    if (typeof options === 'function') { listener = options; options = null; }
    var recursive = !!(options && options.recursive === true);
    var id = __host_watch(path, function (recordsJson) {
      var records = JSON.parse(recordsJson);
      for (var i = 0; i < records.length; i++) {
        var r = records[i];
        var type = r.type === 'created' || r.type === 'renamed' ? 'rename' : 'change';
        if (listener) listener(type, r.path);
      }
    }, recursive ? 1 : 0);
    return { close: function () { __host_unwatch(id); }, __id: id };
  };
  fs.watchFile = function (path, options, listener) {
    var prev = null;
    var id = setInterval(function () {
      try {
        var cur = fs.statSync(path);
        if (prev && cur.mtimeMs !== prev.mtimeMs) listener(cur, prev);
        prev = cur;
      } catch (e) { clearInterval(id); }
    }, (options && options.interval) || 5007);
  };
  fs.unwatchFile = function () {};
  fs.fstatSync = function () { throw new Error('fd-based fs not supported'); };
  fs.utimesSync = function () {};
  fs.chownSync = function () {};
  fs.lchownSync = function () {};
  fs.fchmodSync = function () {};
  fs.statSync.native = fs.statSync;
  fs.readdirSync.native = fs.readdirSync;
  fs.readSync = function () { throw new Error('fd-based fs not supported'); };
  fs.writeSync = function (fd, data) {
    if (fd === 1) { __host_stdout(String(data)); return data.length; }
    if (fd === 2) { __host_stderr(String(data)); return data.length; }
    throw new Error('fd-based fs not supported');
  };
  fs.open = function (path, flags, mode, cb) {
    if (typeof mode === 'function') cb = mode;
    cb(Object.assign(new Error('fd-based fs not supported'), { code: 'ENOSYS' }));
  };
  fs.close = function (fd, cb) { cb(null); };
  globalThis.__ocModules.fs = fs;
})();
`;
