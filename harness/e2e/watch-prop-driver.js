/**
 * E2E driver: fs.watch event propagation. A guest process watches a file;
 * the host writes it via the runtime fs API (as an IDE would); verify the
 * watcher fires (this is what vite/chokidar invalidation depends on).
 */
window.__ocWatch = { phase: 'start' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocWatch;
  const enc = new TextEncoder();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const script = `
const fs = require('fs');
process.stdout.write('[watch] arming\\\\n');
try {
  const w = fs.watch('/home/project/minivite/src/main.js', (event, file) => {
    process.stdout.write('[watch] EVENT ' + event + ' ' + file + '\\\\n');
  });
  process.stdout.write('[watch] armed: ' + !!w + '\\\\n');
} catch (e) {
  process.stdout.write('[watch] fs.watch THREW: ' + e.message + '\\\\n');
}
try {
  fs.watchFile('/home/project/minivite/src/main.js', (cur, prev) => {
    process.stdout.write('[watch] watchFile mtime ' + cur.mtimeMs + ' (was ' + prev.mtimeMs + ')\\\\n');
  });
  process.stdout.write('[watch] watchFile armed\\\\n');
} catch (e) {
  process.stdout.write('[watch] watchFile THREW: ' + e.message + '\\\\n');
}
setTimeout(() => { process.stdout.write('[watch] done\\\\n'); process.exit(0); }, 8000);
`;
  await rt.writeFile('/home/project/watch-test.js', enc.encode(script));
  const h = await rt.spawnProgram('node', ['watch-test.js'], { cwd: '/home/project' });
  let out = '';
  h.output.pipeTo(new WritableStream({ write(d) { out += d; R.out = out; } })).catch(() => {});

  await sleep(1500); // let the watcher arm
  await rt.writeFile('/home/project/minivite/src/main.js', enc.encode(
    'document.body.textContent = "HOST WRITE " + Date.now();\n'));
  await sleep(1500);
  await rt.writeFile('/home/project/minivite/src/main.js', enc.encode(
    'document.body.textContent = "HOST WRITE 2 " + Date.now();\n'));
  await sleep(6000);
  R.phase = 'done';
})();
