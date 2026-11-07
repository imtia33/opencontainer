/* 559-package scale install — mirrors the user's create-expo-app benchmark
 * (expo + react + react-dom + expo-status-bar ≈ 550-600 packages). Run on a
 * FRESH page load. Parks results on window.__ocScale. */
window.__ocScale = null;
void (async () => {
  const t = window.__ocTerm;
  const rt = window.__ocRuntime;
  const core = t._core.coreService;
  const type = (s) => core.triggerDataEvent(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const PROMPT_RE = /oc v26\.13\.0 ❯\s*$/;
  const curLine = () => {
    const b = t.buffer.active;
    const y = b.baseY + b.cursorY;
    const line = (b.getLine(y) || { translateToString: () => '' }).translateToString(true);
    return { before: line.slice(0, b.cursorX), after: line.slice(b.cursorX) };
  };
  const isReady = () => { const c = curLine(); return PROMPT_RE.test(c.before) && c.after === ''; };
  const waitFor = async (fn, ms, step = 50) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return Date.now() - t0; await sleep(step); }
    return -1;
  };
  const run = async (cmd, timeout = 300000) => {
    if ((await waitFor(isReady, 60000, 100)) < 0) return { error: 'no prompt (pre ' + cmd + ')' };
    await sleep(150);
    type(cmd + '\r');
    if ((await waitFor(() => !isReady(), 5000, 5)) < 0) return { error: 'not submitted: ' + cmd };
    const ms = await waitFor(isReady, timeout, 100);
    return { ms, ok: ms >= 0 };
  };
  const out = { steps: [] };
  out.memStart = performance.memory ? performance.memory.usedJSHeapSize : null;
  out.bootPhases = window.__ocBootPhases ?? null;
  out.steps.push(['init', await run('npm init -y', 60000)]);
  const SCALE = 'npm install expo expo-status-bar react react-dom';
  out.installCmd = SCALE;
  out.steps.push(['install-559', await run(SCALE, 960000)]);
  out.memAfterInstall = performance.memory ? performance.memory.usedJSHeapSize : null;
  // Post-install spawn cost (snapshot hydration of the whole tree).
  out.steps.push(['spawn-after-install', await run('node -e "console.log(1+1)"', 180000)]);
  out.steps.push(['spawn-after-install-2', await run('node -e "console.log(2+2)"', 180000)]);
  out.memAfterSpawns = performance.memory ? performance.memory.usedJSHeapSize : null;
  // Verify node_modules landed + count packages.
  try {
    const entries = await rt.readdir('/home/project/node_modules');
    out.nodeModulesCount = entries.length;
    const exp = entries.filter((e) => e.name === 'expo' || e.name === 'react' || e.name === 'react-dom');
    out.keyPackagesPresent = exp.map((e) => e.name);
  } catch (e) { out.nodeModulesError = String(e); }
  const lines = [];
  const b = t.buffer.active;
  for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) lines.push(l.translateToString(true)); }
  out.summaries = lines.filter((l) => /added \d+ packages?/.test(l)).slice(-4);
  window.__ocScale = out;
})().catch((e) => { window.__ocScale = { driverError: String((e && e.stack) || e) }; });
