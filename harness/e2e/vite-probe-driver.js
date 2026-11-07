/**
 * E2E driver: probe the RUNNING vite dev server (:5173) with a guest raw
 * socket — bypasses the SW. See exactly what vite returns for / and
 * /src/main.js, and whether HMR asset paths respond.
 */
window.__ocVprobe = { phase: 'start' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocVprobe;
  const enc = new TextEncoder();

  const paths = ['/p/rxs9pm/5173/', '/', '/p/rxs9pm/5173/src/main.js'];
  const script = `
const net = require('net');
const paths = ${JSON.stringify(paths)};
(async () => {
  for (const p of paths) {
    await new Promise((done) => {
      const sock = net.connect(5173, '127.0.0.1', () => {
        sock.write("GET " + p + " HTTP/1.1\\r\\nHost: localhost:5173\\r\\nConnection: close\\r\\n\\r\\n");
      });
      let data = '';
      sock.on('data', (d) => { data += d.toString(); });
      sock.on('error', (e) => { process.stdout.write('[probe] ' + p + ' ERR ' + e.message + '\\n'); done(); });
      sock.on('close', () => {
        const head = data.split('\\r\\n')[0] || '(empty)';
        const len = data.length;
        process.stdout.write('[probe] ' + p + ' -> ' + head + ' total=' + len + 'B\\\\n');
        if (p === '/' && len > 0) process.stdout.write('[probe] body-head: ' + JSON.stringify(data.slice(data.indexOf('\\r\\n\\r\\n') + 4, data.indexOf('\\r\\n\\r\\n') + 240)) + '\\n');
        done();
      });
      setTimeout(() => { process.stdout.write('[probe] ' + p + ' TIMEOUT\\\\n'); sock.destroy(); done(); }, 10000);
    });
  }
  process.exit(0);
})();
`;
  await rt.writeFile('/home/project/vprobe.js', enc.encode(script));
  const h = await rt.spawnProgram('node', ['vprobe.js'], { cwd: '/home/project' });
  let out = '';
  h.output.pipeTo(new WritableStream({ write(d) { out += d; R.out = out; } })).catch(() => {});
  await Promise.race([h.exit, new Promise((r) => setTimeout(r, 45000))]);
  R.phase = 'done';
})();
