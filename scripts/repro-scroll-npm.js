/* Scroll-during-streaming + npm install timing test. */
window.__ocScroll = null;
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
  const ready = () => { const c = curLine(); return PROMPT_RE.test(c.before) && c.after === ''; };
  const waitPrompt = async (timeout = 60000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { if (ready()) return true; await sleep(120); }
    return false;
  };
  const out = {};

  // 1) scroll DURING a streaming process
  type('node -e "let n=0;const iv=setInterval(()=>{console.log(\'stream \'+(n++));if(n>400)clearInterval(iv)},30)"\r');
  await sleep(2500); // mid-stream
  const v = document.querySelector('.xterm-viewport');
  const midStream = { viewportY: t.buffer.active.viewportY, scrollTop: v.scrollTop };
  v.dispatchEvent(new WheelEvent('wheel', { deltaY: -600, bubbles: true, cancelable: true }));
  await sleep(120);
  v.dispatchEvent(new WheelEvent('wheel', { deltaY: -600, bubbles: true, cancelable: true }));
  await sleep(400); // let more writes land after the wheel
  out.duringStream = {
    midStream,
    afterWheel: { viewportY: t.buffer.active.viewportY, scrollTop: v.scrollTop },
    stillStreaming: !ready(),
  };
  // wait for the stream to finish
  await waitPrompt(60000);
  out.streamDone = true;

  // 2) npm install timing — small package
  type('npm init -y\r');
  await waitPrompt();
  const t0 = Date.now();
  type('npm install lodash\r');
  await waitPrompt(120000);
  out.npmInstallLodashMs = Date.now() - t0;

  // 3) npm install timing — medium tree (express = ~60 deps)
  const t1 = Date.now();
  type('npm install express\r');
  await waitPrompt(300000);
  out.npmInstallExpressMs = Date.now() - t1;

  const log = window.__ocStdioLog.join('');
  const m = log.match(/added \d+ packages?[^\r\n]*/g);
  out.npmSummaries = m ? m.slice(-4) : null;

  // 4) after everything, is the buffer scrollable + wheel works at prompt?
  const v2 = {
    viewportY: t.buffer.active.viewportY,
    scrollable: v.scrollHeight > v.clientHeight,
    bufferLength: t.buffer.active.length,
  };
  v.dispatchEvent(new WheelEvent('wheel', { deltaY: -600, bubbles: true, cancelable: true }));
  await sleep(300);
  out.atPrompt = { before: v2, afterWheelViewportY: t.buffer.active.viewportY };
  window.__ocScroll = out;
})();
