/**
 * E2E driver: scaffold a VITE 7 app (rollup-based — single-threaded wasm in
 * our kernel, unlike vite 8/rolldown which needs real wasm threads), install,
 * build, and report. Phases published on window.__ocV7.
 */
window.__ocV7 = { phase: 'start', steps: [] };
void (async () => {
  const rt = window.__ocRuntime;
  const run = async (cmd, timeoutMs, label) => {
    window.__ocV7.phase = label;
    const t0 = Date.now();
    const parts = cmd.split(/\s+/);
    const h = await rt.spawnProgram(parts[0], parts.slice(1), { cwd: '/home/project' });
    let out = '';
    h.output.pipeTo(new WritableStream({ write(d) { out += d; } })).catch(() => {});
    const code = await Promise.race([
      h.exit,
      new Promise((r) => setTimeout(() => r('TIMEOUT'), timeoutMs)),
    ]);
    const step = { label, code, ms: Date.now() - t0, tail: out.slice(-400) };
    window.__ocV7.steps.push(step);
    return step;
  };
  try {
    // 1. scaffold vite 7 app (rollup path)
    await run('npx --yes create-vite@7 vapp7 -- --template react', 300000, 'create-vite7');
    if (window.__ocV7.steps[0].code !== 0) return;
    // 2. install
    await run('npm install', 600000, 'npm-install');
    // 3. verify the oc-compat swaps happened (rollup -> wasm-node, esbuild -> wasm)
    const ls = await rt.readdir('/home/project/vapp7/node_modules').then((d) => d.map((e) => e.name));
    window.__ocV7.modules = {
      rollup: ls.includes('rollup'),
      rollupWasmNode: ls.includes('.oc-compat') || ls.includes('rollup'),
      esbuild: ls.includes('esbuild'),
      count: ls.length,
      ocCompat: ls.filter((n) => n.startsWith('.oc')),
    };
    // 4. build
    await run('npm run build', 600000, 'vite-build');
    // 5. read dist to verify
    try {
      const dist = await rt.readdir('/home/project/vapp7/dist').then((d) => d.map((e) => e.name));
      window.__ocV7.dist = dist;
    } catch (e) { window.__ocV7.dist = 'ERR ' + e.message; }
    window.__ocV7.phase = 'done';
  } catch (e) {
    window.__ocV7.phase = 'error';
    window.__ocV7.error = String(e?.stack ?? e);
  }
})();
