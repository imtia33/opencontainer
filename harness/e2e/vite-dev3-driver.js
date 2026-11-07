/**
 * E2E driver: `npm run dev` in vite-repro2 (fresh vite install from OPFS)
 * + same-tab preview + HMR + keeper-loss watch.
 *
 * The dev script is added via a HOST write into a package.json that was
 * hydrated from OPFS — the exact condition under which the first-run
 * keeper-VFS loss happened.
 */
window.__ocVD = { phase: 'devscript', log: [] };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocVD;
  const enc = new TextEncoder();
  const dir = '/home/project/vite-repro2';
  const L = (m) => { R.log.push(String(m)); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const keeperHas = async (p) => {
    try { await rt.readTextFile(p); return true; } catch { return false; }
  };

  try {
    // 0. add the dev script via host write into the OPFS-hydrated package.json
    const pkgTxt = await rt.readTextFile(dir + '/package.json');
    const pkg = JSON.parse(pkgTxt);
    pkg.scripts.dev = 'vite dev';
    await rt.writeFile(dir + '/package.json', enc.encode(JSON.stringify(pkg, null, 2)));
    R.devScriptInKeeper = await keeperHas(dir + '/package.json');
    R.phase = 'spawn';

    // 1. spawn the dev server
    const h = await rt.spawnProgram('npm', ['run', 'dev'], { cwd: dir });
    let out = '';
    h.output.pipeTo(new WritableStream({ write(d) { out += d; R.tail = out.slice(-1500); } })).catch(() => {});

    // 2. wait for listen
    let listened = null;
    const off = rt.on('listen', (info) => { listened = info; });
    const t0 = Date.now();
    while (!listened && Date.now() - t0 < 120000) await sleep(200);
    off();
    R.listen = listened;
    if (!listened) { R.phase = 'no-listen'; R.output = out.slice(-2000); return; }
    R.phase = 'listening';
    L(`dev server on :${listened.port}`);
    await sleep(4000); // let vite settle (optimize deps etc.)
    R.devOutput = out.slice(-1200);

    // 3. fetch the preview URL through the SW
    const url = rt.previewUrl(listened.port);
    R.previewUrl = url;
    const htmlRes = await fetch(url, { cache: 'no-store' });
    R.htmlStatus = htmlRes.status;
    R.html = (await htmlRes.text()).slice(0, 600);

    // 4. the transformed module
    const modRes = await fetch(url + 'src/main.js', { cache: 'no-store' });
    R.modStatus = modRes.status;
    R.mod = (await modRes.text()).slice(0, 400);

    // 5. HMR: edit the source via a HOST write, re-fetch
    await rt.writeFile(dir + '/src/main.js', enc.encode(
      'document.body.textContent = "EDITED via HMR " + Date.now();\nconsole.log("edited");\n'));
    await sleep(2000);
    const mod2Res = await fetch(url + 'src/main.js?t=' + Date.now(), { cache: 'no-store' });
    R.mod2Status = mod2Res.status;
    R.mod2 = (await mod2Res.text()).slice(0, 400);
    R.hmrWorked = /EDITED via HMR/.test(R.mod2);

    // 6. keeper watch: did package.json / src/main.js survive in the keeper?
    R.keeperAfterHmr = {
      pkg: await keeperHas(dir + '/package.json'),
      main: await keeperHas(dir + '/src/main.js'),
      idx: await keeperHas(dir + '/index.html'),
    };

    // 7. process + port state
    R.ports = rt.listeningPorts();
    R.phase = 'done';
  } catch (e) {
    R.phase = 'error';
    R.error = String(e?.stack ?? e);
  }
})();
