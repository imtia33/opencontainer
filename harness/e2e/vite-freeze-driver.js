/**
 * E2E driver: minimal Vite HMR freeze reproduction with FULL client-side
 * capture. NO diag imports (they pollute vite's module graph and skew the
 * failure mode). Captures per edit:
 *   - marker, hmrLog, console.warn/error, unhandledrejections
 *   - WS update payloads (JSON.parse hook)
 *   - whether the client's own import settled (poll-only observation)
 */
window.__ocFreeze = { phase: 'spawn', edits: [], cap: null };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocFreeze;
  const enc = new TextEncoder();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DIR = '/home/project/vite-hmr';
  const PORT = 5173;
  const EDITS = 12;

  try {
    // fresh sources (identical shape to the main driver)
    await rt.mkdir(DIR + '/src');
    await rt.writeFile(DIR + '/package.json', enc.encode(JSON.stringify({
      name: 'vite-hmr-lab', private: true, type: 'module',
      scripts: { dev: 'vite dev' }, dependencies: { vite: '7.3.7' },
    }, null, 2)));
    await rt.writeFile(DIR + '/index.html', '<!DOCTYPE html>\n<html>\n  <head><meta charset="utf-8"><title>hmr-lab</title></head>\n  <body><script type="module" src="/src/main.js"></script></body>\n</html>\n');
    await rt.writeFile(DIR + '/src/main.js', [
      "import { renderMarker } from './app.js';",
      "window.__loadedAt = Date.now();",
      "window.__hmrLog = [];",
      "window.__wsMsgs = [];",
      "window.__cap = { warns: [], errs: [], unhandled: [] };",
      "var __op = JSON.parse;",
      "JSON.parse = function (t, r) { var v = __op(t, r); try { if (v && typeof v === 'object' && typeof v.type === 'string') window.__wsMsgs.push(v); } catch (e) {} return v; };",
      "var __ow = console.warn; console.warn = function () { window.__cap.warns.push(Array.prototype.map.call(arguments, String).join(' ').slice(0, 500)); return __ow.apply(console, arguments); };",
      "var __oe = console.error; console.error = function () { window.__cap.errs.push(Array.prototype.map.call(arguments, String).join(' ').slice(0, 500)); return __oe.apply(console, arguments); };",
      "window.addEventListener('unhandledrejection', function (e) { window.__cap.unhandled.push(String(e.reason && e.reason.message || e.reason).slice(0, 400)); });",
      "window.addEventListener('vite:ws:connect', function () { window.__hmrLog.push('ws:connect'); });",
      "if (import.meta.hot) {",
      "  import.meta.hot.on('vite:beforeUpdate', function (d) { window.__hmrLog.push('beforeUpdate'); });",
      "  import.meta.hot.on('vite:afterUpdate', function () { window.__hmrLog.push('afterUpdate'); });",
      "}",
      "renderMarker();",
      '',
    ].join('\n'));
    await rt.writeFile(DIR + '/src/app.js', [
      "export const MARKER = 'e0';",
      "export function renderMarker() {",
      "  document.body.innerHTML = '';",
      "  var el = document.createElement('div');",
      "  el.id = 'marker';",
      "  el.textContent = 'HMR-' + MARKER;",
      "  document.body.appendChild(el);",
      "}",
      "if (import.meta.hot) {",
      "  import.meta.hot.accept(function (newModule) { if (newModule) newModule.renderMarker(); });",
      "}",
      '',
    ].join('\n'));

    // install (may be skipped if node_modules survived in OPFS)
    let installed = false;
    try {
      const pkg = await rt.readTextFile(DIR + '/node_modules/vite/package.json');
      installed = JSON.parse(pkg).version === '7.3.7';
    } catch (e) { /* install below */ }
    R.installSkipped = installed;
    if (!installed) {
      const inst = await rt.spawnProgram('npm', ['install', '--no-audit', '--no-fund'], { cwd: DIR });
      let out = '';
      inst.output.pipeTo(new WritableStream({ write(d) { out += d; } })).catch(() => {});
      const code = await Promise.race([inst.exit, new Promise((r) => setTimeout(() => r('TIMEOUT'), 420000))]);
      if (code !== 0) { R.phase = 'install-failed'; R.installTail = out.slice(-1000); return; }
    }

    // dev server
    R.phase = 'dev';
    const dev = await rt.spawnProgram('npm', ['run', 'dev'], { cwd: DIR });
    let devLog = '';
    dev.output.pipeTo(new WritableStream({ write(d) { devLog += d; R.devTail = devLog.slice(-500); } })).catch(() => {});
    let listened = null;
    const off = rt.on('listen', (info) => { if (info.port === PORT) listened = info; });
    const t0 = Date.now();
    while (!listened && Date.now() - t0 < 120000) await sleep(200);
    off();
    if (!listened) { R.phase = 'no-listen'; return; }
    await sleep(3000);

    // preview iframe
    const ifr = document.createElement('iframe');
    ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:280px;border:2px solid #d09fff;z-index:9999;background:#fff';
    ifr.src = rt.previewUrl(PORT);
    document.body.appendChild(ifr);
    let w = null;
    for (let i = 0; i < 100; i++) {
      try { if (ifr.contentWindow.document.getElementById('marker')) { w = ifr.contentWindow; break; } } catch (e) { /* wait */ }
      await sleep(100);
    }
    if (!w) { R.phase = 'iframe-dead'; return; }
    R.initial = { marker: w.document.getElementById('marker').textContent, loadedAt: w.__loadedAt };
    R.phase = 'edits';

    const MK = (m) => "export const MARKER = '" + m + "';\n" +
      "export function renderMarker() {\n  document.body.innerHTML = '';\n  var el = document.createElement('div');\n  el.id = 'marker';\n  el.textContent = 'HMR-' + MARKER;\n  document.body.appendChild(el);\n}\n" +
      "if (import.meta.hot) {\n  import.meta.hot.accept(function (newModule) { if (newModule) newModule.renderMarker(); });\n}\n";

    for (let i = 1; i <= EDITS; i++) {
      if (i > 1) await sleep(1200);
      await rt.writeFile(DIR + '/src/app.js', enc.encode(MK('e' + i)));
      const t1 = Date.now();
      let ok = false;
      while (Date.now() - t1 < 12000) {
        try {
          if (ifr.contentWindow.document.getElementById('marker')?.textContent === 'HMR-e' + i) { ok = true; break; }
        } catch (e) { /* frame gone */ }
        await sleep(120);
      }
      await sleep(300); // let any async failures surface
      const viteUpdatesSoFar = (devLog.match(/hmr update/g) || []).length;
      try {
        w = ifr.contentWindow;
        R.edits.push({
          i, ok, ms: Date.now() - t1,
          marker: w.document.getElementById('marker')?.textContent,
          loadedAt: w.__loadedAt,
          hmr: (w.__hmrLog || []).join(','),
          wsUpdates: (w.__wsMsgs || []).filter((m) => m.type === 'update').length,
          warns: (w.__cap.warns || []).slice(-3),
          errs: (w.__cap.errs || []).slice(-3),
          unhandled: (w.__cap.unhandled || []).slice(-3),
          viteUpdatesSoFar,
        });
      } catch (e) {
        R.edits.push({ i, ok, frameErr: String(e.message) });
      }
    }
    R.viteUpdateLines = (devLog.match(/\[vite\] hmr update/g) || []).length;
    R.viteLogTail = devLog.slice(-600);
    R.phase = 'done';
  } catch (e) {
    R.phase = 'error';
    R.error = String(e && e.stack || e);
  }
})();
