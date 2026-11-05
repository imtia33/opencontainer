/**
 * OpenContainer IDE — browser E2E driver (oc-ide-driver.js).
 *
 * Runs inside real Chromium via agent-browser against /ide. Exercises:
 *   boot → create project → explorer tree → file CRUD through the IDE store
 *   → Monaco model wiring → terminal (node -v/-e, npm init, npm install
 *   express) → node server.js & → REAL preview fetch through the SW bridge
 *   → edit file → restart server → updated response → diagnostics →
 *   kill server. Every check reads REAL state (store, VFS, runtime).
 */
window.__ocIdeResult = null;
void (async () => {
  const checks = [];
  const check = (name, ok, detail = '') => {
    checks.push({ name, ok, detail: String(detail).slice(0, 300) });
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${String(detail).slice(0, 120)}` : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 20000, step = 50) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(step);
    }
    return null;
  };

  try {
    // ---- 1. boot ---------------------------------------------------------
    const ide = window.__ocIde;
    const getContainer = window.__ocIdeContainer;
    if (!ide || !getContainer) throw new Error('IDE hooks missing');
    await waitFor(() => ide.getState().booted, 30000);
    check('IDE booted (real kernel)', ide.getState().booted, ide.getState().nodeVersion);

    const container = getContainer();
    const rt = window.__ocRuntime;
    if (!rt) throw new Error('runtime hook missing');
    check('runtime wired to terminal', true, rt.nodeVersion);

    // ---- 2. create a project --------------------------------------------
    // Clean slate: remove any e2e-ide* projects from PREVIOUS runs (registry
    // + VFS + node_modules).
    for (const p of await container.projects()) {
      if (p.name.startsWith('e2e-ide')) await container.deleteProject(p.id).catch(() => {});
    }
    await container.rm('/home/projects/e2e-ide', { recursive: true }).catch(() => {});
    const meta = await container.createProject('e2e-ide');
    check('project created', meta.rootPath === '/home/projects/e2e-ide', meta.rootPath);
    check('shell cwd switched', rt.getCurrentCwd() === '/home/projects/e2e-ide', rt.getCurrentCwd());

    const t = window.__ocTerm;
    const core = t._core.coreService;
    const type = (s) => core.triggerDataEvent(s);
    const allLines = () => {
      const b = t.buffer.active;
      const out = [];
      for (let i = 0; i < b.length; i++) {
        const l = b.getLine(i);
        if (l) out.push(l.translateToString(true));
      }
      return out;
    };
    const waitForText = (needle, ms = 20000) =>
      waitFor(() => allLines().some((l) => l.includes(needle)), ms);
    const PROMPT_RE = /❯\s*$/;
    const promptLine = () => {
      const b = t.buffer.active;
      const y = b.baseY + b.cursorY;
      const line = (b.getLine(y) || { translateToString: () => '' }).translateToString(true);
      return line.slice(0, b.cursorX);
    };
    const waitPrompt = (ms = 20000) => waitFor(() => PROMPT_RE.test(promptLine()), ms);
    const run = async (cmd, timeout = 20000) => {
      const before = t.buffer.active.length;
      type(cmd + '\r');
      await waitFor(() => t.buffer.active.length > before, 3000);
      return await waitPrompt(timeout);
    };

    // ---- 3. file operations through the container API --------------------
    await container.writeFile('/home/projects/e2e-ide/hello.txt', 'written-by-container');
    const readback = await container.readTextFile('/home/projects/e2e-ide/hello.txt');
    check('container read/write round-trip', readback === 'written-by-container', readback);

    const entries = await container.readdir('/home/projects/e2e-ide');
    check('readdir sees the file', entries.some((e) => e.name === 'hello.txt' && e.kind === 'file'), JSON.stringify(entries));

    const st = await container.stat('/home/projects/e2e-ide/hello.txt');
    check('stat reports size', st && st.size === 20, JSON.stringify(st));

    // watch events
    let watchEvents = 0;
    const unwatch = await container.watch('/home/projects/e2e-ide', () => { watchEvents++; });
    await container.writeFile('/home/projects/e2e-ide/watched.txt', 'x');
    await sleep(400);
    check('fs watch fires on writes', watchEvents > 0, `${watchEvents} events`);
    unwatch();

    // rename + delete
    await container.rename('/home/projects/e2e-ide/hello.txt', 'hello-renamed.txt');
    const afterRename = await container.readdir('/home/projects/e2e-ide');
    check('rename works', afterRename.some((e) => e.name === 'hello-renamed.txt'), JSON.stringify(afterRename.map((e) => e.name)));
    await container.rm('/home/projects/e2e-ide/hello-renamed.txt');
    const afterDelete = await container.readdir('/home/projects/e2e-ide');
    check('rm works', !afterDelete.some((e) => e.name === 'hello-renamed.txt'));

    // ---- 4. terminal: node -v / node -e -----------------------------------
    await waitPrompt(15000);
    await run('node -v', 15000);
    check('terminal node -v', allLines().some((l) => l.includes('v26.13.0')));
    await run('node -e "console.log(21*2)"', 15000);
    check('terminal node -e', allLines().some((l) => l.trim() === '42'));

    // ---- 5. npm init + install express ------------------------------------
    await run('npm init -y', 15000);
    const pkg = await container.readTextFile('/home/projects/e2e-ide/package.json');
    check('npm init -y wrote package.json', pkg.includes('"name"'), pkg.slice(0, 60));

    const t0 = performance.now();
    await run('npm install express', 120000);
    const installMs = Math.round(performance.now() - t0);
    const installLine = allLines().reverse().find((l) => l.includes('added 68 packages')) ?? '';
    check('npm install express (real registry)', !!installLine, `${installLine} (${installMs}ms)`);

    // ---- 6. write server.js through the IDE store (editor path) ----------
    const serverJs = `const express = require('express');
const app = express();
app.get('/', (req, res) => res.json({ ok: true, from: 'ide-e2e', version: 1 }));
app.listen(3001, () => console.log('E2E-READY on 3001'));
`;
    await container.writeFile('/home/projects/e2e-ide/server.js', serverJs);
    // Open it through the store (Monaco model path)
    await ide.getState().openFile('/home/projects/e2e-ide/server.js');
    await sleep(300);
    check('file opened in editor store', ide.getState().activeTab === '/home/projects/e2e-ide/server.js');

    // ---- 7. run server in background + preview fetch ----------------------
    await run('node server.js &', 15000);
    const listenOk = await waitForText('listening on :3001', 15000);
    check('server listen event', !!listenOk);
    check('store port registry', ide.getState().ports.some((p) => p.port === 3001), JSON.stringify(ide.getState().ports));

    const res = await fetch('/opencontainer/p/3001/');
    const body = await res.json().catch(() => null);
    check('preview fetch through SW bridge', res.status === 200 && body?.ok === true, `${res.status} ${JSON.stringify(body)}`);

    // ---- 8. edit the file → restart → response reflects the edit ----------
    await container.writeFile('/home/projects/e2e-ide/server.js', serverJs.replace('version: 1', 'version: 2'));
    const res2 = await fetch('/opencontainer/p/3001/');
    const body2 = await res2.json().catch(() => null);
    check('live file edit visible to running server (require cache: old process)', body2?.version === 1, JSON.stringify(body2));

    // kill and restart — new process reads the new file. Clear the
    // scrollback FIRST so waitForText cannot match the FIRST server's
    // stale E2E-READY (S9 driver fix — the old text made the check fetch
    // before the restarted server ever bound the port).
    const pids = rt.ps().filter((p) => !p.exited && p.ports.includes(3001));
    if (pids.length > 0) rt.killProcess(pids[0].pid, 'SIGTERM');
    await waitFor(() => !rt.listeningPorts().includes(3001), 10000);
    t.clear();
    await run('node server.js &', 15000);
    await waitForText('E2E-READY on 3001', 15000).catch(() => {});
    await waitFor(() => rt.listeningPorts().includes(3001), 10000);
    const res3 = await fetch('/opencontainer/p/3001/');
    const body3 = await res3.json().catch(() => null);
    check('restart picks up edited file', body3?.version === 2, JSON.stringify(body3));

    // ---- 9. diagnostics ----------------------------------------------------
    const diag = await container.diagnostics();
    check('diagnostics: node version', diag.nodeVersion === 'v26.13.0', diag.nodeVersion);
    check('diagnostics: process count > 0', diag.processCount > 0, `${diag.processCount} processes`);
    check('diagnostics: vfs stats real', diag.vfs && diag.vfs.fileCount > 60, `${diag.vfs?.fileCount} files`);
    check('diagnostics: ports include 3001', diag.ports.includes(3001), JSON.stringify(diag.ports));

    // ---- 9b. S9: coreutils + command-created projects + terminal sanity ----
    // Terminal renders each write exactly once (the S9 double-wire fix).
    {
      const t = window.__ocTerm;
      await waitPrompt(15000);
      t.clear();
      t._core.coreService.triggerDataEvent('node -e "console.log(777766)"\r');
      let dupes = 0;
      let found = false;
      // Snapshot-at-found: record the line index when the output first
      // appears, then count occurrences in a FIXED window (the window
      // center follows buffer growth otherwise — a race that lost the line).
      const at = await waitFor(() => {
        const buf = t.buffer.active;
        // Whole-buffer scan: after t.clear() the content sits at the TOP
        // (lines 0..2) with blank viewport filler below — a "last N lines"
        // window misses it entirely.
        for (let i = Math.max(0, buf.length - 30); i < buf.length; i++) {
          const l = buf.getLine(i)?.translateToString(true) ?? '';
          if (l.trim() === '777766') { found = true; return i + 1; } // +1: index 0 is falsy
        }
        return false;
      }, 15000);
      if (typeof at === 'number') {
        const hit = at - 1;
        const buf = t.buffer.active;
        for (let i = Math.max(0, hit - 4); i < Math.min(buf.length, hit + 5); i++) {
          const l = buf.getLine(i)?.translateToString(true) ?? '';
          if (l.trim() === '777766') dupes++;
        }
      }
      {
        const buf = t.buffer.active;
        const dump = [];
        for (let i = Math.max(0, buf.length - 12); i < buf.length; i++) {
          const l = buf.getLine(i)?.translateToString(true) ?? '';
          if (l.trim()) dump.push(l.trim().slice(0, 40));
        }
        check('terminal: node output renders exactly once', found && dupes === 1, `dupes=${dupes} found=${found} len=${buf.length} [${dump.join(' / ')}]`);
      }
      // Prompt must not be eaten (bare-ESC regression guard): 'oc v' + ❯.
      let promptOk = false;
      for (let i = Math.max(0, t.buffer.active.length - 12); i < t.buffer.active.length; i++) {
        const l = t.buffer.active.getLine(i)?.translateToString(true) ?? '';
        if (l.includes('oc v') && l.includes('❯')) { promptOk = true; break; }
      }
      check('terminal: prompt renders intact (SGR discipline)', promptOk);
    }
    // Coreutils through the real sh.
    {
      const t = window.__ocTerm;
      await waitPrompt(15000);
      t._core.coreService.triggerDataEvent('mkdir coreutil-check\r');
      await sleep(1500);
      const st = await container.stat('/home/projects/e2e-ide/coreutil-check').catch(() => null);
      check('coreutils: mkdir creates real dir', !!st && st.kind === 'dir');
      await container.rm('/home/projects/e2e-ide/coreutil-check', { recursive: true });
    }
    // GitHub proxy route (server-side codeload fetch).
    {
      const res = await fetch('/api/gh-import?url=expressjs/express');
      const bytes = res.ok ? await res.arrayBuffer() : null;
      check('github import proxy works', res.ok && bytes && bytes.byteLength > 50000, `${res.status} · ${bytes ? bytes.byteLength : 0}B`);
    }

    // ---- 10. cleanup: kill server, delete project --------------------------
    const pids2 = rt.ps().filter((p) => !p.exited && p.ports.includes(3001));
    for (const p of pids2) rt.killProcess(p.pid, 'SIGTERM');
    await waitFor(() => !rt.listeningPorts().includes(3001), 10000);
    check('server killed, port released', !rt.listeningPorts().includes(3001));

    const projects = await container.projects();
    check('project registry lists project', projects.some((p) => p.id === meta.id), `${projects.length} projects`);

    window.__ocIdeResult = {
      passed: checks.filter((c) => c.ok).length,
      failed: checks.filter((c) => !c.ok).length,
      checks,
      installMs,
    };
  } catch (err) {
    window.__ocIdeResult = {
      passed: checks.filter((c) => c.ok).length,
      failed: checks.filter((c) => !c.ok).length + 1,
      checks,
      error: String(err?.stack ?? err),
    };
  }
})();
