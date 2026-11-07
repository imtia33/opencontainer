/**
 * E2E diagnostic driver: vite dev-server KILL + RESTART WS reconnect.
 *
 * Difference vs vite-hmr-driver: (a) index.html carries an INLINE
 * pre-module WebSocket wrapper — the shim is injected by the SW before any
 * page script, so wrapping window.WebSocket synchronously logs every WS
 * instance open/close/error with timestamps (no listener-registration race);
 * (b) the post-restart marker poll runs 150s (> the 90s stale-route sweep)
 * and records the FIRST time the marker flips, to discriminate
 * sweep-eventually-heals vs reconnects-never-succeed.
 *
 * State on window.__ocRS: { phase, steps, wsLog[], markerTimeline[], ... }
 */
window.__ocRS = { phase: 'scaffold', steps: [], wsLog: [], markerTimeline: [] };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocRS;
  const enc = new TextEncoder();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DIR = '/home/project/vite-restart';
  const PORT = 5177;
  const T0 = Date.now();
  const rel = () => Date.now() - T0;

  const APP = (mark) =>
    "export const MARKER = '" + mark + "';\n" +
    "export function renderMarker() {\n" +
    "  document.body.innerHTML = '';\n" +
    "  var el = document.createElement('div');\n" +
    "  el.id = 'marker';\n" +
    "  el.textContent = 'HMR-' + MARKER;\n" +
    "  document.body.appendChild(el);\n" +
    "}\n" +
    "if (import.meta.hot) { import.meta.hot.accept(function (m) { if (m) m.renderMarker(); }); }\n";

  const appFile = (mark) => enc.encode(APP(mark));

  try {
    // ---- 1. scaffold (index.html has the WS wrapper inline, FIRST) --------
    R.phase = 'scaffold';
    await rt.mkdir(DIR + '/src').catch(() => {});
    await rt.writeFile(DIR + '/package.json', enc.encode(JSON.stringify({
      name: 'vite-restart-lab', private: true, type: 'module',
      scripts: { dev: 'vite dev --port ' + PORT + ' --strictPort' },
      dependencies: { vite: '7.3.7' },
    }, null, 2)));
    await rt.writeFile(DIR + '/index.html', enc.encode([
      '<!DOCTYPE html>',
      '<html>',
      '  <head><meta charset="utf-8"><title>restart-lab</title></head>',
      '  <body>',
      /* INLINE sync script: runs BEFORE @vite/client (a module script) —
       * wraps the shim's WebSocket class so every instance is logged with
       * timestamps. The shim was injected by the SW before any page script,
       * so window.WebSocket here is ALREADY the OC shim. */
      '    <script>',
      '      window.__wsLog = [];',
      '      (function () {',
      '        var Real = window.WebSocket;',
      '        function LogWS(url, protocols) {',
      '          var ws = (protocols === undefined) ? new Real(url) : new Real(url, protocols);',
      '          var entry = { url: String(url), born: Date.now(), open: null, close: null, errors: [] };',
      '          window.__wsLog.push(entry);',
      '          window.__wsLast = ws;',
      '          try {',
      '            ws.addEventListener("open", function () { entry.open = Date.now(); entry.rs = ws.readyState; });',
      '            ws.addEventListener("close", function (e) { entry.close = { t: Date.now(), code: e.code, clean: e.wasClean, rs: ws.readyState }; });',
      '            ws.addEventListener("error", function () { entry.errors.push(Date.now()); });',
      '          } catch (e) { entry.wrapError = String(e); }',
      '          return ws;',
      '        }',
      '        try { LogWS.prototype = Real.prototype; } catch (e) {}',
      '        LogWS.CONNECTING = 0; LogWS.OPEN = 1; LogWS.CLOSING = 2; LogWS.CLOSED = 3;',
      '        window.WebSocket = LogWS;',
      '      })();',
      '    </script>',
      '    <script type="module" src="/src/main.js"></script>',
      '  </body>',
      '</html>',
      '',
    ].join('\n')));
    await rt.writeFile(DIR + '/src/main.js', enc.encode([
      "import { renderMarker } from './app.js';",
      'window.__loadedAt = Date.now();',
      'renderMarker();',
      '',
    ].join('\n')));
    await rt.writeFile(DIR + '/src/app.js', appFile('e0'));

    // ---- 2. install --------------------------------------------------------
    R.phase = 'npm-install';
    const tI = Date.now();
    const ins = await rt.spawnProgram('npm', ['install', '--no-audit', '--no-fund'], { cwd: DIR });
    let insOut = '';
    ins.output.pipeTo(new WritableStream({ write(d) { insOut += d; } })).catch(() => {});
    const insCode = await ins.exit;
    R.steps.push({ label: 'npm-install', code: insCode, ms: Date.now() - tI, tail: insOut.slice(-300) });
    if (insCode !== 0) { R.phase = 'install-failed'; return; }

    // ---- 3. dev server -----------------------------------------------------
    R.phase = 'dev';
    const dev = await rt.spawnProgram('npm', ['run', 'dev'], { cwd: DIR });
    let devOut = '';
    dev.output.pipeTo(new WritableStream({ write(d) { devOut += d; R.devTail = devOut.slice(-600); } })).catch(() => {});
    let listened = null;
    const off = rt.on('listen', (info) => { if (info.port === PORT) listened = info; });
    const tL = Date.now();
    while (!listened && Date.now() - tL < 120000) await sleep(200);
    off();
    R.listen = !!listened;
    if (!listened) { R.phase = 'no-listen'; R.devOutput = devOut.slice(-1500); return; }
    await sleep(4000); // vite optimize deps

    // ---- 4. iframe ---------------------------------------------------------
    R.phase = 'preview';
    const purl = rt.previewUrl(PORT);
    R.previewUrl = purl;
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:280px;border:2px solid #0d9fff;z-index:9999;background:#fff';
    iframe.src = purl;
    document.body.appendChild(iframe);
    const markerOf = () => {
      try { return iframe.contentWindow?.document?.getElementById('marker')?.textContent ?? null; }
      catch { return 'ERR'; }
    };
    const tM = Date.now();
    while (markerOf() !== 'HMR-e0' && Date.now() - tM < 20000) await sleep(100);
    R.initialMarker = markerOf();
    if (R.initialMarker !== 'HMR-e0') { R.phase = 'iframe-dead'; return; }
    R.initialWs = await (async () => { try { return JSON.parse(JSON.stringify(iframe.contentWindow.__wsLog ?? [])); } catch { return null; } })();
    R.loadedAt0 = await (async () => { try { return iframe.contentWindow.__loadedAt; } catch { return null; } })();

    // ---- 5. baseline edit (HMR sanity before any kill) ----------------------
    R.phase = 'baseline-edit';
    await rt.writeFile(DIR + '/src/app.js', appFile('base1'));
    const tB = Date.now();
    while (markerOf() !== 'HMR-base1' && Date.now() - tB < 15000) await sleep(120);
    R.baselineEditOk = markerOf() === 'HMR-base1';
    R.baselineLoadedAt = await (async () => { try { return iframe.contentWindow.__loadedAt; } catch { return null; } })();
    R.markerTimeline.push({ t: rel(), ev: 'baseline-edit', marker: markerOf() });

    // ---- 6. KILL ------------------------------------------------------------
    R.phase = 'kill';
    const killT = rel();
    R.killAt = killT;
    dev.kill();
    await sleep(2000);
    R.portAfterKill = rt.listeningPorts().includes(PORT);
    R.wsLogAtKill = await (async () => { try { return JSON.parse(JSON.stringify(iframe.contentWindow.__wsLog ?? [])); } catch { return null; } })();

    // ---- 7. RESTART ---------------------------------------------------------
    R.phase = 'restart';
    const dev2 = await rt.spawnProgram('npm', ['run', 'dev'], { cwd: DIR });
    let dev2Out = '';
    dev2.output.pipeTo(new WritableStream({ write(d) { dev2Out += d; R.dev2Tail = dev2Out.slice(-600); } })).catch(() => {});
    let listened2 = null;
    const off2 = rt.on('listen', (info) => { if (info.port === PORT) listened2 = info; });
    const tL2 = Date.now();
    while (!listened2 && Date.now() - tL2 < 120000) await sleep(200);
    off2();
    R.relistened = !!listened2;
    R.relistenAt = rel();
    if (!listened2) { R.phase = 'no-relisten'; R.dev2Output = dev2Out.slice(-1500); return; }
    await sleep(6000); // vite ready + client retry window

    // ---- 8. post-restart edit; poll 150s (> 90s stale sweep) ----------------
    R.phase = 'post-restart-edit';
    await rt.writeFile(DIR + '/src/app.js', appFile('after-restart'));
    const editAt = rel();
    const tP = Date.now();
    let marker = markerOf();
    while (Date.now() - tP < 150000) {
      const m = markerOf();
      if (m !== marker) { R.markerTimeline.push({ t: rel(), ev: 'marker-change', from: marker, to: m }); marker = m; }
      if (marker === 'HMR-after-restart') break;
      await sleep(500);
    }
    R.postRestartEdit = marker === 'HMR-after-restart' ? 'OK' : 'FAIL';
    R.postRestartEditLandedAt = marker === 'HMR-after-restart' ? rel() - editAt : null;
    R.markerTimeline.push({ t: rel(), ev: 'final', marker, postRestartEdit: R.postRestartEdit });

    // did the PAGE reload at any point? loadedAt change = full reload
    R.loadedAtFinal = await (async () => { try { return iframe.contentWindow.__loadedAt; } catch { return null; } })();

    // full WS log with timestamps (from the CURRENT page instance — if the
    // page reloaded, __wsLog restarted; we keep what we can read)
    R.wsLogFinal = await (async () => { try { return JSON.parse(JSON.stringify(iframe.contentWindow.__wsLog ?? [])); } catch { return null; } })();
    R.frameAlive = markerOf() !== null;

    R.phase = 'done';
  } catch (e) {
    R.phase = 'error';
    R.error = String((e && e.stack) || e);
  }
})();
