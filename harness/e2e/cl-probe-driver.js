/**
 * E2E driver: verify the LOADED _http_server.js is the instrumented one, and
 * call connectionListener's pieces manually to find where it stops.
 */
window.__ocCL = { phase: 'start' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocCL;
  const enc = new TextEncoder();

  const script = `
// 1. Is the instrumented module loaded? (the source check)
const src = process.binding ? null : null;
const http = require('http');
// reach the internal module through the require cache
const path = require('path');
// node exposes no direct way; use the module registry via Error stack? Simpler:
// create a server and inspect the listener function source.
const s = http.createServer(() => {});
const listeners = s.listeners('connection');
const connListener = listeners[0];
process.stdout.write('[cl] listener name=' + connListener.name + ' src-head=' + connListener.toString().slice(0, 180).replace(/\\n/g, ' ') + '\\n');
// 2. getOrSetAsyncId behavior on a socket-less object
try {
  const hooks = require('internal/async_hooks');
  const obj = {};
  const id = hooks.getOrSetAsyncId ? hooks.getOrSetAsyncId(obj) : 'NO getOrSetAsyncId export';
  process.stdout.write('[cl] getOrSetAsyncId -> ' + id + '\\n');
} catch (e) {
  process.stdout.write('[cl] getOrSetAsyncId THREW: ' + e.message + '\\n');
}
// 3. defaultTriggerAsyncIdScope behavior
try {
  const hooks = require('internal/async_hooks');
  let ran = false;
  const r = hooks.defaultTriggerAsyncIdScope(123, () => { ran = true; return 'ok'; });
  process.stdout.write('[cl] scope ran=' + ran + ' ret=' + r + '\\n');
} catch (e) {
  process.stdout.write('[cl] scope THREW: ' + e.message + '\\n');
}
process.exit(0);
`;
  await rt.writeFile('/home/project/cl-probe.js', enc.encode(script));
  const h = await rt.spawnProgram('node', ['cl-probe.js'], { cwd: '/home/project' });
  let out = '';
  h.output.pipeTo(new WritableStream({ write(d) { out += d; R.out = out; } })).catch(() => {});
  const code = await Promise.race([h.exit, new Promise((r) => setTimeout(() => r('TIMEOUT'), 15000))]);
  R.code = code;
  R.phase = 'done';
})();
