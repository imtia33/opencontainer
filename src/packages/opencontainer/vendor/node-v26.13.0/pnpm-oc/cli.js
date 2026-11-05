/**
 * OpenContainer pnpm-oc — CLI entry (the `pnpm` command in the OpenContainer
 * shell). OpenContainer-authored module (NOT vendored Node source, NOT
 * vendored pnpm).
 *
 * Runs as a real node process with process.argv = [node, pnpm-oc-cli, ...].
 *
 * Honest compatibility banner: registry-faithful installer with pnpm's
 * symlinked node_modules semantics for scenario-A packages. run/exec/dlx
 * are real process executions through the REAL child_process + sh.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const installer = require('./installer.js');
const npmScripts = require('../npm-oc/scripts.js');
const { findLocalBin, pickBin } = require('../npm-oc/exec.js');

const args = process.argv.slice(2);

const VERSION = '1.0.0-oc (OpenContainer pnpm-layout installer + run/exec/dlx; real pnpm CLI lands in S5)';

const HELP = [
  'pnpm-oc — OpenContainer pnpm-layout installer (scenario A: pure-JS packages)',
  '',
  'Usage:',
  '  pnpm init                    create a package.json (non-interactive default)',
  '  pnpm install                 install everything from package.json',
  '  pnpm install <pkg[@ver]>     add packages (aliases: i, add)',
  '  pnpm add <pkg> [-D|-E|-O]    add to dependencies / dev / exact / optional',
  '  pnpm install --allow-scripts install AND run dependency lifecycle scripts',
  '  pnpm remove <pkg>            remove packages + garbage-collect the store',
  '  pnpm run [script] [args…]    run a script (args pass straight through)',
  '  pnpm test | start            script aliases (start falls back to node server.js)',
  '  pnpm exec <cmd> [args…]      run a command from node_modules/.bin (never installs)',
  '  pnpm dlx <pkg>[@ver] [args…] fetch a package to the dlx cache and run its bin',
  '  pnpm ls                      list direct dependencies',
  '  pnpm why <pkg>               show why a package is installed',
  '  pnpm store path              print the virtual store path',
  '  pnpm -v | --version          print the pnpm-oc version',
  '',
  'Layout: symlinked node_modules with a .pnpm virtual store (strict',
  'resolution — phantom dependencies fail loudly, like real pnpm).',
  '',
  'Unknown commands fall back to run-then-exec (pnpm semantics): `pnpm dev`',
  'runs the "dev" script, or executes the "dev" binary from .bin.',
  '',
  'Boundaries (documented, not hidden): lifecycle scripts run only with',
  '--allow-scripts (pnpm-10-style default-off policy), native builds,',
  'git/shell deps, workspaces, pnpm-lock.yaml and the real pnpm CLI are NOT',
  'supported yet — they arrive with in-kernel child_process/ESM (S5).',
].join('\n');

function fail(msg, code) {
  console.error(msg);
  process.exit(code ?? 1);
}

function keepAlive() {
  return setInterval(() => {}, 1000);
}

function loadPkg() {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// run / exec / dlx
// ---------------------------------------------------------------------------

/** pnpm run — args pass straight through (no `--` needed), pre/post run. */
async function pnpmRun(scriptName, scriptArgs, { alias } = {}) {
  const cwd = process.cwd();
  const pkg = loadPkg();
  if (!pkg) fail('pnpm-oc: no package.json in the current directory (ERR_PNPM_NO_PKG)');
  const scripts = pkg.scripts ?? {};
  const event = alias ?? scriptName;
  if (scriptName === undefined || scripts[scriptName] === undefined) {
    const e = new Error(`Missing script: ${scriptName ?? ''}`);
    e.code = 'ERR_PNPM_NO_SCRIPT';
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
  // pnpm appends extra args verbatim (JSON-string-escaped in real pnpm —
  // we use sh quoting, which preserves the semantics).
  const quote = (a) => /[^A-Za-z0-9_@%+=:,./-]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a;
  const script = scriptArgs.length > 0
    ? `${scripts[scriptName]} ${scriptArgs.map(quote).join(' ')}`
    : scripts[scriptName];

  const env = npmScripts.scriptEnv({
    lifecycle: event,
    script: scripts[scriptName],
    pkgJsonPath: path.join(cwd, 'package.json'),
    pkg,
    command: 'run-script',
  });
  const run = (s, ev) => new Promise((resolve) => {
    const child = spawn('sh', ['-c', s], { cwd, env: { ...env, npm_lifecycle_event: ev }, stdio: 'inherit' });
    child.on('error', (err) => { console.error(`pnpm-oc: ${err.message}`); resolve(127); });
    child.on('close', (code) => resolve(code ?? 1));
  });
  if (scripts[`pre${event}`] !== undefined) {
    const code = await run(scripts[`pre${event}`], `pre${event}`);
    if (code !== 0) process.exit(code);
  }
  const code = await run(script, event);
  if (code !== 0) process.exit(code);
  if (scripts[`post${event}`] !== undefined) {
    const postCode = await run(scripts[`post${event}`], `post${event}`);
    process.exit(postCode);
  }
  process.exit(0);
}

/** pnpm start — falls back to `node server.js` (pnpm's documented behavior). */
async function pnpmStart() {
  const pkg = loadPkg();
  if (pkg?.scripts?.start !== undefined) return pnpmRun('start', []);
  const cwd = process.cwd();
  for (const candidate of ['server.js', 'index.js', 'app.js']) {
    if (fs.existsSync(path.join(cwd, candidate))) {
      const code = await new Promise((resolve) => {
        const child = spawn('node', [candidate], { cwd, stdio: 'inherit' });
        child.on('error', () => resolve(127));
        child.on('close', (c) => resolve(c ?? 1));
      });
      process.exit(code);
    }
  }
  const e = new Error('Missing script: start — and no server.js/index.js/app.js found');
  e.code = 'ERR_PNPM_NO_SCRIPT_OR_SERVER';
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
}

/** pnpm exec — PATH-prepend ONLY (never installs); system PATH retained. */
async function pnpmExec(argv) {
  const cwd = process.cwd();
  const cmd = argv[0];
  if (!cmd) fail('pnpm-oc: pnpm exec requires a command');
  const cmdArgs = argv.slice(1);
  const dirs = npmScripts.binDirs(cwd);
  const PATH = [...dirs, process.env.PATH].join(':');
  const quote = (a) => /[^A-Za-z0-9_@%+=:,./-]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a;
  const script = [quote(cmd), ...cmdArgs.map(quote)].join(' ');
  const code = await new Promise((resolve) => {
    const child = spawn('sh', ['-c', script], { cwd, env: { ...process.env, PATH }, stdio: 'inherit' });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') {
        console.error(`Command "${cmd}" not found`);
        process.exit(1);
      }
      resolve(127);
    });
    child.on('close', (c) => resolve(c ?? 1));
  });
  process.exit(code);
}

/** pnpm dlx — fetch a package into the dlx cache and run its default bin. */
async function pnpmDlx(argv) {
  const spec = argv[0];
  if (!spec) fail('pnpm-oc: pnpm dlx requires a package name');
  const cmdArgs = argv.slice(1);
  const cwd = process.cwd();
  // Parse @scope/pkg@ver forms.
  const at = spec.lastIndexOf('@');
  const name = at > 0 ? spec.slice(0, at) : spec;
  const range = at > 0 ? (spec.slice(at + 1) || '*') : 'latest';

  const npmOc = require('../npm-oc/installer.js');
  const packument = await npmOc.fetchPackument(name);
  const version = npmOc.pickVersion(packument, range);
  if (!version) {
    const e = new Error(`No matching version found for ${spec}`);
    e.code = 'ERR_PNPM_NO_MATCHING_VERSION';
    throw e;
  }
  const manifest = packument.versions[version];
  const bin = pickBin(manifest, name);
  if (!bin) {
    const e = new Error(`Package ${name}@${version} has no bin to execute`);
    e.code = 'ERR_PNPM_DLX_NO_BIN';
    throw e;
  }

  // dlx cache: /home/node/.cache/pnpm/dlx/<name>-<version>
  const cacheDir = path.join('/home/node/.cache/pnpm/dlx', `${name.replace('/', '+')}-${version}`);
  const cachePkgJson = path.join(cacheDir, 'package.json');
  const exists = fs.existsSync(path.join(cacheDir, 'node_modules', name));
  if (!exists) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cachePkgJson, JSON.stringify({
      name: 'pnpm-dlx-cache', private: true, dependencies: { [name]: version },
    }, null, 2));
    console.log(`pnpm-oc: dlx fetching ${name}@${version}`);
    await npmOc.install([], { cwd: cacheDir, log: () => {} });
  }
  const cacheBinDir = path.join(cacheDir, 'node_modules', '.bin');
  const PATH = [cacheBinDir, ...npmScripts.binDirs(cwd), process.env.PATH].join(':');
  const quote = (a) => /[^A-Za-z0-9_@%+=:,./-]/.test(a) ? `'${a.replace(/'/g, `'\\''`)}'` : a;
  const script = [quote(bin.binName), ...cmdArgs.map(quote)].join(' ');
  const code = await new Promise((resolve) => {
    const child = spawn('sh', ['-c', script], { cwd, env: { ...process.env, PATH }, stdio: 'inherit' });
    child.on('error', () => resolve(127));
    child.on('close', (c) => resolve(c ?? 1));
  });
  process.exit(code);
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const SCRIPT_ALIASES = { t: 'test', tst: 'test' };

function main() {
  const cmd = args[0];

  if (cmd === '-v' || cmd === '--version') {
    console.log(VERSION);
    process.exit(0);
    return;
  }
  if (cmd === 'init') {
    installer.initYes();
    process.exit(0);
    return;
  }
  if (cmd === 'install' || cmd === 'i' || cmd === 'add') {
    const specs = args.slice(1).filter((a) => !a.startsWith('-'));
    const save = specs.length === 0 ? null
      : args.includes('-D') || args.includes('--save-dev') ? 'devDependencies'
      : args.includes('-O') || args.includes('--save-optional') ? 'optionalDependencies'
      : 'dependencies';
    const saveExact = args.includes('-E') || args.includes('--save-exact');
    const allowAllScripts = args.includes('--allow-scripts');
    const ka = keepAlive();
    if (specs.length === 0) {
      console.log(`pnpm-oc: installing dependencies from package.json (${process.cwd()})`);
    } else {
      console.log(`pnpm-oc: adding ${specs.join(', ')} from https://registry.npmjs.org`);
    }
    installer.install(specs, { cwd: process.cwd(), save, saveExact })
      .then(async (record) => {
        // Lifecycle scripts: pnpm-10-style blocked-by-default policy.
        if (allowAllScripts || (record && record.packages)) {
          const tree = record?.__packagesArray;
          if (tree && tree.length > 0) {
            const result = await npmScripts.runDependencyLifecycle(
              tree, path.join(process.cwd(), 'node_modules'),
              { allowAll: allowAllScripts, allowList: allowAllScripts ? undefined : readAllowList() },
            );
            if (result.skipped.length > 0 && !allowAllScripts) {
              console.warn('pnpm-oc warn: lifecycle scripts were BLOCKED (pnpm-10-style default; use --allow-scripts):');
              for (const s of result.skipped) console.warn(`  ${s}`);
            }
            if (result.failures.length > 0) {
              clearInterval(ka);
              process.exit(result.failures[0].code || 1);
            }
          }
        }
        clearInterval(ka);
        process.exit(0);
      })
      .catch((err) => {
        clearInterval(ka);
        console.error(err && err.stack ? err.stack : String(err));
        process.exit(1);
      });
    return;
  }
  if (cmd === 'remove' || cmd === 'rm' || cmd === 'uninstall' || cmd === 'un') {
    const specs = args.slice(1).filter((a) => !a.startsWith('-'));
    if (specs.length === 0) fail('pnpm-oc: pnpm remove requires at least one package name');
    try {
      installer.remove(specs, { cwd: process.cwd() });
      process.exit(0);
    } catch (err) {
      fail(err && err.message ? err.message : String(err));
    }
    return;
  }
  if (cmd === 'ls' || cmd === 'list') {
    installer.ls();
    process.exit(0);
    return;
  }
  if (cmd === 'why') {
    const pkg = args[1];
    if (!pkg) fail('pnpm-oc: pnpm why requires a package name');
    try {
      installer.why(pkg);
      process.exit(0);
    } catch (err) {
      fail(err && err.message ? err.message : String(err));
    }
    return;
  }
  if (cmd === 'store') {
    const sub = args[1];
    if (sub !== 'path') {
      fail(`pnpm-oc: unsupported 'pnpm store ${sub ?? ''}'. Supported: store path`);
    }
    installer.storePath();
    process.exit(0);
    return;
  }
  if (cmd === 'run' || cmd === 'run-script') {
    const scriptName = args[1];
    const scriptArgs = args.slice(2); // pnpm: args pass straight through
    if (scriptName === undefined) {
      const pkg = loadPkg();
      if (pkg) npmScripts.listScripts(pkg);
      else console.log('(no package.json)');
      process.exit(0);
    }
    void pnpmRun(scriptName, scriptArgs);
    return;
  }
  if (cmd === 'test') {
    void pnpmRun('test', args.slice(1), { alias: 'test' });
    return;
  }
  if (cmd === 'start') {
    void pnpmStart();
    return;
  }
  if (cmd === 'exec') {
    void pnpmExec(args.slice(1));
    return;
  }
  if (cmd === 'dlx') {
    const ka = keepAlive();
    pnpmDlx(args.slice(1))
      .catch((err) => {
        clearInterval(ka);
        console.error(err && err.stack ? err.stack : String(err));
        process.exit(1);
      });
    return;
  }
  if (cmd === '--help' || cmd === '-h' || cmd === 'help' || cmd === undefined) {
    console.log(HELP);
    process.exit(cmd === undefined ? 1 : 0);
    return;
  }

  // ---- pnpm's fallback: unknown command → run a script, then exec ----------
  if (SCRIPT_ALIASES[cmd]) {
    void pnpmRun(SCRIPT_ALIASES[cmd], args.slice(1), { alias: SCRIPT_ALIASES[cmd] });
    return;
  }
  const pkg = loadPkg();
  if (pkg?.scripts?.[cmd] !== undefined) {
    void pnpmRun(cmd, args.slice(1));
    return;
  }
  // Not a script: try exec (PATH lookup) — pnpm's fallbackCommandUsed path.
  if (findLocalBin(cmd, process.cwd()) || ['node', 'sh'].includes(cmd)) {
    void pnpmExec(args);
    return;
  }
  fail(`pnpm-oc: unsupported command '${cmd}' (no script or .bin binary named '${cmd}' either). ` +
    `Supported: init, install/add, remove, run, exec, dlx, test, start, ls, why, store path, -v — ` +
    `or any package.json script name.`);
}

function readAllowList() {
  try {
    return loadPkg()?.opencontainer?.allowScripts ?? [];
  } catch {
    return [];
  }
}

main();
