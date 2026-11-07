/**
 * E2E driver: stdio matrix for child_process.spawn. Tests which stdio
 * configurations produce working stdin/stdout pipes on the child handle.
 */
window.__ocStdio = { phase: 'start', output: '' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocStdio;
  const enc = new TextEncoder();

  await rt.writeFile('/home/project/stdio-matrix.js', enc.encode(`
const cp = require('child_process');
const log = (m) => process.stdout.write('[m] ' + m + '\\n');
const CASES = [
  ['pipe-str', 'pipe'],
  ['inherit-str', 'inherit'],
  ['arr-pipe-pipe-inherit', ['pipe', 'pipe', 'inherit']],
  ['arr-pipe-pipe-pipe', ['pipe', 'pipe', 'pipe']],
  ['arr-pipe-pipe-ignore', ['pipe', 'pipe', 'ignore']],
  ['arr-pipe-pipe-fd2', ['pipe', 'pipe', 2]],
  ['arr-pipe-pipe-null', ['pipe', 'pipe', null]],
];
(async () => {
  for (const [name, stdio] of CASES) {
    await new Promise((done) => {
      const report = { name };
      let child;
      try {
        child = cp.spawn(process.execPath, ['-e', 'process.stdout.write("hi"); process.exit(0)'], { stdio });
      } catch (e) {
        log(name + ' THROW ' + e.message);
        return done();
      }
      let out = '';
      if (child.stdin) { report.stdin = 'yes'; try { child.stdin.write('x'); } catch (e) { report.stdinWriteErr = e.message; } }
      else report.stdin = 'NULL';
      if (child.stdout) { report.stdout = 'yes'; child.stdout.on('data', (d) => { out += d.toString(); }); }
      else report.stdout = 'NULL';
      if (child.stderr) { report.stderr = 'yes'; child.stderr.on('data', (d) => { out += 'E:' + d.toString(); }); }
      else report.stderr = 'NULL';
      child.on('exit', (code) => { report.exitCode = code; report.got = out; log(name + ' ' + JSON.stringify(report)); done(); });
      child.on('error', (e) => { report.spawnErr = e.message; log(name + ' ' + JSON.stringify(report)); done(); });
      setTimeout(() => { report.timeout = true; log(name + ' ' + JSON.stringify(report)); done(); }, 3000);
    });
  }
  log('matrix-done');
})();
`));

  R.phase = 'running';
  const h = await rt.spawnProgram('node', ['stdio-matrix.js'], { cwd: '/home/project' });
  let out = '';
  h.output.pipeTo(new WritableStream({ write(d) { out += d; R.output = out; } })).catch(() => {});
  await Promise.race([
    h.exit,
    new Promise((r) => setTimeout(() => r('TIMEOUT'), 45000)),
  ]);
  R.exitCode = await h.exit.catch(() => 'x');
  R.phase = 'done';
})();
