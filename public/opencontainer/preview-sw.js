/**
 * OpenContainer preview Service Worker v2 — same-tab preview networking.
 *
 * WHAT CHANGED vs v1 (and why):
 *   v1 served previews under a fixed /opencontainer/p/<port>/ prefix inside
 *   this SW's scope. A SW can only intercept requests UNDER ITS SCOPE, so
 *   every guest asset with an absolute path (Vite's /@vite/client, Next's
 *   /_next/…) escaped to a 404. WebContainer avoids this by putting the port
 *   in a SUBDOMAIN (their own origin). On the embedder's origin we reproduce
 *   that semantics with per-CLIENT port binding (verified empirically,
 *   harness/e2e/preview/sw-experiments.mjs):
 *
 *     - the FIRST navigation carries the port:  <scope>/p/<sid>/<port>/<path>
 *     - the SW binds the resulting client id → {sid, port}
 *     - every later request from that client — any absolute path, fetch(),
 *       client-side-routed reloads — routes to that port with its RAW path
 *       (no URL rewriting of guest code, ever)
 *
 * TIER 1 (root scope, script served at /preview-sw.js or emitted by the
 * opencontainer vite plugin) gives full fidelity. TIER 2 (package-path scope
 * — the zero-integration CDN fallback) can never see root-absolute paths
 * (browser scope rule, verified E2), so it serves relative-path guests
 * best-effort: the injected preview shim rewrites fetch/XHR/pushState to
 * stay inside the scope.
 *
 * WebSockets cannot be intercepted by a Service Worker (platform limit) —
 * HMR sockets go through the injected shim's WebSocket override, which
 * tunnels RFC6455 frames over a MessagePort chain:
 *   shim ⇄ SW ⇄ bridge(runtime) ⇄ kernel virtual TCP ⇄ guest server.
 *
 * Bridge protocol (this SW's peers):
 *   attach:  {type:'oc-attach', sid} + [MessagePort] — the runtime registers
 *            its private pipe (Tier 1: the host page; Tier 2: the hidden
 *            bridge iframe relaying to its parent).
 *   fetch:   {type:'oc-fetch', port, id, bytes} + [MessagePort] → replies
 *            {type:'data', bytes} / {type:'end'} on that port.
 *   ws:      {type:'oc-ws-open', port, id, url, bytes} + [MessagePort] →
 *            byte pipe both ways; {type:'end'} closes.
 *   detach:  {type:'oc-detach', sid}
 *   legacy ownership scan (multi-tab, pre-sid URLs): {type:'oc-who-owns',
 *            port} → bridge answers {type:'oc-claim', sid, port}.
 */

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

/* ------------------------------------------------------------------ state */

/** Runtime session id → its MessagePort pipe (the "bridge"). */
var bridges = new Map(); // sid → MessagePort

/* A service worker is terminated by the browser whenever idle and restarted
 * on the next event — every in-memory table (bridges!) is lost on restart.
 * Announce our (re)start to every client so owning runtimes re-attach their
 * bridge pipes before the next preview fetch needs them. */
self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
  for (var i = 0; i < cs.length; i++) {
    try { cs[i].postMessage({ type: 'oc-sw-restarted' }); } catch (e) { /* gone */ }
  }
});
/** Client id → {sid, port} — per-iframe binding, the core routing table. */
var clientBinds = new Map();
/** Legacy ownership claims: port → [sids]. */
var pendingClaims = new Map();
/** setPreviewScript payload — injected after the built-in shim. */
var previewScript = null;
/** ws id → source client (for runtime→page relays). */
var wsTunnels = new Map();
var nextReqId = 1;

/* The built-in preview shim. The BUILD STEP inlines harness shim source
 * here (scripts/build-opencontainer.sh: __OC_PREVIEW_SHIM__ replacement). */
var OC_PREVIEW_SHIM = "/**\n * OpenContainer preview shim \u2014 injected FIRST into every guest HTML page\n * by the preview Service Worker (see preview-sw.js).\n *\n * Responsibilities (WebContainer parity):\n *  - WebSocket override: service workers cannot intercept WebSocket\n *    connections (platform limit), so HMR sockets are tunneled through a\n *    MessagePort chain (shim \u21c4 SW \u21c4 runtime bridge \u21c4 kernel virtual TCP)\n *    with a real RFC6455 client implementation: masked frames, ping/pong,\n *    close handshake, text + binary payloads. The guest server sees a\n *    genuine WebSocket upgrade on the wire.\n *  - preview-message parity: uncaught errors / unhandled rejections /\n *    console.error are forwarded to the host page as PREVIEW_* messages\n *    (the runtime re-emits them as 'preview-message').\n *  - LOCALSERVICE_RELOAD_WINDOW handshake: reloadPreview() (upstream\n *    contract) pings before reassigning iframe.src; we ack then reload.\n *  - Tier-2 (scoped SW \u2014 the zero-integration CDN fallback) remapping:\n *    fetch/XHR/sendBeacon/pushState with absolute paths are remapped into\n *    the SW scope so they stay interceptable. On Tier 1 (root scope) the\n *    SW routes absolute paths natively and NOTHING here rewrites URLs.\n *\n * The binding ({sid, port}) is resolved from the SW (oc-whoami) and cached;\n * WS frames sent before it resolves are buffered.\n */\n(function () {\n  if (window.__ocPreviewShim) return;\n  window.__ocPreviewShim = true;\n\n  var sw = navigator.serviceWorker;\n  var controller = sw && sw.controller;\n\n  /* ------------------------------------------------------- binding lookup */\n\n  var bindPromise = new Promise(function (resolve) {\n    if (!controller) return resolve(null);\n    var onMsg = function (ev) {\n      if (ev.data && ev.data.type === 'oc-you-are') {\n        window.removeEventListener('message', onMsg);\n        resolve(ev.data.bind || null);\n      }\n    };\n    window.addEventListener('message', onMsg);\n    try { controller.postMessage({ type: 'oc-whoami' }); } catch (e) { resolve(null); }\n    setTimeout(function () { window.removeEventListener('message', onMsg); resolve(null); }, 3000);\n  });\n  // The page's own URL is a synchronous fallback for the FIRST navigation\n  // (before client-side routing rewrites it).\n  var m = /^\\/p\\/([a-z][a-z0-9]{3,11})\\/(\\d+)(\\/|$)/.exec(location.pathname)\n    || /^\\/p\\/(\\d+)(\\/|$)/.exec(location.pathname);\n  var syncBind = m ? (m.length > 3 ? { sid: m[1], port: Number(m[2]) } : { sid: null, port: Number(m[1]) }) : null;\n  if (syncBind) {\n    bindPromise = Promise.resolve(syncBind);\n  }\n\n  /* ------------------------------------------------- preview-message parity */\n\n  function postPreview(msg) {\n    try { msg.type = msg.type || 'PREVIEW_ERROR'; parent.postMessage(msg, '*'); } catch (e) { /* noop */ }\n  }\n  window.addEventListener('error', function (ev) {\n    postPreview({\n      type: 'PREVIEW_ERROR', kind: 'uncaughtException',\n      message: String(ev.message), filename: ev.filename, lineno: ev.lineno, colno: ev.colno,\n    });\n  });\n  window.addEventListener('unhandledrejection', function (ev) {\n    var reason = ev.reason;\n    postPreview({\n      type: 'PREVIEW_ERROR', kind: 'unhandledRejection',\n      message: String(reason && reason.message || reason),\n    });\n  });\n  var realConsoleError = console.error;\n  console.error = function () {\n    try {\n      postPreview({\n        type: 'PREVIEW_ERROR', kind: 'consoleError',\n        message: Array.prototype.map.call(arguments, String).join(' '),\n      });\n    } catch (e) { /* noop */ }\n    return realConsoleError.apply(console, arguments);\n  };\n\n  /* ------------------------------------------------------ reload handshake */\n\n  window.addEventListener('message', function (ev) {\n    var d = ev.data;\n    if (!d || typeof d !== 'object') return;\n    if (d.type === 'LOCALSERVICE_RELOAD_WINDOW') {\n      try { ev.ports[0] && ev.ports[0].postMessage({ type: 'LOCALSERVICE_WINDOW_RELOADED' }); } catch (e) { /* noop */ }\n      setTimeout(function () { location.reload(); }, 0);\n    }\n  });\n\n  /* ---------------------------------------------------- WebSocket override */\n\n  var RealWebSocket = window.WebSocket;\n  var wsInstances = new Map(); // id \u2192 instance\n  var nextWsId = 1;\n\n  function OCWebSocket(url, protocols) {\n    if (!(this instanceof OCWebSocket)) return new OCWebSocket(url, protocols);\n    var self = this;\n    this.id = nextWsId++;\n    this.url = String(url);\n    this.protocol = '';\n    this.extensions = '';\n    this.binaryType = 'blob';\n    this.readyState = OCWebSocket.CONNECTING;\n    this._buf = [];\n    this._channel = null;\n    this._pendingFrames = [];\n    this._headerBuf = '';\n    this._handshakeDone = false;\n    this._closeCode = null;\n    this._closeReason = '';\n    this._eventListeners = { open: [], message: [], close: [], error: [] };\n\n    var sub = '';\n    if (protocols) {\n      var list = Array.isArray(protocols) ? protocols : [protocols];\n      sub = 'Sec-WebSocket-Protocol: ' + list.join(', ') + '\\r\\n';\n    }\n    var key = btoa(String.fromCharCode.apply(null,\n      new Uint8Array(Array.from({ length: 16 }, function () { return Math.floor(Math.random() * 256); }))));\n    var parsed = new URL(this.url);\n    var pathWithQuery = parsed.pathname + (parsed.search || '');\n    var req =\n      'GET ' + pathWithQuery + ' HTTP/1.1\\r\\n' +\n      'Host: ' + parsed.host + '\\r\\n' +\n      'Upgrade: websocket\\r\\n' +\n      'Connection: Upgrade\\r\\n' +\n      'Sec-WebSocket-Key: ' + key + '\\r\\n' +\n      sub +\n      'Sec-WebSocket-Version: 13\\r\\n\\r\\n';\n\n    wsInstances.set(this.id, this);\n    bindPromise.then(function (bind) {\n      if (!bind) {\n        self._fail('OpenContainer: preview WebSocket has no port binding');\n        return;\n      }\n      var channel = new MessageChannel();\n      self._channel = channel.port1;\n      channel.port1.onmessage = function (ev) { self._onChannelMessage(ev.data); };\n      channel.port1.start ? channel.port1.start() : void channel.port1;\n      var open = {\n        type: 'oc-ws-open',\n        id: self.id,\n        url: self.url,\n        bind: bind,\n        bytes: new TextEncoder().encode(req),\n      };\n      try {\n        controller.postMessage(open, [channel.port2]);\n      } catch (e) {\n        self._fail('OpenContainer: preview WebSocket tunnel unavailable: ' + e.message);\n      }\n    });\n  }\n  OCWebSocket.CONNECTING = 0;\n  OCWebSocket.OPEN = 1;\n  OCWebSocket.CLOSING = 2;\n  OCWebSocket.CLOSED = 3;\n\n  OCWebSocket.prototype = {\n    constructor: OCWebSocket,\n    send: function (data) {\n      if (this.readyState !== OCWebSocket.OPEN) throw new Error('InvalidStateError: WebSocket is not open');\n      var bytes = typeof data === 'string'\n        ? new TextEncoder().encode(data)\n        : new Uint8Array(data instanceof ArrayBuffer ? data : (data.buffer || data));\n      this._sendFrame(typeof data === 'string' ? 0x1 : 0x2, bytes);\n    },\n    close: function (code, reason) {\n      if (this.readyState === OCWebSocket.CLOSING || this.readyState === OCWebSocket.CLOSED) return;\n      this.readyState = OCWebSocket.CLOSING;\n      this._closeCode = typeof code === 'number' ? code : 1000;\n      this._closeReason = String(reason || '');\n      var payload = new Uint8Array(2 + this._closeReason.length);\n      payload[0] = (this._closeCode >> 8) & 0xff;\n      payload[1] = this._closeCode & 0xff;\n      for (var i = 0; i < this._closeReason.length; i++) payload[2 + i] = this._closeReason.charCodeAt(i);\n      this._sendFrame(0x8, payload);\n      var self = this;\n      setTimeout(function () { self._finishClose(this._closeCode || 1000, ''); }, 500);\n    },\n    addEventListener: function (type, fn) {\n      if (this._eventListeners[type]) this._eventListeners[type].push(fn);\n    },\n    removeEventListener: function (type, fn) {\n      var list = this._eventListeners[type] || [];\n      var i = list.indexOf(fn);\n      if (i >= 0) list.splice(i, 1);\n    },\n    get onopen() { return this._onopen || null; },\n    set onopen(fn) { this._onopen = fn; },\n    get onmessage() { return this._onmessage || null; },\n    set onmessage(fn) { this._onmessage = fn; },\n    get onclose() { return this._onclose || null; },\n    set onclose(fn) { this._onclose = fn; },\n    get onerror() { return this._onerror || null; },\n    set onerror(fn) { this._onerror = fn; },\n\n    /* ---------------- internals ---------------- */\n\n    _emit: function (type, ev) {\n      var handler = this['_on' + type];\n      if (typeof handler === 'function') { try { handler.call(this, ev); } catch (e) { /* app error */ } }\n      var list = (this._eventListeners[type] || []).slice();\n      for (var i = 0; i < list.length; i++) {\n        try { list[i].call(this, ev); } catch (e) { /* app error */ }\n      }\n    },\n    _fail: function (message) {\n      if (this.readyState === OCWebSocket.CLOSED) return;\n      this.readyState = OCWebSocket.CLOSED;\n      this._emit('error', { type: 'error', message: message, target: this });\n      this._emit('close', { type: 'close', code: 1006, reason: message, wasClean: false, target: this });\n      wsInstances.delete(this.id);\n    },\n    _finishClose: function (code, reason) {\n      if (this.readyState === OCWebSocket.CLOSED) return;\n      this.readyState = OCWebSocket.CLOSED;\n      try { this._channel && this._channel.postMessage({ type: 'oc-ws-close', id: this.id }); } catch (e) { /* noop */ }\n      try { this._channel && this._channel.close(); } catch (e) { /* noop */ }\n      this._emit('close', { type: 'close', code: code, reason: reason, wasClean: true, target: this });\n      wsInstances.delete(this.id);\n    },\n    _onChannelMessage: function (msg) {\n      if (!msg || typeof msg !== 'object') return;\n      var self = this;\n      if (msg.type === 'oc-ws-open-failed') { this._fail(msg.error || 'connection failed'); return; }\n      if (msg.type === 'oc-ws-end') { this._fail('connection closed'); return; }\n      if (msg.type !== 'oc-ws-data') return;\n      var bytes = new Uint8Array(msg.bytes);\n      if (!this._handshakeDone) {\n        this._headerBuf += latin1(bytes);\n        var idx = this._headerBuf.indexOf('\\r\\n\\r\\n');\n        if (idx < 0) return;\n        var head = this._headerBuf.slice(0, idx);\n        var rest = this._headerBuf.length - (idx + 4);\n        var body = rest > 0 ? bytes.subarray(bytes.length - rest) : new Uint8Array(0);\n        if (!/^HTTP\\/1\\.1 101/.test(head)) {\n          var statusLine = head.split('\\r\\n')[0] || '';\n          this._fail('WebSocket handshake failed: ' + statusLine);\n          return;\n        }\n        var protoMatch = /Sec-WebSocket-Protocol:\\s*(.+)/i.exec(head);\n        if (protoMatch) this.protocol = protoMatch[1].trim();\n        this._handshakeDone = true;\n        this.readyState = OCWebSocket.OPEN;\n        this._emit('open', { type: 'open', target: this });\n        if (body.length > 0) this._consumeFrames(body);\n        // flush anything the app sent while connecting\n        for (var i = 0; i < this._pendingFrames.length; i++) this._rawSend(this._pendingFrames[i]);\n        this._pendingFrames.length = 0;\n        return;\n      }\n      this._consumeFrames(bytes);\n    },\n    _consumeFrames: function (bytes) {\n      var self = this;\n      var offset = { v: 0 };\n      while (offset.v < bytes.length) {\n        var frame = readFrame(bytes, offset);\n        if (!frame) break; // incomplete \u2014 wait for more bytes (no partial buffering yet: browsers deliver whole TCP-ish chunks via our channel)\n        var payload = frame.payload;\n        switch (frame.opcode) {\n          case 0x1: // text\n            self._emit('message', { type: 'message', data: new TextDecoder().decode(payload), target: self });\n            break;\n          case 0x2: // binary\n            self._emit('message', {\n              type: 'message',\n              data: self.binaryType === 'arraybuffer' ? payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.length) : payload,\n              target: self,\n            });\n            break;\n          case 0x8: { // close\n            var code = payload.length >= 2 ? (payload[0] << 8) | payload[1] : 1005;\n            var reason = payload.length > 2 ? latin1(payload.subarray(2)) : '';\n            // echo close then finish\n            self._sendFrame(0x8, payload.subarray(0, Math.min(2, payload.length)));\n            self._finishClose(code, reason);\n            return;\n          }\n          case 0x9: // ping \u2192 pong\n            self._sendFrame(0xA, payload);\n            break;\n          case 0xA: // pong\n            break;\n          default:\n            break;\n        }\n      }\n    },\n    _sendFrame: function (opcode, payload) {\n      var frame = buildClientFrame(opcode, payload);\n      if (this.readyState === OCWebSocket.CONNECTING) {\n        this._pendingFrames.push(frame);\n        return;\n      }\n      this._rawSend(frame);\n    },\n    _rawSend: function (frame) {\n      try { this._channel.postMessage({ type: 'oc-ws-data', id: this.id, bytes: frame.buffer }, [frame.buffer]); }\n      catch (e) { this._fail('send failed: ' + e.message); }\n    },\n  };\n\n  window.WebSocket = OCWebSocket;\n\n  /* ------------------------------------------ SW \u2192 shim ws control messages */\n\n  // The SW relays runtime control messages (open-failed / end) via the page;\n  // data flows on the private MessagePorts. Route controls to instances.\n  window.addEventListener('message', function (ev) {\n    var d = ev.data;\n    if (!d || typeof d !== 'object') return;\n    if (d.type === 'oc-ws-open-failed' || d.type === 'oc-ws-end') {\n      var inst = wsInstances.get(d.id);\n      if (inst) {\n        if (d.type === 'oc-ws-open-failed') inst._fail(d.error || 'connection failed');\n        else inst._fail('connection closed');\n      }\n    }\n  });\n\n  /* ------------------------------------------------- RFC6455 frame helpers */\n\n  function buildClientFrame(opcode, payload) {\n    var maskKey = new Uint8Array(4);\n    crypto.getRandomValues(maskKey);\n    var len = payload.length;\n    var headerLen = len < 126 ? 2 : len < 65536 ? 4 : 10;\n    var frame = new Uint8Array(headerLen + 4 + len);\n    frame[0] = 0x80 | opcode; // FIN + opcode\n    if (len < 126) {\n      frame[1] = 0x80 | len;\n    } else if (len < 65536) {\n      frame[1] = 0x80 | 126;\n      frame[2] = (len >> 8) & 0xff;\n      frame[3] = len & 0xff;\n    } else {\n      frame[1] = 0x80 | 127;\n      var hi = Math.floor(len / 4294967296);\n      frame[2] = (hi >> 24) & 0xff; frame[3] = (hi >> 16) & 0xff;\n      frame[4] = (hi >> 8) & 0xff; frame[5] = hi & 0xff;\n      frame[6] = (len >> 24) & 0xff; frame[7] = (len >> 16) & 0xff;\n      frame[8] = (len >> 8) & 0xff; frame[9] = len & 0xff;\n    }\n    var maskOffset = headerLen;\n    frame[maskOffset] = maskKey[0];\n    frame[maskOffset + 1] = maskKey[1];\n    frame[maskOffset + 2] = maskKey[2];\n    frame[maskOffset + 3] = maskKey[3];\n    for (var i = 0; i < len; i++) {\n      frame[headerLen + 4 + i] = payload[i] ^ maskKey[i & 3];\n    }\n    return frame;\n  }\n\n  /** Read one (unmasked, server\u2192client) frame at offset.v; returns null if incomplete. */\n  function readFrame(bytes, offset) {\n    if (bytes.length - offset.v < 2) return null;\n    var b0 = bytes[offset.v];\n    var b1 = bytes[offset.v + 1];\n    var fin = (b0 & 0x80) !== 0;\n    var opcode = b0 & 0x0f;\n    var masked = (b1 & 0x80) !== 0;\n    var len = b1 & 0x7f;\n    var at = offset.v + 2;\n    if (len === 126) {\n      if (bytes.length - at < 2) return null;\n      len = (bytes[at] << 8) | bytes[at + 1];\n      at += 2;\n    } else if (len === 127) {\n      if (bytes.length - at < 8) return null;\n      len = 0;\n      for (var i = 0; i < 8; i++) len = len * 256 + bytes[at + i];\n      at += 8;\n    }\n    var maskKey = null;\n    if (masked) {\n      if (bytes.length - at < 4) return null;\n      maskKey = bytes.subarray(at, at + 4);\n      at += 4;\n    }\n    if (bytes.length - at < len) return null;\n    var payload = bytes.subarray(at, at + len);\n    if (masked) {\n      var un = new Uint8Array(len);\n      for (var j = 0; j < len; j++) un[j] = payload[j] ^ maskKey[j & 3];\n      payload = un;\n    }\n    offset.v = at + len;\n    return { fin: fin, opcode: opcode, payload: payload };\n  }\n\n  function latin1(bytes) {\n    var out = '';\n    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);\n    return out;\n  }\n\n  /* --------------------------------- Tier-2 scoped-URL remapping (fallback) */\n\n  // Applied only when the SW's scope cannot cover root-absolute paths (the\n  // CDN package-path scope). Detected via the page's OWN preview prefix: if\n  // the initial URL carried /p/<sid>/<port>/, absolute paths must be mapped\n  // back into that prefix to stay interceptable.\n  if (syncBind) {\n    var prefix = location.pathname.slice(0, location.pathname.indexOf('/p/') + 1)\n      + 'p/' + (syncBind.sid ? syncBind.sid + '/' : '') + syncBind.port;\n    var mapUrl = function (u) {\n      if (typeof u !== 'string' || !u.startsWith('/')) return u;\n      if (u.startsWith(prefix + '/')) return u;\n      return prefix + u;\n    };\n    var realFetch = window.fetch;\n    if (realFetch) {\n      window.fetch = function (input, init) {\n        try {\n          if (typeof input === 'string') input = mapUrl(input);\n          else if (input && input.url) {\n            var mapped = new URL(mapUrl(input.url), location.origin);\n            if (mapped.href !== input.url) input = new Request(mapped, input);\n          }\n        } catch (e) { /* fall through */ }\n        return realFetch.call(window, input, init);\n      };\n    }\n    var RealXHR = window.XMLHttpRequest;\n    if (RealXHR) {\n      var realOpen = RealXHR.prototype.open;\n      RealXHR.prototype.open = function (method, url) {\n        arguments[1] = mapUrl(String(url));\n        return realOpen.apply(this, arguments);\n      };\n    }\n    if (navigator.sendBeacon) {\n      var realBeacon = navigator.sendBeacon.bind(navigator);\n      navigator.sendBeacon = function (url, data) { return realBeacon(mapUrl(String(url)), data); };\n    }\n    var realPush = history.pushState.bind(history);\n    var realReplace = history.replaceState.bind(history);\n    var stripPrefix = function (p) {\n      return p.startsWith(prefix) ? p.slice(prefix.length) || '/' : p;\n    };\n    history.pushState = function (st, title, url) {\n      return realPush(st, title, url == null ? url : stripPrefix(String(url)));\n    };\n    history.replaceState = function (st, title, url) {\n      return realReplace(st, title, url == null ? url : stripPrefix(String(url)));\n    };\n  }\n})();\n";

/* ------------------------------------------------------- SW ← peer messages */

self.addEventListener('message', function (event) {
  var m = event.data;
  if (!m || typeof m !== 'object') return;
  var port = event.ports[0] || null;
  switch (m.type) {
    case 'oc-attach':
      if (port) {
        bridges.set(m.sid, port);
        port.onmessage = function (ev) { handleBridgeMessage(m.sid, ev.data, ev.ports); };
      }
      return;
    case 'oc-detach':
      bridges.delete(m.sid);
      return;
    case 'oc-preview-script':
      previewScript = typeof m.code === 'string' ? m.code : null;
      return;
    case 'oc-claim':
      if (typeof m.port === 'number' && typeof m.sid === 'string') {
        var list = pendingClaims.get(m.port);
        if (list) list.push(m.sid);
      }
      return;
    case 'oc-ws-open':
      openWsFromClient(event, m, port);
      return;
    case 'oc-whoami':
      try {
        event.source.postMessage({
          type: 'oc-you-are',
          bind: clientBinds.get(event.source.id) || null,
        });
      } catch (e) { /* client gone */ }
      return;
    default:
      return;
  }
});

/** Messages arriving FROM a bridge pipe (runtime side). */
function handleBridgeMessage(sid, m, ports) {
  if (!m || typeof m !== 'object') return;
  void sid;
  if (m.type === 'oc-preview-script') {
    previewScript = typeof m.code === 'string' ? m.code : null;
    return;
  }
  // ws data pushed from the runtime toward a preview page (relay)
  if (m.type === 'oc-ws-data' || m.type === 'oc-ws-end' || m.type === 'oc-ws-open-failed') {
    var t = wsTunnels.get(m.id);
    if (t) {
      try { t.client.postMessage(m); } catch (e) { /* client gone */ }
      if (m.type === 'oc-ws-end' || m.type === 'oc-ws-open-failed') wsTunnels.delete(m.id);
    }
  }
  void ports;
}

/* --------------------------------------------------------------- URL space */

var P_RE_LEGACY = /^\/p\/(\d+)(\/.*)?$/; // <scope>/p/<port>/<path>
var P_RE = /^\/p\/([a-z][a-z0-9]{3,11})\/(\d+)(\/.*)?$/; // <scope>/p/<sid>/<port>/<path>

/** Parse a preview URL (pathname → {sid, port, guestPath} or null). */
function parsePreviewPath(pathname) {
  var base = '';
  try { base = new URL(self.registration.scope).pathname.replace(/\/+$/, ''); } catch (e) { /* noop */ }
  var rel = base && pathname.indexOf(base) === 0 ? pathname.slice(base.length) : pathname;
  var m = P_RE.exec(rel);
  if (m) return { sid: m[1], port: Number(m[2]), guestPath: m[3] || '/' };
  var legacy = P_RE_LEGACY.exec(rel);
  if (legacy) return { sid: null, port: Number(legacy[1]), guestPath: legacy[2] || '/' };
  return null;
}

function bindFromUrl(url) {
  if (!url) return null;
  try { return parsePreviewPath(new URL(url).pathname); } catch (e) { return null; }
}

/* ------------------------------------------------------------ fetch router */

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  var parsed = parsePreviewPath(url.pathname);

  if (event.request.mode === 'navigate') {
    var bind = null;
    if (parsed) {
      // Explicit port in the URL — bind the NEW client this navigation
      // creates (and the old one — it initiated this navigation).
      bind = parsed;
      if (event.resultingClientId) clientBinds.set(event.resultingClientId, bind);
      if (event.clientId && !clientBinds.has(event.clientId)) clientBinds.set(event.clientId, bind);
    } else if (event.clientId && clientBinds.has(event.clientId)) {
      // Reload / deep link initiated by an already-bound preview document.
      bind = clientBinds.get(event.clientId);
    } else {
      return; // unbound navigation — not ours
    }
    var navGuestPath = parsed ? parsed.guestPath : (url.pathname + url.search);
    event.respondWith(proxyHttp(event.request, bind, navGuestPath));
    return;
  }

  // Subresource / fetch() / XHR from a bound client. The guest path:
  // - a request that CARRIES the /p/<sid>/<port>/ prefix (a host-page fetch
  //   or an iframe asset URL): strip the prefix — the guest server must see
  //   /src/main.js, not /p/<sid>/<port>/src/main.js (vite's html fallback
  //   answered index.html for every prefixed asset path).
  // - a bound client's own absolute path (/@vite/client): the raw path —
  //   per-client routing keeps it on the right port (E3 semantics).
  var byClient = event.clientId ? clientBinds.get(event.clientId) : null;
  var bind2 = byClient || bindFromUrl(event.referrer) || bindFromUrl(event.request.url);
  if (!bind2) return; // not a preview request — default behavior
  var parsedReq = parsePreviewPath(url.pathname);
  var guestPath = parsedReq ? parsedReq.guestPath : (url.pathname + url.search);
  event.respondWith(proxyHttp(event.request, bind2, guestPath));
});

/* ---------------------------------------------------------- HTTP proxying */

function proxyHttp(request, bind, guestPath) {
  return resolveSid(bind).then(function (sid) {
    if (sid === null) {
      return new Response(
        'OpenContainer: preview server is not running (no runtime bridge). ' +
        'Reload the host page and start the dev server again.',
        { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    // ---- build the raw HTTP/1.1 request bytes (what a TCP peer sends) ----
    var headers = [];
    var entries = request.headers.entries();
    for (var it = entries.next(); !it.done; it = entries.next()) {
      var kv = it.value;
      if (kv[0] === 'host' || kv[0] === 'content-length' || kv[0] === 'connection') continue;
      headers.push(kv);
    }
    var bodyBytes = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      bodyBytes = request.arrayBuffer().catch(function () { return new ArrayBuffer(0); });
    }
    return Promise.resolve(bodyBytes).then(function (body) {
      var bodyU8 = body ? new Uint8Array(body) : null;
      var head = request.method + ' ' + guestPath + ' HTTP/1.1\r\n';
      head += 'Host: localhost:' + bind.port + '\r\n';
      for (var i = 0; i < headers.length; i++) head += headers[i][0] + ': ' + headers[i][1] + '\r\n';
      if (bodyU8) head += 'content-length: ' + bodyU8.byteLength + '\r\n';
      head += 'connection: close\r\n\r\n';
      var headBytes = new TextEncoder().encode(head);
      var reqBytes = bodyU8 ? concat(headBytes, bodyU8) : headBytes;

      // ---- pipe through the owning runtime's bridge ----------------------
      var channel = new MessageChannel();
      var reply = channel.port1;
      var bridge = bridges.get(sid);
      if (!bridge) {
        return new Response('OpenContainer: runtime bridge detached', {
          status: 503, headers: { 'content-type': 'text/plain' },
        });
      }
      try {
        bridge.postMessage(
          { type: 'oc-fetch', id: nextReqId++, port: bind.port, bytes: reqBytes },
          [channel.port2]);
      } catch (e) {
        bridges.delete(sid);
        return new Response('OpenContainer: runtime bridge went away', {
          status: 503, headers: { 'content-type': 'text/plain' },
        });
      }

      return new Promise(function (resolve) {
        var headerText = '';
        var headerDone = false;
        var resolved = false;
        var settling = false;
        var bodyController = null;
        var chunks = [];
        var closed = false;
        var guardTimer = setTimeout(function () {
          if (!resolved) {
            resolve(new Response('OpenContainer: preview bridge timeout', { status: 502 }));
            try { reply.close(); } catch (e2) { /* noop */ }
          }
        }, 60000);

        reply.onmessage = function (ev) {
          var msg = ev.data;
          if (msg.type === 'data') {
            var bytes = new Uint8Array(msg.bytes);
            if (!headerDone) {
              headerText += latin1(bytes);
              var idx = headerText.indexOf('\r\n\r\n');
              if (idx >= 0) {
                var headPart = headerText.slice(0, idx);
                var bodyLen = headerText.length - (idx + 4);
                var bodyInChunk = bodyLen > 0 ? bytes.subarray(bytes.length - bodyLen) : new Uint8Array(0);
                finishHeadersNow(headPart, bodyInChunk);
                return;
              }
              if (headerText.length > 65536) {
                clearTimeout(guardTimer);
                resolve(new Response('OpenContainer: response header too large', { status: 502 }));
              }
            } else if (bodyController) {
              bodyController.enqueue(bytes);
            } else {
              chunks.push(bytes);
            }
          } else if (msg.type === 'end') {
            closed = true;
            if (bodyController) { try { bodyController.close(); } catch (e3) { /* noop */ } }
            try { reply.close(); } catch (e4) { /* noop */ }
            clearTimeout(guardTimer);
            if (!resolved && !settling) {
              resolve(new Response('OpenContainer: upstream closed before responding', { status: 502 }));
            }
          }
        };

        function finishHeadersNow(headPart, bodyInChunk) {
          headerDone = true;
          clearTimeout(guardTimer);
          var parsedHead = parseResponseHead(headPart);
          var responseHeaders = new Headers();
          for (var i = 0; i < parsedHead.headerLines.length; i++) {
            var line = parsedHead.headerLines[i];
            var colon = line.indexOf(':');
            if (colon > 0) {
              try { responseHeaders.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim()); }
              catch (e5) { /* skip malformed */ }
            }
          }
          var isChunked = (responseHeaders.get('transfer-encoding') || '').indexOf('chunked') >= 0;
          var isHtml = (responseHeaders.get('content-type') || '').indexOf('text/html') >= 0;
          // setPreviewScript + the built-in shim inject into HTML responses:
          // buffer the body, inject FIRST in <head>, drop content-length.
          if (isHtml && (previewScript || OC_PREVIEW_SHIM)) {
            // Async body collection: mark settling NOW so a same-tick 'end'
            // (server closed after the response — normal with connection:
            // close) cannot win the race with 502 "upstream closed". The
            // 'end' message still closes the body stream (collectBody then
            // resolves); it just must not resolve the fetch itself.
            settling = true;
            responseHeaders.delete('content-length');
            collectBody(bodyStreamFactory(bodyInChunk)).then(function (bytes) {
              var text = new TextDecoder().decode(bytes);
              var tag = '';
              if (OC_PREVIEW_SHIM) tag += '<script>' + OC_PREVIEW_SHIM + '</script>';
              if (previewScript) tag += '<script>' + previewScript + '</script>';
              // Inject at the FIRST valid script position. Prepending blindly
              // (the old fallback) puts the script BEFORE <!doctype html> —
              // the doctype is then dropped (quirks mode) and Chrome refuses
              // to execute the leading script at all (verified against vite's
              // minimal index.html, which has <html><body> but NO <head>).
              var anchor = /<head[^>]*>/i.exec(text) || /<html[^>]*>/i.exec(text)
                || /<!doctype[^>]*>/i.exec(text);
              text = anchor
                ? text.slice(0, anchor.index + anchor[0].length) + tag + text.slice(anchor.index + anchor[0].length)
                : tag + text;
              resolve(new Response(request.method === 'HEAD' ? null : text, {
                status: parsedHead.status, statusText: parsedHead.statusText || undefined,
                headers: responseHeaders,
              }));
              resolved = true;
              try { reply.close(); } catch (e6) { /* noop */ }
            }).catch(function () {
              if (!resolved) {
                resolve(new Response('OpenContainer: preview injection failed', { status: 502 }));
              }
            });
            return;
          }
          var bodyStream = new ReadableStream({
            start: function (controller) {
              bodyController = controller;
              if (bodyInChunk && bodyInChunk.length > 0) controller.enqueue(bodyInChunk);
              for (var i = 0; i < chunks.length; i++) controller.enqueue(chunks[i]);
              chunks.length = 0;
              if (closed) controller.close();
            },
          });
          resolved = true;
          resolve(new Response(
            request.method === 'HEAD' ? null : dechunk(bodyStream, isChunked),
            { status: parsedHead.status, statusText: parsedHead.statusText || undefined, headers: responseHeaders }));
        }

        function bodyStreamFactory(bodyInChunk) {
          return new ReadableStream({
            start: function (controller) {
              bodyController = controller;
              if (bodyInChunk && bodyInChunk.length > 0) controller.enqueue(bodyInChunk);
              for (var i = 0; i < chunks.length; i++) controller.enqueue(chunks[i]);
              chunks.length = 0;
              if (closed) controller.close();
            },
          });
        }
      });
    });
  });
}

/** Resolve the owning runtime: sids route directly; legacy URLs (no sid)
 *  use the ownership scan — multi-tab safe, SW-restart safe. */
function resolveSid(bind) {
  if (bind.sid) return Promise.resolve(bind.sid);
  if (bridges.size === 0) return Promise.resolve(null);
  if (bridges.size === 1) return Promise.resolve(bridges.keys().next().value);
  // Pull protocol: ask every bridge who owns this port; first claim wins.
  var claims = [];
  pendingClaims.set(bind.port, claims);
  bridges.forEach(function (p) {
    try { p.postMessage({ type: 'oc-who-owns', port: bind.port }); } catch (e) { /* gone */ }
  });
  return new Promise(function (resolve) {
    setTimeout(function () {
      pendingClaims.delete(bind.port);
      var claimed = null;
      for (var i = 0; i < claims.length; i++) {
        if (bridges.has(claims[i])) { claimed = claims[i]; break; }
      }
      resolve(claimed || bridges.keys().next().value);
    }, 150);
  });
}

/* ------------------------------------------------------ WebSocket tunneling */

function openWsFromClient(event, m, port) {
  var clientId = event.source && event.source.id;
  var bind = clientBinds.get(clientId) || m.bind || null;
  if (!bind || !port) {
    try {
      event.source.postMessage({ type: 'oc-ws-open-failed', id: m.id, error: 'no preview binding' });
    } catch (e) { /* noop */ }
    return;
  }
  resolveSid(bind).then(function (sid) {
    var bridge = sid ? bridges.get(sid) : null;
    if (!bridge) {
      try {
        event.source.postMessage({ type: 'oc-ws-open-failed', id: m.id, error: 'no runtime bridge' });
      } catch (e) { /* noop */ }
      return;
    }
    wsTunnels.set(m.id, { client: event.source });
    // The shim's MessagePort is TRANSFERRED to the runtime — data flows
    // shim ⇄ runtime directly on it (the SW only relays control messages,
    // via handleBridgeMessage → wsTunnels).
    bridge.postMessage(
      { type: 'oc-ws-open', id: m.id, port: bind.port, url: m.url, bytes: m.bytes || null },
      [port]);
  });
}

/* ------------------------------------------------------------------ helpers */

function parseResponseHead(text) {
  var lines = text.split('\r\n');
  var statusLine = lines.shift() || '';
  var m = /^HTTP\/(\d)\.(\d)\s+(\d{3})(?:\s(.*))?$/.exec(statusLine);
  return {
    status: m ? Number(m[3]) : 502,
    statusText: m ? (m[4] || '') : '',
    headerLines: lines,
  };
}

function dechunk(stream, enabled) {
  if (!enabled) return stream;
  var buffer = new Uint8Array(0);
  var done = false;
  return new ReadableStream({
    pull: function (controller) {
      var self2 = this;
      return pump();
      function pump() {
        var text = '';
        for (var i = 0; i < buffer.length; i++) text += String.fromCharCode(buffer[i]);
        var crlf = text.indexOf('\r\n');
        if (crlf >= 0) {
          var sizeStr = text.slice(0, crlf).split(';')[0].trim();
          var size = parseInt(sizeStr, 16);
          if (!Number.isFinite(size)) { controller.close(); done = true; return; }
          var chunkStart = crlf + 2;
          if (size === 0) { controller.close(); done = true; return; }
          if (buffer.length >= chunkStart + size + 2) {
            controller.enqueue(buffer.subarray(chunkStart, chunkStart + size));
            buffer = buffer.subarray(chunkStart + size + 2);
            return;
          }
        }
        if (done) return;
        var reader = stream.getReader();
        return reader.read().then(function (r) {
          if (r.value) {
            var merged = new Uint8Array(buffer.length + r.value.length);
            merged.set(buffer);
            merged.set(r.value, buffer.length);
            buffer = merged;
          }
          reader.releaseLock();
          if (r.done && buffer.length === 0) { controller.close(); done = true; return; }
          return pump();
        }, function () { reader.releaseLock(); });
      }
    },
  });
}

function latin1(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function concat(a, b) {
  var out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function collectBody(stream) {
  return new Response(stream).arrayBuffer().then(function (buf) { return new Uint8Array(buf); });
}
