/**
 * OpenContainer — S6 browser e2e driver (phase A: the full dev workflow).
 *
 * Runs inside real Chromium via agent-browser. Exercises THE workflow:
 *   terminal boot → node -e → npm init → npm install express (real registry)
 *   → write server.js → npm run dev (script → sh → node server.js, background)
 *   → REAL HTTP fetch through the Service-Worker preview bridge → the
 *   virtual TCP stack → node's REAL http.Server → express app → response.
 *   Plus: npx (registry fetch + _npx cache), pnpm dlx, jobs/kill, EADDRINUSE.
 */
window.__ocResult = null;
window.__ocPhase = 'starting';
void (async () => {
  const t = window.__ocTerm;
  const rt = window.__ocRuntime;
  if (!t || !rt) { window.__ocResult = { error: 'hooks missing (__ocTerm/__ocRuntime)' }; return; }
  const core = t._core.coreService;
  const type = (s) => core.triggerDataEvent(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const PROMPT_RE = /oc v26\.13\.0 ❯\s*$/;
  const curLine = () => {
    const b = t.buffer.active;
    const y = b.baseY + b.cursorY;
    const line = (b.getLine(y) || { translateToString: () => '' }).translateToString(true);
    return { before: line.slice(0, b.cursorX), after: line.slice(b.cursorX), y };
  };
  const isReady = () => { const c = curLine(); return PROMPT_RE.test(c.before) && c.after === ''; };
  const allLines = () => {
    const b = t.buffer.active;
    const out = [];
    for (let i = 0; i < b.length; i++) {
      const l = b.getLine(i);
      if (l) out.push(l.translateToString(true));
    }
    return out;
  };
  const waitFor = async (fn, ms = 10000, step = 25) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) { if (fn()) return performance.now() - t0; await sleep(step); }
    return -1;
  };
  const run = async (cmd, timeout = 20000) => {
    type(cmd + '\r');
    const submitted = await waitFor(() => !isReady(), 3000, 5);
    const ms = await waitFor(isReady, timeout, 20);
    return { cmd, submitted: submitted >= 0, ms, lines: allLines().slice(-80) };
  };
  const has = (r, ...needles) => {
    const text = r.lines.join('\n');
    return needles.every((n) => text.includes(n));
  };

  const out = { steps: [], checks: {}, preview: {}, fetch: {}, timings: {} };
  const step = async (name, cmd, timeout, ...needles) => {
    const r = await run(cmd, timeout);
    const ok = r.submitted && r.ms >= 0 && (needles.length === 0 || has(r, ...needles));
    out.steps.push({ name, ok, ms: r.ms });
    out.checks[name] = { ok, ms: r.ms, lines: r.lines.slice(-30) };
    window.__ocPhase = name;
    return r;
  };

  // ---- wait for terminal readiness -----------------------------------------
  const bootOk = await waitFor(isReady, 30000, 50);
  out.checks.boot = { ok: bootOk >= 0, ms: bootOk };

  // ---- 1. basics -------------------------------------------------------------
  await step('node-v', 'node -v', 15000, 'v26.13.0');
  await step('node-eval', 'node -e "console.log(21*2)"', 15000, '42');

  // ---- 2. project bootstrap ---------------------------------------------------
  await step('npm-init', 'npm init -y', 15000, 'Wrote to /home/project/package.json');

  // ---- 3. real install (registry) ---------------------------------------------
  const t0 = performance.now();
  await step('npm-install-express', 'npm install express', 90000, 'added');
  out.timings.npmInstallExpressMs = Math.round(performance.now() - t0);
  await step('require-express', 'node -e "const e=require(\'express\'); console.log(\'EXPRESS-OK\', typeof e, e.version)"',
    20000, 'EXPRESS-OK');

  // ---- 4. npm run + server + preview (the Phase-4 milestone) ------------------
  await rt.writeFile('/home/project/server.js', [
    "const express = require('express');",
    'const app = express();',
    "app.get('/api', (req, res) => {",
    "  res.json({ ok: true, url: req.url, runtime: process.version, express: true });",
    '});',
    "app.get('/html', (req, res) => {",
    "  res.writeHead(200, { 'content-type': 'text/html' });",
    "  res.end('<html><body><h1 id=oc>PREVIEW-HTML-OK</h1></body></html>');",
    '});',
    "app.listen(3000, () => console.log('EXPRESS-READY on 3000'));",
  ].join('\n'));
  await rt.writeFile('/home/project/package.json', JSON.stringify({
    name: 'project', version: '1.0.0', private: true,
    scripts: {
      dev: 'node server.js',
      hello: 'echo HELLO-FROM-NPM-RUN && echo SECOND-LINE',
      bad: 'exit 3',
    },
    dependencies: { express: '^5.3.0' },
  }, null, 2));

  // npm run hello — script execution through sh with && semantics.
  await step('npm-run-hello', 'npm run hello', 20000, 'HELLO-FROM-NPM-RUN', 'SECOND-LINE');
  // npm run failure propagates the exit code.
  await step('npm-run-bad', 'npm run bad', 20000, 'exited with code 3');

  // Background server via npm run dev (npm → sh → node server.js).
  const listenP = new Promise((resolve) => {
    const off = rt.on('listen', ({ port }) => { off(); resolve(port); });
  });
  const srv = await run('npm run dev &', 20000);
  out.checks['npm-run-dev-bg'] = { ok: srv.ms >= 0, ms: srv.ms, lines: srv.lines.slice(-15) };
  const listened = await waitFor(() => rt.listeningPorts().includes(3000), 30000, 100);
  out.checks.serverListen = { ok: listened >= 0, ports: rt.listeningPorts() };

  // ---- 5. REAL HTTP through the preview bridge --------------------------------
  if (listened >= 0) {
    // Wait for the Service Worker to control the page.
    const swReady = await waitFor(() => !!(navigator.serviceWorker.controller), 10000, 100);
    out.preview.swControlled = swReady >= 0;
    try {
      const t1 = performance.now();
      const res = await fetch('/opencontainer/p/3000/api?x=1', { cache: 'no-store' });
      const body = await res.json();
      out.timings.previewFetchMs = Math.round(performance.now() - t1);
      out.fetch.api = {
        status: res.status,
        contentType: res.headers.get('content-type'),
        body,
      };
      out.checks.previewApi = {
        ok: res.status === 200 && body.ok === true && body.url === '/api?x=1'
          && body.runtime === 'v26.13.0' && body.express === true,
      };
    } catch (e) {
      out.fetch.api = { error: String(e) };
      out.checks.previewApi = { ok: false, error: String(e) };
    }
    try {
      const res2 = await fetch('/opencontainer/p/3000/html', { cache: 'no-store' });
      const text = await res2.text();
      out.fetch.html = { status: res2.status, hasMarker: text.includes('PREVIEW-HTML-OK') };
      out.checks.previewHtml = { ok: res2.status === 200 && text.includes('PREVIEW-HTML-OK') };
    } catch (e) {
      out.fetch.html = { error: String(e) };
      out.checks.previewHtml = { ok: false, error: String(e) };
    }
    // A second, concurrent request (keep-alive/connection reuse paths).
    try {
      const [r1, r2] = await Promise.all([
        fetch('/opencontainer/p/3000/api?a=1', { cache: 'no-store' }),
        fetch('/opencontainer/p/3000/api?b=2', { cache: 'no-store' }),
      ]);
      const [b1, b2] = await Promise.all([r1.json(), r2.json()]);
      out.checks.previewConcurrent = { ok: b1.url === '/api?a=1' && b2.url === '/api?b=2' };
    } catch (e) {
      out.checks.previewConcurrent = { ok: false, error: String(e) };
    }
  }

  // ---- 6. jobs + kill ------------------------------------------------------------
  const jobs = await run('jobs', 10000);
  out.checks.jobs = {
    ok: jobs.lines.some((l) => /\[\d+\]/.test(l) && l.includes('3000')),
    lines: jobs.lines.slice(-10),
  };

  // ---- 7. second server → EADDRINUSE (real port-conflict semantics) ---------------
  await rt.writeFile('/home/project/server2.js', [
    "require('http').createServer((q, s) => s.end('x')).listen(3000, () => console.log('S2-READY'));",
  ].join('\n'));
  const srv2 = await run('node server2.js &', 10000);
  const conflict = await waitFor(() => srv2 !== null && allLines().join('\n').includes('EADDRINUSE'), 8000, 100);
  out.checks.eaddrinuse = { ok: conflict >= 0, lines: allLines().slice(-12) };

  // ---- 8. localhost outbound client inside the kernel ------------------------------
  await rt.writeFile('/home/project/client.js', [
    "http = require('http');",
    "http.get('http://localhost:3000/api?from=node', (res) => {",
    "  let b = '';",
    "  res.on('data', (c) => { b += c; });",
    "  res.on('end', () => { console.log('NODE-CLIENT', res.statusCode, b); process.exit(0); });",
    "}).on('error', (e) => { console.log('NODE-CLIENT-ERR', e.message); process.exit(1); });",
  ].join('\n'));
  await step('node-http-client', 'node client.js', 20000, 'NODE-CLIENT 200', '"from=node"');

  // ---- 9. npx (registry fetch + _npx cache + bin execution) -------------------------
  await step('npx-cowsay', 'npx -y cowsay browser-e2e', 60000, 'browser-e2e');

  // ---- 10. pnpm dlx -----------------------------------------------------------------
  await step('pnpm-dlx', 'pnpm dlx cowsay dlx-works', 60000, 'dlx-works');

  // ---- 11. pnpm exec (local .bin, never installs) -----------------------------------
  await step('pnpm-exec', 'pnpm exec cowsay exec-works', 30000, 'exec-works');

  // ---- 12. kill the servers -----------------------------------------------------------
  const procs = rt.ps().filter((p) => !p.exited && p.pid !== 1);
  for (const p of procs) {
    if (p.ports.length > 0) rt.killProcess(p.pid, 'SIGTERM');
  }
  await sleep(500);
  out.checks.killServers = { ok: rt.listeningPorts().length === 0, portsAfter: rt.listeningPorts() };

  // ---- summary --------------------------------------------------------------------------
  const passed = Object.values(out.checks).filter((c) => c && c.ok).length;
  const total = Object.keys(out.checks).length;
  out.summary = { passed, total };
  window.__ocResult = out;
  window.__ocPhase = 'done';
})();
