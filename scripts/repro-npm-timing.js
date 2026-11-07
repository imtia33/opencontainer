/* npm install timing — prompt discipline modeled on e2e-terminal-driver.js:
 * every run FIRST confirms submission (prompt consumed), THEN waits for the
 * prompt to return. The old version raced the echo (typed into running
 * processes and reported 0-1ms "installs"). */
window.__ocNpm = null;
void (async () => {
  const t = window.__ocTerm;
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
  const waitFor = async (fn, ms, step = 25) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return Date.now() - t0; await sleep(step); }
    return -1;
  };
  const run = async (cmd, timeout = 300000) => {
    const pre = await waitFor(isReady, 30000, 100);
    if (pre < 0) return { error: 'no prompt (pre ' + cmd + ')' };
    await sleep(150); // let the prompt fully settle
    type(cmd + '\r');
    const submitted = await waitFor(() => !isReady(), 5000, 5);
    if (submitted < 0) return { error: 'not submitted: ' + cmd };
    const ms = await waitFor(isReady, timeout, 50);
    return { ms, ok: ms >= 0 };
  };
  const out = { steps: [] };
  out.bootPhases = window.__ocBootPhases ?? null;
  out.steps.push(['init', await run('npm init -y', 60000)]);
  out.steps.push(['lodash', await run('npm install lodash', 180000)]);
  out.steps.push(['express', await run('npm install express', 300000)]);
  // Summaries from the real xterm buffer (the __ocStdioLog ring evicts under
  // spinner floods): "added N packages in Xs" lines.
  const lines = [];
  const b = t.buffer.active;
  for (let i = 0; i < b.length; i++) {
    const l = b.getLine(i);
    if (l) lines.push(l.translateToString(true));
  }
  out.summaries = lines.filter((l) => /added \d+ packages?/.test(l)).slice(-6);
  out.expressModulesDir = lines.some((l) => /node_modules/.test(l));
  window.__ocNpm = out;
})().catch((e) => { window.__ocNpm = { driverError: String((e && e.stack) || e) }; });
