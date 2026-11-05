/**
 * OpenContainer — Node compat prelude: streams.
 * A pragmatic implementation of Readable/Writable/Duplex/Transform with
 * the event surface real-world packages rely on (data/end/error/close,
 * pause/resume, pipe, encoding handling).
 */
export const PRELUDE_STREAM = String.raw`
/* ============================= stream ============================= */
(function () {
  'use strict';
  var EventEmitter = globalThis.__ocModules.events;

  function emitErrorNT(self, err) {
    process.nextTick(function () { self.emit('error', err); });
  }

  function Readable(options) {
    EventEmitter.call(this);
    options = options || {};
    this._readableState = {
      flowing: false,
      ended: false,
      endEmitted: false,
      buffer: [],
      length: 0,
      encoding: options.encoding || null,
      highWaterMark: options.highWaterMark || 16 * 1024,
      objectMode: !!options.objectMode,
      pipes: [],
      closeEmitted: false,
      destroyed: false,
    };
    if (typeof options.read === 'function') this._read = options.read;
    if (typeof options.destroy === 'function') this._destroy = options.destroy;
  }
  globalThis.__ocInherits(Readable, EventEmitter);

  Readable.prototype.push = function (chunk, encoding) {
    var state = this._readableState;
    if (chunk === null) {
      state.ended = true;
      this._maybeEnd();
      return false;
    }
    if (chunk !== undefined && chunk !== null) {
      if (typeof chunk === 'string' && state.encoding !== 'string') {
        encoding = encoding || state.encoding || 'utf8';
        chunk = globalThis.Buffer.from(chunk, encoding);
      } else if (typeof chunk === 'string' && state.encoding) {
        chunk = globalThis.__ocDecodeString(Buffer.from(chunk, 'utf8'), state.encoding);
      } else if (!(chunk instanceof Uint8Array) && !state.objectMode) {
        chunk = Buffer.from(String(chunk));
      }
      state.buffer.push(chunk);
      state.length += chunk.length || 1;
    }
    if (state.flowing) this._flow();
    return state.length < state.highWaterMark;
  };
  Readable.prototype.unshift = function (chunk) { this.push(chunk); };
  Readable.prototype.read = function (size) {
    var state = this._readableState;
    if (state.buffer.length === 0) {
      if (state.ended) { this._maybeEnd(); return null; }
      if (typeof this._read === 'function') { try { this._read(size || state.highWaterMark); } catch (e) { emitErrorNT(this, e); } }
      if (state.buffer.length === 0) return state.ended ? null : null;
    }
    if (state.buffer.length === 0) return null;
    if (state.objectMode || size === undefined) return state.buffer.shift();
    var out = Buffer.alloc(0);
    while (out.length < (size || 1) && state.buffer.length > 0) {
      var chunk = state.buffer.shift();
      state.length -= chunk.length;
      if (out.length === 0 && chunk.length >= size) {
        if (chunk.length === size) return chunk;
        var head = chunk.subarray(0, size);
        state.buffer.unshift(chunk.subarray(size));
        state.length += chunk.length - size;
        return head;
      }
      out = Buffer.concat([out, chunk]);
    }
    return out;
  };
  Readable.prototype._flow = function () {
    var state = this._readableState;
    var self = this;
    while (state.flowing && state.buffer.length > 0) {
      var chunk = state.buffer.shift();
      state.length -= chunk.length || 1;
      var data = chunk;
      if (typeof chunk !== 'string' && !state.objectMode && state.encoding) {
        data = globalThis.__ocDecodeString(chunk, state.encoding);
      }
      this.emit('data', data);
      for (var i = 0; i < state.pipes.length; i++) {
        state.pipes[i].write(chunk);
      }
      if (!state.flowing) break;
    }
    if (state.buffer.length === 0) {
      if (typeof this._read === 'function' && !state.ended) {
        try { this._read(state.highWaterMark); } catch (e) { emitErrorNT(this, e); }
      }
      this._maybeEnd();
    }
  };
  Readable.prototype._maybeEnd = function () {
    var state = this._readableState;
    if (state.ended && state.buffer.length === 0 && !state.endEmitted) {
      state.endEmitted = true;
      this.emit('end');
      for (var i = 0; i < state.pipes.length; i++) {
        var dest = state.pipes[i];
        if (typeof dest.end === 'function') dest.end();
      }
      this.emit('close');
    }
  };
  Readable.prototype.setEncoding = function (enc) {
    this._readableState.encoding = enc;
    return this;
  };
  Readable.prototype.pause = function () {
    this._readableState.flowing = false;
    return this;
  };
  Readable.prototype.resume = function () {
    this._readableState.flowing = true;
    this._flow();
    return this;
  };
  Readable.prototype.isPaused = function () { return !this._readableState.flowing; };
  Readable.prototype.pipe = function (dest, pipeOpts) {
    var self = this;
    this._readableState.pipes.push(dest);
    this.resume();
    dest.emit('pipe', this);
    return dest;
  };
  Readable.prototype.unpipe = function (dest) {
    var pipes = this._readableState.pipes;
    if (dest) {
      var idx = pipes.indexOf(dest);
      if (idx !== -1) pipes.splice(idx, 1);
    } else {
      pipes.length = 0;
    }
    return this;
  };
  Readable.prototype.destroy = function (err) {
    if (this._readableState.destroyed) return;
    this._readableState.destroyed = true;
    if (typeof this._destroy === 'function') this._destroy(err);
    var self = this;
    process.nextTick(function () {
      if (err) self.emit('error', err);
      self.emit('close');
    });
  };
  Readable.prototype.iterator = function () { throw new Error('stream.iterator not supported'); };
  Readable.prototype[Symbol.asyncIterator] = function () {
    var self = this;
    var ended = false;
    var error = null;
    var pending = [];
    self.on('data', function (chunk) { if (pending.length) pending.shift()[0]({ value: chunk, done: false }); else pending.push([null, chunk]); });
    self.on('end', function () { ended = true; while (pending.length) pending.shift()[0]({ value: undefined, done: true }); });
    self.on('error', function (e) { error = e; });
    return {
      next: function () {
        return new Promise(function (resolve, reject) {
          if (error) return reject(error);
          if (ended) return resolve({ value: undefined, done: true });
          if (pending.length) {
            var entry = pending.shift();
            if (entry[0]) entry[0]({ value: entry[1], done: false });
            resolve({ value: entry[1], done: false });
            return;
          }
          pending.push([resolve]);
        });
      },
    };
  };

  function Writable(options) {
    EventEmitter.call(this);
    options = options || {};
    this._writableState = {
      highWaterMark: options.highWaterMark || 16 * 1024,
      objectMode: !!options.objectMode,
      ending: false,
      ended: false,
      finished: false,
      corked: 0,
      buffer: [],
      writecb: null,
      writelen: 0,
      destroyed: false,
      decodeStrings: options.decodeStrings !== false,
      defaultEncoding: options.defaultEncoding || 'utf8',
    };
    if (typeof options.write === 'function') this._write = options.write;
    if (typeof options.final === 'function') this._final = options.final;
    if (typeof options.destroy === 'function') this._destroy = options.destroy;
  }
  globalThis.__ocInherits(Writable, EventEmitter);

  Writable.prototype.write = function (chunk, encoding, cb) {
    if (typeof encoding === 'function') { cb = encoding; encoding = null; }
    var state = this._writableState;
    if (typeof chunk === 'string' && state.decodeStrings) {
      chunk = Buffer.from(chunk, encoding || state.defaultEncoding);
    }
    if (chunk && !(chunk instanceof Uint8Array) && !state.objectMode) {
      chunk = Buffer.from(String(chunk));
    }
    var len = chunk ? (chunk.length || 1) : 1;
    var ret = true;
    var self = this;
    if (state.corked > 0 || state.buffer.length > 0 || !this._writableState.finished === false) {
      // fast path
    }
    var callback = function () {
      if (cb) cb();
      self._drain();
    };
    try {
      ret = this._write ? this._write(chunk, encoding, callback) : true;
    } catch (e) {
      emitErrorNT(this, e);
      return false;
    }
    return ret !== false;
  };
  Writable.prototype._drain = function () {
    var state = this._writableState;
    if (state.ending && !state.finished) {
      state.finished = true;
      var self = this;
      if (typeof this._final === 'function') {
        this._final(function () { self.emit('finish'); self.emit('close'); });
      } else {
        this.emit('finish');
        this.emit('close');
      }
    }
  };
  Writable.prototype.cork = function () { this._writableState.corked++; };
  Writable.prototype.uncork = function () { if (this._writableState.corked > 0) this._writableState.corked--; };
  Writable.prototype.setDefaultEncoding = function (enc) { this._writableState.defaultEncoding = enc; return this; };
  Writable.prototype.end = function (chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = null; }
    else if (typeof encoding === 'function') { cb = encoding; encoding = null; }
    var state = this._writableState;
    if (chunk !== null && chunk !== undefined) this.write(chunk, encoding);
    state.ending = true;
    var self = this;
    if (!state.finished) {
      process.nextTick(function () { self._drain(); });
    }
    if (cb) this.once('finish', cb);
    return this;
  };
  Writable.prototype.destroy = function (err) {
    if (this._writableState.destroyed) return;
    this._writableState.destroyed = true;
    if (typeof this._destroy === 'function') this._destroy(err);
    var self = this;
    process.nextTick(function () {
      if (err) self.emit('error', err);
      self.emit('close');
    });
  };

  function Duplex(options) {
    Readable.call(this, options);
    Writable.call(this, options);
    this.allowHalfOpen = options ? options.allowHalfOpen !== false : true;
  }
  globalThis.__ocInherits(Duplex, Readable);
  Object.keys(Writable.prototype).forEach(function (key) {
    if (typeof Writable.prototype[key] === 'function' && Duplex.prototype[key] === undefined) {
      Duplex.prototype[key] = Writable.prototype[key];
    }
  });

  function Transform(options) {
    Duplex.call(this, options);
    this._transformState = { afterTransform: function (er, data) {} };
    if (options && typeof options.transform === 'function') this._transform = options.transform;
    if (options && typeof options.flush === 'function') this._flush = options.flush;
  }
  globalThis.__ocInherits(Transform, Duplex);
  var origWrite = Writable.prototype.write;
  Transform.prototype.write = function (chunk, encoding, cb) {
    var self = this;
    origWrite.call(this, chunk, encoding, function () {
      if (typeof cb === 'function') cb();
    });
    // run transform on each write
    var data = chunk;
    try {
      this._transform(data, encoding, function (err, out) {
        if (err) { emitErrorNT(self, err); return; }
        if (out !== null && out !== undefined) self.push(out);
      });
    } catch (e) { emitErrorNT(this, e); }
    return true;
  };
  Transform.prototype._write = function (chunk, encoding, cb) { cb(); };
  Transform.prototype._final = function (cb) {
    var self = this;
    if (typeof this._flush === 'function') {
      this._flush(function (err, out) {
        if (out !== null && out !== undefined) self.push(out);
        cb();
      });
    } else { cb(); }
  };

  function PassThrough(options) { Transform.call(this, options); }
  globalThis.__ocInherits(PassThrough, Transform);
  PassThrough.prototype._transform = function (chunk, encoding, cb) { cb(null, chunk); };

  var stream = {
    Readable: Readable,
    Writable: Writable,
    Duplex: Duplex,
    Transform: Transform,
    PassThrough: PassThrough,
    Stream: Duplex,
    finished: function (streamLike, cb) {
      if (streamLike && streamLike.readable) {
        streamLike.once('end', function () { cb(null); });
        streamLike.once('error', function (e) { cb(e); });
      } else if (streamLike && streamLike.writable) {
        streamLike.once('finish', function () { cb(null); });
        streamLike.once('error', function (e) { cb(e); });
      }
      return function () {};
    },
    pipeline: function () {
      var streams = Array.prototype.slice.call(arguments);
      var cb = streams.pop();
      var lastErr = null;
      if (typeof cb !== 'function') { streams.push(cb); cb = null; }
      streams.forEach(function (s) {
        s.on('error', function (e) { lastErr = e; });
      });
      for (var i = 0; i < streams.length - 1; i++) {
        streams[i].pipe(streams[i + 1]);
      }
      var last = streams[streams.length - 1];
      if (last && typeof cb === 'function') {
        if (last.readable) last.once('end', function () { cb(lastErr); });
        else if (last.writable) last.once('finish', function () { cb(lastErr); });
      }
    },
    addAbortSignal: function () {},
    isErrored: function (s) { return false; },
    isWritable: function (s) { return s && s.writable !== false; },
    isReadable: function (s) { return s && s.readable !== false; },
  };
  Readable.Writable = Writable;
  Readable.Duplex = Duplex;
  Readable.Transform = Transform;
  Readable.PassThrough = PassThrough;
  Writable.Writable = Writable;

  globalThis.__ocModules.stream = stream;
  globalThis.__ocModules.Readable = Readable;
  globalThis.__ocModules.Writable = Writable;
})();
`;
