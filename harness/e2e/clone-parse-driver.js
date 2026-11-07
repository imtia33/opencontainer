/**
 * E2E driver: EXACT clone of parse-bisect's scripts (byte-identical server
 * and client templates), on a fresh port. If this fails where parse-bisect
 * worked, the variable is session state, not the scripts.
 */
window.__ocClone = { phase: 'start' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocClone;
  const enc = new TextEncoder();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const PORT = 8806;

  const srv = `
const http = require('http');
const s = http.createServer((req, res) => {
  process.stdout.write('[srv] OK ' + req.method + ' ' + req.url + '\\n');
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('OK');
});
s.listen(${PORT}, '127.0.0.1', () => process.stdout.write('[srv] listening\\n'));
`;
  await rt.writeFile('/home/project/clone-srv.js', enc.encode(srv));
  const hs = await rt.spawnProgram('node', ['clone-srv.js'], { cwd: '/home/project' });
  let srvOut = '';
  hs.output.pipeTo(new WritableStream({ write(d) { srvOut += d; R.srvOut = srvOut; } })).catch(() => {});

  let listened = false;
  const off = rt.on('listen', (i) => { if (i.port === PORT) listened = true; });
  const t0 = Date.now();
  while (!listened && Date.now() - t0 < 15000) await sleep(150);
  off();

  // FORCE a SW/preview connection first (batched initialBytes path) —
  // poll until the SW actually routes to the guest server.
  for (let i = 0; i < 15; i++) {
    try {
      const swRes = await fetch(rt.previewUrl(PORT) + 'warmup', { cache: 'no-store' });
      const t = await swRes.text();
      R.warmup = swRes.status + ':' + t.slice(0, 30);
      if (swRes.status === 200) break;
    } catch (e) {
      R.warmup = 'ERR ' + e.message;
    }
    await sleep(400);
  }
  await sleep(300);

  const req = 'GET /a HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n';
  const cli = `
const net = require('net');
const sock = net.connect(${PORT}, '127.0.0.1', () => sock.write(${JSON.stringify(req)}));
let data = '';
sock.on('data', (d) => { data += d.toString(); });
sock.on('close', () => { process.stdout.write('[clone] closed got=' + data.length + 'B head=' + JSON.stringify(data.slice(0, 40)) + '\\n'); process.exit(0); });
sock.on('error', (e) => { process.stdout.write('[clone] ERR ' + e.message + '\\n'); process.exit(1); });
setTimeout(() => { process.stdout.write('[clone] TIMEOUT\\n'); process.exit(2); }, 5000);
`;
  await rt.writeFile('/home/project/clone-cli.js', enc.encode(cli));
  const hc = await rt.spawnProgram('node', ['clone-cli.js'], { cwd: '/home/project' });
  let cliOut = '';
  hc.output.pipeTo(new WritableStream({ write(d) { cliOut += d; R.cliOut = cliOut; } })).catch(() => {});
  await Promise.race([hc.exit, new Promise((r) => setTimeout(r, 12000))]);
  R.phase = 'done';
})();
