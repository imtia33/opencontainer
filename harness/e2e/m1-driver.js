/**
 * OpenContainer — browser E2E driver (m1-driver.js).
 *
 * Runs in real Chromium against the harness page (harness/server.ts).
 * Exercise: boot → node -v → node -e → npm -v (genuine CLI) → npm init -y →
 * npm install lodash (REAL registry through the oc-net bridge) → require in
 * a fresh process → npx cowsay (child process through the host manager) →
 * express install → background dev server → preview fetch through the SW →
 * kill → reload → node_modules is gone, project files persist (ephemeral
 * dependencies) → reinstall works.
 *
 * Phase A runs on injection; it arms phase B via localStorage + reload.
 *
 * Usage:
 *   agent-browser open http://localhost:7800
 *   agent-browser eval "document.head.appendChild(Object.assign(document.createElement('script'),{src:'/e2e/m1-driver.js'})).tagName"
 *   agent-browser wait --fn "window.__ocM1Result && window.__ocM1Result.done" --timeout 240000
 *   agent-browser eval "JSON.stringify(window.__ocM1Result)"
 */
window.__ocM1Result = { phase: 'a', done: false, checks: [], notes: [] };
void (async () => {
  const R = window.__ocM1Result;
  const check = (name, ok, detail = '') => {
    R.checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) });
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${String(detail).slice(0, 140)}` : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 30000, step = 50) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  };

  const t = window.__ocTerm;
  const rt = window.__ocRuntime;
  const state = window.__ocState;
  if (!t || !rt || !state) {
    R.checks.push({ name: 'harness hooks', ok: false, detail: 'missing __ocTerm/__ocRuntime/__ocState' });
    R.done = true;
    return;
  }

  // ---- terminal helpers ---------------------------------------------------
  const core = t._core.coreService;
  const type = (s) => core.triggerDataEvent(s);
  const allLines = () => {
    const b = t.buffer.active;
    const out = [];
    for (let i = 0; i < b.length; i++) {
      const l = b.getLine(i);
      if (l) out.push(l.translateToString(true));
    }
    return out;
  };
  const waitForText = (needle, ms = 30000) =>
    waitFor(() => allLines().some((l) => l.includes(needle)), ms);
  const PROMPT_RE = /oc v26\.13\.0 ❯\s*$/;
  const promptLine = () => {
    const b = t.buffer.active;
    const y = b.baseY + b.cursorY;
    const line = (b.getLine(y) || { translateToString: () => '' }).translateToString(true);
    return line.slice(0, b.cursorX);
  };
  const waitPrompt = (ms = 30000) => waitFor(() => PROMPT_RE.test(promptLine()), ms);
  const run = async (cmd, timeout = 60000) => {
    const before = t.buffer.active.length;
    type(cmd + '\r');
    await waitFor(() => t.buffer.active.length > before, 5000);
    return await waitPrompt(timeout);
  };

  const phase = localStorage.getItem('__ocM1Phase');

  // =========================================================================
  // PHASE A
  // =========================================================================
  if (phase !== 'b') {
    try {
      // 1. boot
      await waitFor(() => state.booted, 60000);
      check('kernel booted (real node lib)', state.booted, state.nodeVersion);
      check('SW registered', state.swReady, state.swReady ? 'scope /' : 'no');

      // 2. node -v
      await run('node -v');
      check('node -v', await waitForText('v26.13.0', 15000), '');

      // 3. node -e hello
      await run(`node -e 'console.log("Hello from OpenContainer")'`);
      check("node -e hello", await waitForText('Hello from OpenContainer', 15000));

      // 4. npm -v (genuine CLI)
      await run('npm -v');
      check('npm -v → 12.2.1 (genuine CLI)', await waitForText('12.2.1', 20000));

      // 5. npm init -y
      await run('npm init -y');
      check('npm init -y', await waitForText('Wrote to', 30000));

      // 6. npm install lodash (real registry!)
      const t0 = performance.now();
      await run('npm install lodash --no-audit --no-fund', 180000);
      const installMs = Math.round(performance.now() - t0);
      const addedOk = await waitForText('added 1 package', 60000);
      check('npm install lodash (real registry)', addedOk, `${installMs}ms`);

      // 7. require lodash in a fresh process
      await run(`node -e 'console.log("CHUNK=" + JSON.stringify(require("lodash").chunk([1,2,3,4],2)))'`);
      check("require('lodash').chunk", await waitForText('CHUNK=[[1,2],[3,4]]', 30000));

      // 8. npx cowsay (child process via host process manager)
      await run('npx --yes cowsay OpenContainer', 180000);
      const cow = await waitForText('(___)', 60000);
      check('npx cowsay (child process)', cow);

      // 9. express + background dev server + preview through the SW
      await run('npm install express --no-audit --no-fund', 240000);
      check('npm install express', await waitForText('added ', 60000));
      await rt.writeFile('/home/project/server.js',
        'const app=require("express")();app.get("/",(q,s)=>s.send("M1-PREVIEW-OK"));app.listen(3000,()=>console.log("SERVER-UP"));');
      {
        const readBack = await rt.readTextFile('/home/project/server.js');
        check('server.js written', readBack.includes('M1-PREVIEW-OK'), 'len=' + readBack.length);
      }
      await rt.spawn('node server.js', { background: true });
      const portUp = await waitFor(() => state.ports.includes(3000), 30000);
      check('server listening :3000', !!portUp, `ports=${state.ports.join(',')}`);
      let previewText = '';
      let previewStatus = 0;
      if (portUp) {
        try {
          const res = await fetch('/opencontainer/p/3000/');
          previewStatus = res.status;
          previewText = await res.text();
        } catch (e) {
          previewText = 'FETCH-ERR: ' + (e && e.message);
        }
        check('preview fetch through SW', previewStatus === 200 && previewText.includes('M1-PREVIEW-OK'),
          `status=${previewStatus} body=${previewText.slice(0, 60)}`);
      }
      // kill the server
      const ps = rt.ps();
      const serverProc = ps.find((p) => p.ports && p.ports.includes(3000));
      if (serverProc) rt.killProcess(serverProc.pid);
      await waitFor(() => !state.ports.includes(3000), 10000);
      check('server killed', !state.ports.includes(3000), '');

      // 10. arm phase B (ephemeral node_modules)
      localStorage.setItem('__ocM1Phase', 'b');
      R.phase = 'a-done';
      R.done = true;
      await sleep(200);
      location.reload();
      return;
    } catch (e) {
      R.checks.push({ name: 'phase-a-fatal', ok: false, detail: String(e && (e.stack || e.message || e)).slice(0, 500) });
      R.done = true;
      return;
    }
  }

  // =========================================================================
  // PHASE B (after reload — fresh session, OPFS-hydrated)
  // =========================================================================
  try {
    localStorage.removeItem('__ocM1Phase');
    await waitFor(() => state.booted, 60000);
    await waitPrompt(30000);
    // fresh boot banner should NOT contain phase A scrollback
    await run(`node -e 'console.log("NM=" + require("fs").existsSync("node_modules/lodash"))'`);
    const nmGone = !(await waitForText('NM=true', 8000)) && !!(await waitForText('NM=false', 8000));
    check('ephemeral: node_modules/lodash gone after reload', nmGone);
    await run(`node -e 'console.log("PJ=" + require("fs").existsSync("package.json"))'`);
    check('persistent: package.json survives reload', !!(await waitForText('PJ=true', 8000)));
    await run('npm install lodash --no-audit --no-fund', 180000);
    check('reinstall works', !!(await waitForText('added 1 package', 60000)));
    await run(`node -e 'console.log("CHUNK=" + JSON.stringify(require("lodash").chunk([1,2,3,4],2)))'`);
    check('require after reinstall', !!(await waitForText('CHUNK=[[1,2],[3,4]]', 30000)));
    R.phase = 'b-done';
  } catch (e) {
    R.checks.push({ name: 'phase-b-fatal', ok: false, detail: String(e && (e.stack || e.message || e)).slice(0, 500) });
  } finally {
    R.done = true;
  }
})();
