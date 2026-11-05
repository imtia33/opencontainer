/**
 * OpenContainer — Node compat prelude: net / http / https / fetch / WebSocket.
 *
 * Inbound: virtual HTTP servers. listen(port) registers a virtual port with
 * the host; preview requests arrive via __ocNetDispatch(port, requestId,
 * method, path, headersJson, body).
 * Outbound: http(s).request and global fetch bridge to the browser network
 * via __host_net_fetch; WebSocket bridges to the browser WebSocket API.
 */
export const PRELUDE_NET = String.raw`
/* ============================= net / http ============================= */
(function () {
  'use strict';
  var EventEmitter = globalThis.__ocModules.events;
  var Readable = globalThis.__ocModules.Readable;
  var Writable = globalThis.__ocModules.Writable;

  /* ------------------------------ IncomingMessage ------------------------------ */
  function IncomingMessage(socket) {
    Readable.call(this, {});
    this.socket = socket || null;
    this.connection = this.socket;
    this.httpVersion = '1.1';
    this.httpVersionMajor = 1;
    this.httpVersionMinor = 1;
    this.complete = true;
    this.headers = {};
    this.rawHeaders = [];
    this.trailers = {};
    this.method = null;
    this.url = null;
    this.statusCode = null;
    this.statusMessage = null;
    this.client = this.socket;
  }
  globalThis.__ocInherits(IncomingMessage, Readable);
  IncomingMessage.prototype.getHeader = function (name) { return this.headers[String(name).toLowerCase()] !== undefined ? this.headers[String(name).toLowerCase()] : undefined; };
  IncomingMessage.prototype.getHeaders = function () { var out = {}; for (var k in this.headers) out[k] = this.headers[k]; return out; };
  IncomingMessage.prototype.getHeaderNames = function () { return Object.keys(this.headers); };
  IncomingMessage.prototype.hasHeader = function (name) { return this.headers[String(name).toLowerCase()] !== undefined; };
  IncomingMessage.prototype.setTimeout = function (msecs, cb) { if (cb) this.once('timeout', cb); return this; };

  /* ------------------------------ ServerResponse ------------------------------ */
  function ServerResponse(req) {
    Writable.call(this, {});
    this.req = req;
    this.statusCode = 200;
    this.statusMessage = undefined;
    this.headersSent = false;
    this.finished = false;
    this.headers_ = {};
    this._ocRequestId = null;
    this._ocResponded = false;
    this._ocChunked = false;
    this._ocHeadOnly = false;
    this.sendDate = true;
    this.socket = req ? req.socket : null;
    this.connection = this.socket;
  }
  globalThis.__ocInherits(ServerResponse, Writable);

  ServerResponse.prototype._write = function (chunk, encoding, cb) {
    this._ocEnsureHead();
    var data = chunk;
    if (typeof data === 'string') data = Buffer.from(data, encoding || 'utf8');
    if (data && data.length > 0) {
      __host_net_write(this._ocRequestId, data.buffer && data.byteLength !== undefined ? new Uint8Array(data).buffer : data);
    }
    cb();
    return true;
  };
  ServerResponse.prototype._final = function (cb) {
    if (!this._ocResponded) {
      this._ocEnsureHead();
    }
    this.finished = true;
    __host_net_finish(this._ocRequestId);
    this.emit('finish');
    this.emit('close');
    cb();
  };
  ServerResponse.prototype._ocEnsureHead = function () {
    if (this._ocResponded) return;
    this._ocResponded = true;
    this.headersSent = true;
    var headers = {};
    for (var k in this.headers_) {
      headers[k] = this.headers_[k];
    }
    __host_net_respond(this._ocRequestId, this.statusCode, JSON.stringify(headers), null, 0);
  };
  ServerResponse.prototype.setHeader = function (name, value) {
    if (value === undefined) delete this.headers_[String(name).toLowerCase()];
    else this.headers_[String(name).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
  };
  ServerResponse.prototype.getHeader = function (name) { return this.headers_[String(name).toLowerCase()]; };
  ServerResponse.prototype.getHeaders = function () { var out = {}; for (var k in this.headers_) out[k] = this.headers_[k]; return out; };
  ServerResponse.prototype.removeHeader = function (name) { delete this.headers_[String(name).toLowerCase()]; };
  ServerResponse.prototype.hasHeader = function (name) { return this.headers_[String(name).toLowerCase()] !== undefined; };
  ServerResponse.prototype.writeHead = function (statusCode, statusMessage, headers) {
    if (this.headersSent) throw new Error('writeHead: headers already sent');
    if (typeof statusMessage === 'object' && statusMessage !== null) { headers = statusMessage; statusMessage = undefined; }
    this.statusCode = statusCode;
    if (typeof statusMessage === 'string') this.statusMessage = statusMessage;
    if (headers) {
      var keys = Object.keys(headers);
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (key.toLowerCase() === 'content-length') continue;
        this.setHeader(key, headers[key]);
      }
    }
    return this;
  };
  ServerResponse.prototype.end = function (chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = null; encoding = null; }
    else if (typeof encoding === 'function') { cb = encoding; encoding = null; }
    if (this.finished) { if (cb) cb(); return this; }
    var self = this;
    if (chunk !== null && chunk !== undefined) {
      var data = typeof chunk === 'string' ? Buffer.from(chunk, encoding || 'utf8') : Buffer.from(chunk);
      if (!this._ocResponded) {
        // buffered fast path: full response in one go
        this._ocResponded = true;
        this.headersSent = true;
        var headers = {};
        for (var k in this.headers_) headers[k] = this.headers_[k];
        var u8 = new Uint8Array(data);
        __host_net_respond(this._ocRequestId, this.statusCode, JSON.stringify(headers), u8.buffer, 1);
        this.finished = true;
        __host_net_finish(this._ocRequestId);
        this.emit('finish');
        this.emit('close');
        if (cb) cb();
        return this;
      }
      this.write(chunk, encoding);
    } else if (!this._ocResponded) {
      this._ocEnsureHead();
    }
    Writable.prototype.end.call(this, function () {
      if (cb) cb();
    });
    return this;
  };
  ServerResponse.prototype.setTimeout = function (msecs, cb) { if (cb) this.once('timeout', cb); return this; };
  ServerResponse.prototype.flushHeaders = function () { this._ocEnsureHead(); };
  ServerResponse.prototype.writeContinue = function () {};
  ServerResponse.prototype.strictContentLength = false;

  /* ------------------------------ Server ------------------------------ */
  function Server(requestListener, options) {
    EventEmitter.call(this);
    var self = this;
    this.listening = false;
    this.port = null;
    this.maxRequestsCount = Infinity;
    this.requestTimeout = 0;
    this.headersTimeout = 0;
    this.keepAliveTimeout = 0;
    if (typeof requestListener === 'function') this.on('request', requestListener);
    this.timeout = 0;
  }
  globalThis.__ocInherits(Server, EventEmitter);

  Server.prototype.listen = function () {
    var self = this;
    var args = Array.prototype.slice.call(arguments);
    var port = 0;
    var cb = null;
    for (var i = 0; i < args.length; i++) {
      if (typeof args[i] === 'number') port = args[i];
      else if (typeof args[i] === 'function') cb = args[i];
      else if (args[i] && typeof args[i] === 'object' && args[i].port !== undefined) port = Number(args[i].port);
    }
    this.port = port;
    if (typeof cb === 'function') this.once('listening', cb);
    var p = __host_net_listen(port);
    p.then(function () {
      self.listening = true;
      __ocHttpServers[port] = self;
      self.emit('listening');
    }, function (err) {
      self.emit('error', err);
    });
    return this;
  };
  Server.prototype.address = function () {
    return this.listening ? { port: this.port, family: 'IPv4', address: '127.0.0.1' } : null;
  };
  Server.prototype.close = function (cb) {
    var self = this;
    if (this.port !== null && __ocHttpServers[this.port] === this) {
      delete __ocHttpServers[this.port];
      __host_net_close(this.port);
    }
    this.listening = false;
    if (typeof cb === 'function') this.once('close', cb);
    process.nextTick(function () { self.emit('close'); });
    return this;
  };
  Server.prototype.setTimeout = function (msecs, cb) { if (cb) this.on('timeout', cb); return this; };
  Server.prototype.setTimeouts = function () { return this; };
  Server.prototype.headersTimeout = 0;
  Server.prototype.requestTimeout = 0;
  Server.prototype.keepAliveTimeout = 0;

  globalThis.__ocHttpServers = globalThis.__ocHttpServers || {};

  /* ------------------------------ dispatch (inbound) ------------------------------ */
  globalThis.__ocNetDispatch = function __ocNetDispatch(port, requestId, method, path, headersJson, bodyBuf) {
    var server = __ocHttpServers[port];
    if (!server) {
      __host_net_respond(requestId, 503, JSON.stringify({ 'content-type': 'text/plain' }), new Uint8Array(0).buffer, 0);
      __host_net_finish(requestId);
      return;
    }
    var headers = JSON.parse(headersJson || '{}');
    var socket = {
      remoteAddress: '127.0.0.1',
      remotePort: 44321,
      localAddress: '127.0.0.1',
      localPort: port,
      destroyed: false,
      write: function (data) { __host_net_write(requestId, data); },
      end: function () { __host_net_finish(requestId); },
      destroy: function () { __host_net_finish(requestId); },
      setTimeout: function () { return socket; },
      setNoDelay: function () { return socket; },
      setKeepAlive: function () { return socket; },
      ref: function () { return socket; },
      unref: function () { return socket; },
      on: function () { return socket; },
      once: function () { return socket; },
    };
    var req = new IncomingMessage(socket);
    req.method = method;
    req.url = path;
    req.headers = {};
    var rawPairs = [];
    for (var hk in headers) {
      var lower = String(hk).toLowerCase();
      req.headers[lower] = headers[hk];
      rawPairs.push(hk, String(headers[hk]));
    }
    req.rawHeaders = rawPairs;
    var res = new ServerResponse(req);
    res._ocRequestId = requestId;
    var u = new URL(path, 'http://localhost:' + port);
    res.setHeader('Date', new Date().toUTCString());

    // deliver the request body asynchronously (Node-like ordering)
    var body = bodyBuf instanceof ArrayBuffer ? new Uint8Array(bodyBuf) : null;
    process.nextTick(function () {
      if (body && body.length > 0) {
        var buf = new Uint8Array(body.length);
        buf.set(body);
        buf.__proto__ = Buffer.prototype;
        req.push(buf);
      }
      req.push(null);
    });

    if (method === 'HEAD' || method === 'OPTIONS') {
      // still dispatch; user code decides
    }
    server.emit('request', req, res);
    return true;
  };

  /* ------------------------------ http module ------------------------------ */
  var http = {};
  http.createServer = function (requestListener, options) { return new Server(requestListener, options); };
  http.Server = Server;
  http.IncomingMessage = IncomingMessage;
  http.ServerResponse = ServerResponse;
  http.STATUS_CODES = {
    100: 'Continue', 101: 'Switching Protocols', 200: 'OK', 201: 'Created', 202: 'Accepted',
    204: 'No Content', 206: 'Partial Content', 301: 'Moved Permanently', 302: 'Found',
    303: 'See Other', 304: 'Not Modified', 307: 'Temporary Redirect', 308: 'Permanent Redirect',
    400: 'Bad Request', 401: 'Unauthorized', 402: 'Payment Required', 403: 'Forbidden',
    404: 'Not Found', 405: 'Method Not Allowed', 406: 'Not Acceptable', 408: 'Request Timeout',
    409: 'Conflict', 410: 'Gone', 411: 'Length Required', 413: 'Payload Too Large',
    415: 'Unsupported Media Type', 418: 'I\'m a Teapot', 429: 'Too Many Requests',
    431: 'Request Header Fields Too Large', 500: 'Internal Server Error', 501: 'Not Implemented',
    502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
  };
  http.METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'];
  http.maxHeaderSize = 16384;
  http.globalAgent = { destroy: function () {}, maxSockets: Infinity };

  /* ------------------------------ ClientRequest (outbound) ------------------------------ */
  function ClientRequest(options, cb) {
    EventEmitter.call(this);
    if (typeof options === 'string') options = { url: options };
    var url = options.url || ((options.protocol || 'http:') + '//' + (options.host || options.hostname || 'localhost') + (options.port ? ':' + options.port : '') + (options.path || '/'));
    this.__url = url;
    this.__method = options.method || 'GET';
    this.__headers = {};
    if (options.headers) {
      var keys = Object.keys(options.headers);
      for (var i = 0; i < keys.length; i++) this.__headers[keys[i]] = options.headers[keys[i]];
    }
    this.__chunks = [];
    this.__finished = false;
    this.aborted = false;
    this.socket = { destroyed: false };
    if (typeof cb === 'function') this.on('response', cb);
    var self = this;
    if (options.auth) {
      this.setHeader('authorization', 'Basic ' + Buffer.from(options.auth).toString('base64'));
    }
    var timeout = options.timeout;
    if (timeout) setTimeout(function () { if (!self.__finished) { var e = new Error('socket hang up'); e.code = 'ETIMEDOUT'; self.emit('error', e); } }, timeout);
  }
  globalThis.__ocInherits(ClientRequest, EventEmitter);
  ClientRequest.prototype.setHeader = function (name, value) { this.__headers[String(name)] = value === undefined ? undefined : String(value); };
  ClientRequest.prototype.getHeader = function (name) { return this.__headers[String(name)]; };
  ClientRequest.prototype.removeHeader = function (name) { delete this.__headers[String(name)]; };
  ClientRequest.prototype.getHeaders = function () { var out = {}; for (var k in this.__headers) out[k] = this.__headers[k]; return out; };
  ClientRequest.prototype.abort = function () { this.aborted = true; this.emit('abort'); };
  ClientRequest.prototype.destroy = function (err) { this.aborted = true; if (err) this.emit('error', err); };
  ClientRequest.prototype.setTimeout = function (msecs, cb) { if (cb) this.once('timeout', cb); return this; };
  ClientRequest.prototype.setNoDelay = function () { return this; };
  ClientRequest.prototype.setSocketKeepAlive = function () { return this; };
  ClientRequest.prototype.end = function (chunk, encoding, cb) {
    if (typeof chunk === 'function') { cb = chunk; chunk = null; }
    var self = this;
    if (chunk !== null && chunk !== undefined) this.write(chunk, encoding);
    this.__finished = true;
    var body = null;
    if (self.__chunks.length > 0) {
      var total = self.__chunks.reduce(function (a, c) { return a + c.length; }, 0);
      body = new Uint8Array(total);
      var off = 0;
      for (var i = 0; i < self.__chunks.length; i++) {
        body.set(self.__chunks[i], off);
        off += self.__chunks[i].length;
      }
    }
    var p = __host_net_fetch(self.__url, JSON.stringify({ method: self.__method, headers: self.__headers, body: body ? body.buffer : undefined }));
    p.then(function (result) {
      if (self.aborted) return;
      var res = new IncomingMessage(null);
      res.statusCode = result.status;
      res.statusMessage = http.STATUS_CODES[result.status] || '';
      res.headers = {};
      res.rawHeaders = [];
      for (var hk in result.headers) {
        var lower = String(hk).toLowerCase();
        res.headers[lower] = result.headers[hk];
        res.rawHeaders.push(hk, String(result.headers[hk]));
      }
      res.url = self.__url;
      self.emit('response', res);
      var u8 = new Uint8Array(result.body || new Uint8Array(0));
      var buf = new Uint8Array(u8.length);
      buf.set(u8);
      buf.__proto__ = Buffer.prototype;
      process.nextTick(function () {
        if (buf.length > 0) res.push(buf);
        res.push(null);
      });
      if (typeof cb === 'function') cb();
    }, function (err) {
      self.emit('error', err);
    });
    return this;
  };
  ClientRequest.prototype.write = function (chunk, encoding) {
    if (typeof chunk === 'string') chunk = Buffer.from(chunk, encoding || 'utf8');
    else if (chunk && !(chunk instanceof Uint8Array)) chunk = Buffer.from(String(chunk));
    if (chunk) {
      var copy = new Uint8Array(chunk.length);
      copy.set(chunk);
      this.__chunks.push(copy);
    }
    return true;
  };
  ClientRequest.prototype.flushHeaders = function () {};

  http.request = function (options, cb) { return new ClientRequest(options, cb); };
  http.get = function (options, cb) {
    var req = new ClientRequest(typeof options === 'string' ? { url: options } : Object.assign({}, options, { method: 'GET' }), cb);
    req.end();
    return req;
  };
  http.ClientRequest = ClientRequest;
  http.Agent = function () { this.destroy = function () {}; };
  http.validateHeaderName = function () {};
  http.validateHeaderValue = function () {};

  var https = {};
  https.createServer = http.createServer;
  https.Server = Server;
  https.request = http.request;
  https.get = http.get;
  https.Agent = http.Agent;
  https.globalAgent = http.globalAgent;
  https.IncomingMessage = IncomingMessage;
  https.ServerResponse = ServerResponse;
  https.ClientRequest = ClientRequest;

  /* ------------------------------ net module ------------------------------ */
  var net = {};
  net.Server = Server;
  net.createServer = function (connectionListener) {
    var server = new Server(function (req, res) {
      // virtual TCP surfaces as decoded HTTP requests; raw sockets are not
      // available in the browser sandbox (see COMPATIBILITY.md)
      var socket = req.socket;
      if (typeof connectionListener === 'function') connectionListener(socket);
      socket.on('data', function () {});
    });
    return server;
  };
  net.connect = net.createConnection = function () {
    throw new Error('net.connect (raw outbound TCP) is not supported inside the browser sandbox; use http.request or fetch');
  };
  net.isIP = function (str) { return /^\d+\.\d+\.\d+\.\d+$/.test(str) ? 4 : (str === 'localhost' ? 4 : 0); };
  net.isIPv4 = function (str) { return net.isIP(str) === 4; };
  net.isIPv6 = function () { return false; };
  net.Socket = function () { EventEmitter.call(this); };
  net.IPv4 = net.IPv6 = function () {};

  /* ------------------------------ global fetch ------------------------------ */
  function HeadersLite(init) {
    this.__h = {};
    if (init && typeof init.forEach === 'function') {
      init.forEach(function (v, k) { this.__h[String(k).toLowerCase()] = String(v); }, this);
    } else if (init && typeof init === 'object') {
      for (var k in init) this.__h[String(k).toLowerCase()] = String(init[k]);
    }
  }
  HeadersLite.prototype.get = function (name) { var v = this.__h[String(name).toLowerCase()]; return v === undefined ? null : v; };
  HeadersLite.prototype.has = function (name) { return this.__h[String(name).toLowerCase()] !== undefined; };
  HeadersLite.prototype.set = function (name, value) { this.__h[String(name).toLowerCase()] = String(value); };
  HeadersLite.prototype.append = function (name, value) {
    var k = String(name).toLowerCase();
    this.__h[k] = this.__h[k] !== undefined ? this.__h[k] + ', ' + String(value) : String(value);
  };
  HeadersLite.prototype.delete = function (name) { delete this.__h[String(name).toLowerCase()]; };
  HeadersLite.prototype.forEach = function (cb, thisArg) { for (var k in this.__h) cb.call(thisArg, this.__h[k], k, this); };
  HeadersLite.prototype.entries = function () { var self = this; var keys = Object.keys(this.__h); var i = 0; return { next: function () { return i < keys.length ? { value: [keys[i++], self.__h[keys[i - 1]]], done: false } : { done: true, value: undefined }; }, [Symbol.iterator]: function () { return this; } }; };
  HeadersLite.prototype[Symbol.iterator] = HeadersLite.prototype.entries;

  function ResponseLite(body, init) {
    init = init || {};
    this.body = body;
    this.status = init.status || 200;
    this.statusText = init.statusText || http.STATUS_CODES[init.status || 200] || '';
    this.ok = this.status >= 200 && this.status < 300;
    this.redirected = false;
    this.type = 'basic';
    this.url = init.url || '';
    this.headers = new HeadersLite(init.headers);
    var bodyText = null;
    var bodyBuf = null;
    if (typeof body === 'string') bodyText = body;
    else if (body instanceof Uint8Array) bodyBuf = body;
    this.text = function () {
      if (bodyText === null) bodyText = bodyBuf ? globalThis.__ocDecodeString(bodyBuf, 'utf8') : '';
      return Promise.resolve(bodyText);
    };
    this.json = function () { return this.text().then(function (t) { return JSON.parse(t); }); };
    this.arrayBuffer = function () {
      return Promise.resolve((bodyBuf || globalThis.__ocUtf8Encode(bodyText || '')).buffer.slice(0));
    };
    this.blob = function () { return Promise.reject(new Error('Blob not supported')); };
    this.formData = function () { return Promise.reject(new Error('FormData not supported')); };
    this.clone = function () { return new ResponseLite(body, init); };
  }

  globalThis.fetch = function fetch(url, init) {
    init = init || {};
    if (url && typeof url === 'object' && url.url) { init = { method: url.method, headers: url.headers, body: url.body }; url = url.url; }
    var bodyU8 = null;
    if (init.body !== undefined && init.body !== null) {
      if (typeof init.body === 'string') bodyU8 = globalThis.__ocUtf8Encode(init.body);
      else if (init.body instanceof Uint8Array) bodyU8 = new Uint8Array(init.body);
    }
    return __host_net_fetch(String(url), JSON.stringify({ method: init.method || 'GET', headers: init.headers || {}, body: bodyU8 ? bodyU8.buffer : undefined })).then(function (result) {
      var u8 = new Uint8Array(result.body || new Uint8Array(0));
      var headersInit = result.headers || {};
      return new ResponseLite(u8.length ? u8 : '', { status: result.status, headers: headersInit, url: String(url) });
    });
  };
  globalThis.Headers = HeadersLite;
  globalThis.Response = ResponseLite;
  globalThis.Request = function Request(url, init) { this.url = String(url); Object.assign(this, init || {}); };

  /* ------------------------------ WebSocket (outbound) ------------------------------ */
  var wsRegistry = globalThis.__ocWsRegistry || {};
  globalThis.__ocWsRegistry = wsRegistry;
  var wsSeq = 1;

  function WebSocket(url, protocols) {
    EventEmitter.call(this);
    var self = this;
    this.url = String(url);
    this.readyState = 0; // CONNECTING
    this.protocol = '';
    this.binaryType = 'nodebuffer';
    this.__id = wsSeq++;
    wsRegistry[this.__id] = this;
    var p = protocols && !Array.isArray(protocols) ? [protocols] : protocols;
    var id = __host_ws_open(this.url, JSON.stringify(p || []));
    this.__id = id;
    this.send = function (data) {
      if (typeof data === 'string') __host_ws_send(self.__id, data, 0);
      else if (data instanceof Uint8Array) __host_ws_send(self.__id, new Uint8Array(data).buffer, 1);
      else if (data && data.buffer) __host_ws_send(self.__id, data.buffer, 1);
      else __host_ws_send(self.__id, String(data), 0);
    };
    this.close = function (code, reason) { __host_ws_close(self.__id); };
    this.terminate = function () { __host_ws_close(self.__id); };
    this.ping = function () {};
    this.pong = function () {};
  }
  globalThis.__ocInherits(WebSocket, EventEmitter);
  WebSocket.CONNECTING = 0;
  WebSocket.OPEN = 1;
  WebSocket.CLOSING = 2;
  WebSocket.CLOSED = 3;
  Object.defineProperty(WebSocket.prototype, 'onopen', { set: function (cb) { if (cb) this.on('open', cb); }, configurable: true });
  Object.defineProperty(WebSocket.prototype, 'onmessage', { set: function (cb) { if (cb) this.on('message', cb); }, configurable: true });
  Object.defineProperty(WebSocket.prototype, 'onclose', { set: function (cb) { if (cb) this.on('close', cb); }, configurable: true });
  Object.defineProperty(WebSocket.prototype, 'onerror', { set: function (cb) { if (cb) this.on('error', cb); }, configurable: true });

  globalThis.__ocWsEvent = function __ocWsEvent(id, event, data) {
    var ws = wsRegistry[id];
    if (!ws) return;
    if (event === 'open') {
      ws.readyState = 1;
      ws.emit('open');
    } else if (event === 'message') {
      var payload;
      if (data instanceof ArrayBuffer) {
        var u8 = new Uint8Array(data);
        var buf = new Uint8Array(u8.length);
        buf.set(u8);
        buf.__proto__ = Buffer.prototype;
        payload = ws.binaryType === 'string' ? globalThis.__ocDecodeString(buf, 'utf8') : buf;
      } else {
        payload = String(data);
      }
      ws.emit('message', payload);
    } else if (event === 'close') {
      ws.readyState = 3;
      ws.emit('close', 1000, '');
      delete wsRegistry[id];
    } else if (event === 'error') {
      ws.emit('error', new Error('WebSocket error: ' + String(data)));
    }
  };

  globalThis.__ocModules.http = http;
  globalThis.__ocModules.https = https;
  globalThis.__ocModules.net = net;
  globalThis.__ocModules.WebSocket = WebSocket;
})();
`;
