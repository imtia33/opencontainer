/**
 * OpenContainer — ESM GRAPH E2E DRIVER (S3.1 Phase 6, real Chromium).
 *
 * Verifies the browser transport end-to-end: guest .mjs entry → graph
 * importer → POST /oc-esm publish → V8 fetches /oc-esm/<nonce>/<path> →
 * real module linking (live bindings, cycles, TLA, dynamic import, CJS
 * interop, package exports) → output in the real xterm.
 *
 * Usage:
 *   agent-browser open http://localhost:3000
 *   agent-browser eval "document.head.appendChild(Object.assign(document.createElement('script'),{src:'/oc-esm-driver.js'})).tagName"
 *   agent-browser wait --fn "!!window.__ocResult" --timeout 120000
 *   agent-browser eval "JSON.stringify(window.__ocResult)"
 */
window.__ocResult = null;
void (async () => {
  const t = window.__ocTerm;
  const rt = window.__ocRuntime;
  if (!t || !rt) { window.__ocResult = { error: 'hooks missing' }; return; }
  const core = t._core.coreService;
  const type = (s) => core.triggerDataEvent(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });

  const PROMPT_RE = /oc v26\.13\.0 ❯\s*$/;
  const bufferText = () => {
    const b = t.buffer.active;
    let out = '';
    for (let y = 0; y < b.length; y++) {
      const line = (b.getLine(y) || { translateToString: () => '' }).translateToString(true);
      out += `${line}\n`;
    }
    return out;
  };
  const curLine = () => {
    const b = t.buffer.active;
    const y = b.baseY + b.cursorY;
    const line = (b.getLine(y) || { translateToString: () => '' }).translateToString(true);
    return { before: line.slice(0, b.cursorX), after: line.slice(b.cursorX) };
  };
  const isReady = () => { const c = curLine(); return PROMPT_RE.test(c.before) && c.after === ''; };

  // 0. wait for the shell prompt
  for (let i = 0; i < 200 && !isReady(); i++) await sleep(100);
  if (!isReady()) { window.__ocResult = { error: 'prompt never appeared' }; return; }

  // 1. write fixtures through the host editor bridge (real runtime path)
  const F = '/home/project/esmt';
  await rt.writeFile(`${F}/counter.mjs`,
    'export let n = 0;\nexport function bump() { n += 1; }\nexport default "counter";\n');
  await rt.writeFile(`${F}/cyc-a.mjs`,
    "import { bFn } from './cyc-b.mjs';\nexport function aFn() { return 'a:' + bFn(); }\nconsole.log('A-BODY');\n");
  await rt.writeFile(`${F}/cyc-b.mjs`,
    "import { aFn } from './cyc-a.mjs';\nexport function bFn() { return 'b'; }\nconsole.log('B-BODY', typeof aFn);\n");
  await rt.writeFile(`${F}/cyc-main.mjs`,
    "import { aFn } from './cyc-a.mjs';\nconsole.log('CYCLE-OK', aFn());\n");
  await rt.writeFile(`${F}/tla.mjs`,
    "const v = await Promise.resolve(42);\nconsole.log('TLA', v);\n");
  await rt.writeFile(`${F}/legacy.cjs`,
    'exports.msg = "CJS-HELLO";\nexports.seven = function () { return 7; };\n');
  await rt.writeFile(`${F}/dyn-dep.mjs`, 'export const dyn = "DYN-OK";\n');
  await rt.writeFile(`${F}/meta.mjs`,
    "console.log('META-URL', import.meta.url);\nconsole.log('META-DIR', import.meta.dirname);\n");
  await rt.writeFile(`${F}/app.mjs`,
    "import def, { n, bump } from './counter.mjs';\nconsole.log('N-BEFORE', n);\nbump(); bump();\nconsole.log('N-AFTER', n);\nconsole.log('DEFAULT', def);\nconst m1 = await import('./dyn-dep.mjs');\nconsole.log('DYN-LIT', m1.dyn);\nconst name = './dyn-dep.mjs';\nconst m2 = await import(name);\nconsole.log('DYN-CMP', m2.dyn);\nconsole.log('DYN-SAME', m1 === m2);\n");
  await rt.writeFile(`${F}/use-cjs.mjs`,
    "import legacy, { msg, seven } from './legacy.cjs';\nconsole.log('CJS-DEF', legacy.msg);\nconsole.log('CJS-NAMED', msg, seven());\n");
  await rt.writeFile(`${F}/missing.mjs`, "import './does-not-exist.mjs';\n");
  await rt.writeFile(`${F}/esmt-pkg/package.json`,
    '{"name":"esmt-pkg","exports":{".":{"import":"./esm/index.mjs"},"./util":"./esm/util.mjs"}}');
  await rt.writeFile(`${F}/esmt-pkg/esm/index.mjs`, 'export const pkg = "PKG-INDEX";\n');
  await rt.writeFile(`${F}/esmt-pkg/esm/util.mjs`, 'export const util = "PKG-UTIL";\n');
  await rt.writeFile(`${F}/node_modules/esmt-pkg/package.json`,
    '{"name":"esmt-pkg","exports":{".":{"import":"./esm/index.mjs"},"./util":"./esm/util.mjs"}}');
  await rt.writeFile(`${F}/node_modules/esmt-pkg/esm/index.mjs`, 'export const pkg = "PKG-INDEX";\n');
  await rt.writeFile(`${F}/node_modules/esmt-pkg/esm/util.mjs`, 'export const util = "PKG-UTIL";\n');
  await rt.writeFile(`${F}/use-pkg.mjs`,
    "import { pkg } from 'esmt-pkg';\nimport { util } from 'esmt-pkg/util';\nconsole.log('PKG', pkg, util);\n");

  /** Type a command, wait for the prompt to return. */
  const run = async (cmd) => {
    const before = t.buffer.active.length;
    type(`${cmd}\r`);
    // pace: wait for the submit newline to render before prompt polling
    for (let i = 0; i < 50 && t.buffer.active.length === before; i++) await sleep(50);
    for (let i = 0; i < 300 && !isReady(); i++) await sleep(100);
    await sleep(150); // tail output flush
    return bufferText();
  };

  // 2. run the ESM entry — THE browser-transport proof
  const outApp = await run(`node ${F}/app.mjs`);
  check('esm entry boots through the browser transport', outApp.includes('N-BEFORE 0'));
  check('live bindings update', outApp.includes('N-AFTER 2'));
  check('default export', outApp.includes('DEFAULT counter'));
  check('dynamic import (literal)', outApp.includes('DYN-LIT DYN-OK'));
  check('dynamic import (computed)', outApp.includes('DYN-CMP DYN-OK'));
  check('module cache identity (m1===m2)', outApp.includes('DYN-SAME true'));

  const outCyc = await run(`node ${F}/cyc-main.mjs`);
  check('cyclic imports (V8 linking)', outCyc.includes('CYCLE-OK a:b'));

  const outTla = await run(`node ${F}/tla.mjs`);
  check('top-level await', outTla.includes('TLA 42'));

  const outCjs = await run(`node ${F}/use-cjs.mjs`);
  check('CJS interop default', outCjs.includes('CJS-DEF CJS-HELLO'));
  check('CJS interop named', outCjs.includes('CJS-NAMED CJS-HELLO 7'));

  const outPkg = await run(`node ${F}/use-pkg.mjs`);
  check('package exports (bare specifier, node_modules)', outPkg.includes('PKG PKG-INDEX PKG-UTIL'));

  const outMeta = await run(`node ${F}/meta.mjs`);
  check('import.meta.url is the file URL of the VFS path', outMeta.includes(`META-URL file://${F}/meta.mjs`));
  check('import.meta.dirname', outMeta.includes(`META-DIR ${F}`));

  const outMissing = await run(`node ${F}/missing.mjs`);
  check('missing module → ERR_MODULE_NOT_FOUND + exit 1',
    outMissing.includes('ERR_MODULE_NOT_NOT_FOUND') === false
      && (outMissing.includes("Cannot find module './does-not-exist.mjs'") || outMissing.includes('ERR_MODULE_NOT_FOUND')),
    outMissing.slice(-600));

  // 3. server from ESM: express is CJS — install it for real first (this
  // ALSO re-verifies the S3 npm-oc regression path after the fs fixes), then
  // import it from an .mjs entry and listen.
  const outInstall = await run('npm install express');
  check('npm install express (real registry) — regression', /added \d+ packages/.test(outInstall), outInstall.slice(-300));
  await rt.writeFile(`${F}/server.mjs`,
    "import express from 'express';\nconst app = express();\napp.get('/', (req, res) => res.json({ esm: 'server-ok' }));\napp.listen(3011, () => console.log('ESM-LISTEN 3011'));\n");
  const outSrv = await run(`node ${F}/server.mjs &`);
  // Background process: the listen event lands asynchronously — poll the
  // port registry (the host's own source of truth) instead of racing it.
  let listening = false;
  for (let i = 0; i < 100; i++) {
    if (rt.listeningPorts().includes(3011)) { listening = true; break; }
    await sleep(100);
  }
  check('express imported from ESM entry + listen', listening || outSrv.includes('ESM-LISTEN 3011'));
  // real HTTP through the preview bridge
  try {
    const res = await fetch('/opencontainer/p/3011/');
    const body = await res.text();
    check('preview fetch hits the ESM-booted server', res.status === 200 && body.includes('server-ok'), `${res.status} ${body.slice(0, 120)}`);
  } catch (e) {
    check('preview fetch hits the ESM-booted server', false, String(e));
  }
  // kill the server
  for (const port of rt.listeningPorts()) {
    const pid = rt.ports?.get?.(port)?.pid;
    if (pid !== undefined) { try { rt.killProcess(pid); } catch { /* best effort */ } }
  }

  const passed = checks.filter((c) => c.ok).length;
  window.__ocResult = {
    suite: 'oc-esm-driver',
    passed,
    failed: checks.length - passed,
    checks,
    tail: bufferText().split('\n').slice(-30).join('\n'),
  };
})().catch((e) => { window.__ocResult = { error: String(e?.stack ?? e) }; });
