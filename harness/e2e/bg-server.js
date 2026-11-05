/**
 * Background server test: node server.js in background, capture stdio.
 */
(() => {
  const R = (window.__ocBg = { steps: [], done: false });
  const log = (name, ok, detail = '') => {
    R.steps.push({ name, ok: !!ok, detail: String(detail).slice(0, 500) });
    console.log(`${ok ? '✓' : '✗'} ${name} — ${String(detail).slice(0, 200)}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 30000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(50);
    }
    return null;
  };

  void (async () => {
    const rt = window.__ocRuntime;
    const state = window.__ocState;
    window.__ocStdioLog = [];
    try {
      // server.js should still exist (OPFS persistence)
      const ls = await rt.readdir('/home/project');
      log('server.js exists', ls.some((e) => e.name === 'server.js'), ls.map((e) => e.name).join(','));

      // background spawn
      rt.spawn('node server.js', { background: true }).catch((e) => log('bg spawn rejected', false, e.message));
      await sleep(8000);
      log('after 8s: ps', true, JSON.stringify(rt.ps()));
      log('after 8s: ports', state.ports.length > 0, JSON.stringify(state.ports));
      log('stdio', true, JSON.stringify((window.__ocStdioLog || []).join('').slice(-600)));
    } catch (e) {
      R.steps.push({ name: 'fatal', ok: false, detail: String((e && e.stack) || e).slice(0, 600) });
    }
    R.done = true;
    console.log('BG-DONE');
  })();
})();
