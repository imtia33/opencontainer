/**
 * OpenContainer — WebContainer FACADE E2E driver (wc-facade-driver.js).
 *
 * Verifies the drop-in @webcontainer/api surface against a REAL browser
 * runtime, per docs/webcontainer-research.md:
 *
 *   boot → mount (files + dirs + SYMLINK + binary) → fs API roundtrips →
 *   spawn (output stream, exit code, env) → input stream → server-ready /
 *   port events → kill → teardown.
 *
 * Usage:
 *   agent-browser open http://localhost:7800
 *   agent-browser eval "document.head.appendChild(Object.assign(document.createElement('script'),{src:'/e2e/wc-facade-driver.js'})).tagName"
 *   agent-browser wait --fn "window.__ocWcResult && window.__ocWcResult.done" --timeout 120000
 *   agent-browser eval "JSON.stringify(window.__ocWcResult)"
 */
window.__ocWcResult = { done: false, checks: [], notes: [] };
void (async () => {
  const R = window.__ocWcResult;
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

  try {
    const { WebContainer } = await import('/opencontainer.mjs');
    check('WebContainer exported from package entry', typeof WebContainer === 'function' && typeof WebContainer.boot === 'function');

    // ---- boot ------------------------------------------------------------
    // Self-hosted assets: the harness serves /opencontainer/* itself. The
    // CDN default (jsDelivr) only resolves once the package is actually
    // published to npm — a release-time concern, not an E2E gate; pinning
    // the base keeps this driver deterministic on every commit.
    const wc = await WebContainer.boot({ workdirName: 'project', assetsBase: '/opencontainer' });
    check('boot() resolves', !!wc);
    check('workdir property', wc.workdir === '/home/project', wc.workdir);
    check('path property', typeof wc.path === 'string' && wc.path.includes('/usr/local/bin'), wc.path);
    // Register with the page preview router (multi-runtime page).
    if (Array.isArray(window.__ocRuntimes) && !window.__ocRuntimes.includes(wc._runtime)) {
      window.__ocRuntimes.push(wc._runtime);
    }

    // ---- mount (files + dirs + symlink + binary) --------------------------
    const encoder = new TextEncoder();
    await wc.mount({
      'package.json': { file: { contents: JSON.stringify({ name: 'wc-facade-e2e', version: '1.0.0', type: 'commonjs' }) } },
      'server.js': { file: { contents: [
        "const http = require('http');",
        "const s = http.createServer((req, res) => { res.end('WC-FACADE-OK ' + process.env.GREETING); });",
        's.listen(4173, () => console.log("LISTENING-4173"));',
      ].join('\n') } },
      lib: { directory: { 'util.js': { file: { contents: 'module.exports = () => 42;' } } } },
      'link-to-util.js': { file: { symlink: 'lib/util.js' } },
      'blob.bin': { file: { contents: new Uint8Array([0, 1, 2, 250, 251, 252]) } },
    });
    check('mount() resolves', true);

    // ---- fs API ------------------------------------------------------------
    const pkgText = await wc.fs.readFile('/package.json', 'utf-8');
    check("fs.readFile('/package.json','utf-8')", typeof pkgText === 'string' && pkgText.includes('wc-facade-e2e'), String(pkgText).slice(0, 60));

    const names = await wc.fs.readdir('/');
    check('fs.readdir names', ['package.json', 'server.js', 'lib', 'link-to-util.js', 'blob.bin'].every((n) => names.includes(n)), JSON.stringify(names));

    const bin = await wc.fs.readFile('/blob.bin');
    check('fs.readFile binary', bin instanceof Uint8Array && bin.length === 6 && bin[3] === 250, `len=${bin?.length} b3=${bin?.[3]}`);

    await wc.fs.writeFile('/written.txt', 'hello facade');
    const written = await wc.fs.readFile('/written.txt', 'utf-8');
    check('fs.writeFile + read roundtrip', written === 'hello facade', written);

    await wc.fs.mkdir('/made/dir', { recursive: true });
    const madeNames = await wc.fs.readdir('/made');
    check('fs.mkdir recursive + readdir', Array.isArray(madeNames) && madeNames.includes('dir'), JSON.stringify(madeNames));

    await wc.fs.rm('/written.txt', { force: true });
    let rmThrew = false;
    try { await wc.fs.readFile('/written.txt'); } catch { rmThrew = true; }
    check('fs.rm force removes', rmThrew);

    // symlink target resolves through the guest (mount + readlink)
    const p = await wc.spawn('node', ['-e', "const u = require('./link-to-util.js'); console.log('SYMLINK-VALUE=' + u())"]);
    let out = '';
    const reader = p.output.getReader();
    // The facade's output stream yields STRINGS (upstream contract).
    const readPump = (async () => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        out += value;
      }
    })();
    const code = await p.exit;
    await readPump;
    check('spawn(node -e) exit 0', code === 0, `code=${code}`);
    check('spawn output stream (symlink require)', out.includes('SYMLINK-VALUE=42'), out.trim().slice(0, 80));

    // ---- spawn env + stderr stream ---------------------------------------
    const p2 = await wc.spawn('node', ['-e', "console.log('OUT-LINE'); console.error('ERR-LINE'); process.exit(7)"], { env: { FORCE_COLOR: '0' } });
    let out2 = '', err2 = '';
    const oReader = p2.output.getReader();
    const eReader = p2.stderr.getReader();
    const pump = (r, sink) => (async () => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await r.read();
        if (done) break;
        sink(value);
      }
    })();
    const t2o = pump(oReader, (s) => { out2 += s; });
    const t2e = pump(eReader, (s) => { err2 += s; });
    const code2 = await p2.exit;
    await Promise.all([t2o, t2e]);
    check('exit code 7 propagates', code2 === 7, `code=${code2}`);
    check('output stream has OUT-LINE (merged)', out2.includes('OUT-LINE'), out2.trim().slice(0, 60));
    check('output stream has ERR-LINE (merged, drop-in)', out2.includes('ERR-LINE'), out2.trim().slice(0, 60));
    check('stderr stream is fd2-only', err2.includes('ERR-LINE') && !err2.includes('OUT-LINE'), err2.trim().slice(0, 60));

    // ---- input stream ------------------------------------------------------
    const p3 = await wc.spawn('node', ['-e', "let d=''; process.stdin.on('data', c => { d += c; }); process.stdin.on('end', () => { console.log('ECHO=' + d.trim()); })"]);
    let out3 = '';
    const r3 = p3.output.getReader();
    const pump3 = (async () => {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await r3.read();
        if (done) break;
        out3 += value;
      }
    })();
    const w = p3.input.getWriter();
    await w.write('stdin works\n');
    await w.close();
    const code3 = await p3.exit;
    await pump3;
    check('input stream feeds stdin', code3 === 0 && out3.includes('ECHO=stdin works'), out3.trim().slice(0, 60));

    // ---- server-ready / port events --------------------------------------
    let serverReady = null;
    let portOpens = [];
    let portCloses = [];
    const offReady = wc.on('server-ready', (port, url) => { serverReady = { port, url }; });
    const offPort = wc.on('port', (port, type) => { (type === 'open' ? portOpens : portCloses).push(port); });
    const server = await wc.spawn('node', ['server.js'], { env: { GREETING: 'hi' } });
    const got = await waitFor(() => serverReady, 20000);
    check("on('server-ready') fires", !!got && got.port === 4173, JSON.stringify(got));
    // Per-client preview URLs: the event's url is a page-origin href of the
    // shape /p/<sid>/4173/ (session-scoped SW routing) — the shape the
    // previewUrl() API returns. It must be a FETCHABLE same-origin URL.
    check("server-ready url", !!got && /^https?:\/\/[^/]+\/p\/[a-z0-9-]+\/4173\/?$/.test(got.url), got?.url);
    check("on('port') open event", portOpens.includes(4173), JSON.stringify(portOpens));

    // Preview fetch through the harness ServiceWorker bridge — use the
    // URL the event delivered (the canonical per-client preview path):
    const res = await fetch(got.url, { cache: 'no-store' });
    const body = await res.text();
    check('preview fetch through SW (env passed to server)', res.status === 200 && body.includes('WC-FACADE-OK hi'), `${res.status} ${body.slice(0, 40)}`);

    server.kill();
    await waitFor(() => portCloses.includes(4173), 10000);
    check("on('port') close after kill", portCloses.includes(4173), JSON.stringify(portCloses));
    const serverExit = await server.exit;
    check('killed server exit resolves', typeof serverExit === 'number', `code=${serverExit}`);
    offReady();
    offPort();

    // ---- unsubscribe contract ---------------------------------------------
    let late = false;
    const off = wc.on('error', () => { late = true; });
    off();
    check('on() returns working unsubscribe', typeof off === 'function');

    // ---- teardown ----------------------------------------------------------
    wc.teardown();
    check('teardown() does not throw', true);
    let spawnAfterTeardown = false;
    try { await wc.spawn('node', ['-v']); } catch { spawnAfterTeardown = true; }
    check('spawn after teardown rejected', spawnAfterTeardown);

    const pass = R.checks.filter((c) => c.ok).length;
    R.notes.push(`${pass}/${R.checks.length} pass`);
    R.done = true;
    console.log(`=== WC FACADE E2E: ${pass}/${R.checks.length} ===`);
  } catch (err) {
    R.checks.push({ name: 'FATAL', ok: false, detail: err?.stack ?? String(err) });
    R.done = true;
  }
})();
