/* S20/S21 functional gate: real shell builtins + coreutils via oc-sh,
 * cd session persistence (incl. compound `mkdir x && cd x`), node -v,
 * real pnpm -v. Parks results on window.__ocFunc. */
window.__ocFunc = null;
void (async () => {
  const t = window.__ocTerm;
  const rt = window.__ocRuntime;
  const core = t._core.coreService;
  const type = (s) => core.triggerDataEvent(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const PROMPT_RE = /oc v26\.13\.0 ❯\s*$/;
  const curLine = () => {
    const b = t.buffer.active;
    const y = b.baseY + b.cursorY;
    const line = (b.getLine(y) || { translateToString: () => '' }).translateToString(true);
    return { before: line.slice(0, b.cursorX), after: line.slice(b.cursorX) };
  };
  const isReady = () => { const c = curLine(); return PROMPT_RE.test(c.before) && c.after === ''; };
  const waitFor = async (fn, ms, step = 50) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (fn()) return Date.now() - t0; await sleep(step); }
    return -1;
  };
  const lines = () => {
    const b = t.buffer.active;
    const out = [];
    for (let i = 0; i < b.length; i++) { const l = b.getLine(i); if (l) out.push(l.translateToString(true)); }
    return out;
  };
  const run = async (cmd, timeout = 60000) => {
    if ((await waitFor(isReady, 30000, 100)) < 0) return { error: 'no prompt (pre ' + cmd + ')' };
    await sleep(120);
    type(cmd + '\r');
    if ((await waitFor(() => !isReady(), 5000, 5)) < 0) return { error: 'not submitted: ' + cmd };
    const ms = await waitFor(isReady, timeout, 30);
    return { ms, ok: ms >= 0 };
  };
  const check = (name, ok, detail) => { out.checks.push({ name, ok: !!ok, detail: String(detail ?? '').slice(0, 200) }); };
  const out = { checks: [], steps: [] };
  const snap = () => lines().join('\n');

  // 1. node -v (user reported zero output once)
  let r = await run('node -v', 30000);
  check('node -v runs', r.ok, r.ms + 'ms');
  check('node -v prints v26.13.0', /v26\.13\.0/.test(snap()), '');

  // 2. pwd (should be /home/project)
  r = await run('pwd', 30000);
  check('pwd prints /home/project', /\/home\/project/.test(snap()), '');

  // 3. mkdir + cd + compound
  r = await run('mkdir my-app', 30000);
  check('mkdir my-app exits 0', r.ok, r.ms + 'ms');
  const lsAfterMkdir = await run('ls', 30000);
  check('ls lists my-app', /my-app/.test(snap()), '');
  r = await run('cd my-app', 30000);
  check('cd my-app exits 0', r.ok, r.ms + 'ms');
  r = await run('pwd', 30000);
  check('pwd after cd = /home/project/my-app', /\/home\/project\/my-app/.test(snap()), '');
  // file creation INSIDE the new cwd proves the session cwd is real
  r = await run('echo hello-from-my-app > note.txt', 30000);
  r = await run('cat note.txt', 30000);
  check('cat reads file created in new cwd', /hello-from-my-app/.test(snap()), '');
  try {
    const entries = await rt.readdir('/home/project/my-app');
    check('fs API sees my-app/note.txt', entries.some((e) => e.name === 'note.txt'), JSON.stringify(entries.map((e) => e.name)));
  } catch (e) { check('fs API sees my-app/note.txt', false, String(e)); }

  // 4. cd .. then compound `mkdir x && cd x` (the report-channel case)
  r = await run('cd ..', 30000);
  r = await run('pwd', 30000);
  check('cd .. back to /home/project', /\/home\/project\s*$/.test(snap().split('\n').filter(Boolean).pop() ?? ''), '');
  r = await run('mkdir compound && cd compound', 30000);
  check('compound mkdir+cd exits 0', r.ok, r.ms + 'ms');
  r = await run('pwd', 30000);
  check('pwd after compound = compound dir', /\/home\/project\/compound/.test(snap()), '');

  // 5. cd to missing dir → real sh error
  r = await run('cd no-such-dir-xyz', 30000);
  check('cd missing dir errors', /no such file or directory/.test(snap()), '');

  // 6. cd back home for later steps
  await run('cd /home/project', 30000);

  // 7. real pnpm -v
  r = await run('pnpm -v', 120000);
  check('pnpm -v runs', r.ok, r.ms + 'ms');
  check('pnpm -v prints 10.34.9', /10\.34\.9/.test(snap()), '');

  // 8. rm/mv/cp/head/tail/wc/which smoke
  await run('echo line1 > f.txt', 30000);
  await run('echo line2 >> f.txt', 30000);
  await run('cp f.txt g.txt', 30000);
  r = await run('cat g.txt', 30000);
  check('cp+cat roundtrip', /line1/.test(snap()) && /line2/.test(snap()), '');
  r = await run('wc -l < f.txt', 30000);
  check('wc -l redirect = 2', /(^|\s)2(\s|$)/.test(snap()), '');
  r = await run('which node', 30000);
  check('which node → /usr/local/bin/node', /\/usr\/local\/bin\/node/.test(snap()), '');
  r = await run('mv g.txt h.txt && ls', 30000);
  check('mv works', /h\.txt/.test(snap()), '');
  r = await run('rm h.txt', 30000);
  check('rm works', r.ok, '');
  r = await run('ls nope-xyz', 30000);
  check('ls missing → No such file', /No such file or directory/.test(snap()), '');

  // 9. home + cd with no args
  r = await run('cd', 30000);
  r = await run('pwd', 30000);
  check('cd (no args) → /home/node', /\/home\/node/.test(snap()), '');
  await run('cd /home/project', 30000);

  out.summary = `${out.checks.filter((c) => c.ok).length}/${out.checks.length}`;
  window.__ocFunc = out;
})().catch((e) => { window.__ocFunc = { driverError: String((e && e.stack) || e) }; });
