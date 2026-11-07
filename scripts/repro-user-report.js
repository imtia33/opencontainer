/* Repro driver: type real keystrokes into the demo terminal, capture results. */
window.__ocRepro = null;
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
    return { before: line.slice(0, b.cursorX), after: line.slice(b.cursorX), y };
  };
  const ready = () => { const c = curLine(); return PROMPT_RE.test(c.before) && c.after === ''; };
  const waitPrompt = async (label, timeout = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (ready()) return true;
      await sleep(150);
    }
    throw new Error('no prompt after ' + label);
  };
  const run = async (cmd, timeout = 30000) => {
    await waitPrompt('pre-' + cmd, 10000);
    type(cmd + '\r');
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      await sleep(150);
      if (ready()) return Date.now() - t0;
    }
    return -1;
  };
  const screen = (n = 30) => {
    const b = t.buffer.active;
    const out = [];
    const end = b.baseY + b.cursorY;
    for (let i = Math.max(0, end - n); i <= end; i++) {
      const l = b.getLine(i);
      if (l) out.push(l.translateToString(true));
    }
    return out;
  };
  const results = {};
  try {
    results.node_v = await run('node -v');
    results.npm_v = await run('npm -v');
    results.pnpm_v = await run('pnpm -v', 45000);
    results.pnpm_screen = screen(6);
    results.cd_test = await run('mkdir -p my-app');
    results.cd_run = await run('cd my-app');
    results.cd_screen = screen(4);
    results.pwd_run = await run('pwd');
    results.pwd_screen = screen(3);
    // scrollback test: emit many lines, then check viewport scrollability
    await run('node -e "for(let i=0;i<80;i++)console.log(\'line \'+i)"', 20000);
    const v = document.querySelector('.xterm-viewport');
    results.scroll = {
      viewportScrollable: v.scrollHeight > v.clientHeight,
      scrollHeight: v.scrollHeight, clientHeight: v.clientHeight,
      bufferLength: t.buffer.active.length, viewportY: t.buffer.active.viewportY,
    };
    // try scrolling up via wheel event
    v.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true }));
    await sleep(300);
    results.scroll.afterWheelViewportY = t.buffer.active.viewportY;
    results.scroll.afterWheelScrollTop = v.scrollTop;
    results.final_screen = screen(5);
  } catch (e) {
    results.error = String(e && e.message || e);
    results.screen = screen(20);
  }
  window.__ocRepro = results;
})();
