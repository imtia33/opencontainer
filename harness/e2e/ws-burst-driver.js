/** Burst test: N messages sent back-to-back, count echoes. */
window.__burst = { phase: 'start' };
void (async () => {
  const ifr = document.createElement('iframe');
  ifr.style.cssText = 'position:fixed;left:0;top:0;width:380px;height:220px;border:2px solid gold;z-index:99998;background:#fff';
  ifr.src = window.__ocRuntime.previewUrl(8899) + '?n=1&m=0&ch=0';
  document.body.appendChild(ifr);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(2500);
  const w = ifr.contentWindow;
  const R = window.__burst;
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
    R.phase = 'done';
  } catch (e) {
    R.phase = 'error';
    R.error = String(e && e.message || e);
  }
})();
