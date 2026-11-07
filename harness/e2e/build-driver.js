/**
 * E2E driver: run `npm run build` (vite) inside the guest vapp and capture
 * the full output + exit code. Injected into the harness page, polled via
 * window.__ocBuildResult.
 *
 * Usage:
 *   agent-browser eval "document.head.appendChild(Object.assign(document.createElement('script'),{src:'/e2e/build-driver.js'})).tagName"
 *   agent-browser eval "window.__ocBuildResult"
 */
window.__ocBuildResult = { phase: 'start', output: '', exit: null, ms: null };
void (async () => {
  const rt = window.__ocRuntime;
  const t0 = Date.now();
  try {
    window.__ocBuildResult.phase = 'spawning';
    const h = await rt.spawnProgram('npm', ['run', 'build'], { cwd: '/home/project/vapp' });
    window.__ocBuildResult.phase = 'running';
    h.output.pipeTo(new WritableStream({
      write(d) { window.__ocBuildResult.output += d; },
    })).catch(() => {});
    const code = await h.exit;
    window.__ocBuildResult.exit = code;
    window.__ocBuildResult.ms = Date.now() - t0;
    window.__ocBuildResult.phase = 'done';
  } catch (e) {
    window.__ocBuildResult.phase = 'error';
    window.__ocBuildResult.error = String(e?.stack ?? e);
    window.__ocBuildResult.ms = Date.now() - t0;
  }
})();
