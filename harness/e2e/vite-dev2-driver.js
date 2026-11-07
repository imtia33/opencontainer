/**
 * E2E driver: `npm run dev` (vite dev server) in the guest + same-tab preview.
 * Runs in /home/project/minivite (created by vite-min-driver — requires the
 * page NOT to have been reloaded since, or re-run vite-min-driver first).
 *
 * Steps:
 *  1. spawn `npm run dev` (background)
 *  2. wait for the 'listen' event → port + previewUrl
 *  3. fetch the preview URL through the ServiceWorker → expect vite's HTML
 *  4. fetch the transformed module /src/main.js → expect vite-transformed ESM
 *  5. HMR: edit src/main.js in the guest fs, re-fetch → expect the new code
 *  6. verify the dev server process + port teardown
 */
window.__ocDev = { phase: 'start', log: [] };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocDev;
  const L = (m) => { R.log.push(String(m)); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const enc = new TextEncoder();

  try {
    // 0. minivite must exist
    const has = await rt.readdir('/home/project/minivite').then((d) => d.some((e) => e.name === 'node_modules')).catch(() => false);
    if (!has) { R.phase = 'no-minivite'; return; }

    // 1. spawn the dev server
    R.phase = 'spawn';
    const h = await rt.spawnProgram('npm', ['run', 'dev'], { cwd: '/home/project/minivite' });
    let out = '';
    h.output.pipeTo(new WritableStream({ write(d) { out += d; R.tail = out.slice(-1500); } })).catch(() => {});

    // 2. wait for listen
    let listened = null;
    const off = rt.on('listen', (info) => { listened = info; });
    const t0 = Date.now();
    while (!listened && Date.now() - t0 < 90000) await sleep(200);
    off();
    R.listen = listened;
    if (!listened) { R.phase = 'no-listen'; R.output = out.slice(-2000); return; }
    R.phase = 'listening';
    L(`dev server on :${listened.port}`);
    await sleep(3500); // let vite settle (optimize deps etc.)
    R.devOutput = out.slice(-1200);

    // 3. fetch the preview URL through the SW
    const url = rt.previewUrl(listened.port);
    R.previewUrl = url;
    const htmlRes = await fetch(url, { cache: 'no-store' });
    R.htmlStatus = htmlRes.status;
    R.html = (await htmlRes.text()).slice(0, 700);

    // 4. the transformed module
    const modRes = await fetch(url + 'src/main.js', { cache: 'no-store' });
    R.modStatus = modRes.status;
    R.mod = (await modRes.text()).slice(0, 500);

    // 5. HMR: edit the source, re-fetch
    await rt.writeFile('/home/project/minivite/src/main.js', enc.encode(
      'document.body.textContent = "EDITED via HMR " + Date.now();\nconsole.log("edited");\n'));
    await sleep(1800);
    const mod2Res = await fetch(url + 'src/main.js?t=' + Date.now(), { cache: 'no-store' });
    R.mod2Status = mod2Res.status;
    R.mod2 = (await mod2Res.text()).slice(0, 500);
    R.hmrWorked = /EDITED via HMR/.test(R.mod2);

    // 6. process + port state
    R.ports = rt.listeningPorts();
    R.phase = 'done';
  } catch (e) {
    R.phase = 'error';
    R.error = String(e?.stack ?? e);
  }
})();
