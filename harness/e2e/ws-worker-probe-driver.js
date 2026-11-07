/**
 * E2E probe: prove that WebSocket connections created INSIDE a SharedWorker
 * bypass the preview shim (real WS → dials the host origin → dies), while the
 * same URL created in the page (shimmed WS) tunnels to the guest server.
 *
 * Uses the existing ws-lab-server (any guest server that upgrades WS at "/").
 * State on window.__ocWP: { phase, ... }
 */
window.__ocWP = { phase: 'boot' };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocWP;
  const enc = new TextEncoder();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    // 1. spawn the lab server (echoes, upgrades WS at "/")
    const srcRes = await fetch('/e2e/ws-lab-server.js');
    const src = await srcRes.text();
    await rt.mkdir('/home/project/ws-probe');
    await rt.writeFile('/home/project/ws-probe/server.js', src);
    R.phase = 'spawn';
    const h = await rt.spawnProgram('node', ['/home/project/ws-probe/server.js'], {
      cwd: '/home/project/ws-probe',
      env: { WSLAB_PORT: '8898' },
    });
    let out = '';
    h.output.pipeTo(new WritableStream({ write(d) { out += d; R.tail = out.slice(-400); } })).catch(() => {});
    let listened = null;
    const off = rt.on('listen', (info) => { if (info.port === 8898) listened = info; });
    const t0 = Date.now();
    while (!listened && Date.now() - t0 < 30000) await sleep(100);
    off();
    if (!listened) { R.phase = 'no-listen'; return; }
    await sleep(400);

    // 2. preview iframe
    R.phase = 'iframe';
    const purl = rt.previewUrl(8898);
    R.previewUrl = purl;
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:360px;height:220px;border:2px solid #0d9fff;z-index:9999;background:#fff';
    iframe.src = purl;
    document.body.appendChild(iframe);
    const tI = Date.now();
    while (Date.now() - tI < 15000) {
      try { if (iframe.contentWindow?.document?.readyState === 'complete') break; } catch { /* */ }
      await sleep(100);
    }
    await sleep(500);

    // 3. probe INSIDE the iframe
    R.phase = 'probe';
    R.probe = await iframe.contentWindow.eval(`(async () => {
      const out = { origin: location.origin, hasSharedWorker: typeof SharedWorker };
      // (a) SHIMMED WS in the page — should tunnel to the guest and OPEN
      const pageWs = await new Promise((resolve) => {
        let settled = false;
        try {
          const ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '/', 'vite-ping');
          const done = (v) => { if (!settled) { settled = true; try { ws.close(); } catch (e) {} resolve(v); } };
          ws.addEventListener('open', () => done('OPEN'));
          ws.addEventListener('error', () => done('ERROR'));
          ws.addEventListener('close', (e) => done('CLOSE-' + e.code));
          setTimeout(() => done('TIMEOUT'), 5000);
        } catch (e) { resolve('THROW:' + e.message); }
      });
      out.pageShimmedWs = pageWs;

      // (b) REAL WS inside a SharedWorker (vite 7.3.7's ping mechanism).
      //     With the shim's SharedWorker wrapper, the worker's WebSocket is
      //     bridged back to the page and tunneled — must OPEN now.
      if (typeof SharedWorker === 'function') {
        const workerSrc =
          'self.addEventListener("connect", function (ev) {' +
          '  var port = ev.ports[0];' +
          '  port.start();' +
          '  var result = { hasWebSocket: typeof WebSocket };' +
          '  try {' +
          '    var ws = new WebSocket(' + JSON.stringify(location.origin.replace(/^http/, 'ws') + '/') + ', "vite-ping");' +
          '    var settled = false;' +
          '    var done = function (v) {' +
          '      if (settled) return; settled = true;' +
          '      result.workerWs = v;' +
          '      result.wsCtor = ws.constructor && ws.constructor.name;' +
          '      try { ws.close(); } catch (e) {}' +
          '      port.postMessage(result);' +
          '    };' +
          '    ws.addEventListener("open", function () { done("OPEN"); });' +
          '    ws.addEventListener("error", function () { done("ERROR"); });' +
          '    ws.addEventListener("close", function (e) { done("CLOSE-" + e.code); });' +
          '    setTimeout(function () { done("TIMEOUT"); }, 5000);' +
          '  } catch (e) { result.workerWs = "THROW:" + e.message; port.postMessage(result); }' +
          '});';
        const blob = new Blob([workerSrc], { type: 'application/javascript' });
        const swUrl = URL.createObjectURL(blob);
        let sharedOk;
        try {
          const sw = new SharedWorker(swUrl);
          sw.port.start();
          sharedOk = await new Promise((resolve) => {
            const to = setTimeout(() => resolve('TIMEOUT'), 7000);
            sw.port.addEventListener('message', (ev) => { clearTimeout(to); resolve(ev.data); });
            sw.port.addEventListener('error', () => { clearTimeout(to); resolve('WORKER-ERROR'); });
          });
        } catch (e) {
          sharedOk = 'CONSTRUCT-THROW:' + e.message;
        }
        out.sharedWorkerPing = sharedOk;
      }

      // (c) SHIMMED SharedWorker + data path: open a WS through the bridge,
      //     send a text frame, expect the echo back (ws-lab echoes), close.
      if (typeof SharedWorker === 'function') {
        const echoSrc =
          'self.addEventListener("connect", function (ev) {' +
          '  var port = ev.ports[0];' +
          '  port.start();' +
          '  var result = {};' +
          '  try {' +
          '    var ws = new WebSocket(' + JSON.stringify(location.origin.replace(/^http/, 'ws') + '/') + ', "vite-ping");' +
          '    var msgs = [];' +
          '    ws.addEventListener("open", function () { ws.send("bridge-echo-probe"); });' +
          '    ws.addEventListener("message", function (e) { msgs.push(String(e.data)); });' +
          '    ws.addEventListener("close", function () { result.msgs = msgs; port.postMessage(result); });' +
          '    ws.addEventListener("error", function () { result.error = true; port.postMessage(result); });' +
          '    setTimeout(function () { result.timeout = true; result.msgs = msgs; try { ws.close(); } catch (e) {} port.postMessage(result); }, 6000);' +
          '  } catch (e) { result.throw = String(e); port.postMessage(result); }' +
          '});';
        const blob2 = new Blob([echoSrc], { type: 'application/javascript' });
        const swUrl2 = URL.createObjectURL(blob2);
        let echoOk;
        try {
          const sw2 = new SharedWorker(swUrl2);
          sw2.port.start();
          echoOk = await new Promise((resolve) => {
            const to = setTimeout(() => resolve('TIMEOUT'), 9000);
            sw2.port.addEventListener('message', (ev) => { clearTimeout(to); resolve(ev.data); });
            sw2.port.addEventListener('error', () => { clearTimeout(to); resolve('WORKER-ERROR'); });
          });
        } catch (e) {
          echoOk = 'CONSTRUCT-THROW:' + e.message;
        }
        out.sharedWorkerEcho = echoOk;
      }
      return out;
    })()`);

    R.phase = 'done';
  } catch (e) {
    R.phase = 'error';
    R.error = String((e && e.stack) || e);
  }
})();
