/**
 * Manual verification: dev server + preview through SW + kill.
 * Usage: inject as script tag after express is installed.
 */
(() => {
  const R = (window.__ocSrvResult = { steps: [], done: false });
  const log = (name, ok, detail = '') => {
    R.steps.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) });
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + String(detail).slice(0, 140) : ''}`);
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
    try {
      const rt = window.__ocRuntime;
      const state = window.__ocState;

      // 0. node_modules is EPHEMERAL by design (dropped on reload) —
      //    install express in-session like any real workflow would.
      const nm = await rt.readdir('/home/project/node_modules').catch(() => []);
      if (!nm.some((e) => e.name === 'express')) {
        await rt.spawn('npm install express --no-audit --no-fund');
      }
      const nm2 = await rt.readdir('/home/project/node_modules').catch(() => []);
      log('express installed', nm2.some((e) => e.name === 'express'), nm2.length + ' entries');

      // 1. write server.js via the runtime's editor-bridge API — exactly
      //    what a real IDE does (no shell quoting involved).
      const script =
        'const app=require("express")();' +
        'app.get("/",(q,s)=>s.send("M1-PREVIEW-OK"));' +
        'app.listen(3000,()=>console.log("SERVER-UP"));';
      await rt.writeFile('/home/project/server.js', script);
      const readBack = await rt.readTextFile('/home/project/server.js');
      log('server.js written (rt.writeFile)', readBack === script, 'len=' + readBack.length);

      // 2. start dev server in background
      await rt.spawn('node server.js', { background: true });
      const portUp = await waitFor(() => state.ports.includes(3000), 30000);
      log('server listening :3000', !!portUp, 'ports=' + state.ports.join(','));

      // 3. fetch through the preview SW
      let status = 0, body = '';
      if (portUp) {
        try {
          const res = await fetch('/opencontainer/p/3000/');
          status = res.status;
          body = await res.text();
        } catch (e) {
          body = 'FETCH-ERR: ' + (e && e.message);
        }
        log('preview fetch through SW', status === 200 && body.includes('M1-PREVIEW-OK'), 'status=' + status + ' body=' + body.slice(0, 60));
      }

      // 4. kill the server
      if (portUp) {
        const ps = rt.ps();
        const serverProc = ps.find((p) => p.ports && p.ports.includes(3000));
        if (serverProc) rt.killProcess(serverProc.pid);
        const gone = await waitFor(() => !state.ports.includes(3000), 10000);
        log('server killed, port closed', !!gone, 'ports=' + state.ports.join(','));
      }
      R.done = true;
      console.log('SRV-VERIFY-DONE');
    } catch (e) {
      R.steps.push({ name: 'fatal', ok: false, detail: String((e && e.stack) || e).slice(0, 500) });
      R.done = true;
      console.log('SRV-VERIFY-FATAL', e && e.message);
    }
  })();
})();
