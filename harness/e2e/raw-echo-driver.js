/**
 * E2E driver: RAW net echo server — is the accepted socket's 'data' event
 * delivered when the client's bytes arrive as a separate 'tcp-data' message
 * (guest→guest), vs batched initialBytes (SW/preview)?
 */
window.__ocRaw = { phase: 'start' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocRaw;
  const enc = new TextEncoder();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const srv = `
const net = require('net');
globalThis.__ocDebugHook = (m) => process.stdout.write('[srv-dbg] ' + m + '\\\\n');
const s = net.createServer((sock) => {
  process.stdout.write('[srv] connection\\\\n');
  sock.on('data', (d) => {
    process.stdout.write('[srv] data ' + d.length + 'B ' + JSON.stringify(d.toString().slice(0, 30)) + '\\\\n');
    sock.write('ECHO:' + d.toString());
  });
  sock.on('close', () => process.stdout.write('[srv] closed\\\\n'));
  sock.on('error', (e) => process.stdout.write('[srv] err ' + e.message + '\\\\n'));
});
s.listen(8795, '127.0.0.1', () => process.stdout.write('[srv] listening\\\\n'));
`;
  await rt.writeFile('/home/project/raw-srv.js', enc.encode(srv));
  const hs = await rt.spawnProgram('node', ['raw-srv.js'], { cwd: '/home/project' });
  let srvOut = '';
  hs.output.pipeTo(new WritableStream({ write(d) { srvOut += d; R.srvOut = srvOut; } })).catch(() => {});

  let listened = false;
  const off = rt.on('listen', (i) => { if (i.port === 8795) listened = true; });
  const t0 = Date.now();
  while (!listened && Date.now() - t0 < 15000) await sleep(150);
  off();

  const cli = `
const net = require('net');
globalThis.__ocDebugHook = (m) => process.stdout.write('[cli-dbg] ' + m + '\\\\n');
const sock = net.connect(8795, '127.0.0.1', () => {
  process.stdout.write('[cli] connected, writing\\\\n');
  sock.write('HELLO-RAW');
});
sock.on('data', (d) => { process.stdout.write('[cli] got ' + JSON.stringify(d.toString()) + '\\\\n'); process.exit(0); });
sock.on('error', (e) => { process.stdout.write('[cli] ERR ' + e.message + '\\\\n'); process.exit(1); });
setTimeout(() => { process.stdout.write('[cli] TIMEOUT\\\\n'); process.exit(2); }, 20000);
`;
  await rt.writeFile('/home/project/raw-cli.js', enc.encode(cli));
  const hc = await rt.spawnProgram('node', ['raw-cli.js'], { cwd: '/home/project' });
  let cliOut = '';
  hc.output.pipeTo(new WritableStream({ write(d) { cliOut += d; R.cliOut = cliOut; } })).catch(() => {});
  await Promise.race([hc.exit, new Promise((r) => setTimeout(r, 25000))]);
  R.phase = 'done';
})();
