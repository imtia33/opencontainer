/**
 * Blob-worker npm bisect driver — writes a staged require script into the
 * guest VFS and runs it as the npm entry (OC_NPM_STAGES=1 swaps the shim's
 * target). Each stage prints STAGE <name>-ok/-FAIL so the exact failing
 * subsystem of npm's bootstrap shows up in the piped output.
 *
 * Precondition: window.__rt2 (an OpenContainerRuntime booted with an
 * absolute assetsBase → blob-URL workers).
 */
window.__ocBisect = { done: false, out: '', exit: null };
void (async () => {
  const R = window.__ocBisect;
  const rt2 = window.__rt2;
  if (!rt2) { R.out = 'no window.__rt2'; R.done = true; return; }

  const stages = [
    "const P=(s)=>process.stdout.write('STAGE '+s+'\\n');",
    "const T=(n,f)=>{try{const r=f();P(n+'-ok'+(r!==undefined?' '+String(r).slice(0,80):''));}catch(e){P(n+'-FAIL '+(e&&e.message||e));}};",
    "T('pkg',()=>require('/usr/lib/node_modules/npm/package.json').version);",
    "T('cli-js',()=>!!require('/usr/lib/node_modules/npm/lib/cli.js'));",
    "T('npmjs',()=>!!require('/usr/lib/node_modules/npm/lib/npm.js'));",
    "T('config',()=>!!require('/usr/lib/node_modules/npm/node_modules/@npmcli/config'));",
    "T('proclog',()=>!!require('/usr/lib/node_modules/npm/node_modules/proc-log'));",
    "T('os',()=>require('os').type()+' '+require('os').release());",
    "T('os-homedir',()=>require('os').homedir());",
    "T('os-userinfo',()=>JSON.stringify(require('os').userInfo()));",
    "T('cwd',()=>process.cwd());",
    "T('envhome',()=>process.env.HOME);",
    "T('execpath',()=>process.execPath);",
    "T('argv',()=>JSON.stringify(process.argv));",
    "T('env-keys',()=>Object.keys(process.env).length);",
    "T('ini',()=>!!require('/usr/lib/node_modules/npm/node_modules/ini'));",
    "T('nopt',()=>!!require('/usr/lib/node_modules/npm/node_modules/nopt'));",
    "T('semver',()=>String(require('/usr/lib/node_modules/npm/node_modules/semver/functions/satisfies')('26.13.0','^20.17.0 || >=22.9.0')));",
    "T('graceful-fs',()=>!!require('/usr/lib/node_modules/npm/node_modules/graceful-fs'));",
    "T('walk-up',()=>!!require('/usr/lib/node_modules/npm/node_modules/walk-up-path'));",
    "T('which',()=>!!require('/usr/lib/node_modules/npm/node_modules/which'));",
    "T('mkdirp',()=>!!require('/usr/lib/node_modules/npm/node_modules/make-fetch-happen'));",
    "T('done',()=>1);",
  ].join('\n');

  await rt2.writeFile('/home/project/.oc-npm-stages.js', stages);
  const handle = await rt2.spawnProgram('npm', ['version'], { env: { OC_NPM_STAGES: '1' } });
  const rd = handle.output.getReader();
  (async () => {
    try {
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        R.out += value;
      }
    } catch { /* closed */ }
  })();
  R.exit = await handle.exit;
  await new Promise((r) => setTimeout(r, 400));
  R.done = true;
  console.log('=== BISECT exit=' + R.exit + ' ===\n' + R.out);
})();
