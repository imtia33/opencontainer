/**
 * E2E driver: bisect the dev-server 502. The vite dev server (started by
 * vite-dev2-driver) is listening on :5173. Test from INSIDE the guest with
 * a raw socket + the guest's own fetch, to separate server-side breakage
 * from the SW→runtime path.
 */
window.__ocBis = { phase: 'start' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocBis;
  const enc = new TextEncoder();

  const script = `
const net = require('net');
const log = (m) => process.stdout.write('[bis] ' + m + '\\\\n');
const sock = net.connect(5173, '127.0.0.1', () => {
  log('connected');
  sock.write("GET / HTTP/1.1\\r\\nHost: localhost:5173\\r\\nConnection: close\\r\\n\\r\\n");
});
let data = '';
sock.on('data', (d) => { data += d.toString(); log('chunk ' + d.length + 'B'); });
sock.on('end', () => { log('end, total ' + data.length + 'B'); log('head: ' + JSON.stringify(data.slice(0, 300))); process.exit(0); });
sock.on('error', (e) => { log('sock ERR ' + e.message); process.exit(1); });
sock.on('close', () => { log('closed'); setTimeout(() => process.exit(0), 200); });
setTimeout(() => { log('TIMEOUT total=' + data.length); process.exit(2); }, 8000);
`;
  await rt.writeFile('/home/project/bis.js', enc.encode(script));
  R.phase = 'raw-socket';
  const h = await rt.spawnProgram('node', ['bis.js'], { cwd: '/home/project' });
  let out = '';
  h.output.pipeTo(new WritableStream({ write(d) { out += d; R.rawOut = out; } })).catch(() => {});
  const code = await Promise.race([h.exit, new Promise((r) => setTimeout(() => r('TIMEOUT'), 20000))]);
  R.rawCode = code;

  // guest-side fetch (through the oc-net bridge, not the SW)
  R.phase = 'guest-fetch';
  const script2 = `
fetch('http://localhost:5173/').then(async (r) => {
  const t = await r.text();
  process.stdout.write('[gf] status=' + r.status + ' len=' + t.length + ' head=' + JSON.stringify(t.slice(0, 200)));
  process.exit(0);
}).catch((e) => { process.stdout.write('[gf] ERR ' + e.message); process.exit(1); });
`;
  await rt.writeFile('/home/project/gf.js', enc.encode(script2));
  const h2 = await rt.spawnProgram('node', ['gf.js'], { cwd: '/home/project' });
  let out2 = '';
  h2.output.pipeTo(new WritableStream({ write(d) { out2 += d; R.gfOut = out2; } })).catch(() => {});
  const code2 = await Promise.race([h2.exit, new Promise((r) => setTimeout(() => r('TIMEOUT'), 20000))]);
  R.gfCode = code2;
  R.phase = 'done';
})();
