/**
 * E2E driver: WebSocket upgrade + TCP close lifecycle lab.
 *
 * Boot → write ws-lab server into the VFS → spawn it → wait for listen →
 * open the preview URL in an iframe (the guest test page) → collect the
 * client-side results (PREVIEW_WS_* postMessages) and guest-side logs.
 *
 * State on window.__ocWSL:
 *   { phase, listen, guestLog[], client{cycles,abnormal,recovery,concurrent},
 *     guestStats, iframe }
 */
window.__ocWSL = { phase: 'boot', guestLog: [], errors: [] };
void (async () => {
  const rt = window.__ocRuntime;
  const R = window.__ocWSL;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1. fetch the lab server source (served by the harness, same origin)
  const srcRes = await fetch('/e2e/ws-lab-server.js');
  const src = await srcRes.text();
  await rt.mkdir('/home/project/ws-lab');
  await rt.writeFile('/home/project/ws-lab/server.js', src);
  R.phase = 'spawn';

  // 2. spawn it (fresh port to dodge any stale registration)
  const h = await rt.spawnProgram('node', ['/home/project/ws-lab/server.js'], {
    cwd: '/home/project/ws-lab',
    env: { WSLAB_PORT: '8899', OC_TRACE_TCP: '1' },
  });
  let out = '';
  h.output.pipeTo(new WritableStream({
    write(d) {
      out += d;
      R.guestLog = out.split('\n').filter(Boolean).slice(-400);
    },
  })).catch(() => {});

  // 3. wait for the listen event
  let listened = null;
  const off = rt.on('listen', (info) => { if (info.port === 8899) listened = info; });
  const t0 = Date.now();
  while (!listened && Date.now() - t0 < 30000) await sleep(100);
  off();
  R.listen = listened;
  if (!listened) {
    R.phase = 'no-listen';
    R.output = out.slice(-2000);
    return;
  }
  R.phase = 'listening';
  await sleep(500);

  // 4. plain HTTP regression through the preview SW first
  const purl = rt.previewUrl(8899);
  R.previewUrl = purl;
  try {
    const health = await fetch(purl + 'health', { cache: 'no-store' });
    R.httpHealth = { status: health.status, body: await health.text() };
  } catch (e) { R.httpHealth = { error: String(e) }; }

  // 5. open the test page in an iframe (client-side cycles run there)
  R.phase = 'iframe';
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:420px;height:300px;border:1px solid #888;z-index:9999;background:#fff';
  iframe.src = purl + '?n=120&m=60&ch=10';
  document.body.appendChild(iframe);
  R.iframe = true;

  // 6. collect client-side reports
  R.client = null;
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'PREVIEW_WS_PROGRESS') {
      R.clientProgress = d;
      R.phase = 'client:' + d.phase;
    } else if (d.type === 'PREVIEW_WS_DONE') {
      R.client = d.summary;
      R.phase = 'client-done';
    } else if (d.type === 'PREVIEW_WS_ERROR') {
      R.errors.push(d.error);
    }
  });

  // 7. wait for the client to finish (cap at 6 minutes)
  const t1 = Date.now();
  while (!R.client && Date.now() - t1 < 360000) await sleep(250);
  R.phase = R.client ? 'done' : 'client-timeout';

  // 8. guest-side stats after the storm
  try {
    const st = await fetch(purl + 'stats', { cache: 'no-store' });
    R.guestStats = await st.json();
  } catch (e) { R.guestStats = { error: String(e) }; }
  R.guestTail = out.slice(-2500);

  // 9. Test F: ordinary HTTP regression
  //    F-a: 20 preview-SW fetches (each a fresh preview route) + a page-sized GET
  R.phase = 'http-f';
  try {
    const fetches = [];
    for (let i = 0; i < 20; i++) {
      fetches.push(fetch(purl + 'health?sw=' + i, { cache: 'no-store' }).then(async (r) =>
        ({ i, status: r.status, body: await r.text() })));
    }
    const results = await Promise.all(fetches);
    R.httpSw = {
      ok: results.filter((r) => r.status === 200 && r.body === 'ok').length,
      bad: results.filter((r) => r.status !== 200 || r.body !== 'ok').length,
    };
    const page = await fetch(purl, { cache: 'no-store' });
    R.httpPage = { status: page.status, isHtml: (await page.text()).indexOf('<!DOCTYPE html>') === 0 };
  } catch (e) { R.httpSw = { error: String(e) }; }

  //    F-b: in-guest loopback client (keep-alive, concurrency, raw upgrades)
  R.phase = 'http-f-guest';
  try {
    const srcF = await (await fetch('/e2e/ws-lab-http-client.js')).text();
    await rt.writeFile('/home/project/ws-lab/http-client.js', srcF);
    const hc = await rt.spawnProgram('node', ['/home/project/ws-lab/http-client.js'], {
      cwd: '/home/project/ws-lab',
    });
    let hout = '';
    hc.output.pipeTo(new WritableStream({ write(d) { hout += d; } })).catch(() => {});
    const code = await Promise.race([
      hc.exit,
      new Promise((r) => setTimeout(() => r('TIMEOUT'), 60000)),
    ]);
    const line = hout.split('\n').filter((l) => l.startsWith('FRESULT ')).pop();
    R.httpGuest = { code, result: line ? JSON.parse(line.slice(8)) : null, tail: hout.slice(-400) };
  } catch (e) { R.httpGuest = { error: String(e) }; }

  R.phase = 'done';
})();
