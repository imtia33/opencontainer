/** Rapid-edit verdict: vite's own logged updates vs client receipts. */
window.__verdict = { phase: 'spawn' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__verdict;
  const enc = new TextEncoder();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DIR = '/home/project/vite-hmr';
  try {
    // ensure deps exist (keeper OPFS persistence currently drops
    // node_modules across reloads — known issue, re-install when absent)
    let installed = false;
    try {
      const pkg = await rt.readTextFile(DIR + '/node_modules/vite/package.json');
      installed = JSON.parse(pkg).version === '7.3.7';
    } catch (e) { /* install below */ }
    if (!installed) {
      R.phase = 'install';
      const inst = await rt.spawnProgram('npm', ['install', '--no-audit', '--no-fund'], { cwd: DIR });
      let out = '';
      inst.output.pipeTo(new WritableStream({ write(d) { out += d; } })).catch(() => {});
      const code = await Promise.race([inst.exit, new Promise((r) => setTimeout(() => r('TIMEOUT'), 420000))]);
      if (code !== 0) { R.phase = 'install-failed'; R.installTail = out.slice(-800); return; }
    }
    const dev = await rt.spawnProgram('npm', ['run', 'dev'], { cwd: DIR });
    let devLog = '';
    dev.output.pipeTo(new WritableStream({ write(d) { devLog += d; } })).catch(() => {});
    let listened = null;
    const off = rt.on('listen', (info) => { if (info.port === 5173) listened = info; });
    const t0 = Date.now();
    while (!listened && Date.now() - t0 < 120000) await sleep(200);
    off();
    if (!listened) { R.phase = 'no-listen'; return; }
    await sleep(2500);
    const ifr = document.createElement('iframe');
    ifr.style.cssText = 'position:fixed;right:0;top:0;width:400px;height:250px;border:2px solid #0f0;z-index:99999;background:#fff';
    ifr.src = rt.previewUrl(5173);
    document.body.appendChild(ifr);
    for (let i = 0; i < 80; i++) {
      try { if (ifr.contentWindow.document.getElementById('marker')) break; } catch (e) { /* wait */ }
      await sleep(100);
    }
    await sleep(500);
    R.phase = 'edits';
    const MK = (m) => "export const MARKER = '" + m + "';\n" +
      "export function renderMarker() {\n  document.body.innerHTML = '';\n  var el = document.createElement('div');\n  el.id = 'marker';\n  el.textContent = 'HMR-' + MARKER;\n  document.body.appendChild(el);\n}\n" +
      "if (import.meta.hot) {\n  import.meta.hot.accept(function (newModule) { if (newModule) newModule.renderMarker(); });\n}\n";
    // SAME-LENGTH markers (like the failing runs), rapid cadence
    const marks = [];
    for (let i = 1; i <= 10; i++) marks.push('z' + (i < 10 ? '0' + i : i));
    const applied = [];
    for (const m of marks) {
      await rt.writeFile(DIR + '/src/app.js', enc.encode(MK(m)));
      const t1 = Date.now();
      let ok = false;
      while (Date.now() - t1 < 4000) {
        try { if (ifr.contentWindow.document.getElementById('marker')?.textContent === 'HMR-' + m) { ok = true; break; } } catch (e) { /* wait */ }
        await sleep(40);
      }
      applied.push(m.split('').pop() + (ok ? '+' : '-'));
    }
    await sleep(1500);
    const w = ifr.contentWindow;
    R.applied = applied.join(' ');
    R.marker = w.document.getElementById('marker')?.textContent;
    R.viteLoggedUpdates = (devLog.match(/\[vite\] hmr update/g) || []).length;
    R.clientUpdates = (w.__wsMsgs || []).filter((x) => x.type === 'update').length;
    R.fullViteHmrLines = (devLog.match(/.*hmr update.*$/gm) || []).slice(-14);
    R.phase = 'done';
  } catch (e) {
    R.phase = 'error';
    R.error = String(e && e.stack || e);
  }
})();
