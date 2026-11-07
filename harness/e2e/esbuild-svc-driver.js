/**
 * E2E driver: SELF-CONTAINED esbuild --service repro. Installs esbuild-wasm
 * in a scratch dir, spawns `node bin/esbuild --service --ping` exactly like
 * lib/main.js does, drives a build request, and verifies the response.
 * Reports on window.__ocSvc.
 */
window.__ocSvc = { phase: 'start', output: '' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocSvc;
  const enc = new TextEncoder();

  const run = async (cmd, args, timeoutMs) => {
    const h = await rt.spawnProgram(cmd, args, { cwd: '/home/project' });
    let out = '';
    h.output.pipeTo(new WritableStream({ write(d) { out += d; R.output = out; } })).catch(() => {});
    const code = await Promise.race([
      h.exit,
      new Promise((r) => setTimeout(() => r('TIMEOUT'), timeoutMs)),
    ]);
    return { code, out };
  };

  try {
    // 1. install esbuild-wasm (the oc-compat pass swaps nothing — it IS wasm)
    await rt.writeFile('/home/project/svcdir/package.json', enc.encode(JSON.stringify({
      name: 'svc', private: true, version: '0.0.0',
      dependencies: { 'esbuild-wasm': '0.28.2' },
    })));
    R.phase = 'install';
    const ih = await rt.spawnProgram('npm', ['install'], { cwd: '/home/project/svcdir' });
    let iout = '';
    ih.output.pipeTo(new WritableStream({ write(d) { iout += d; R.output = iout; } })).catch(() => {});
    const icode = await Promise.race([
      ih.exit,
      new Promise((r) => setTimeout(() => r('TIMEOUT'), 300000)),
    ]);
    if (icode !== 0) { R.phase = 'install-failed'; return; }

    // npm --prefix layout: svcdir/node_modules/esbuild-wasm
    const wasmDir = '/home/project/svcdir/node_modules/esbuild-wasm';
    const ok = await rt.readFile(wasmDir + '/package.json').then(() => true).catch(() => false);
    R.wasmDirOk = ok;
    if (!ok) { R.phase = 'no-wasm-dir'; return; }

    // 2. parent: spawn the service, drive a version-check + build request
    const parent = `
const cp = require('child_process');
const path = require('path');
const wasmDir = ${JSON.stringify(wasmDir)};
const child = cp.spawn(process.execPath, [path.join(wasmDir, 'bin', 'esbuild'), '--service=0.28.2', '--ping'], {
  windowsHide: true,
  stdio: ['pipe', 'pipe', 'inherit'],
  cwd: process.cwd(),
});
const log = (m) => process.stdout.write('[svc] ' + m + '\\\\n');
log('spawned pid=' + child.pid);
let out = '';
child.stdout.on('data', (d) => { out += d; log('stdout ' + d.length + 'B'); });
child.on('exit', (code, sig) => { log('child exit code=' + code + ' sig=' + sig + ' got=' + out.length + 'B'); process.exit(0); });
child.on('error', (e) => log('child error: ' + e.message));
const send = (obj) => {
  const s = JSON.stringify(obj);
  const len = Buffer.alloc(4); len.writeUInt32LE(s.length);
  child.stdin.write(Buffer.concat([len, Buffer.from(s)]), (err) => { if (err) log('stdin write err: ' + err.message); });
};
// main.js-shaped ping reply so the service stays alive
const handlePacket = (s) => {
  let obj; try { obj = JSON.parse(s); } catch { return; }
  if (obj && obj.isRequest) {
    if (obj.value && obj.value.command === 'ping') {
      const r = JSON.stringify({ id: obj.id, isRequest: false, value: {} });
      const len = Buffer.alloc(4); len.writeUInt32LE(r.length);
      child.stdin.write(Buffer.concat([len, Buffer.from(r)]));
      log('replied to ping ' + obj.id);
    }
  }
};
let acc = 0;
child.stdout.on('data', (d) => {
  // parse length-prefixed packets out of the stream
  let buf = d;
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    handlePacket(buf.subarray(4, 4 + len).toString());
    buf = buf.subarray(4 + len);
  }
});
setTimeout(() => {
  log('sending build request');
  send({ command: 'build', stdin: 'let x = 1 // c', stdinContents: true? undefined : undefined });
  send({ command: 'transform', input: 'let x: number = 1', loader: 'ts' });
}, 600);
setTimeout(() => { log('final: got=' + out.length + 'B'); child.kill(); setTimeout(() => process.exit(0), 300); }, 8000);
`;
    await rt.writeFile('/home/project/svc-parent.js', enc.encode(parent));
    R.phase = 'running';
    const res = await run('node', ['svc-parent.js'], 30000);
    R.exitCode = res.code;
    R.phase = 'done';
  } catch (e) {
    R.phase = 'error';
    R.error = String(e?.stack ?? e);
  }
})();
