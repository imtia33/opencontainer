/** Burst test: N messages sent back-to-back, count echoes.
 *  Self-contained: spawns its own ws-lab echo server (was previously
 *  dependent on a ws-lifecycle run leaving one on 8899 in the same tab). */
window.__burst = { phase: 'spawn' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__burst;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // spawn the echo lab server (the harness serves its source same-origin)
  const srcRes = await fetch('/e2e/ws-lab-server.js');
  const src = await srcRes.text();
  await rt.mkdir('/home/project/ws-burst').catch(() => {});
  await rt.writeFile('/home/project/ws-burst/server.js', src);
  const srv = await rt.spawnProgram('node', ['/home/project/ws-burst/server.js'], {
    cwd: '/home/project/ws-burst',
    env: { WSLAB_PORT: '8899' },
  });
  let srvOut = '';
  srv.output.pipeTo(new WritableStream({ write(d) { srvOut += d; R.tail = srvOut.slice(-300); } })).catch(() => {});
  let listened = null;
  const off = rt.on('listen', (info) => { if (info.port === 8899) listened = info; });
  const tL = Date.now();
  while (!listened && Date.now() - tL < 30000) await sleep(100);
  off();
  if (!listened) { R.phase = 'no-listen'; R.output = srvOut.slice(-800); return; }
  await sleep(400);
  R.phase = 'iframe';

  const ifr = document.createElement('iframe');
  ifr.style.cssText = 'position:fixed;left:0;top:0;width:380px;height:220px;border:2px solid gold;z-index:99998;background:#fff';
  ifr.src = rt.previewUrl(8899) + '?n=1&m=0&ch=0';
  document.body.appendChild(ifr);
  await sleep(2500);
  const w = ifr.contentWindow;
  R.shim = w.WebSocket && w.WebSocket.name;
  const openWs = () => new Promise((res, rej) => {
    const s = new w.WebSocket('ws://' + w.location.host + '/ws');
    s.onopen = () => res(s);
    s.onerror = (e) => rej(new Error('open: ' + (e && e.message)));
    setTimeout(() => rej(new Error('timeout')), 8000);
  });
  try {
    const ws = await openWs();
    R.phase = 'open';
    const seen = new Set();
    ws.onmessage = (ev) => { const m = /^echo:b(\d+)-(\d+)$/.exec(String(ev.data)); if (m) seen.add(m[1] + '-' + m[2]); };
    // three rounds of increasing burst size, no pacing between sends
    for (const size of [10, 50, 200]) {
      seen.clear();
      for (let i = 0; i < size; i++) ws.send('b' + size + '-' + i);
      await sleep(Math.max(3000, size * 60));
      R['burst' + size] = { sent: size, got: seen.size };
    }
    ws.close(1000);
    srv.kill();
    R.phase = 'done';
  } catch (e) {
    R.phase = 'error';
    R.error = String(e && e.message || e);
  }
})();
