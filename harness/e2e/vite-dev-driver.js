/**
 * E2E driver: scaffold a Vite app via REAL terminal commands, install deps,
 * start the dev server, and report exactly what happens (incl. server-ready
 * and preview URL). Runs inside the harness page via
 *   agent-browser eval "document.head.appendChild(Object.assign(document.createElement('script'),{src:'/e2e/vite-dev-driver.js'})).tagName"
 */
window.__ocResult = null;
window.__ocPhase = 'start';
void (async () => {
  const term = window.__ocTerm;
  const rt = window.__ocRuntime;
  const core = term._core.coreService;
  const type = (s) => core.triggerDataEvent(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = window.__ocStdioLog;

  const PROMPT_RE = /oc v26\.13\.0 ❯\s*$/;
  const curLine = () => {
    const b = term.buffer.active;
    const y = b.baseY + b.cursorY;
    const line = (b.getLine(y) || { translateToString: () => '' }).translateToString(true);
    return { before: line.slice(0, b.cursorX), after: line.slice(b.cursorX) };
  };
  const atPrompt = () => { const c = curLine(); return PROMPT_RE.test(c.before) && c.after === ''; };
  const awaitPrompt = async (timeout = 600000, label = '') => {
    const t0 = Date.now();
    while (!atPrompt()) {
      if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for prompt ${label}; tail: ${log.slice(-8).join('|')}`);
      await sleep(150);
    }
    return Date.now() - t0;
  };
  const run = async (cmd, timeout, label) => {
    window.__ocPhase = label ?? cmd;
    await awaitPrompt(120000, 'before ' + cmd);
    const start = log.length;
    type(cmd + '\r');
    await awaitPrompt(timeout, label ?? cmd);
    return { cmd, ms: 0, output: log.slice(start).join('') };
  };

  const result = { steps: [], serverReady: null, previewHtml: null, error: null };
  try {
    // Listen for server-ready on the facade-shaped runtime events
    rt.on('listen', (info) => { result.serverReady = { port: info.port, pid: info.pid }; });

    const skipCreate = await rt.readdir('/home/project').then(d => d.some(e => e.name === 'vapp'));
    if (!skipCreate) {
      result.steps.push(await run('npm create --yes vite@latest vapp -- --template react', 600000, 'create-vite'));
    } else {
      result.steps.push({ cmd: 'create-vite', skipped: true });
    }
    result.steps.push(await run('cd ~/vapp', 30000, 'cd'));
    result.steps.push(await run('npm install', 900000, 'npm-install'));
    // start dev server in the background so we keep the prompt
    const before = log.length;
    type('npm run dev &\r');
    window.__ocPhase = 'vite-dev-wait';
    // wait for either server-ready or 90s
    const t0 = Date.now();
    while (!result.serverReady && Date.now() - t0 < 90000) await sleep(200);
    await sleep(3000); // let output settle
    result.devOutput = log.slice(before).join('');
    result.ports = rt.listeningPorts();
    result.ps = rt.ps();
    window.__ocResult = result;
  } catch (e) {
    result.error = String(e?.stack ?? e);
    result.tail = log.slice(-25).join('');
    window.__ocResult = result;
  }
})();
