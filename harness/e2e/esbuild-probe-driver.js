/**
 * E2E driver: probe WHERE the EBADF on fs.read(0) comes from. Creates a copy
 * of esbuild-wasm's bin/esbuild whose wasm_exec_node.js is instrumented: every
 * fs method is wrapped; calls+throws are logged to fd 2 (inherited → visible
 * in parent output). Then spawns it as a --service and drives a packet.
 */
window.__ocProbe = { phase: 'start', output: '' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocProbe;
  const enc = new TextEncoder();

  const guest = `
const fs = require('fs');
const path = require('path');
const wasmDir = '/home/project/svcdir/node_modules/esbuild-wasm';
// 1. probe copy of wasm_exec_node.js: wrap globalThis.fs with logging
let we = fs.readFileSync(path.join(wasmDir, 'wasm_exec_node.js'), 'utf8');
we = we.replace(
  'globalThis.fs = require("fs");',
  'const __realFs = require("fs"); globalThis.fs = new Proxy(__realFs, { get(t, p) { const v = t[p]; if (typeof v !== "function") return v; return function (...a) { try { const r = v.apply(t, a); if (p === "read" || p === "readSync" || p === "write" || p === "writeSync" || p === "open" || p === "close" || p === "fstat") process.stderr.write("[probe] fs." + p + "(" + Array.from(a, (x) => typeof x === "number" ? x : typeof x?.length === "number" ? "<" + x.length + "B>" : String(x)?.slice(0, 30)).join(", ") + ") -> " + String(r).slice(0, 40) + "\\\\n"); return r; } catch (e) { process.stderr.write("[probe] fs." + p + " THREW: " + e.message + "\\\\n" + e.stack.split("\\\\n").slice(0, 6).join("\\\\n") + "\\\\n"); throw e; } }; } });'
);
if (!we.includes('[probe]')) { console.error('PATCH FAILED'); process.exit(9); }
we = we.replace('require("./wasm_exec")', 'require(' + JSON.stringify(path.join(wasmDir, 'wasm_exec.js')) + ')');
fs.writeFileSync('/home/project/we-probe.js', we);
// 2. probe bin runner: identical to bin/esbuild but uses our we-probe.js
let bin = fs.readFileSync(path.join(wasmDir, 'bin', 'esbuild'), 'utf8');
bin = bin.replace("path.join(__dirname, '..', 'wasm_exec_node.js')", "'/home/project/we-probe.js'");
bin = bin.replace("path.join(__dirname, '..', 'esbuild.wasm')", JSON.stringify(path.join(wasmDir, 'esbuild.wasm')));
fs.writeFileSync('/home/project/bin-esbuild-probe.js', bin);
console.log('[probe] files written');
`;
  await rt.writeFile('/home/project/make-probe.js', enc.encode(guest));
  let h = await rt.spawnProgram('node', ['make-probe.js'], { cwd: '/home/project' });
  let o1 = '';
  h.output.pipeTo(new WritableStream({ write(d) { o1 += d; } })).catch(() => {});
  await h.exit;

  const runner = `
const cp = require('child_process');
const child = cp.spawn(process.execPath, ['/home/project/bin-esbuild-probe.js', '--service=0.28.2', '--ping'], {
  stdio: ['pipe', 'pipe', 'inherit'],
  cwd: '/home/project',
});
const log = (m) => process.stdout.write('[run] ' + m + '\\\\n');
log('spawned ' + child.pid);
child.stdout.on('data', (d) => log('stdout: ' + JSON.stringify(d.toString())));
child.on('exit', (c, s) => { log('exit ' + c + ' ' + s); process.exit(0); });
// reply to pings like esbuild's main.js does
let pending = Buffer.alloc(0);
child.stdout.on('data', (d) => {
  pending = Buffer.concat([pending, d]);
  while (pending.length >= 4) {
    const len = pending.readUInt32LE(0);
    if (pending.length < 4 + len) break;
    const body = pending.subarray(4, 4 + len).toString();
    pending = pending.subarray(4 + len);
    try {
      const obj = JSON.parse(body);
      if (obj.isRequest) {
        const r = JSON.stringify({ id: obj.id, isRequest: false, value: {} });
        const rl = Buffer.alloc(4); rl.writeUInt32LE(r.length);
        child.stdin.write(Buffer.concat([rl, Buffer.from(r)]));
        process.stdout.write('[run] replied to request ' + obj.id + '\\n');
      }
    } catch {}
  }
});
setTimeout(() => {
  const s = JSON.stringify({ command: 'version-check' });
  const len = Buffer.alloc(4); len.writeUInt32LE(s.length);
  log('writing packet');
  child.stdin.write(Buffer.concat([len, Buffer.from(s)]), (e) => e ? log('write err ' + e.message) : log('write ok'));
}, 800);
setTimeout(() => { log('timeout-kill'); child.kill(); process.exit(0); }, 6000);
`;
  await rt.writeFile('/home/project/run-probe.js', enc.encode(runner));

  R.phase = 'running';
  h = await rt.spawnProgram('node', ['run-probe.js'], { cwd: '/home/project' });
  let out = '';
  h.output.pipeTo(new WritableStream({ write(d) { out += d; R.output = out; } })).catch(() => {});
  await Promise.race([h.exit, new Promise((r) => setTimeout(r, 30000))]);
  R.phase = 'done';
})();
