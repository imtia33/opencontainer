/**
 * E2E driver: plain node http server + two clients (guest raw socket, host
 * SW fetch) — isolates vite-specific breakage from kernel TCP issues.
 */
window.__ocHttp = { phase: 'start' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocHttp;
  const enc = new TextEncoder();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1. a minimal http server on :8805
  const srv = `
globalThis.__ocDebugHook = (m) => process.stdout.write('[srv-dbg] ' + m + '\\n');
globalThis.__ocTcpDebug = (m) => process.stdout.write('[srv-tcp] ' + m + '\\n');
const http = require('http');
const s = http.createServer((req, res) => {
  process.stdout.write('[srv] ' + req.method + ' ' + req.url + '\\\\n');
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('PLAIN-SRV-OK ' + req.url);
});
s.on('connection', (sock) => {
  process.stdout.write('[srv-conn] listeners: ' + s.listeners('connection').map((f) => f.name || 'anon').join(', ') + '\\n');
  process.stdout.write('[srv-conn] socket\\n');
  sock.on('data', (d) => process.stdout.write('[srv-sock] data ' + d.length + 'B ' + JSON.stringify(d.toString().slice(0, 30)) + '\\n'));
  sock.on('close', (hadErr) => process.stdout.write('[srv-sock] closed err=' + hadErr + '\\n'));
  sock.on('error', (e) => process.stdout.write('[srv-sock] ERROR ' + e.message + '\\n'));
});
s.listen(8805, '127.0.0.1', () => process.stdout.write('[srv] listening 8805\\\\n'));
`;
  await rt.writeFile('/home/project/plain-srv.js', enc.encode(srv));
  const hs = await rt.spawnProgram('node', ['plain-srv.js'], { cwd: '/home/project' });
  let srvOut = '';
  hs.output.pipeTo(new WritableStream({ write(d) { srvOut += d; R.srvOut = srvOut; } })).catch(() => {});

  let listened = false;
  const off = rt.on('listen', (i) => { if (i.port === 8805) listened = true; });
  const t0 = Date.now();
  while (!listened && Date.now() - t0 < 20000) await sleep(50);
  off();
  R.listened = listened;

  // 2. guest raw socket client
  const cli = `
globalThis.__ocDebugHook = (m) => process.stdout.write('[cli-dbg ' + (Date.now() % 100000) + '] ' + m + '\\n');
globalThis.__ocTcpDebug = (m) => process.stdout.write('[cli-tcp ' + (Date.now() % 100000) + '] ' + m + '\\n');
const net = require('net');
const sock = net.connect(8805, '127.0.0.1', () => { process.stdout.write('[cli ' + (Date.now() % 100000) + '] connected\\n');
  sock.write("GET /ping HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
});
let data = '';
sock.on('data', (d) => { data += d.toString(); process.stdout.write('[cli ' + (Date.now() % 100000) + '] DATA ' + d.length + 'B'); });
sock.on('close', () => { process.stdout.write('[cli] closed total=' + data.length + ' head=' + JSON.stringify(data.slice(0, 120))); process.exit(0); });
sock.on('error', (e) => { process.stdout.write('[cli] ERR ' + e.message); process.exit(1); });
setTimeout(() => { process.stdout.write('[cli] TIMEOUT ' + data.length); process.exit(2); }, 60000);
`;
  await rt.writeFile('/home/project/plain-cli.js', enc.encode(cli));
  const hc = await rt.spawnProgram('node', ['plain-cli.js'], { cwd: '/home/project' });
  let cliOut = '';
  hc.output.pipeTo(new WritableStream({ write(d) { cliOut += d; R.cliOut = cliOut; } })).catch(() => {});
  await Promise.race([hc.exit, new Promise((r) => setTimeout(r, 12000))]);

  // 3. host-side SW fetch
  try {
    const url = rt.previewUrl(8805);
    R.previewUrl = url;
    const res = await fetch(url + 'hostcheck', { cache: 'no-store' });
    R.swStatus = res.status;
    R.swBody = (await res.text()).slice(0, 200);
  } catch (e) {
    R.swErr = String(e);
  }
  R.phase = 'done';
})();
