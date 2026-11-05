/**
 * OpenContainer — browser terminal regression driver (runs inside Chromium
 * via `agent-browser eval "$(cat scripts/e2e-terminal-driver.js)"`).
 *
 * Exercises the REAL xterm instance (window.__ocTerm, installed by
 * NodeTerminal.tsx) and the real runtime (window.__ocRuntime):
 *   - input injected through xterm's coreService.triggerDataEvent — the same
 *     entry point real keypresses produce (synthetic keydown does NOT work
 *     in xterm v6);
 *   - state read from xterm's real buffer (buffer.active.getLine);
 *   - prompt detection = cursor line ends with the shell prompt and nothing
 *     is typed after it.
 *
 * Covers PART 6.5 of the spec: consecutive commands, error recovery, Ctrl+C,
 * REPL lifecycle, and the 100-cycle regression with per-command prompt
 * latency measurement.
 */
// Usage (agent-browser eval only accepts simple expressions — so this runs
//  as an injected <script src> file; results are parked on window.__ocResult):
//   cp scripts/e2e-terminal-driver.js public/oc-e2e-driver.js
//   agent-browser eval "document.head.appendChild(Object.assign(document.createElement('script'),{src:'/oc-e2e-driver.js'})).tagName"
//   agent-browser wait --fn "!!window.__ocResult" --timeout 300000
//   agent-browser eval "JSON.stringify(window.__ocResult)"
window.__ocResult = null;
void (async () => {
  const t = window.__ocTerm;
  const rt = window.__ocRuntime;
  if (!t || !rt) { window.__ocResult = { error: 'hooks missing (__ocTerm/__ocRuntime)' }; return; }
  const core = t._core.coreService;
  const type = (s) => core.triggerDataEvent(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const PROMPT_RE = /oc v26\.13\.0 ❯\s*$/; // prompt body ends with a space
  const curLine = () => {
    const b = t.buffer.active;
    const y = b.baseY + b.cursorY;
    const line = (b.getLine(y) || { translateToString: () => '' }).translateToString(true);
    return { before: line.slice(0, b.cursorX), after: line.slice(b.cursorX), y };
  };
  const isReady = () => { const c = curLine(); return PROMPT_RE.test(c.before) && c.after === ''; };
  const isRepl = () => { const c = curLine(); return /(^|\s)> ?$/.test(c.before) && c.after === ''; };
  const tail = (n = 8) => {
    const b = t.buffer.active;
    const end = b.baseY + b.cursorY;
    const out = [];
    for (let i = Math.max(0, end - n); i <= end; i++) {
      const l = b.getLine(i);
      if (l) out.push(l.translateToString(true));
    }
    return out;
  };
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
  const run = async (cmd) => {
    type(cmd + '\r');
    // Phase 1 — confirm submission: the prompt must be consumed (the shell
    // took the line). Without this, keystrokes race into the PREVIOUS
    // process's stdin (faithful terminal routing — a driver bug, not kernel).
    const submitted = await waitFor(() => !isReady(), 3000, 5);
    // Phase 2 — the exit event restores the prompt (single prompt authority).
    const ms = await waitFor(isReady, 15000, 20);
    return { cmd, submitted: submitted >= 0, ms };
  };

  const mem0 = performance.memory ? performance.memory.usedJSHeapSize : null;
  await waitFor(isReady, 15000); // initial prompt
  const out = { bootPhases: window.__ocBootPhases };

  // ---- PART 6.5 required sequence (no Enter between commands) ----
  out.part65 = [];
  for (const cmd of [
    'node -e "console.log(\'first\')"',
    'node -e "console.log(\'second\')"',
    'node -e "console.log(\'third\')"',
    'node -e "throw new Error(\'test\')"',
    'node -e "console.log(\'recovered\')"',
  ]) { out.part65.push(await run(cmd)); await sleep(40); }

  // non-zero exit / syntax error / both-streams / instant-exit
  out.exitCode3 = await run('node -e "process.exit(3)"');
  out.syntaxErr = await run('node -e "const = broken"');
  out.bothStreams = await run('node -e "console.log(\'out-line\'); console.error(\'err-line\')"');
  out.instantExit = await run('node -e ""');
  out.nodeV = await run('node -v');

  // ---- Ctrl+C during execution (kill a runaway process) ----
  type('node -e "setInterval(() => console.log(\'tick\'), 200)"\r');
  await waitFor(() => !isReady(), 3000, 5); // submission confirmed
  out.ctrlCSawTicks = await waitFor(() => tail(3).some((l) => l.includes('tick')), 8000);
  await sleep(350); // a few ticks accumulate
  out.promptWhileRunning = isReady(); // MUST be false
  type('\x03');
  out.ctrlCDuringExec = await waitFor(isReady, 8000);
  out.ctrlCTail = tail(4);

  // ---- REPL lifecycle ----
  type('node\r');
  out.replPromptMs = await waitFor(isRepl, 10000);
  out.shellPromptDuringRepl = isReady(); // MUST be false
  type('7*6\r');
  out.replSaw42 = await waitFor(() => tail(3).some((l) => l.trim() === '42'), 5000);
  type('\x03'); // abort mid-line inside REPL (no half-typed text, REPL survives)
  await sleep(120);
  type('1+1\r');
  out.replSaw2 = await waitFor(() => tail(3).some((l) => l.trim() === '2'), 5000);
  type('.exit\r');
  out.replExitToPromptMs = await waitFor(isReady, 8000);

  // ---- 100-cycle regression: one-shot commands, prompt latency each ----
  const lat = [];
  const fails = [];
  for (let i = 1; i <= 100; i++) {
    const r = await run(`node -e "console.log(${i} * 7)"`);
    lat.push(r.ms);
    if (r.ms < 0) fails.push(i);
    if (i % 25 === 0) await sleep(50);
  }
  lat.sort((a, b) => a - b);
  const pct = (p) => lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))];
  out.cycles = {
    n: 100, timeouts: fails.length, failedCycles: fails,
    p50: pct(50), p95: pct(95), max: lat[lat.length - 1],
  };

  // verify all 100 outputs present as exact lines; no duplicated prompts
  const lines = allLines();
  const lineSet = new Set(lines.map((l) => l.trim()));
  const missingOutputs = Array.from({ length: 100 }, (_, k) => String((k + 1) * 7))
    .filter((n) => !lineSet.has(n));
  const doublePromptLines = lines.filter((l) => (l.match(/oc v26\.13\.0 ❯/g) || []).length > 1);
  const promptStartLines = lines.filter((l) => l.trim().startsWith('oc v26.13.0 ❯')).length;
  out.cycles.missingOutputs = missingOutputs;
  out.cycles.doublePromptLines = doublePromptLines.length;
  out.cycles.promptStartLines = promptStartLines;
  window.__ocResult = out; // park early — a late failure must not lose the data

  // REPL still works after 100 cycles
  type('node\r');
  out.replAfterCyclesMs = await waitFor(isRepl, 10000);
  type('2**10\r');
  out.replAfterCyclesSaw1024 = await waitFor(() => tail(3).some((l) => l.trim() === '1024'), 5000);
  type('.exit\r');
  out.replAfterCyclesExitMs = await waitFor(isReady, 8000);
  out.finalReady = isReady();

  // ---- large-project hydration cost (200 × ~1KB host files → recycle) ----
  // NOTE: node's fs.writeFile does NOT create parent dirs (ENOENT is faithful
  // behavior) — create /home/project/src first, exactly like a real workflow.
  out.filesTest = {};
  try {
    await run('node -e "require(\'fs\').mkdirSync(\'/home/project/src\', {recursive: true})"');
    const t0w = performance.now();
    await Promise.all(Array.from({ length: 200 }, (_, i) =>
      rt.writeFile(`/home/project/src/f${i}.js`, `export const v${i} = ${i * 2};\n` + 'x'.repeat(1000))));
    out.filesTest.write200FilesMs = Math.round(performance.now() - t0w);
    out.filesTest.spawnWith200FilesMs = (await run('node -e "console.log(\'after-files\')"')).ms;
    out.filesTest.spawnWith200Files2Ms = (await run('node -e "1"')).ms;
  } catch (e) { out.filesTest.error = String(e); }

  out.memBefore = mem0;
  out.memAfter = performance.memory ? performance.memory.usedJSHeapSize : null;
  out.finalReady2 = isReady();
  window.__ocResult = out;
})().catch((e) => { window.__ocResult = { driverError: String((e && e.stack) || e) }; });
