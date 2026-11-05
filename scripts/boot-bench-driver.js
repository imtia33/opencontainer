/**
 * OpenContainer — BOOT BENCHMARK DRIVER (research instrumentation, read-only).
 *
 * Measures the five independent boot figures the kernel-boot investigation
 * requires, in real Chromium, through the real xterm + runtime hooks:
 *
 *   1. `node -v`            — submit → prompt returns (process boot + exit)
 *   2. `node -e`            — submit → prompt returns (boot + eval + settle)
 *   3. REPL startup         — submit `node` → node REPL prompt `>` renders
 *   4. server spawn→listen  — submit `node server.js` → rt 'listen' event,
 *                             WITH the per-spawn boot-phase timeline captured
 *                             from rt 'bootProgress' events (index → core:cache
 *                             → core:decode → bootstrap → listen)
 *   5. first package require— submit `node -e "require('express')…"` → marker
 *                             (skipped with a note when express absent)
 *
 * Plus: warm-session keeper boot phases (window.__ocBootPhases — set by
 * runtime.ts:241 from the pid-1 'ready' message), a 10-cycle `node -e`
 * spawn-latency distribution, and a plain-http server variant.
 *
 * Usage (agent-browser eval only accepts simple expressions — so this runs
 * as an injected <script src> file; results are parked on window.__ocResult):
 *   bun run dev                                    # or: bun run start
 *   cp scripts/boot-bench-driver.js public/oc-boot-bench-driver.js
 *   agent-browser open http://localhost:3000
 *   # COLD keeper numbers (optional, do this FIRST — reloading without this
 *   # gives the warm keeper numbers):
 *   #   agent-browser eval "await caches.delete('opencontainer-runtime-v1')"
 *   #   agent-browser open http://localhost:3000
 *   agent-browser eval "document.head.appendChild(Object.assign(document.createElement('script'),{src:'/oc-boot-bench-driver.js'})).tagName"
 *   agent-browser wait --fn "!!window.__ocResult" --timeout 300000
 *   agent-browser eval "JSON.stringify(window.__ocResult)"
 *
 * Hooks used (all pre-existing, no gameplay changes):
 *   - window.__ocTerm / t._core.coreService.triggerDataEvent  (NodeTerminal.tsx:149)
 *   - window.__ocRuntime                                       (NodeTerminal.tsx:88)
 *   - rt.on('bootProgress' | 'listen' | 'processStart')       (runtime.ts:27-40)
 *   - rt.writeFile / rt.listeningPorts / rt.ps / rt.killProcess
 *   - window.__ocBootPhases                                    (runtime.ts:241)
 */
window.__ocResult = null;
window.__ocBenchPhase = 'starting';
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
  // PACING (from oc-s6-driver.js): wait for the submit newline to render
  // before waiting for the prompt — else keystrokes land in a still-running
  // process's stdin and vanish.
  const run = async (cmd, timeout = 30000) => {
    const before = t.buffer.active.length;
    const tSubmit = performance.now();
    type(cmd + '\r');
    await waitFor(() => t.buffer.active.length > before || !isReady(), 4000, 10);
    const ms = await waitFor(isReady, timeout, 20);
    return { cmd, submitMs: tSubmit, ms, lines: allLines().slice(-60) };
  };
  const waitForText = async (needles, ms = 8000) =>
    waitFor(() => needles.every((n) => allLines().join('\n').includes(n)), ms, 25);

  const out = {
    session: {}, steps: {}, timings: {}, spawnDistribution: {}, serverTimeline: {},
    notes: [],
  };
  const step = (name, r, needles) => {
    const ok = r.ms >= 0 && (needles.length === 0 || allLines().join('\n').includes(needles[0]));
    out.steps[name] = { ok, ms: Math.round(r.ms) };
    window.__ocBenchPhase = name;
  };

  // per-spawn boot-phase timeline: runtime.ts:229-233 forwards 'boot-progress'
  // for FOREGROUND processes; the worker posts them at phase START
  // (worker-entry.ts:198,204,209,367,380).
  let phaseLog = [];
  rt.on('bootProgress', (info) => {
    phaseLog.push({ phase: info.phase, at: performance.now() });
  });

  // ---- 0. keeper (pid 1) boot phases of THIS page load ----------------------
  // window.__ocBootPhases is set when the keeper reports ready (runtime.ts:241).
  // A cold page load (Cache API cleared before reload) shows coreFetchMs +
  // coreInflateMs; a warm one shows coreCacheMs and neither fetch mark.
  await waitFor(() => !!window.__ocBootPhases, 90000, 50).catch(() => {});
  out.session.bootPhases = { ...(window.__ocBootPhases ?? null) } ?? null;
  out.session.cacheState = out.session.bootPhases?.coreFetchMs != null ? 'COLD (network fetch)'
    : out.session.bootPhases?.coreCacheMs != null ? 'WARM (Cache API)' : 'unknown';
  out.session.swControlled = !!(navigator.serviceWorker?.controller);

  // ---- wait for shell readiness ---------------------------------------------
  const bootOk = await waitFor(isReady, 60000, 50);
  out.steps.shellReady = { ok: bootOk >= 0, ms: Math.round(bootOk) };

  // ---- 1. node -v (fast command: measure by OUTPUT, not prompt return ------
  // — the prompt-return pacing mis-anchors for sub-100ms commands; only scan
  // lines written AFTER this command was submitted (scrollback safety)) -----
  {
    const before = t.buffer.active.length;
    const tSubmit = performance.now();
    type('node -v\r');
    const outWait = await waitFor(() => {
      const b = t.buffer.active;
      for (let i = before; i < b.length; i++) {
        const l = b.getLine(i);
        if (l && l.translateToString(true).trim() === 'v26.13.0') return true;
      }
      return false;
    }, 30000);
    out.timings.nodeVOutputMs = outWait >= 0 ? Math.round(outWait) : null;
    // NOTE: NodeTerminal.tsx:474-476 intercepts `node -v` in the HOST shell
    // and prints runtime.nodeVersion directly — NO process is spawned. The
    // true process-boot figure for a version query is the nodeEvalOutputMs
    // measurement below (same boot path as `node -v` would take).
    const promptMs = await waitFor(isReady, 30000, 15);
    out.steps['node-v'] = { ok: outWait >= 0 && promptMs >= 0, ms: outWait >= 0 ? Math.round(outWait) : null, shellFastPath: true };
    await sleep(100);
  }

  // ---- 2. node -e (single shot: first-output vs prompt-return = exit tail) -
  // Sequenced (NOT Promise.all): the prompt-return wait must start only after
  // the output line exists, else the pacing anchor races and returns 0. -----
  {
    phaseLog = [];
    const before = t.buffer.active.length;
    const tSubmit = performance.now();
    type('node -e "console.log(21*2)"\r');
    const outMs = await waitFor(() => {
      const b = t.buffer.active;
      for (let i = before; i < b.length; i++) {
        const l = b.getLine(i);
        if (l && l.translateToString(true).trim() === '42') return true;
      }
      return false;
    }, 30000);
    const promptMs = await waitFor(isReady, 30000, 15);
    out.timings.nodeEvalOutputMs = outMs >= 0 ? Math.round(outMs) : null;
    out.timings.nodeEvalExitTailMs = (outMs >= 0 && promptMs >= 0) ? Math.round(promptMs - outMs) : null;
    out.steps['node-eval'] = { ok: outMs >= 0 && promptMs >= 0, ms: Math.round(promptMs) };
    window.__ocBenchPhase = 'node-eval';
    // re-run for the phase timeline (same path)
    phaseLog = [];
    const r2 = await run('node -e "console.log(21*2)"');
    step('node-eval-2', r2, ['42']);
    out.serverTimeline.nodeEval = phaseLog.map((p) => ({ phase: p.phase, sinceSubmitMs: Math.round(p.at - r2.submitMs) }));
  }

  // ---- 2b. spawn-latency distribution (10 cycles) ----------------------------
  {
    const samples = [];
    for (let i = 0; i < 10; i++) {
      const r = await run('node -e "1"', 30000);
      if (r.ms >= 0) samples.push(r.ms);
    }
    const sorted = samples.slice().sort((a, b) => a - b);
    out.spawnDistribution.nodeEvalMs = {
      n: samples.length,
      min: sorted[0] ?? null,
      median: sorted[Math.floor(sorted.length / 2)] ?? null,
      p95: sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))] ?? null,
      max: sorted[sorted.length - 1] ?? null,
      all: samples.map((x) => Math.round(x)),
    };
  }

  // ---- 3. REPL startup (submit `node` → node's own `>` prompt renders) -------
  {
    const before = t.buffer.active.length;
    const tSubmit = performance.now();
    type('node\r');
    await waitFor(() => t.buffer.active.length > before || !isReady(), 4000, 10);
    // node REPL banner ends with a `>` prompt on its own line (after the
    // welcome text). Poll for a line ending in `>` in the last few lines.
    const replMs = await waitFor(() => {
      const lines = allLines().slice(-6);
      return lines.some((l) => />$/.test(l.trim()));
    }, 30000, 20);
    out.timings.replStartupMs = replMs >= 0 ? Math.round(replMs) : null;
    // exit the REPL cleanly
    type('.exit\r');
    await waitFor(isReady, 15000, 30);
    out.steps.repl = { ok: replMs >= 0, ms: Math.round(Math.max(0, replMs)) };
  }

  // ---- 4. server spawn→listen (plain http — works without express) ----------
  await rt.writeFile('/home/project/bench-server.js', [
    "const http = require('http');",
    "http.createServer((q, s) => s.end('bench-ok')).listen(4173, () => {",
    "  console.log('BENCH-LISTENING');",
    '});',
  ].join('\n'));
  {
    let listenAt = null; let procStartAt = null;
    const offListen = rt.on('listen', (info) => { if (info.port === 4173) listenAt = performance.now(); });
    const offStart = rt.on('processStart', (info) => { procStartAt = performance.now(); });
    phaseLog = [];
    const before = t.buffer.active.length;
    const tSubmit = performance.now();
    type('node bench-server.js\r');
    await waitFor(() => t.buffer.active.length > before || !isReady(), 4000, 10);
    const listenWait = await waitForText(['BENCH-LISTENING'], 40000);
    const firstOut = listenWait >= 0 ? performance.now() : null;
    const listenEvent = await waitFor(() => rt.listeningPorts().includes(4173), 10000, 10);
    offListen(); offStart();
    out.timings.serverSpawnToListenMs = {
      submitToListenText: listenWait >= 0 ? Math.round(listenWait) : null,
      submitToFirstOutput: firstOut != null ? Math.round(firstOut - tSubmit) : null,
      submitToPortRegistered: listenEvent >= 0 ? Math.round(listenEvent) : null,
      processStartToPortRegistered: (listenEvent >= 0 && procStartAt != null && listenAt != null)
        ? Math.round(listenAt - procStartAt) : null,
    };
    // phase timeline (deltas from submit)
    const tl = phaseLog.map((p) => ({ phase: p.phase, sinceSubmitMs: Math.round(p.at - tSubmit) }));
    out.serverTimeline.plainHttp = tl;
    // foreground server keeps running (it listens) — kill it
    await run('\u0003', 8000); // Ctrl+C → SIGINT → default exit
    await waitFor(() => !rt.listeningPorts().includes(4173), 5000, 50);
  }

  // ---- 5. first package require (express) ------------------------------------
  const hasExpress = await (async () => {
    try {
      const r = await run("node -e \"console.log('HAS-EXPRESS', !!require('express'))\"", 30000);
      const ok = allLines().join('\n').includes('HAS-EXPRESS true');
      out.timings.firstRequireExpressMs = r.ms >= 0 ? Math.round(r.ms) : null;
      out.steps.requireExpress = { ok, ms: Math.round(r.ms) };
      return ok;
    } catch { return false; }
  })();
  if (!hasExpress) out.notes.push('express not installed — first-require figure skipped (run `npm install express` first for that figure)');

  // ---- 6. express server spawn→listen (only if express present) --------------
  if (hasExpress) {
    await rt.writeFile('/home/project/bench-express.js', [
      "const express = require('express');",
      'const app = express();',
      "app.get('/x', (q, s) => s.json({ok:true}));",
      "app.listen(4174, () => console.log('EXPRESS-BENCH-READY'));",
    ].join('\n'));
    phaseLog = [];
    let listenAt = null;
    const offListen = rt.on('listen', (info) => { if (info.port === 4174) listenAt = performance.now(); });
    const before = t.buffer.active.length;
    const tSubmit = performance.now();
    type('node bench-express.js\r');
    await waitFor(() => t.buffer.active.length > before || !isReady(), 4000, 10);
    const readyWait = await waitForText(['EXPRESS-BENCH-READY'], 60000);
    offListen();
    out.timings.expressSpawnToListenMs = readyWait >= 0 ? Math.round(readyWait) : null;
    out.serverTimeline.express = phaseLog.map((p) => ({ phase: p.phase, sinceSubmitMs: Math.round(p.at - tSubmit) }));
    await run('\u0003', 8000);
    await waitFor(() => !rt.listeningPorts().includes(4174), 5000, 50);
  }

  // ---- 7. cleanup + terminal echo sanity (write path baseline) ---------------
  await rt.writeFile('/home/project/bench-cleanup.js', [
    "const fs = require('fs');",
    "for (const f of ['bench-server.js','bench-express.js','bench-cleanup.js']) {",
    "  try { fs.rmSync('/home/project/' + f, {force:true}); } catch {}",
    "}",
    "console.log('BENCH-CLEAN');",
  ].join('\n'));
  await run('node bench-cleanup.js', 30000);

  out.summary = {
    figures: {
      nodeVms: out.steps['node-v']?.ms ?? null,
      nodeEvalMs: out.steps['node-eval']?.ms ?? null,
      replStartupMs: out.timings.replStartupMs ?? null,
      serverSpawnToListenMs: out.timings.serverSpawnToListenMs?.submitToListenText ?? null,
      firstRequireExpressMs: out.timings.firstRequireExpressMs ?? null,
    },
  };
  window.__ocResult = out;
  window.__ocBenchPhase = 'done';
})();
