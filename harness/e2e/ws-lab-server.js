/**
 * E2E guest: WebSocket lifecycle lab server.
 *
 * A real node http.Server with an 'upgrade' handler speaking RFC 6455
 * directly on the upgraded socket (no npm deps) — the same shape Vite's
 * ws-transport uses (ws library on top of http.Server upgrade).
 *
 * Serves:
 *   GET /            → the browser test page (runs the client-side cycles
 *                      against the preview shim's WebSocket override)
 *   GET /health      → plain HTTP regression endpoint
 *   upgrade /ws      → echo WebSocket (text frames echoed as "echo:<text>")
 *
 * Every connection lifecycle event is logged to stdout with a connection
 * id so the driver can correlate guest-side and client-side timelines:
 *   [srv] listen :PORT
 *   [conn N] open / msg / close(code) / end / finish / close / error
 *   [http] req <url> → <code>
 */
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.WSLAB_PORT || 8899);
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function acceptKey(key) {
  return crypto.createHash('sha1').update(key + GUID).digest('base64');
}

let connSeq = 0;
/** connId → { closedByUs, sawEnd, sawClose } — reported on /stats. */
const conns = new Map();

function frameHeader(opcode, len) {
  if (len < 126) return Buffer.from([0x80 | opcode, len]);
  if (len < 65536) {
    const h = Buffer.alloc(4);
    h[0] = 0x80 | opcode; h[1] = 126; h.writeUInt16BE(len, 2);
    return h;
  }
  const h = Buffer.alloc(10);
  h[0] = 0x80 | opcode; h[1] = 127; h.writeBigUInt64BE(BigInt(len), 2);
  return h;
}

function attachWs(socket, head, id) {
  const st = { closedByUs: false, sawEnd: false, sawClose: false, closeCode: null, msgs: 0 };
  conns.set(id, st);
  let buf = Buffer.from(head || []);
  const send = (opcode, payload) => {
    socket.write(Buffer.concat([frameHeader(opcode, payload.length), payload]));
  };
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (true) {
      if (buf.length < 2) return;
      const b0 = buf[0], b1 = buf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
      let mask = null;
      if (masked) { if (buf.length < at + 4) return; mask = buf.subarray(at, at + 4); at += 4; }
      if (buf.length < at + len) return;
      let payload = buf.subarray(at, at + len);
      if (masked) {
        const un = Buffer.alloc(len);
        for (let i = 0; i < len; i++) un[i] = payload[i] ^ mask[i & 3];
        payload = un;
      }
      buf = buf.subarray(at + len);
      if (opcode === 0x8) {
        st.closeCode = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        console.log(`[conn ${id}] close(${st.closeCode})`);
        if (!st.closedByUs) {
          st.closedByUs = true;
          send(0x8, payload.subarray(0, Math.min(2, payload.length)));
        }
        socket.end();
        return;
      } else if (opcode === 0x9) {
        send(0xA, payload);
      } else if (opcode === 0x1 || opcode === 0x2) {
        st.msgs++;
        console.log(`[conn ${id}] msg #${st.msgs} (${payload.length}B)`);
        send(0x1, Buffer.concat([Buffer.from('echo:'), payload]));
      }
    }
  });
  socket.on('end', () => {
    st.sawEnd = true;
    console.log(`[conn ${id}] end`);
    // http.Server hands out allowHalfOpen sockets; a server that cares about
    // its sockets (like the real ws library) treats an unexpected transport
    // EOF as an abnormal closure and destroys the socket.
    socket.destroy();
  });
  socket.on('close', (hadErr) => { st.sawClose = true; console.log(`[conn ${id}] close-evt hadErr=${hadErr}`); });
  socket.on('error', (e) => { console.log(`[conn ${id}] error ${e.message}`); });
  socket.wsend = (text) => send(0x1, Buffer.from(text));
  return socket;
}

const server = http.createServer((req, res) => {
  console.log(`[http] ${req.method} ${req.url}`);
  res.on('finish', () => console.log(`[http] finish ${req.method} ${req.url} ${res.statusCode} headersSent=${res.headersSent}`));
  if (req.url === '/' || req.url.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(TEST_PAGE);
  } else if (req.url.split('?')[0] === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  } else if (req.url.split('?')[0] === '/stats') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([...conns.entries()].map(([id, st]) => ({ id, ...st }))));
  } else {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('nf');
  }
});

server.on('upgrade', (req, socket, head) => {
  const id = ++connSeq;
  const key = req.headers['sec-websocket-key'];
  console.log(`[conn ${id}] upgrade head=${head ? head.length : 0}B key=${key ? 'yes' : 'MISSING'} reqComplete=${req.complete} rawSocket=${socket === req.socket}`);
  if (!key) { socket.destroy(); return; }
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey(key)}\r\n\r\n`);
  console.log(`[conn ${id}] 101 sent`);
  attachWs(socket, head, id);
});

server.listen(PORT, () => console.log(`[srv] listen :${PORT}`));

// ---- the browser test page (client side of the lab) ------------------------
const TEST_PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>ws-lab</title></head>
<body><h3>ws-lab client</h3><script>
(function () {
  var R = { phase: 'boot', cycles: [], abnormal: [], concurrent: null, errors: [] };
  window.__wsLab = R;
  function post(m) { try { parent.postMessage(m, '*'); } catch (e) { /* noop */ } }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function openWs(timeout) {
    return new Promise(function (resolve, reject) {
      var ws = new WebSocket('ws://' + location.host + '/ws');
      var to = setTimeout(function () {
        reject(new Error('open timeout after ' + timeout + 'ms (readyState=' + ws.readyState + ')'));
        try { ws._channel && ws._channel.close(); } catch (e) { /* noop */ }
      }, timeout);
      ws.onopen = function () { clearTimeout(to); resolve(ws); };
      ws.onerror = function (e) {
        clearTimeout(to);
        reject(new Error('ws error: ' + (e && e.message || 'unknown') + ' (readyState=' + ws.readyState + ')'));
      };
      ws.onclose = function (e) {
        clearTimeout(to);
        reject(new Error('closed before open: code=' + e.code + ' reason=' + e.reason));
      };
    });
  }
  function latin1(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
  }
  function roundTrip(ws, text, timeout) {
    return new Promise(function (resolve, reject) {
      var to = setTimeout(function () { reject(new Error('echo timeout: ' + text)); }, timeout);
      ws.onmessage = function (ev) {
        clearTimeout(to);
        if (ev.data === 'echo:' + text) resolve();
        else reject(new Error('bad echo: ' + ev.data));
      };
      ws.send(text);
    });
  }
  function waitClose(ws, timeout) {
    return new Promise(function (resolve, reject) {
      if (ws.readyState === 3) return resolve(ws._closeCode || ws._labCloseCode || null);
      var to = setTimeout(function () { reject(new Error('close-event timeout')); }, timeout);
      ws.onclose = function (e) { clearTimeout(to); resolve(e.code); };
    });
  }
  function fail(err, tag) {
    R.errors.push(String((tag || '') + err));
    post({ type: 'PREVIEW_WS_ERROR', error: String((tag || '') + (err && err.message || err)) });
  }

  async function run() {
    await sleep(300); // let the shim's bindPromise settle
    post({ type: 'PREVIEW_WS_PROGRESS', phase: 'cycles' });
    R.phase = 'cycles';

    // ---- Test A: N clean connect/echo/close cycles -------------------------
    var N = Number(new URLSearchParams(location.search).get('n') || 120);
    for (var i = 1; i <= N; i++) {
      try {
        var t0 = Date.now();
        var ws = await openWs(8000);
        await roundTrip(ws, 'c' + i, 8000);
        await roundTrip(ws, 'c' + i + 'b', 8000);
        ws.close(1000, 'done');
        await waitClose(ws, 8000);
        R.cycles.push({ i: i, ms: Date.now() - t0, code: 1000 });
        if (i % 10 === 0) post({ type: 'PREVIEW_WS_PROGRESS', phase: 'cycles', done: i, total: N });
      } catch (e) {
        R.cycles.push({ i: i, error: String(e && e.message || e) });
        fail(e, 'cycle ' + i + ': ');
        if (R.errors.length > 5) break;
      }
    }
    R.cycleSummary = {
      ok: R.cycles.filter(function (c) { return !c.error; }).length,
      fail: R.cycles.filter(function (c) { return c.error; }).length,
    };

    // ---- Test B: M abnormal disconnects (transport cut, no WS close) -------
    post({ type: 'PREVIEW_WS_PROGRESS', phase: 'abnormal' });
    R.phase = 'abnormal';
    var M = Number(new URLSearchParams(location.search).get('m') || 60);
    for (var j = 1; j <= M; j++) {
      try {
        var ws2 = await openWs(8000);
        await roundTrip(ws2, 'ab' + j, 8000);
        // ABORT: browser-style abrupt transport death — no WS closing
        // handshake (no close frame), but the transport teardown IS
        // signaled (the shim's _abort posts the terminal oc-ws-close).
        // The guest must see EOF without ever receiving a close frame.
        ws2._abort();
        R.abnormal.push({ j: j, aborted: true });
        await sleep(20);
      } catch (e) {
        R.abnormal.push({ j: j, error: String(e && e.message || e) });
        fail(e, 'abnormal ' + j + ': ');
        if (R.errors.length > 10) break;
      }
    }

    // ---- Test C: simultaneous close (both sides initiate at once) ---------
    post({ type: 'PREVIEW_WS_PROGRESS', phase: 'simultaneous' });
    R.phase = 'simultaneous';
    try {
      var SC = 12;
      for (var c = 0; c < SC; c++) {
        var wsc = await openWs(8000);
        await roundTrip(wsc, 'sim' + c, 8000);
        // Client close and "server close" race: close() sends our close
        // frame; the guest echoes + FINs synchronously — the two closing
        // handshakes interleave on every connection. Idempotent cleanup
        // must absorb whichever order they land in.
        wsc.close(1000, 'sim');
        // immediately cut from the client side too (aborts the handshake
        // half the time — the race window is real)
        if (c % 2 === 1) wsc._abort();
        else await waitClose(wsc, 8000);
        await sleep(15);
      }
      R.simultaneous = { ran: SC, ok: true };
    } catch (e) {
      R.simultaneous = { error: String(e && e.message || e) };
      fail(e, 'simultaneous: ');
    }

    // ---- Test D: upgrade/disconnect timing edges --------------------------
    post({ type: 'PREVIEW_WS_PROGRESS', phase: 'timing' });
    R.phase = 'timing';
    try {
      var sw2 = navigator.serviceWorker.controller;
      var mkOpen = function (handshakeBytes) {
        return new Promise(function (resolve) {
          var chan = new MessageChannel();
          var st = { stage: 0, data: '', ended: false, failed: false };
          chan.port1.onmessage = function (ev) {
            var m = ev.data;
            if (!m || typeof m !== 'object') return;
            if (m.type === 'oc-ws-data') st.data += latin1(new Uint8Array(m.bytes));
            else if (m.type === 'oc-ws-end') st.ended = true;
            else if (m.type === 'oc-ws-open-failed') st.failed = true;
          };
          try { chan.port1.start(); } catch (e2) { /* noop */ }
          sw2.postMessage({
            type: 'oc-ws-open', id: 90000 + (D.seq++), url: 'ws://x/',
            bind: { sid: null, port: 8899 }, bytes: handshakeBytes,
          }, [chan.port2]);
          st.chan = chan.port1;
          resolve(st);
        });
      };
      var D = { seq: 0, cases: [] };
      var HANDSHAKE = (function () {
        var key = btoa(String.fromCharCode.apply(null,
          new Uint8Array(Array.from({ length: 16 }, function () { return Math.floor(Math.random() * 256); }))));
        return new TextEncoder().encode(
          'GET /ws HTTP/1.1\\r\\nHost: x\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\n' +
          'Sec-WebSocket-Key: ' + key + '\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n');
      })();

      // D1: EOF before the handshake is fully parsed (half the request line)
      var d1 = await mkOpen(HANDSHAKE.subarray(0, 20));
      d1.chan.postMessage({ type: 'oc-ws-close' });
      await sleep(250);
      D.cases.push({ d: 'eof-mid-headers', got101: d1.data.indexOf('101') >= 0, ended: d1.ended || d1.failed });

      // D2: EOF immediately after the handshake was sent (parser just done)
      var d2 = await mkOpen(HANDSHAKE);
      d2.chan.postMessage({ type: 'oc-ws-close' });
      await sleep(250);
      D.cases.push({ d: 'eof-after-handshake', got101: d2.data.indexOf('101') >= 0 });

      // D3: 101 received, then immediate disconnect (data in flight window)
      var d3 = await mkOpen(HANDSHAKE);
      await sleep(300); // let the 101 arrive
      d3.chan.postMessage({ type: 'oc-ws-close' });
      await sleep(250);
      D.cases.push({ d: 'abort-after-101', got101: d3.data.indexOf('101') >= 0 });

      // D4: malformed garbage instead of a handshake (no Host/no CRLFCRLF)
      var d4 = await mkOpen(new TextEncoder().encode('NOT-HTTP GARBAGE\\r\\n\\r\\n'));
      await sleep(300);
      d4.chan.postMessage({ type: 'oc-ws-close' });
      await sleep(200);
      D.cases.push({ d: 'garbage-handshake', any: d4.data.length > 0 || d4.ended || d4.failed });

      // D5: after all edge cases the server must still accept cleanly
      var d5 = await openWs(8000);
      await roundTrip(d5, 'after-timing', 8000);
      d5.close(1000);
      await waitClose(d5, 8000);
      D.cases.push({ d: 'recovery', ok: true });

      R.timing = D.cases;
      try { d1.chan.close(); d2.chan.close(); d3.chan.close(); d4.chan.close(); } catch (e2) { /* noop */ }
    } catch (e) {
      R.timing = [{ error: String(e && e.message || e) }];
      fail(e, 'timing: ');
    }

    // ---- one clean cycle after the storm: proves recovery ------------------
    R.phase = 'recovery';
    try {
      var ws3 = await openWs(8000);
      await roundTrip(ws3, 'after-storm', 8000);
      ws3.close(1000);
      await waitClose(ws3, 8000);
      R.recovery = 'ok';
    } catch (e) {
      R.recovery = 'FAIL: ' + String(e && e.message || e);
      fail(e, 'recovery: ');
    }

    // ---- Test E: 10 concurrent clients, independent churn ------------------
    post({ type: 'PREVIEW_WS_PROGRESS', phase: 'concurrent' });
    R.phase = 'concurrent';
    try {
      var CH = Number(new URLSearchParams(location.search).get('ch') || 10);
      var clients = [];
      for (var k = 0; k < CH; k++) {
        var w = await openWs(8000);
        clients.push(w);
      }
      // all alive: round-trip each
      for (var k2 = 0; k2 < clients.length; k2++) {
        await roundTrip(clients[k2], 'conc' + k2, 8000);
      }
      R.concurrent = { opened: clients.length };
      // churn: close half (odd), verify the rest still work, reconnect
      var closed = 0;
      for (var k3 = 1; k3 < clients.length; k3 += 2) {
        clients[k3].close(1000);
        await waitClose(clients[k3], 8000);
        closed++;
      }
      for (var k4 = 0; k4 < clients.length; k4 += 2) {
        await roundTrip(clients[k4], 'conc-after' + k4, 8000);
      }
      R.concurrent.closedHalf = closed;
      for (var k5 = 1; k5 < clients.length; k5 += 2) {
        var w2 = await openWs(8000);
        await roundTrip(w2, 'reconn' + k5, 8000);
        clients[k5] = w2;
      }
      for (var k6 = 0; k6 < clients.length; k6++) {
        await roundTrip(clients[k6], 'final' + k6, 8000);
      }
      for (var k7 = 0; k7 < clients.length; k7++) clients[k7].close(1000);
      for (var k8 = 0; k8 < clients.length; k8++) await waitClose(clients[k8], 8000);
      R.concurrent.ok = true;
    } catch (e) {
      R.concurrent = R.concurrent || {};
      R.concurrent.error = String(e && e.message || e);
      fail(e, 'concurrent: ');
    }

    R.phase = 'done';
    R.doneAt = Date.now();
    post({ type: 'PREVIEW_WS_DONE', summary: {
      cycles: R.cycleSummary,
      abnormalCuts: R.abnormal.filter(function (a) { return a.aborted; }).length,
      abnormalFails: R.abnormal.filter(function (a) { return a.error; }).length,
      simultaneous: R.simultaneous,
      timing: R.timing,
      recovery: R.recovery,
      concurrent: R.concurrent,
      errors: R.errors,
    } });
  }
  window.__wsLabRun = run;
  run().catch(function (e) {
    R.phase = 'fatal';
    R.fatal = String(e && e.stack || e);
    post({ type: 'PREVIEW_WS_ERROR', error: R.fatal });
  });
})();
</script></body></html>`;
