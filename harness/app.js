/**
 * OpenContainer browser E2E harness — page glue.
 *
 * This is what a minimal embedder looks like TODAY (legacy asset layout):
 * xterm + OpenContainerRuntime + the preview ServiceWorker bridge. It stands
 * in for the demo app that was lost with the dev sandbox.
 *
 * Driver hooks exposed (same names the old e2e drivers used):
 *   window.__ocTerm     — the xterm instance
 *   window.__ocRuntime  — the OpenContainerRuntime
 *   window.__ocState    — { booted, nodeVersion, ports: number[] }
 */
import { OpenContainerRuntime } from '/opencontainer.mjs';

const term = new window.Terminal({
  convertEol: false,
  cursorBlink: true,
  fontSize: 13,
  theme: { background: '#1e1e21' },
});
term.open(document.getElementById('term'));
window.__ocTerm = term;

const state = { booted: false, nodeVersion: '', ports: [], swReady: false, error: null };
window.__ocState = state;

const statusEl = document.getElementById('status');
const setStatus = (text, cls) => {
  statusEl.textContent = text;
  statusEl.className = cls || '';
};

window.__ocStdioLog = [];
const rt = new OpenContainerRuntime({
  // Self-hosted layout: this harness serves /opencontainer/* itself. (The
  // default is the jsDelivr CDN — tested by the standalone IDE test app.)
  onStdio(fd, chunk) {
    window.__ocStdioLog.push(String(chunk));
    if (window.__ocStdioLog.length > 4000) window.__ocStdioLog.shift();
    term.write(chunk);
  },
  onExit() {
    // the shell loop below re-arms the prompt when spawn() resolves
  },
  onReady(info) {
    state.nodeVersion = info.nodeVersion;
    state.booted = true;
    setStatus(`node ${info.nodeVersion} ready`, 'ok');
    term.write(`\x1b[90m# OpenContainer harness — real Node.js ${info.nodeVersion}, genuine npm CLI\x1b[0m\r\n`);
    prompt();
  },
  onListen(info) {
    state.ports.push(info.port);
    term.write(`\r\n\x1b[90m[listening :${info.port} → ${rt.previewUrl(info.port)}]\x1b[0m\r\n`);
    prompt();
    // Zero-setup same-tab preview: the server's output appears in this
    // tab automatically. No tunnel, no copied scripts, no hosted service —
    // previewUrl(port) is the SW-routed same-origin URL (per-client port
    // binding, see registerPreview/preview-sw.js).
    const frame = document.getElementById('preview-frame');
    const empty = document.getElementById('preview-empty');
    const dot = document.getElementById('preview-dot');
    const label = document.getElementById('preview-label');
    const link = document.getElementById('preview-link');
    const url = rt.previewUrl(info.port);
    if (frame) {
      frame.src = url;
      frame.style.display = '';
      if (empty) empty.style.display = 'none';
      if (dot) dot.classList.add('live');
      if (label) label.textContent = `preview :${info.port} — ${url}`;
      if (link) { link.href = url; link.textContent = 'open ↗'; }
    }
    window.__ocPreviewUrl = url;
    window.__ocState.previewUrl = url;
  },
  onUnlisten(info) {
    state.ports = state.ports.filter((p) => p !== info.port);
    const dot = document.getElementById('preview-dot');
    const label = document.getElementById('preview-label');
    if (dot) dot.classList.remove('live');
    if (label) label.textContent = `preview :${info.port} closed`;
  },
  onError(err) {
    term.write(`\r\n\x1b[31m[error] ${err.message}\x1b[0m\r\n`);
  },
}, { assetsBase: '/opencontainer' });
window.__ocRuntime = rt;

function prompt() {
  term.write(`oc ${state.nodeVersion || 'v?'} ❯ `);
}

// ---- the shell loop (a thin readline over rt.spawn) -----------------------
// onData must handle BOTH per-char typing and multi-char chunks (automation
// injection / bracketed-paste-off pastes deliver whole strings — a real
// terminal executes those too, e.g. pasted "npm test\r").
let busy = false;
let line = '';
const handleChar = (ch) => {
  if (state.error) return;
  if (busy) {
    rt.writeStdin(ch);
    return;
  }
  if (ch === '\r') {
    term.write('\r\n');
    const cmd = line.trim();
    line = '';
    if (!cmd) { prompt(); return; }
    busy = true;
    rt.spawn(cmd).then(
      () => { busy = false; prompt(); },
      () => { busy = false; prompt(); },
    );
    return;
  }
  if (ch === '\x7f') { // backspace
    if (line.length > 0) {
      line = line.slice(0, -1);
      term.write('\b \b');
    }
    return;
  }
  if (ch === '\x03') { // Ctrl+C
    term.write('^C\r\n');
    line = '';
    prompt();
    return;
  }
  if (ch >= ' ') {
    line += ch;
    term.write(ch);
  }
};
term.onData((d) => {
  for (const ch of d) handleChar(ch);
});

// ---- preview ServiceWorker -----------------------------------------------
// Nothing to wire: OpenContainerRuntime.boot() registers the preview SW
// (same-origin /opencontainer/preview-sw.js) and routes preview fetches
// into the kernel TCP stack itself. Only a status flag for the drivers.
try {
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg) state.swReady = true;
} catch { /* no SW support — preview disabled */ }

// ---- boot ------------------------------------------------------------------
try {
  await rt.boot();
  if (navigator.serviceWorker.controller) state.swReady = true;
} catch (e) {
  state.error = String((e && e.message) || e);
  setStatus('boot failed', 'bad');
  term.write(`\r\n\x1b[31m[boot] ${state.error}\x1b[0m\r\n`);
}

// ---- e2e driver re-injection (phase B survives reload) ---------------------
if (localStorage.getItem('__ocM1Phase') === 'b') {
  document.head.appendChild(Object.assign(document.createElement('script'), { src: '/e2e/m1-driver.js' }));
}
