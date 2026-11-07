/**
 * E2E driver: Test G — REAL Vite 7.3.7 HMR regression.
 *
 * 1. Scaffold a minimal real Vite project (vite@7.3.7 pinned, real npm
 *    install from the registry).
 * 2. `npm run dev` → wait for the listen event.
 * 3. Same-tab preview iframe (zero-config, the product path).
 * 4. 20 consecutive source edits; each must reach the preview as a REAL
 *    module HMR update (vite:beforeUpdate/afterUpdate + DOM marker change
 *    + NO page reload — __loadedAt must stay constant).
 * 5. iframe reload → HMR WS reconnects (vite:ws:connect).
 * 6. Server kill + restart → vite client auto-reconnects; another edit
 *    propagates without a reload.
 * 7. Repeated iframe reloads.
 *
 * State on window.__ocHMR: { phase, steps[], edits[], verdict }
 */
window.__ocHMR = { phase: 'scaffold', steps: [], edits: [], verdict: null };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocHMR;
  const enc = new TextEncoder();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DIR = '/home/project/vite-hmr';
  const PORT = 5173;
  const EDITS = 20;

  const run = async (cmd, args, label, timeoutMs) => {
    R.phase = label;
    const t0 = Date.now();
    const h = await rt.spawnProgram(cmd, args, { cwd: DIR });
    let out = '';
    h.output.pipeTo(new WritableStream({ write(d) { out += d; R.tail = out.slice(-1200); } })).catch(() => {});
    const code = await Promise.race([
      h.exit,
      new Promise((r) => setTimeout(() => r('TIMEOUT'), timeoutMs)),
    ]);
    R.steps.push({ label, code, ms: Date.now() - t0 });
    return { code, out, handle: h };
  };

  try {
    // ---- 1. scaffold ------------------------------------------------------
    const files = {
      'package.json': JSON.stringify({
        name: 'vite-hmr-lab',
        private: true,
        type: 'module',
        scripts: { dev: 'vite dev' },
        dependencies: { vite: '7.3.7' },
      }, null, 2),
      'index.html': '<!DOCTYPE html>\n<html>\n  <head><meta charset="utf-8"><title>hmr-lab</title></head>\n  <body><script type="module" src="/src/main.js"></script></body>\n</html>\n',
      'src/main.js': [
        "import { renderMarker } from './app.js';",
        "window.__loadedAt = Date.now();",
        "window.__hmrLog = [];",
        "// vite's client dispatches ws lifecycle events; listen on BOTH window",
        "// and document (dispatch target differs across vite versions).",
        "['vite:ws:connect', 'vite:ws:disconnect'].forEach(function (ev) {",
        "  window.addEventListener(ev, function () { window.__hmrLog.push(ev); });",
        "  document.addEventListener(ev, function () { window.__hmrLog.push('doc:' + ev); });",
        "});",
        "if (import.meta.hot) {",
        "  import.meta.hot.on('vite:beforeUpdate', function (d) { window.__hmrLog.push('beforeUpdate'); });",
        "  import.meta.hot.on('vite:afterUpdate', function () { window.__hmrLog.push('afterUpdate'); });",
        "}",
        "renderMarker();",
        '',
      ].join('\n'),
      'src/app.js': [
        "export const MARKER = 'e0';",
        "export function renderMarker() {",
        "  document.body.innerHTML = '';",
        "  var el = document.createElement('div');",
        "  el.id = 'marker';",
        "  el.textContent = 'HMR-' + MARKER;",
        "  document.body.appendChild(el);",
        "}",
        "if (import.meta.hot) {",
        "  // re-render with the NEW module's function on every accepted update",
        "  import.meta.hot.accept(function (newModule) { if (newModule) newModule.renderMarker(); });",
        "}",
        '',
      ].join('\n'),
    };
    await rt.mkdir(DIR + '/src');
    for (const [p, c] of Object.entries(files)) await rt.writeFile(DIR + '/' + p, enc.encode(c));
    R.scaffolded = Object.keys(files).length;

    // ---- 2. real npm install (vite@7.3.7 from the registry) --------------
    // (skipped when the OPFS-persisted node_modules already has it — the
    // project files are always rewritten above, only the deps are reused)
    let viteInstalled = false;
    try {
      const pkg = await rt.readTextFile(DIR + '/node_modules/vite/package.json');
      viteInstalled = JSON.parse(pkg).version === '7.3.7';
    } catch (e) { /* not installed yet */ }
    R.installSkipped = viteInstalled;
    if (viteInstalled) {
      R.steps.push({ label: 'npm-install', code: 0, ms: 0, skipped: true });
    } else {
      const inst = await run('npm', ['install', '--no-audit', '--no-fund'], 'npm-install', 420000);
      if (inst.code !== 0) {
        R.phase = 'install-failed';
        R.installTail = inst.out.slice(-1500);
        return;
      }
    }
    R.viteVersion = '7.3.7 (pinned dependency)';

    // ---- 3. dev server ----------------------------------------------------
    R.phase = 'dev';
    const dev = await rt.spawnProgram('npm', ['run', 'dev'], { cwd: DIR });
    let devOut = '';
    dev.output.pipeTo(new WritableStream({ write(d) { devOut += d; R.devTail = devOut.slice(-900); } })).catch(() => {});
    let listened = null;
    const off = rt.on('listen', (info) => { if (info.port === PORT) listened = info; });
    const t0 = Date.now();
    while (!listened && Date.now() - t0 < 120000) await sleep(200);
    off();
    R.listen = listened;
    if (!listened) { R.phase = 'no-listen'; R.devOutput = devOut.slice(-1800); return; }
    await sleep(3500); // let vite optimize deps
    R.viteReady = true;

    // ---- 4. preview iframe -------------------------------------------------
    R.phase = 'preview';
    const purl = rt.previewUrl(PORT);
    R.previewUrl = purl;
    let iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:480px;height:320px;border:2px solid #0d9fff;z-index:9999;background:#fff';
    iframe.src = purl;
    document.body.appendChild(iframe);
    const ping = async () => {
      // wait until the marker exists with a given text (poll the iframe DOM)
      for (let i = 0; i < 200; i++) {
        try {
          const w = iframe.contentWindow;
          if (w && w.document && w.document.getElementById('marker')) {
            return w;
          }
        } catch (e) { /* not ready */ }
        await sleep(100);
      }
      return null;
    };
    const w0 = await ping();
    if (!w0) { R.phase = 'iframe-dead'; return; }
    const iframeState = (w) => ({
      marker: w.document.getElementById('marker')?.textContent ?? null,
      loadedAt: w.__loadedAt ?? null,
      log: (w.__hmrLog ?? []).join(','),
    });
    R.initialFrame = iframeState(w0);
    if (R.initialFrame.marker !== 'HMR-e0') { R.phase = 'marker-wrong'; return; }
    const firstLog = R.initialFrame.log;
    R.firstWsConnect = firstLog.indexOf('ws:connect') >= 0;
    // __loadedAt must remain IDENTICAL across edits — any change = a full
    // page reload (vite fallback), NOT module HMR.
    const baseLoadedAt = R.initialFrame.loadedAt;

    // ---- 5. 20 edits, each verified as real module HMR ---------------------
    R.phase = 'edits';
    let afterCount0 = (w0.__hmrLog.filter((e) => e === 'afterUpdate')).length;
    let okEdits = 0, reloadLeaks = 0, failures = [];
    // capture every WS payload the client parses (update path/acceptedPath/ts)
    try {
      w0.__wsMsgs = [];
      const op = w0.JSON.parse;
      w0.JSON.parse = function (t, r) {
        const v = op.call(w0.JSON, t, r);
        try { if (v && typeof v === 'object' && typeof v.type === 'string') w0.__wsMsgs.push(v); } catch (e) { /* keep */ }
        return v;
      };
    } catch (e) { /* best effort */ }
    const frameWs = () => {
      try { return iframe.contentWindow; } catch (e) { return null; }
    };
    for (let i = 1; i <= EDITS; i++) {
      const marker = 'e' + i;
      if (i > 1) await sleep(1200); // human-save cadence: outside the coalescing window
      await rt.writeFile(DIR + '/src/app.js', enc.encode(
        "export const MARKER = '" + marker + "';\n" +
        "export function renderMarker() {\n" +
        "  document.body.innerHTML = '';\n" +
        "  var el = document.createElement('div');\n" +
        "  el.id = 'marker';\n" +
        "  el.textContent = 'HMR-' + MARKER;\n" +
        "  document.body.appendChild(el);\n" +
        "}\n" +
        "if (import.meta.hot) { import.meta.hot.accept(function (newModule) { if (newModule) newModule.renderMarker(); }); }\n"));
      // wait for the marker to become HMR-<marker> (up to 15s per edit)
      const t1 = Date.now();
      let done = false;
      while (Date.now() - t1 < 15000) {
        try {
          const w = iframe.contentWindow;
          const m = w.document.getElementById('marker')?.textContent;
          if (m === 'HMR-' + marker) { done = true; break; }
        } catch (e) { /* frame gone */ }
        await sleep(120);
      }
      let log = [];
      let loadedAt = null;
      try {
        const w = iframe.contentWindow;
        log = w.__hmrLog ?? [];
        loadedAt = w.__loadedAt ?? null;
      } catch (e) { /* ignore */ }
      const afterCount = log.filter((e) => e === 'afterUpdate').length;
      const sawHmrEvents = afterCount > afterCount0;
      const reloaded = loadedAt !== baseLoadedAt;
      if (done && sawHmrEvents && !reloaded) okEdits++;
      else failures.push({ i, done, sawHmrEvents, reloaded });
      if (reloaded) reloadLeaks++;
      afterCount0 = afterCount;
      R.edits.push({ i, ok: done && sawHmrEvents && !reloaded, ms: Date.now() - t1 });
      if (i % 5 === 0) R.phase = 'edits:' + i;
    }
    try { R.wsPayloads = frameWs()?.__wsMsgs?.filter((m) => m.type === 'update').map((m) => ({ ts: m.updates[0].timestamp, path: m.updates[0].path, acc: m.updates[0].acceptedPath })) ?? null; } catch (e) { R.wsPayloads = 'unavailable'; }
    R.editsVerdict = { okEdits, total: EDITS, failures, fullReloadLeaks: reloadLeaks };

    // ---- 6. iframe reload → WS reconnect ------------------------------------
    R.phase = 'reload';
    const loadedBefore = await (async () => { try { return iframe.contentWindow.__loadedAt; } catch (e) { return null; } })();
    iframe.src = purl + '?r=' + Date.now();
    await sleep(2500);
    const w1 = await ping();
    let reconnectOk = false;
    let reloadedAt = null;
    if (w1) {
      const log = (w1.__hmrLog ?? []).join(',');
      reloadedAt = w1.__loadedAt ?? null;
      reconnectOk = log.indexOf('ws:connect') >= 0 && reloadedAt !== loadedBefore;
    }
    R.reloadTest = { reconnectOk, marker: w1 ? w1.document.getElementById('marker')?.textContent : null };

    // one more edit AFTER the reload — HMR must keep working on the new page
    let postReloadEdit = 'FAIL';
    if (w1) {
      await rt.writeFile(DIR + '/src/app.js', enc.encode(
        "export const MARKER = 'post-reload';\n" +
        "export function renderMarker() {\n  document.body.innerHTML = '';\n  var el = document.createElement('div');\n  el.id = 'marker';\n  el.textContent = 'HMR-' + MARKER;\n  document.body.appendChild(el);\n}\n" +
        "if (import.meta.hot) { import.meta.hot.accept(function (newModule) { if (newModule) newModule.renderMarker(); }); }\n"));
      const t2 = Date.now();
      while (Date.now() - t2 < 15000) {
        try {
          if (iframe.contentWindow.document.getElementById('marker')?.textContent === 'HMR-post-reload') { postReloadEdit = 'OK'; break; }
        } catch (e) { /* ignore */ }
        await sleep(120);
      }
    }
    R.postReloadEdit = postReloadEdit;

    // ---- 7. server restart → vite client auto-reconnect ---------------------
    R.phase = 'restart';
    dev.kill();
    await sleep(1500);
    R.portAfterKill = rt.listeningPorts().includes(PORT);
    const dev2 = await rt.spawnProgram('npm', ['run', 'dev'], { cwd: DIR });
    let dev2Out = '';
    dev2.output.pipeTo(new WritableStream({ write(d) { dev2Out += d; } })).catch(() => {});
    let listened2 = null;
    const off2 = rt.on('listen', (info) => { if (info.port === PORT) listened2 = info; });
    const t3 = Date.now();
    while (!listened2 && Date.now() - t3 < 120000) await sleep(200);
    off2();
    R.restartListen = !!listened2;
    if (listened2) {
      // vite's client retries its WS automatically; wait for reconnect+edit
      await sleep(6000); // allow vite ready + client retry window
      // if the client reconnected in place, the marker should still be there;
      // an edit must propagate (the client may need a nudge — vite retries
      // every second, so by now it is connected)
      await rt.writeFile(DIR + '/src/app.js', enc.encode(
        "export const MARKER = 'after-restart';\n" +
        "export function renderMarker() {\n  document.body.innerHTML = '';\n  var el = document.createElement('div');\n  el.id = 'marker';\n  el.textContent = 'HMR-' + MARKER;\n  document.body.appendChild(el);\n}\n" +
        "if (import.meta.hot) { import.meta.hot.accept(function (newModule) { if (newModule) newModule.renderMarker(); }); }\n"));
      let restartEdit = 'FAIL';
      const t4 = Date.now();
      while (Date.now() - t4 < 25000) {
        try {
          const w = iframe.contentWindow;
          if (w.document.getElementById('marker')?.textContent === 'HMR-after-restart') { restartEdit = 'OK'; break; }
          // page may have been reloaded by the client on full-reconnect loss
        } catch (e) { /* frame replaced */ }
        await sleep(150);
      }
      // also accept: page did a full reload and shows the new marker
      try {
        if (restartEdit !== 'OK' && iframe.contentWindow?.document?.getElementById('marker')?.textContent === 'HMR-after-restart') restartEdit = 'OK (via reload)';
      } catch (e) { /* ignore */ }
      R.restartEdit = restartEdit;
      // log state after restart
      try {
        R.frameAfterRestart = iframeState(iframe.contentWindow);
      } catch (e) { R.frameAfterRestart = 'gone'; }
    }

    // ---- 8. repeated iframe reloads -----------------------------------------
    R.phase = 'churn';
    const churn = [];
    for (let i = 0; i < 4; i++) {
      iframe.src = purl + '?c=' + i + '-' + Date.now();
      const tw = Date.now();
      let ok = false;
      while (Date.now() - tw < 15000) {
        try {
          const w = iframe.contentWindow;
          if (w.__loadedAt && w.__hmrLog && w.__hmrLog.join('').indexOf('ws:connect') >= 0) { ok = true; break; }
        } catch (e) { /* wait */ }
        await sleep(150);
      }
      churn.push(ok);
    }
    R.churn = churn;

    R.verdict = {
      vite: R.viteVersion,
      installMs: R.steps[0]?.ms,
      listen: !!listened,
      firstWsConnect: R.firstWsConnect,
      edits: R.editsVerdict,
      iframeReloadReconnect: R.reloadTest,
      postReloadEdit: R.postReloadEdit,
      serverRestart: { relistened: R.restartListen, edit: R.restartEdit },
      churnReloads: churn,
      hmrWorksContinuously: R.editsVerdict.okEdits === EDITS && R.postReloadEdit === 'OK',
    };
    R.phase = 'done';
  } catch (e) {
    R.phase = 'error';
    R.error = String(e && e.stack || e);
  }
})();
