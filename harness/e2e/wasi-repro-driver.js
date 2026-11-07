/**
 * E2E driver: minimal rolldown WASI-binding repro with kernel traces on.
 * Requires the binding, calls a cheap sync API (parse), reports timings.
 */
window.__ocRepro = { phase: 'start', out: '', exit: null };
void (async () => {
  const rt = window.__ocRuntime;
  const SCRIPT = `
const t0 = Date.now();
console.error('[repro] requiring binding…');
const binding = require('@rolldown/binding-wasm32-wasi');
console.error('[repro] binding required in', Date.now() - t0, 'ms — keys:', Object.keys(binding).length);
const t1 = Date.now();
const ret = binding.transformSync('const x = 1', { filename: 'a.js' });
console.error('[repro] transformSync ok in', Date.now() - t1, 'ms — code:', JSON.stringify(ret.code));
console.error('[repro] DONE');
`;
  try {
    const b = new TextEncoder().encode(SCRIPT);
    await rt.writeFile('/home/project/vapp/repro-build.cjs', b);
    window.__ocRepro.phase = 'spawning';
    const h = await rt.spawnProgram('node', ['repro-build.cjs'], {
      cwd: '/home/project/vapp',
      env: { OC_WASI_TRACE: '1', OC_TRACE_WORKERS: '1' },
    });
    window.__ocRepro.phase = 'running';
    h.output.pipeTo(new WritableStream({
      write(d) { window.__ocRepro.out += d; },
    })).catch(() => {});
    const code = await h.exit;
    window.__ocRepro.exit = code;
    window.__ocRepro.phase = 'done';
  } catch (e) {
    window.__ocRepro.phase = 'error';
    window.__ocRepro.error = String(e?.stack ?? e);
  }
})();
