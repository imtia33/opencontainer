/**
 * Probe: symlink resolution layers after pnpm install.
 */
(() => {
  const R = (window.__ocSymlinkProbe = { steps: [], done: false });
  const log = (name, ok, detail = '') => {
    R.steps.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) });
    console.log(`${ok ? '✓' : '✗'} ${name} — ${String(detail).slice(0, 200)}`);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const SQ = String.fromCharCode(39);
  const DQ = String.fromCharCode(34);
  const q = (s) => DQ + s + DQ;

  void (async () => {
    const rt = window.__ocRuntime;
    window.__ocStdioLog = [];
    try {
      const script =
        'const fs=require(' + q('fs') + ');' +
        'try{console.log(' + q('STAT=') + '+fs.statSync(' + q('node_modules/lodash') + ').isDirectory())}catch(e){console.log(' + q('STAT-ERR: ') + '+e.message)};' +
        'try{console.log(' + q('PKG=') + '+fs.existsSync(' + q('node_modules/lodash/package.json') + '))}catch(e){console.log(' + q('PKG-ERR: ') + '+e.message)};' +
        'try{console.log(' + q('REAL=') + '+fs.realpathSync(' + q('node_modules/lodash') + '))}catch(e){console.log(' + q('REAL-ERR: ') + '+e.message)};' +
        'try{console.log(' + q('LSYM=') + '+fs.readlinkSync(' + q('node_modules/lodash') + '))}catch(e){console.log(' + q('LSYM-ERR: ') + '+e.message)};';
      await rt.spawn('node -e ' + SQ + script + SQ);
      const out = (window.__ocStdioLog || []).join('');
      log('stat symlink dir', out.includes('STAT=true'), out.slice(0, 200));
      log('pkg exists through symlink', out.includes('PKG=true'), out.slice(0, 200));
      log('realpath', /REAL=\S+/.test(out), (out.match(/REAL=(\S+)/) || [])[1] || '');
      log('readlink', /LSYM=\S+/.test(out), (out.match(/LSYM=(\S+)/) || [])[1] || '');
    } catch (e) {
      R.steps.push({ name: 'fatal', ok: false, detail: String((e && e.stack) || e).slice(0, 400) });
    }
    R.done = true;
    console.log('SYMLINK-PROBE-DONE');
  })();
})();
