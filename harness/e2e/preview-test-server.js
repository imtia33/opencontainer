/**
 * Preview v2 E2E test server — a deliberately awkward guest:
 *   - absolute-path assets (/app.js, /style.css) — the case v1 could not do
 *   - a fetch() API endpoint
 *   - a client-side-routed deep link (pushState + reload)
 *   - an echoing WebSocket server (RFC6455 server-side framing, no deps)
 */
const http = require('http');
const crypto = require('crypto');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/about') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html><head>
<link rel="stylesheet" href="/style.css">
</head><body>
<h1 id="title">preview-v2-ok</h1>
<div id="path">${url.pathname}</div>
<div id="fetched">…</div>
<div id="wsresult">…</div>
<script src="/app.js"></script>
</body></html>`);
    return;
  }
  if (url.pathname === '/app.js') {
    res.writeHead(200, { 'content-type': 'application/javascript' });
    res.end(`
window.__routeInfo = { path: document.getElementById('path').textContent };
fetch('/api/data').then(r => r.json()).then(d => {
  document.getElementById('fetched').textContent = d.msg;
  window.__apiData = d;
}).catch(e => { window.__apiErr = String(e); });
// WebSocket round-trip through the preview shim's tunnel (HMR path).
try {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  window.__wsState = 'connecting';
  ws.onopen = () => { window.__wsState = 'open'; ws.send('ping-through-tunnel'); };
  ws.onmessage = (ev) => {
    window.__wsState = 'message';
    window.__wsEcho = ev.data;
    document.getElementById('wsresult').textContent = ev.data;
  };
  ws.onclose = () => { if (window.__wsState !== 'message') window.__wsState = 'closed'; };
  ws.onerror = () => { window.__wsState = 'error'; };
  window.__ws = ws;
} catch (e) { window.__wsState = 'threw: ' + e.message; }
`);
    return;
  }
  if (url.pathname === '/style.css') {
    res.writeHead(200, { 'content-type': 'text/css' });
    res.end('#title { color: #0a0; }');
    return;
  }
  if (url.pathname === '/api/data') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ msg: 'api-ok' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('not found: ' + url.pathname);
});

// ---- minimal RFC6455 echo server (upgrade handling) ----------------------
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n');
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      if (buf.length < 2) break;
      const b0 = buf[0], b1 = buf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let at = 2;
      if (len === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); at = 10; }
      let mask = null;
      if (masked) { if (buf.length < at + 4) break; mask = buf.subarray(at, at + 4); at += 4; }
      if (buf.length < at + len) break;
      let payload = buf.subarray(at, at + len);
      if (mask) {
        const un = Buffer.alloc(len);
        for (let i = 0; i < len; i++) un[i] = payload[i] ^ mask[i & 3];
        payload = un;
      }
      buf = buf.subarray(at + len);
      if (opcode === 0x8) {
        // close echo
        const hdr = Buffer.from([0x88, 0x00]);
        socket.write(hdr);
        socket.end();
        return;
      }
      if (opcode === 0x9) { // ping → pong
        socket.write(Buffer.from([0x8a, payload.length]));
        continue;
      }
      // echo text frame (server frames are unmasked)
      const frame = Buffer.alloc(2 + payload.length);
      frame[0] = 0x81; // FIN + text
      frame[1] = payload.length;
      payload.copy(frame, 2);
      socket.write(frame);
    }
  });
  socket.on('error', () => { /* client gone */ });
});

server.listen(0, () => {
  const port = server.address().port;
  console.log('PREVIEW-TEST-SERVER listening on ' + port);
});
