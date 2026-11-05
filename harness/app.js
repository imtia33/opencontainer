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
  onStdio(fd, chunk) {
    window.__ocStdioLog.push(String(chunk));
    if (window.__ocStdioLog.length > 400) window.__ocStdioLog.shift();
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
    term.write(`\r\n\x1b[90m[listening :${info.port} → /opencontainer/p/${info.port}/]\x1b[0m\r\n`);
    prompt();
  },
  onUnlisten(info) {
    state.ports = state.ports.filter((p) => p !== info.port);
  },
  onError(err) {
    term.write(`\r\n\x1b[31m[error] ${err.message}\x1b[0m\r\n`);
  },
});
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

// ---- preview ServiceWorker + bridge glue ----------------------------------
try {
  const reg = await navigator.serviceWorker.register('/opencontainer/preview-sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  state.swReady = true;
  // The SW routes /opencontainer/p/<port>/ fetches here; we hand them to the
  // runtime's virtual TCP stack. (This ~15 lines is what M1's registerPreview()
  // will absorb into the package.)
  navigator.serviceWorker.addEventListener('message', (ev) => {
    const m = ev.data;
    if (m && m.type === 'oc-preview-fetch') {
      const channel = ev.ports[0];
      const ok = rt.connectPreview(m.port, channel, m.bytes);
      if (!ok) {
        try { channel.postMessage({ type: 'end' }); } catch (e) { /* closed */ }
      }
    }
  });
} catch (e) {
  state.error = String((e && e.message) || e);
  setStatus('SW registration failed', 'bad');
  term.write(`\r\n\x1b[31m[sw] ${state.error}\x1b[0m\r\n`);
}

// ---- boot ------------------------------------------------------------------
try {
  await rt.boot();
} catch (e) {
  state.error = String((e && e.message) || e);
  setStatus('boot failed', 'bad');
  term.write(`\r\n\x1b[31m[boot] ${state.error}\x1b[0m\r\n`);
}

// ---- e2e driver re-injection (phase B survives reload) ---------------------
if (localStorage.getItem('__ocM1Phase') === 'b') {
  document.head.appendChild(Object.assign(document.createElement('script'), { src: '/e2e/m1-driver.js' }));
}
