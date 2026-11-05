/**
 * OpenContainer — npx create-* generator E2E gate (npx-generators-driver.js).
 *
 * The directive: `npx create-expo-app my-app` must work as a GENERAL
 * capability (real npx machinery, real registry, no hardcoded shortcuts).
 * This driver proves BOTH major generators end-to-end through the REAL CLI:
 *
 *   npx -y create-vite@latest cv-app --template vanilla
 *   npx -y create-expo-app@latest expo-app --template blank --no-install
 *
 * Success = the generator's own success banner AND the scaffolded file tree
 * verified through the runtime's fs API (package.json name, entry files).
 *
 * Kernel fixes this gate guards (found by crash-driven porting):
 *   - webstreams globals must be NODE's (browser DecompressionStream broke
 *     pipeThrough brand checks in tar extraction)
 *   - the SharedArrayBuffer polyfill must not make every ArrayBuffer
 *     "shared" (compression-stream chunk validation rejected all chunks)
 *   - FetchIncomingMessage.setEncoding (generator telemetry reads responses)
 *
 * Usage:
 *   agent-browser open http://localhost:7800
 *   agent-browser eval "inject" ; wait ; read window.__ocGenResult
 */
window.__ocGenResult = { done: false, checks: [], progress: [] };
void (async () => {
  const R = window.__ocGenResult;
  const check = (name, ok, detail = '') => {
    R.checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) });
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${String(detail).slice(0, 140)}` : ''}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const t = window.__ocTerm;
  const rt = window.__ocRuntime;
  if (!t || !rt) { check('harness hooks', false); R.done = true; return; }
  const core = t._core.coreService;
  const text = () => {
    const b = t.buffer.active;
    const lines = [];
    for (let i = 0; i < b.length; i++) lines.push(b.getLine(i).translateToString(true));
    return lines.join('\n');
  };
  const promptSeen = () => /\$\s*$|❯\s*$/.test(text().slice(-40));
  const waitFor = async (fn, ms, label) => {
    const t0 = performance.now();
    R.progress.push(`wait:${label}`);
    while (performance.now() - t0 < ms) {
      const v = fn();
      if (v) return v;
      await sleep(150);
    }
    return null;
  };
  const run = async (cmd, ms) => {
    t.clear();
    core.triggerDataEvent(cmd + '\r');
    await sleep(500);
    // Interactive-prompt fallback: current generators end with a clack
    // "Install with npm and start now?"-style question in TTY mode; its
    // default (No) is what we want — press Enter whenever a question mark
    // has been sitting in the buffer for 12s.
    const autoEnter = setInterval(() => {
      const s = text().slice(-700);
      if (s.includes('?')) core.triggerDataEvent('\r');
    }, 12000);
    try {
      await waitFor(promptSeen, ms, `prompt after ${cmd.slice(0, 40)}`);
    } finally {
      clearInterval(autoEnter);
    }
    return text();
  };
  const readJson = async (p) => {
    try { return JSON.parse(new TextDecoder().decode(await rt.readFile(p))); }
    catch { return null; }
  };
  /** Clean a guest dir through the REAL fs API (the harness runtime has no
   *  rm builtin — oc-sh coreutils live behind `sh`; a raw `rm` command
   *  silently "command not found"s and leftover dirs make generators ask
   *  interactive "directory not empty" prompts). */
  const cleanDir = async (p) => {
    try { await rt.rm(p, { recursive: true }); } catch { /* absent */ }
  };

  await waitFor(() => window.__ocState?.booted, 60000, 'boot');
  await waitFor(promptSeen, 30000, 'initial prompt');

  // ---- create-vite --------------------------------------------------------
  await cleanDir('/home/project/cv-app');
  await cleanDir('/home/project/expo-app');
  await sleep(300);
  const viteOut = await run('npx -y create-vite@latest cv-app --template vanilla', 180000);
  check('create-vite banner', /Done\. Now run|Scaffolding project/.test(viteOut),
    viteOut.split('\n').filter((l) => l.trim()).slice(-4).join(' | '));
  const viteFiles = await rt.readdir('/home/project/cv-app').catch(() => null);
  check('create-vite scaffolded tree', !!viteFiles && viteFiles.length >= 4,
    viteFiles ? viteFiles.map((e) => e.name).join(',') : 'missing');
  const vitePkg = await readJson('/home/project/cv-app/package.json');
  check('create-vite package.json', vitePkg?.name === 'cv-app' && !!vitePkg?.devDependencies?.vite,
    vitePkg ? `name=${vitePkg.name}` : 'missing');

  // ---- create-expo-app ----------------------------------------------------
  const expoOut = await run('npx -y create-expo-app@latest expo-app --template blank --no-install', 300000);
  check('create-expo-app banner', /Your project is ready|Downloaded and extracted project files/.test(expoOut),
    expoOut.split('\n').filter((l) => l.trim()).slice(-4).join(' | '));
  const expoFiles = await rt.readdir('/home/project/expo-app').catch(() => null);
  check('create-expo-app scaffolded tree', !!expoFiles && expoFiles.some((e) => e.name === 'App.js'),
    expoFiles ? expoFiles.map((e) => e.name).join(',') : 'missing');
  const expoPkg = await readJson('/home/project/expo-app/package.json');
  check('create-expo-app package.json', expoPkg?.name === 'expo-app' && !!expoPkg?.dependencies?.expo,
    expoPkg ? `name=${expoPkg.name} deps=${Object.keys(expoPkg.dependencies || {}).length}` : 'missing');

  // no hard-fatal errors in either run
  check('no fatal errors', !/not implemented|MODULE_NOT_FOUND/.test(viteOut + expoOut));

  const pass = R.checks.filter((c) => c.ok).length;
  console.log(`=== NPX GENERATORS E2E: ${pass}/${R.checks.length} ===`);
  R.done = true;
})();
