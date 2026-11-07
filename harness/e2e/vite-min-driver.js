/**
 * E2E driver: MINIMAL vite project — write package.json/index.html/src directly
 * via the fs API (no create-vite), npm install, then `npm run build`.
 * Reports step-by-step on window.__ocVB. Goal: capture the exact vite build
 * failure (or success) with full output.
 */
window.__ocVB = { phase: 'start', steps: [], build: null };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocVB;
  const enc = new TextEncoder();

  const run = async (cmd, timeoutMs, label) => {
    R.phase = label;
    const t0 = Date.now();
    const parts = cmd.split(/\s+/);
    const h = await rt.spawnProgram(parts[0], parts.slice(1), { cwd: '/home/project/minivite' });
    let out = '';
    h.output.pipeTo(new WritableStream({ write(d) { out += d; R.tail = out.slice(-2000); } })).catch(() => {});
    const code = await Promise.race([
      h.exit,
      new Promise((r) => setTimeout(() => r('TIMEOUT'), timeoutMs)),
    ]);
    const step = { label, code, ms: Date.now() - t0 };
    R.steps.push(step);
    return { ...step, out };
  };

  try {
    // 1. write the minimal project files
    const files = {
      'package.json': JSON.stringify({
        name: 'minivite',
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: { build: 'vite build' },
        devDependencies: { vite: '^7.3.0' },
      }, null, 2),
      'index.html': '<!doctype html>\n<html><body><script type="module" src="/src/main.js"></script></body></html>\n',
      'src/main.js': 'document.body.textContent = "hello from vite " + 1;\nconsole.log("minivite loaded");\n',
    };
    for (const [p, c] of Object.entries(files)) {
      await rt.writeFile('/home/project/minivite/' + p, enc.encode(c));
    }
    R.steps.push({ label: 'write-files', code: 0 });

    // 2. install
    const ins = await run('npm install', 600000, 'npm-install');
    R.installTail = ins.out.slice(-1500);
    if (ins.code !== 0) { R.phase = 'install-failed'; return; }

    // 3. what did oc-compat do?
    try {
      const ls = await rt.readdir('/home/project/minivite/node_modules').then((d) => d.map((e) => e.name));
      R.modules = { rollup: ls.includes('rollup'), esbuild: ls.includes('esbuild'), ocCompat: ls.includes('.oc-compat'), count: ls.length };
    } catch (e) { R.modules = 'ERR ' + e.message; }

    // 4. build — capture FULL output
    const b = await run('npm run build', 600000, 'vite-build');
    R.build = { code: b.code, ms: b.ms, out: b.out.slice(-6000) };
    R.phase = 'done';
  } catch (e) {
    R.phase = 'error';
    R.error = String(e?.stack ?? e);
  }
})();
