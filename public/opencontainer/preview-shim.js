/**
 * OpenContainer preview shim — injected FIRST into every guest HTML page
 * by the preview Service Worker (see preview-sw.js).
 *
 * Responsibilities (WebContainer parity):
 *  - WebSocket override: service workers cannot intercept WebSocket
 *    connections (platform limit), so HMR sockets are tunneled through a
 *    MessagePort chain (shim ⇄ SW ⇄ runtime bridge ⇄ kernel virtual TCP)
 *    with a real RFC6455 client implementation: masked frames, ping/pong,
 *    close handshake, text + binary payloads. The guest server sees a
 *    genuine WebSocket upgrade on the wire.
 *  - preview-message parity: uncaught errors / unhandled rejections /
 *    console.error are forwarded to the host page as PREVIEW_* messages
 *    (the runtime re-emits them as 'preview-message').
 *  - LOCALSERVICE_RELOAD_WINDOW handshake: reloadPreview() (upstream
 *    contract) pings before reassigning iframe.src; we ack then reload.
 *  - Tier-2 (scoped SW — the zero-integration CDN fallback) remapping:
 *    fetch/XHR/sendBeacon/pushState with absolute paths are remapped into
 *    the SW scope so they stay interceptable. On Tier 1 (root scope) the
 *    SW routes absolute paths natively and NOTHING here rewrites URLs.
 *
 * The binding ({sid, port}) is resolved from the SW (oc-whoami) and cached;
 * WS frames sent before it resolves are buffered.
 */
(function () {
  if (window.__ocPreviewShim) return;
  window.__ocPreviewShim = true;

  var sw = navigator.serviceWorker;
  var controller = sw && sw.controller;

  /* ------------------------------------------------------- binding lookup */

  var bindPromise = new Promise(function (resolve) {
    if (!controller) return resolve(null);
    var onMsg = function (ev) {
      if (ev.data && ev.data.type === 'oc-you-are') {
        window.removeEventListener('message', onMsg);
        resolve(ev.data.bind || null);
      }
    };
    window.addEventListener('message', onMsg);
    try { controller.postMessage({ type: 'oc-whoami' }); } catch (e) { resolve(null); }
    setTimeout(function () { window.removeEventListener('message', onMsg); resolve(null); }, 3000);
  });
  // The page's own URL is a synchronous fallback for the FIRST navigation
  // (before client-side routing rewrites it).
  var m = /^\/p\/([a-z][a-z0-9]{3,11})\/(\d+)(\/|$)/.exec(location.pathname)
    || /^\/p\/(\d+)(\/|$)/.exec(location.pathname);
  var syncBind = m ? (m.length > 3 ? { sid: m[1], port: Number(m[2]) } : { sid: null, port: Number(m[1]) }) : null;
  if (syncBind) {
    bindPromise = Promise.resolve(syncBind);
  }

  /* ------------------------------------------------- preview-message parity */

  function postPreview(msg) {
    try { msg.type = msg.type || 'PREVIEW_ERROR'; parent.postMessage(msg, '*'); } catch (e) { /* noop */ }
  }
  window.addEventListener('error', function (ev) {
    postPreview({
      type: 'PREVIEW_ERROR', kind: 'uncaughtException',
      message: String(ev.message), filename: ev.filename, lineno: ev.lineno, colno: ev.colno,
    });
  });
  window.addEventListener('unhandledrejection', function (ev) {
    var reason = ev.reason;
    postPreview({
      type: 'PREVIEW_ERROR', kind: 'unhandledRejection',
      message: String(reason && reason.message || reason),
    });
  });
  var realConsoleError = console.error;
  console.error = function () {
    try {
      postPreview({
        type: 'PREVIEW_ERROR', kind: 'consoleError',
        message: Array.prototype.map.call(arguments, String).join(' '),
      });
    } catch (e) { /* noop */ }
    return realConsoleError.apply(console, arguments);
  };

  /* ------------------------------------------------------ reload handshake */

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'LOCALSERVICE_RELOAD_WINDOW') {
      try { ev.ports[0] && ev.ports[0].postMessage({ type: 'LOCALSERVICE_WINDOW_RELOADED' }); } catch (e) { /* noop */ }
      setTimeout(function () { location.reload(); }, 0);
    }
  });

  /* ---------------------------------------------------- WebSocket override */

  var RealWebSocket = window.WebSocket;
  var wsInstances = new Map(); // id → instance
  var nextWsId = 1;

  function OCWebSocket(url, protocols) {
    if (!(this instanceof OCWebSocket)) return new OCWebSocket(url, protocols);
    var self = this;
    this.id = nextWsId++;
    this.url = String(url);
    this.protocol = '';
    this.extensions = '';
    this.binaryType = 'blob';
    this.readyState = OCWebSocket.CONNECTING;
    this._buf = [];
    this._channel = null;
    this._pendingFrames = [];
    this._headerBuf = '';
    this._handshakeDone = false;
    this._closeCode = null;
    this._closeReason = '';
    this._eventListeners = { open: [], message: [], close: [], error: [] };

    var sub = '';
    if (protocols) {
      var list = Array.isArray(protocols) ? protocols : [protocols];
      sub = 'Sec-WebSocket-Protocol: ' + list.join(', ') + '\r\n';
    }
    var key = btoa(String.fromCharCode.apply(null,
      new Uint8Array(Array.from({ length: 16 }, function () { return Math.floor(Math.random() * 256); }))));
    var parsed = new URL(this.url);
    var pathWithQuery = parsed.pathname + (parsed.search || '');
    var req =
      'GET ' + pathWithQuery + ' HTTP/1.1\r\n' +
      'Host: ' + parsed.host + '\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Key: ' + key + '\r\n' +
      sub +
      'Sec-WebSocket-Version: 13\r\n\r\n';

    wsInstances.set(this.id, this);
    bindPromise.then(function (bind) {
      if (!bind) {
        self._fail('OpenContainer: preview WebSocket has no port binding');
        return;
      }
      var channel = new MessageChannel();
      self._channel = channel.port1;
      channel.port1.onmessage = function (ev) { self._onChannelMessage(ev.data); };
      channel.port1.start ? channel.port1.start() : void channel.port1;
      var open = {
        type: 'oc-ws-open',
        id: self.id,
        url: self.url,
        bind: bind,
        bytes: new TextEncoder().encode(req),
      };
      try {
        controller.postMessage(open, [channel.port2]);
      } catch (e) {
        self._fail('OpenContainer: preview WebSocket tunnel unavailable: ' + e.message);
      }
    });
  }
  OCWebSocket.CONNECTING = 0;
  OCWebSocket.OPEN = 1;
  OCWebSocket.CLOSING = 2;
  OCWebSocket.CLOSED = 3;

  OCWebSocket.prototype = {
    constructor: OCWebSocket,
    send: function (data) {
      if (this.readyState !== OCWebSocket.OPEN) throw new Error('InvalidStateError: WebSocket is not open');
      var bytes = typeof data === 'string'
        ? new TextEncoder().encode(data)
        : new Uint8Array(data instanceof ArrayBuffer ? data : (data.buffer || data));
      this._sendFrame(typeof data === 'string' ? 0x1 : 0x2, bytes);
    },
    close: function (code, reason) {
      if (this.readyState === OCWebSocket.CLOSING || this.readyState === OCWebSocket.CLOSED) return;
      this.readyState = OCWebSocket.CLOSING;
      this._closeCode = typeof code === 'number' ? code : 1000;
      this._closeReason = String(reason || '');
      var payload = new Uint8Array(2 + this._closeReason.length);
      payload[0] = (this._closeCode >> 8) & 0xff;
      payload[1] = this._closeCode & 0xff;
      for (var i = 0; i < this._closeReason.length; i++) payload[2 + i] = this._closeReason.charCodeAt(i);
      this._sendFrame(0x8, payload);
      var self = this;
      setTimeout(function () { self._finishClose(this._closeCode || 1000, ''); }, 500);
    },
    addEventListener: function (type, fn) {
      if (this._eventListeners[type]) this._eventListeners[type].push(fn);
    },
    removeEventListener: function (type, fn) {
      var list = this._eventListeners[type] || [];
      var i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    get onopen() { return this._onopen || null; },
    set onopen(fn) { this._onopen = fn; },
    get onmessage() { return this._onmessage || null; },
    set onmessage(fn) { this._onmessage = fn; },
    get onclose() { return this._onclose || null; },
    set onclose(fn) { this._onclose = fn; },
    get onerror() { return this._onerror || null; },
    set onerror(fn) { this._onerror = fn; },

    /* ---------------- internals ---------------- */

    _emit: function (type, ev) {
      var handler = this['_on' + type];
      if (typeof handler === 'function') { try { handler.call(this, ev); } catch (e) { /* app error */ } }
      var list = (this._eventListeners[type] || []).slice();
      for (var i = 0; i < list.length; i++) {
        try { list[i].call(this, ev); } catch (e) { /* app error */ }
      }
    },
    _fail: function (message) {
      if (this.readyState === OCWebSocket.CLOSED) return;
      this.readyState = OCWebSocket.CLOSED;
      this._emit('error', { type: 'error', message: message, target: this });
      this._emit('close', { type: 'close', code: 1006, reason: message, wasClean: false, target: this });
      wsInstances.delete(this.id);
    },
    _finishClose: function (code, reason) {
      if (this.readyState === OCWebSocket.CLOSED) return;
      this.readyState = OCWebSocket.CLOSED;
      try { this._channel && this._channel.postMessage({ type: 'oc-ws-close', id: this.id }); } catch (e) { /* noop */ }
      try { this._channel && this._channel.close(); } catch (e) { /* noop */ }
      this._emit('close', { type: 'close', code: code, reason: reason, wasClean: true, target: this });
      wsInstances.delete(this.id);
    },
    _onChannelMessage: function (msg) {
      if (!msg || typeof msg !== 'object') return;
      var self = this;
      if (msg.type === 'oc-ws-open-failed') { this._fail(msg.error || 'connection failed'); return; }
      if (msg.type === 'oc-ws-end') { this._fail('connection closed'); return; }
      if (msg.type !== 'oc-ws-data') return;
      var bytes = new Uint8Array(msg.bytes);
      if (!this._handshakeDone) {
        this._headerBuf += latin1(bytes);
        var idx = this._headerBuf.indexOf('\r\n\r\n');
        if (idx < 0) return;
        var head = this._headerBuf.slice(0, idx);
        var rest = this._headerBuf.length - (idx + 4);
        var body = rest > 0 ? bytes.subarray(bytes.length - rest) : new Uint8Array(0);
        if (!/^HTTP\/1\.1 101/.test(head)) {
          var statusLine = head.split('\r\n')[0] || '';
          this._fail('WebSocket handshake failed: ' + statusLine);
          return;
        }
        var protoMatch = /Sec-WebSocket-Protocol:\s*(.+)/i.exec(head);
        if (protoMatch) this.protocol = protoMatch[1].trim();
        this._handshakeDone = true;
        this.readyState = OCWebSocket.OPEN;
        this._emit('open', { type: 'open', target: this });
        if (body.length > 0) this._consumeFrames(body);
        // flush anything the app sent while connecting
        for (var i = 0; i < this._pendingFrames.length; i++) this._rawSend(this._pendingFrames[i]);
        this._pendingFrames.length = 0;
        return;
      }
      this._consumeFrames(bytes);
    },
    _consumeFrames: function (bytes) {
      var self = this;
      var offset = { v: 0 };
      while (offset.v < bytes.length) {
        var frame = readFrame(bytes, offset);
        if (!frame) break; // incomplete — wait for more bytes (no partial buffering yet: browsers deliver whole TCP-ish chunks via our channel)
        var payload = frame.payload;
        switch (frame.opcode) {
          case 0x1: // text
            self._emit('message', { type: 'message', data: new TextDecoder().decode(payload), target: self });
            break;
          case 0x2: // binary
            self._emit('message', {
              type: 'message',
              data: self.binaryType === 'arraybuffer' ? payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.length) : payload,
              target: self,
            });
            break;
          case 0x8: { // close
            var code = payload.length >= 2 ? (payload[0] << 8) | payload[1] : 1005;
            var reason = payload.length > 2 ? latin1(payload.subarray(2)) : '';
            // echo close then finish
            self._sendFrame(0x8, payload.subarray(0, Math.min(2, payload.length)));
            self._finishClose(code, reason);
            return;
          }
          case 0x9: // ping → pong
            self._sendFrame(0xA, payload);
            break;
          case 0xA: // pong
            break;
          default:
            break;
        }
      }
    },
    _sendFrame: function (opcode, payload) {
      var frame = buildClientFrame(opcode, payload);
      if (this.readyState === OCWebSocket.CONNECTING) {
        this._pendingFrames.push(frame);
        return;
      }
      this._rawSend(frame);
    },
    _rawSend: function (frame) {
      try { this._channel.postMessage({ type: 'oc-ws-data', id: this.id, bytes: frame.buffer }, [frame.buffer]); }
      catch (e) { this._fail('send failed: ' + e.message); }
    },
  };

  window.WebSocket = OCWebSocket;

  /* ------------------------------------------ SW → shim ws control messages */

  // The SW relays runtime control messages (open-failed / end) via the page;
  // data flows on the private MessagePorts. Route controls to instances.
  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'oc-ws-open-failed' || d.type === 'oc-ws-end') {
      var inst = wsInstances.get(d.id);
      if (inst) {
        if (d.type === 'oc-ws-open-failed') inst._fail(d.error || 'connection failed');
        else inst._fail('connection closed');
      }
    }
  });

  /* ------------------------------------------------- RFC6455 frame helpers */

  function buildClientFrame(opcode, payload) {
    var maskKey = new Uint8Array(4);
    crypto.getRandomValues(maskKey);
    var len = payload.length;
    var headerLen = len < 126 ? 2 : len < 65536 ? 4 : 10;
    var frame = new Uint8Array(headerLen + 4 + len);
    frame[0] = 0x80 | opcode; // FIN + opcode
    if (len < 126) {
      frame[1] = 0x80 | len;
    } else if (len < 65536) {
      frame[1] = 0x80 | 126;
      frame[2] = (len >> 8) & 0xff;
      frame[3] = len & 0xff;
    } else {
      frame[1] = 0x80 | 127;
      var hi = Math.floor(len / 4294967296);
      frame[2] = (hi >> 24) & 0xff; frame[3] = (hi >> 16) & 0xff;
      frame[4] = (hi >> 8) & 0xff; frame[5] = hi & 0xff;
      frame[6] = (len >> 24) & 0xff; frame[7] = (len >> 16) & 0xff;
      frame[8] = (len >> 8) & 0xff; frame[9] = len & 0xff;
    }
    var maskOffset = headerLen;
    frame[maskOffset] = maskKey[0];
    frame[maskOffset + 1] = maskKey[1];
    frame[maskOffset + 2] = maskKey[2];
    frame[maskOffset + 3] = maskKey[3];
    for (var i = 0; i < len; i++) {
      frame[headerLen + 4 + i] = payload[i] ^ maskKey[i & 3];
    }
    return frame;
  }

  /** Read one (unmasked, server→client) frame at offset.v; returns null if incomplete. */
  function readFrame(bytes, offset) {
    if (bytes.length - offset.v < 2) return null;
    var b0 = bytes[offset.v];
    var b1 = bytes[offset.v + 1];
    var fin = (b0 & 0x80) !== 0;
    var opcode = b0 & 0x0f;
    var masked = (b1 & 0x80) !== 0;
    var len = b1 & 0x7f;
    var at = offset.v + 2;
    if (len === 126) {
      if (bytes.length - at < 2) return null;
      len = (bytes[at] << 8) | bytes[at + 1];
      at += 2;
    } else if (len === 127) {
      if (bytes.length - at < 8) return null;
      len = 0;
      for (var i = 0; i < 8; i++) len = len * 256 + bytes[at + i];
      at += 8;
    }
    var maskKey = null;
    if (masked) {
      if (bytes.length - at < 4) return null;
      maskKey = bytes.subarray(at, at + 4);
      at += 4;
    }
    if (bytes.length - at < len) return null;
    var payload = bytes.subarray(at, at + len);
    if (masked) {
      var un = new Uint8Array(len);
      for (var j = 0; j < len; j++) un[j] = payload[j] ^ maskKey[j & 3];
      payload = un;
    }
    offset.v = at + len;
    return { fin: fin, opcode: opcode, payload: payload };
  }

  function latin1(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }

  /* --------------------------------- Tier-2 scoped-URL remapping (fallback) */

  // Applied only when the SW's scope cannot cover root-absolute paths (the
  // CDN package-path scope). Detected via the page's OWN preview prefix: if
  // the initial URL carried /p/<sid>/<port>/, absolute paths must be mapped
  // back into that prefix to stay interceptable.
  if (syncBind) {
    var prefix = location.pathname.slice(0, location.pathname.indexOf('/p/') + 1)
      + 'p/' + (syncBind.sid ? syncBind.sid + '/' : '') + syncBind.port;
    var mapUrl = function (u) {
      if (typeof u !== 'string' || !u.startsWith('/')) return u;
      if (u.startsWith(prefix + '/')) return u;
      return prefix + u;
    };
    var realFetch = window.fetch;
    if (realFetch) {
      window.fetch = function (input, init) {
        try {
          if (typeof input === 'string') input = mapUrl(input);
          else if (input && input.url) {
            var mapped = new URL(mapUrl(input.url), location.origin);
            if (mapped.href !== input.url) input = new Request(mapped, input);
          }
        } catch (e) { /* fall through */ }
        return realFetch.call(window, input, init);
      };
    }
    var RealXHR = window.XMLHttpRequest;
    if (RealXHR) {
      var realOpen = RealXHR.prototype.open;
      RealXHR.prototype.open = function (method, url) {
        arguments[1] = mapUrl(String(url));
        return realOpen.apply(this, arguments);
      };
    }
    if (navigator.sendBeacon) {
      var realBeacon = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function (url, data) { return realBeacon(mapUrl(String(url)), data); };
    }
    var realPush = history.pushState.bind(history);
    var realReplace = history.replaceState.bind(history);
    var stripPrefix = function (p) {
      return p.startsWith(prefix) ? p.slice(prefix.length) || '/' : p;
    };
    history.pushState = function (st, title, url) {
      return realPush(st, title, url == null ? url : stripPrefix(String(url)));
    };
    history.replaceState = function (st, title, url) {
      return realReplace(st, title, url == null ? url : stripPrefix(String(url)));
    };
  }
})();
