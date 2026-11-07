/**
 * E2E driver: the TEMPORARY-ENVIRONMENT contract (product boundary §4).
 *
 * Phase A (fresh session): the host mounts project files, a GUEST process
 * writes a file, npm installs a real dependency, a guest server listens.
 * All four must be visible in the active session.
 *
 * Then the page reloads (= the session ends).
 *
 * Phase B (re-injected after reload): the fresh session must have NONE of
 * it — no host-written files, no guest-written files, no node_modules, no
 * stale server port. Losing them is EXPECTED behavior, not a bug: the host
 * supplies files again for every fresh session.
 *
 * State on window.__ocTE: { phase, checks{}, verdict }
 * Replaces the obsolete keeper-loss-driver (whose subject — cross-reload
 * persistence — was removed from the product).
 */
window.__ocTE = { phase: 'a:mount', checks: {} };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocTE;
  const enc = new TextEncoder();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DIR = '/home/project/temp-env';
  const PORT = 8891;

  const readFileOk = async (p) => {
    try { return await rt.readFile(p); } catch { return null; }
  };

  try {
    if (!localStorage.getItem('__ocTEPhaseB')) {
      // ---------------- PHASE A: populate the session -----------------------
      // 1. host-written project files
      await rt.mkdir(DIR).catch(() => {});
      await rt.writeFile(DIR + '/hello.txt', enc.encode('host-written\n'));
      await rt.writeFile(DIR + '/package.json', enc.encode(JSON.stringify({
        name: 'temp-env-lab', private: true,
        dependencies: { lodash: '^4.17.21' },
      }, null, 2)));
      R.phase = 'a:guest-write';

      // 2. guest-written file
      const gw = await rt.spawnProgram('node', ['-e',
        `require('fs').writeFileSync(${JSON.stringify(DIR + '/guest-note.txt')}, 'guest-written');` +
        " console.log('guest wrote');"]);
      let gwOut = '';
      gw.output.pipeTo(new WritableStream({ write(d) { gwOut += d; } })).catch(() => {});
      R.checks.guestWriteCode = await gw.exit;
      R.phase = 'a:npm-install';

      // 3. real npm install into the guest VFS
      const inst = await rt.spawnProgram('npm', ['install', '--no-audit', '--no-fund'], { cwd: DIR });
      let instOut = '';
      inst.output.pipeTo(new WritableStream({ write(d) { instOut += d; R.installTail = instOut.slice(-300); } })).catch(() => {});
      R.checks.npmCode = await inst.exit;
      R.phase = 'a:server';

      // 4. guest server on a port
      const srv = await rt.spawnProgram('node', ['-e',
        `require('http').createServer((q,s)=>{s.end('te')}).listen(${PORT},()=>console.log('up'));`]);
      let srvOut = '';
      srv.output.pipeTo(new WritableStream({ write(d) { srvOut += d; } })).catch(() => {});
      let listened = null;
      const off = rt.on('listen', (info) => { if (info.port === PORT) listened = info; });
      const tL = Date.now();
      while (!listened && Date.now() - tL < 20000) await sleep(100);
      off();
      R.checks.serverListened = !!listened;

      // verify all four are visible in the ACTIVE session
      R.phase = 'a:verify';
      const hello = await readFileOk(DIR + '/hello.txt');
      const note = await readFileOk(DIR + '/guest-note.txt');
      let lodashDir = null;
      try { lodashDir = (await rt.readdir(DIR + '/node_modules/lodash')).length; } catch { /* gone */ }
      const req = await rt.spawnProgram('node', ['-e',
        `console.log(require(${JSON.stringify(DIR + '/node_modules/lodash/lodash.js')}) != null ? 'REQUIRE-OK' : 'NULL')`,
        ], { cwd: DIR });
      let reqOut = '';
      req.output.pipeTo(new WritableStream({ write(d) { reqOut += d; } })).catch(() => {});
      await req.exit;
      R.phaseA = {
        hostFileVisible: !!hello,
        guestFileVisible: !!note,
        lodashInstalled: typeof lodashDir === 'number' && lodashDir > 0,
        requireWorks: reqOut.includes('REQUIRE-OK'),
        serverListened: !!listened,
        npmCode: R.checks.npmCode,
      };
      R.phase = 'a:reload';
      localStorage.setItem('__ocTEPhaseB', '1');
      localStorage.setItem('__ocTEPhaseA', JSON.stringify(R.phaseA));
      localStorage.setItem('__ocDriver', 'temp-env-driver'); // app.js re-injects this driver once after the reload
      setTimeout(() => location.reload(), 50);
      return; // page reloads; phase B is re-injected by app.js
    }

    // ---------------- PHASE B: the FRESH session ---------------------------
    localStorage.removeItem('__ocTEPhaseB');
    R.phase = 'b:boot';
    const t0 = Date.now();
    while (!window.__ocState?.booted && Date.now() - t0 < 90000) await sleep(200);
    R.checks.booted = !!window.__ocState?.booted;
    R.phaseA = JSON.parse(localStorage.getItem('__ocTEPhaseA') || 'null');
    localStorage.removeItem('__ocTEPhaseA');
    await sleep(800); // settle

    R.phase = 'b:verify';
    // NOTHING from phase A may exist in the fresh session.
    const hello = await readFileOk(DIR + '/hello.txt');
    const note = await readFileOk(DIR + '/guest-note.txt');
    let lodashDir = null;
    try { lodashDir = (await rt.readdir(DIR + '/node_modules/lodash')).length; } catch { /* gone */ }
    const req = await rt.spawnProgram('node', ['-e',
      `try { require(${JSON.stringify(DIR + '/node_modules/lodash/lodash.js')}); console.log('LEAK: require succeeded'); }` +
      " catch (e) { console.log('GONE:' + e.code); }"]);
    let reqOut = '';
    req.output.pipeTo(new WritableStream({ write(d) { reqOut += d; } })).catch(() => {});
    await req.exit;

    R.phaseB = {
      hostFileGone: hello === null,
      guestFileGone: note === null,
      nodeModulesGone: lodashDir === null,
      requireGone: reqOut.includes('GONE:'),
      serverPortGone: !rt.listeningPorts().includes(PORT),
    };
    R.verdict = {
      phaseAAllPresent: R.phaseA
        && R.phaseA.hostFileVisible && R.phaseA.guestFileVisible
        && R.phaseA.lodashInstalled && R.phaseA.requireWorks && R.phaseA.serverListened,
      phaseBAllGone: R.phaseB.hostFileGone && R.phaseB.guestFileGone
        && R.phaseB.nodeModulesGone && R.phaseB.requireGone && R.phaseB.serverPortGone,
    };
    R.verdict.temporaryEnvironment = R.verdict.phaseAAllPresent && R.verdict.phaseBAllGone;
    R.phase = 'done';
  } catch (e) {
    R.phase = 'error';
    R.error = String((e && e.stack) || e);
  }
})();
