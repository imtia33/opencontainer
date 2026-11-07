/**
 * E2E driver: minimal raw-pipe test. Parent spawns a child whose stdin is a
 * pipe; the child reads fd 0 through RAW fs.read (callback mode — the exact
 * Go/wasm_exec pattern) and echoes what it got. Verifies the whole chain:
 * parent stdin write → host pipe-write → child 'stdin' RPC → stdin bridge →
 * parked raw reader completion.
 */
window.__ocPipe = { phase: 'start', output: '' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocPipe;
  const enc = new TextEncoder();

  const childScript = `
globalThis.__ocDebugHook = (m) => console.log('[dbg] ' + m);
globalThis.__ocPipeDebug = (m) => console.log('[wdbg] ' + m);
const fs = require('fs');
console.log('[child] booted, parking fs.read(0)…');
console.log('[child] stdin stream exists: ' + (typeof process.stdin) + ' readable? ' + (process.stdin && process.stdin.readable));
const buf = Buffer.alloc(64);
console.log('[child] buf type=' + buf.constructor.name + ' set=' + typeof buf.set + ' isUA=' + (buf instanceof Uint8Array) + ' proto=' + Object.getPrototypeOf(buf.constructor).name);
fs.read(0, buf, 0, 64, null, (err, n, b) => {
  if (err) { console.log('[child] read ERR ' + err.message); process.exit(3); }
  console.log('[child] read completed n=' + n + ' data=' + JSON.stringify(b.subarray(0, n).toString()));
  // second read — EOF handling after parent closes
  fs.read(0, buf, 0, 64, null, (err2, n2) => {
    console.log('[child] second read: err=' + (err2 ? err2.code : 'none') + ' n=' + n2);
    process.exit(0);
  });
});
// keep a heartbeat so the drain watcher cannot kill us while parked
setInterval(() => {}, 1000);
`;
  await rt.writeFile('/home/project/pipe-child.js', enc.encode(childScript));

  const parentScript = `
globalThis.__ocPipeDebug = (m) => process.stdout.write('[pwdbg] ' + m + '\\n');
const cp = require('child_process');
const child = cp.spawn(process.execPath, ['/home/project/pipe-child.js'], {
  stdio: ['pipe', 'pipe', 'inherit'],
});
const log = (m) => process.stdout.write('[parent] ' + m + '\\\\n');
log('spawned ' + child.pid);
child.stdout.on('data', (d) => log('child says: ' + d.toString().trim()));
child.on('exit', (c) => { log('child exit ' + c); process.exit(0); });
setTimeout(() => {
  log('writing HELLO to child stdin');
  child.stdin.write('HELLO', (e) => log('write ' + (e ? 'ERR ' + e.message : 'ok')));
}, 500);
setTimeout(() => { log('closing stdin (EOF)'); child.stdin.end(); }, 1500);
setTimeout(() => { log('TIMEOUT'); child.kill(); process.exit(1); }, 6000);
`;
  await rt.writeFile('/home/project/pipe-parent.js', enc.encode(parentScript));

  R.phase = 'running';
  const h = await rt.spawnProgram('node', ['pipe-parent.js'], { cwd: '/home/project' });
  let out = '';
  h.output.pipeTo(new WritableStream({ write(d) { out += d; R.output = out; } })).catch(() => {});
  await Promise.race([h.exit, new Promise((r) => setTimeout(r, 30000))]);
  R.phase = 'done';
})();
