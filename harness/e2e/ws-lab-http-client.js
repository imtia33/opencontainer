/**
 * E2E guest: ordinary-HTTP regression client (Test F).
 *
 * Runs IN A SECOND GUEST PROCESS against the ws-lab server on 127.0.0.1:8899
 * — the local-pair virtual TCP path (outbound connect ⇄ accept), which the
 * preview path never touches:
 *   F1  30 sequential http.get over ONE keep-alive agent connection
 *   F2  10 concurrent http.get (agent pool, multiple sockets)
 *   F3  5 sequential RAW upgrade handshakes over net.connect (probe style,
 *       abrupt destroy after the 101 — the old failure shape)
 *   F4  one plain request/response with a body (POST + content-length)
 * Prints a JSON verdict on the last line.
 */
const http = require('http');
const net = require('net');
const PORT = 8899;

function json(obj) { console.log('FRESULT ' + JSON.stringify(obj)); }

async function main() {
  const out = { f1: null, f2: null, f3: null, f4: null };

  // F1 — sequential keep-alive
  {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    let ok = 0, bad = 0, sockets = -1;
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => {
        const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health', agent }, (res) => {
          let body = '';
          res.on('data', (c) => { body += c; });
          res.on('end', () => {
            if (res.statusCode === 200 && body === 'ok') ok++; else bad++;
            resolve();
          });
        });
        req.on('error', () => { bad++; resolve(); });
      });
    }
    sockets = Object.keys(agent.sockets).length + Object.keys(agent.freeSockets).length;
    agent.destroy();
    out.f1 = { ok, bad, liveSocketEntries: sockets };
  }

  // F2 — concurrent
  {
    let ok = 0, bad = 0;
    const agent = new http.Agent({ keepAlive: true, maxSockets: 10 });
    await Promise.all(Array.from({ length: 10 }, (_, i) => new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health?c=' + i, agent }, (res) => {
        res.resume();
        res.on('end', () => { if (res.statusCode === 200) ok++; else bad++; resolve(); });
      });
      req.on('error', () => { bad++; resolve(); });
    })));
    agent.destroy();
    out.f2 = { ok, bad };
  }

  // F3 — raw upgrade probes (sequential, abrupt destroy after 101)
  {
    const results = [];
    const probe = (n) => new Promise((resolve) => {
      const key = Buffer.from(String(Math.random()) + Date.now()).toString('base64').slice(0, 24);
      const s = net.connect(PORT, '127.0.0.1', () => {
        s.write('GET /ws HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
          'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n');
      });
      let buf = '';
      const to = setTimeout(() => { results.push('timeout'); s.destroy(); resolve(); }, 5000);
      s.on('data', (d) => {
        buf += d.toString('latin1');
        if (buf.includes('\r\n\r\n')) {
          clearTimeout(to);
          results.push(buf.split('\r\n')[0]);
          s.destroy(); // abrupt — like a page navigation killing the WS
          resolve();
        }
      });
      s.on('error', (e) => { clearTimeout(to); results.push('ERR ' + e.message); resolve(); });
    });
    for (let i = 0; i < 5; i++) await probe(i);
    out.f3 = {
      all101: results.every((r) => /^HTTP\/1\.1 101/.test(r)),
      lines: results,
    };
  }

  // F4 — request with body
  {
    const verdict = await new Promise((resolve) => {
      const body = JSON.stringify({ ping: 'body-test' });
      const req = http.request({
        host: '127.0.0.1', port: PORT, path: '/health', method: 'POST',
        headers: { 'content-length': String(Buffer.byteLength(body)) },
      }, (res) => {
        res.resume();
        res.on('end', () => resolve('status=' + res.statusCode));
      });
      req.on('error', (e) => resolve('ERR ' + e.message));
      req.end(body);
    });
    out.f4 = verdict;
  }

  json(out);
  process.exit(0);
}

main().catch((e) => { json({ fatal: String(e && e.stack || e) }); process.exit(1); });
