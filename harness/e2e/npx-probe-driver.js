/**
 * OpenContainer — npx create-* generator probe (honest evidence driver).
 *
 * The directive: `npx create-expo-app my-app` must work as a GENERAL
 * capability (no hardcoded shortcuts). This probe runs the REAL npx
 * machinery against real generators and records exactly what happens:
 * success, or the precise boundary where it stops.
 *
 *   agent-browser open http://localhost:7800
 *   agent-browser eval "inject" ; wait ; read window.__ocNpxProbe
 */
window.__ocNpxProbe = { done: false, steps: [] };
void (async () => {
  const R = window.__ocNpxProbe;
  const log = (s, detail = '') => {
    R.steps.push({ step: s, detail: String(detail).slice(0, 400) });
    console.log(`[npx-probe] ${s}${detail ? ' — ' + String(detail).slice(0, 120) : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = window.__ocTerm;
  const rt = window.__ocRuntime;
  if (!t || !rt) { log('harness hooks missing'); R.done = true; return; }
  const core = t._core.coreService;
  const buf = () => {
    const b = t.buffer.active;
    const lines = [];
    for (let i = 0; i < b.length; i++) lines.push(b.getLine(i).translateToString(true));
    return lines.join('\n');
  };
  const waitFor = async (fn, ms, label) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(100);
    }
    log(`timeout: ${label}`);
    return null;
  };
  const promptSeen = () => {
    const s = buf();
    return /project\s*\$?\s*$/.test(s.slice(-80)) || /\$\s*$/.test(s.slice(-40));
  };
  const type = (s) => core.triggerDataEvent(s);
  const runCmd = async (cmd, needles, ms) => {
    const before = t.buffer.active.length;
    type(cmd + '\r');
    // Wait for the submit newline to render first (xterm write asynchrony),
    // then for either a needle or the prompt to return.
    await sleep(400);
    const hit = await waitFor(() => {
      const s = buf();
      return needles.find((n) => s.includes(n)) || (promptSeen() && s.length > 40 ? '__PROMPT__' : null);
    }, ms, cmd);
    return { hit: hit === '__PROMPT__' ? 'prompt' : hit, text: buf().slice(-3000) };
  };

  // Wait for boot
  await waitFor(() => window.__ocState?.booted, 60000, 'boot');
  await waitFor(promptSeen, 30000, 'initial prompt');
  log('booted + prompt');

  // Clean slate
  let r = await runCmd('rm -rf cv-app expo-app npx-probe.log', [], 8000);
  log('cleanup done', r.hit);

  // ---- create-vite (vanilla template — pure-JS generator) ----------------
  r = await runCmd(
    'npx -y create-vite@latest cv-app --template vanilla',
    ['done in', 'cv-app', 'Error', 'error', 'not implemented', 'MODULE_NOT_FOUND'],
    120000,
  );
  log('create-vite outcome', r.hit);
  R.createVite = { hit: r.hit, tail: r.text.split('\n').slice(-14).join('\n') };

  // Did it produce files?
  await sleep(600);
  r = await runCmd('ls cv-app', ['index.html', 'No such file', 'package.json'], 10000);
  const viteFiles = buf().includes('index.html') || buf().includes('package.json');
  R.createVite.files = viteFiles;
  log('cv-app files?', viteFiles);

  // ---- create-expo-app (blank template) -----------------------------------
  r = await runCmd(
    'npx -y create-expo-app@latest expo-app --template blank --no-install',
    ['created', 'Success', 'Error', 'error', 'not implemented', 'What is your app'],
    180000,
  );
  log('create-expo-app outcome', r.hit);
  R.createExpo = { hit: r.hit, tail: r.text.split('\n').slice(-14).join('\n') };

  await sleep(600);
  r = await runCmd('ls expo-app', ['App.js', 'app.json', 'No such file'], 10000);
  const expoFiles = buf().includes('app.json');
  R.createExpo.files = expoFiles;
  log('expo-app files?', expoFiles);

  R.done = true;
  console.log('=== NPX PROBE COMPLETE ===', JSON.stringify({ vite: R.createVite?.hit, viteFiles, expo: R.createExpo?.hit, expoFiles }));
})();
