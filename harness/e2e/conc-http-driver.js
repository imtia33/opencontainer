/**
 * E2E driver: concurrent connections to an http.Server — reproduce the
 * silent-parse-drop. Two guest raw clients connect back-to-back.
 */
window.__ocConc = { phase: 'start' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocConc;
  const enc = new TextEncoder();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const srv = `
const http = require('http');
const s = http.createServer((req, res) => {
  process.stdout.write('[srv] OK ' + req.url + '\\n');
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('OK');
});
s.listen(8801, '127.0.0.1', () => process.stdout.write('[srv] listening\\\\n'));
`;
  await rt.writeFile('/home/project/conc-srv.js', enc.encode(srv));
  const hs = await rt.spawnProgram('node', ['conc-srv.js'], { cwd: '/home/project' });
  let srvOut = '';
  hs.output.pipeTo(new WritableStream({ write(d) { srvOut += d; R.srvOut = srvOut; } })).catch(() => {});

  let listened = false;
  const off = rt.on('listen', (i) => { if (i.port === 8801) listened = true; });
  const t0 = Date.now();
  while (!listened && Date.now() - t0 < 15000) await sleep(150);
  off();
  await sleep(2500); // let the preview iframe's connection settle

  // two clients in ONE process, connecting ~simultaneously
  const cli = `
const net = require('net');
function hit(name, path) {
  return new Promise((done) => {
    const sock = net.connect(8801, '127.0.0.1', () => {
      sock.write(JSON.stringify('GET ' + path + ' HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n'));
    });
    let data = '';
    sock.on('data', (d) => { data += d.toString(); });
    sock.on('close', () => { process.stdout.write('[' + name + '] closed got=' + data.length + 'B\\\\n'); done(); });
    sock.on('error', (e) => { process.stdout.write('[' + name + '] ERR ' + e.message + '\\\\n'); done(); });
    setTimeout(() => { process.stdout.write('[' + name + '] TIMEOUT\\\\n'); sock.destroy(); done(); }, 8000);
  });
}
(async () => {
  // concurrent pair
  await Promise.all([hit('c1', '/one'), hit('c2', '/two')]);
  // sequential follow-ups
  await hit('c3', '/three');
  await hit('c4', '/four');
  process.exit(0);
})();
`;
  await rt.writeFile('/home/project/conc-cli.js', enc.encode(cli));
  const hc = await rt.spawnProgram('node', ['conc-cli.js'], { cwd: '/home/project' });
  let cliOut = '';
  hc.output.pipeTo(new WritableStream({ write(d) { cliOut += d; R.cliOut = cliOut; } })).catch(() => {});
  await Promise.race([hc.exit, new Promise((r) => setTimeout(r, 30000))]);
  R.phase = 'done';
})();
