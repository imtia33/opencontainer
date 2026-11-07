/**
 * E2E driver: reproduce the keeper-VFS loss with a real `npm install vite`.
 * Writes project files via the host fs API, checks the KEEPER's view (rt.readdir
 * = keeper RPC) after each phase. Also mirrors the checks against a freshly
 * spawned process (host-snapshot view) to tell the two apart.
 */
window.__ocVR = { phase: 'writes', log: [] };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocVR;
  const enc = new TextEncoder();
  const dir = '/home/project/vite-repro2';
  const L = (m) => { R.log.push(String(m)); };
  const keeperView = () => rt.readdir(dir).then((d) => d.map((e) => e.name)).catch((e) => 'ERR ' + e.message);
  const snapshotView = () => rt.spawnProgram('node', ['-e',
    'const fs=require("fs");try{console.log(fs.readdirSync(process.argv[1]).join(" "))}catch(e){console.log("ERR "+e.message)}', dir])
    .then(async (h) => {
      let o = '';
      h.output.pipeTo(new WritableStream({ write(d) { o += d; } }));
      await h.exit;
      return o.trim();
    });

  try {
    // 1. host writes
    await rt.mkdir(dir).catch(() => {});
    await rt.mkdir(dir + '/src').catch(() => {});
    await rt.writeFile(dir + '/package.json', enc.encode(JSON.stringify({
      name: 'vite-repro2', private: true, version: '0.0.0', type: 'module',
      scripts: { build: 'vite build' }, devDependencies: { vite: '^7.3.0' },
    }, null, 2)));
    await rt.writeFile(dir + '/index.html', enc.encode('<!doctype html><html><body><script type="module" src="/src/main.js"></script></body></html>\n'));
    await rt.writeFile(dir + '/src/main.js', enc.encode('console.log("vr2");\n'));
    R.afterWrites = { keeper: await keeperView(), snapshot: await snapshotView() };
    R.phase = 'npm-install';

    // 2. npm install (the long part)
    const h = await rt.spawnProgram('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir });
    let out = '';
    h.output.pipeTo(new WritableStream({ write(d) { out += d; R.tail = out.slice(-1000); } }));
    const code = await h.exit;
    R.npmCode = code;
    R.afterInstall = { keeper: await keeperView(), snapshot: await snapshotView() };
    L(`install code=${code}`);
    R.phase = 'vite-build';

    // 3. vite build
    const h2 = await rt.spawnProgram('npm', ['run', 'build'], { cwd: dir });
    let out2 = '';
    h2.output.pipeTo(new WritableStream({ write(d) { out2 += d; R.tail2 = out2.slice(-1000); } }));
    const code2 = await h2.exit;
    R.buildCode = code2;
    R.afterBuild = { keeper: await keeperView(), snapshot: await snapshotView() };
    L(`build code=${code2}`);
    R.phase = 'done';
  } catch (e) {
    R.phase = 'error';
    R.error = String(e?.stack ?? e);
  }
})();
