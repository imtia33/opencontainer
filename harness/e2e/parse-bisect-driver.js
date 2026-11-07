/**
 * E2E driver: http parser bisection — which request shapes does the guest's
 * http.Server parse? Sends several variants over raw sockets to one server.
 */
window.__ocParse = { phase: 'start' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocParse;
  const enc = new TextEncoder();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const srv = `
const http = require('http');
const s = http.createServer((req, res) => {
  process.stdout.write('[srv] OK ' + req.method + ' ' + req.url + '\\\\n');
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('OK');
});
s.listen(8797, '127.0.0.1', () => process.stdout.write('[srv] listening\\\\n'));
`;
  await rt.writeFile('/home/project/parse-srv.js', enc.encode(srv));
  const hs = await rt.spawnProgram('node', ['parse-srv.js'], { cwd: '/home/project' });
  let srvOut = '';
  hs.output.pipeTo(new WritableStream({ write(d) { srvOut += d; R.srvOut = srvOut; } })).catch(() => {});

  let listened = false;
  const off = rt.on('listen', (i) => { if (i.port === 8797) listened = true; });
  const t0 = Date.now();
  while (!listened && Date.now() - t0 < 15000) await sleep(150);
  off();

  const variants = {
    'minimal': 'GET /a HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n',
    'full-host': 'GET /b HTTP/1.1\r\nHost: localhost:8797\r\nConnection: close\r\n\r\n',
    'no-conn': 'GET /c HTTP/1.1\r\nHost: localhost:8797\r\n\r\n',
    'http10': 'GET /d HTTP/1.0\r\n\r\n',
    'browser-like': 'GET /e HTTP/1.1\r\nHost: localhost:8797\r\nUser-Agent: test\r\nAccept: */*\r\nConnection: close\r\n\r\n',
  };

  const cliTemplate = (name, req) => `
const net = require('net');
const sock = net.connect(8797, '127.0.0.1', () => sock.write(${JSON.stringify(req)}));
let data = '';
sock.on('data', (d) => { data += d.toString(); });
sock.on('close', () => { process.stdout.write('[${name}] closed got=' + data.length + 'B head=' + JSON.stringify(data.slice(0, 40)) + '\\\\n'); process.exit(0); });
sock.on('error', (e) => { process.stdout.write('[${name}] ERR ' + e.message + '\\\\n'); process.exit(1); });
setTimeout(() => { process.stdout.write('[${name}] TIMEOUT\\\\n'); process.exit(2); }, 5000);
`;

  for (const [name, req] of Object.entries(variants)) {
    await rt.writeFile('/home/project/parse-cli.js', enc.encode(cliTemplate(name, req)));
    const hc = await rt.spawnProgram('node', ['parse-cli.js'], { cwd: '/home/project' });
    let out = '';
    hc.output.pipeTo(new WritableStream({ write(d) { out += d; } })).catch(() => {});
    await Promise.race([hc.exit, new Promise((r) => setTimeout(r, 8000))]);
    R[name] = out.trim();
    await sleep(400);
  }
  R.phase = 'done';
})();
