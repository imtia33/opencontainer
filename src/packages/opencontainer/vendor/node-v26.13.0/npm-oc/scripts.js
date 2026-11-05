/**
 * OpenContainer npm-oc — script execution support (npm run + lifecycle).
 *
 * OpenContainer-authored module (NOT vendored npm code). Implements npm's
 * documented script semantics on top of the REAL child_process:
 *
 *   - `npm run <script>` → `sh -c "<script> <appended args>"` (args
 *     space-appended after sh-escaping — npm's exact composition)
 *   - pre/post scripts run automatically around the named script
 *   - the full npm_lifecycle_* / npm_package_* env contract
 *   - PATH = walk-up node_modules/.bin dirs + node-gyp-bin + original PATH
 *
 * SECURITY MODEL (documented in COMPATIBILITY.md): dependency lifecycle
 * scripts are BLOCKED by default (pnpm 10's own precedent). The kernel
 * worker shares the host page's origin — an untrusted postinstall could
 * fetch same-origin URLs with the app's credentials. Root-project scripts
 * (the developer's own code) always run; dependency scripts run only with
 * --allow-scripts (all) or a per-project allowlist in package.json
 * ("opencontainer": { "allowScripts": ["pkg", ...] }).
 */
'use strict';

const path = require('path');
const { spawn } = require('child_process');

/** Walk-up .bin dirs from cwd to / (npm's set-path.js shape). */
function binDirs(cwd) {
  const dirs = [];
  let cur = path.resolve(cwd);
  while (true) {
    dirs.push(path.join(cur, 'node_modules', '.bin'));
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return dirs;
}

/** npm's script environment (RFC 183 subset + the fields npm always sets). */
function scriptEnv({ lifecycle, script, pkgJsonPath, pkg, command, extraBinDirs }) {
  const env = { ...process.env };
  const dirs = [...(extraBinDirs ?? []), ...binDirs(path.dirname(pkgJsonPath))];
  env.PATH = [...dirs, env.PATH].join(':');
  env.npm_lifecycle_event = lifecycle;
  if (script !== undefined) env.npm_lifecycle_script = script;
  env.npm_command = command ?? 'run-script';
  if (pkg) {
    if (pkg.name !== undefined) env.npm_package_name = pkg.name;
    if (pkg.version !== undefined) env.npm_package_version = pkg.version;
    if (pkg.engines !== undefined) {
      for (const [k, v] of Object.entries(pkg.engines)) env[`npm_package_engines_${k.replace(/-/g, '_')}`] = String(v);
    }
    if (pkg.config !== undefined) {
      for (const [k, v] of Object.entries(pkg.config)) env[`npm_package_config_${k.replace(/-/g, '_')}`] = String(v);
    }
  }
  env.npm_package_json = pkgJsonPath;
  env.INIT_CWD = process.env.INIT_CWD ?? process.env.PWD ?? process.cwd();
  env.npm_node_execpath = '/usr/local/bin/node';
  env.npm_execpath = '/usr/local/bin/npm';
  env.npm_config_user_agent =
    `npm/11.20.0-oc node/${process.version} ${process.platform} ${process.arch}`;
  return env;
}

/** sh single-quote escaping (npm's escape.sh). */
function shQuote(arg) {
  return /[^A-Za-z0-9_@%+=:,./-]/.test(arg) ? `'${arg.replace(/'/g, `'\\''`)}'` : arg;
}

/** Run `sh -c "<script>"` with env; resolves to the exit code. */
function runShellScript(script, { cwd, env, stdio = 'inherit' }) {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', script], { cwd, env, stdio });
    child.on('error', (err) => {
      process.stderr.write(`npm-oc: failed to spawn sh: ${err.message}\n`);
      resolve(127);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

/** List the scripts of a package.json (npm run with no args prints this). */
function listScripts(pkg) {
  const scripts = pkg.scripts ?? {};
  const names = Object.keys(scripts);
  if (names.length === 0) {
    console.log('no scripts available');
    return;
  }
  console.log('Scripts available:');
  for (const name of names) console.log(`  ${name}\n    ${scripts[name]}`);
}

/**
 * `npm run <script>` (also test/start/stop aliases).
 * Returns the exit code (node: script's code; 1 when the script is missing).
 */
async function npmRun(scriptName, extraArgs, { lifecycleAlias } = {}) {
  const cwd = process.cwd();
  const pkgJsonPath = path.join(cwd, 'package.json');
  let pkg = {};
  try { pkg = JSON.parse(require('fs').readFileSync(pkgJsonPath, 'utf8')); }
  catch { /* npm errors below on the missing manifest */ }
  const scripts = pkg.scripts ?? {};
  const event = lifecycleAlias ?? scriptName;

  if (scriptName === undefined || scripts[scriptName] === undefined) {
    const e = new Error(`Missing script: "${scriptName ?? ''}"`);
    e.code = 'ERR_MISSING_SCRIPT';
    console.error(e.message);
    console.error('');
    console.error('A complete log of this run can be found in: /home/node/.npm/_logs (not yet provided)');
    listScripts(pkg);
    return 1;
  }

  // npm semantics: appended args are sh-escaped and space-appended.
  const script = extraArgs.length > 0
    ? `${scripts[scriptName]} ${extraArgs.map(shQuote).join(' ')}`
    : scripts[scriptName];

  const env = scriptEnv({
    lifecycle: event,
    script: scripts[scriptName],
    pkgJsonPath,
    pkg,
    command: 'run-script',
  });

  // pre<script> / post<script> — npm runs them around the main script.
  const pre = `pre${event}`;
  const post = `post${event}`;
  if (scripts[pre] !== undefined) {
    const code = await runShellScript(scripts[pre], { cwd, env: { ...env, npm_lifecycle_event: pre } });
    if (code !== 0) return code;
  }
  const code = await runShellScript(script, { cwd, env });
  if (code !== 0) return code;
  if (scripts[post] !== undefined) {
    const postCode = await runShellScript(scripts[post], { cwd, env: { ...env, npm_lifecycle_event: post } });
    return postCode;
  }
  return 0;
}

/** pnpm 10-style start fallback: `node server.js` when no start script. */
async function npmStart() {
  const cwd = process.cwd();
  let pkg = {};
  try { pkg = JSON.parse(require('fs').readFileSync(path.join(cwd, 'package.json'), 'utf8')); }
  catch { /* handled by npmRun */ }
  if (pkg.scripts && pkg.scripts.start !== undefined) {
    return npmRun('start', []);
  }
  const fs = require('fs');
  for (const candidate of ['server.js', 'index.js', 'app.js']) {
    if (fs.existsSync(path.join(cwd, candidate))) {
      return new Promise((resolve) => {
        const child = spawn('node', [candidate], { cwd, stdio: 'inherit' });
        child.on('error', () => resolve(127));
        child.on('close', (code) => resolve(code ?? 1));
      });
    }
  }
  console.error('npm-oc: Missing script: "start" and no server.js/index.js/app.js found');
  return 1;
}

// ---------------------------------------------------------------------------
// Lifecycle scripts (install-time) — pnpm-10-style security default
// ---------------------------------------------------------------------------

const LIFECYCLE_ORDER = ['preinstall', 'install', 'postinstall'];

/** Topological-ish order: dependencies before dependents (cycles broken). */
function topoOrder(tree) {
  const byName = new Map(tree.map((e) => [e.name, e]));
  const seen = new Set();
  const out = [];
  const visit = (entry, stack) => {
    if (seen.has(entry.name)) return;
    if (stack.has(entry.name)) return; // cycle — break it
    stack.add(entry.name);
    for (const depName of Object.keys(entry.manifest.dependencies ?? {})) {
      const dep = byName.get(depName);
      if (dep) visit(dep, stack);
    }
    stack.delete(entry.name);
    seen.add(entry.name);
    out.push(entry);
  };
  for (const entry of tree) visit(entry, new Set());
  return out;
}

/**
 * Run dependency lifecycle scripts after an install.
 *
 * @param {Array<{name, version, manifest}>} tree flat resolved tree
 * @param {string} nodeModulesDir
 * @param {{allowAll?: boolean, allowList?: string[]}} policy
 */
async function runDependencyLifecycle(tree, nodeModulesDir, policy = {}) {
  const allowList = new Set(policy.allowList ?? []);
  const skipped = [];
  const failures = [];
  for (const entry of topoOrder(tree)) {
    const m = entry.manifest ?? {};
    const hasAny = LIFECYCLE_ORDER.some((k) => m.scripts && m.scripts[k] !== undefined);
    if (!hasAny) continue;
    const allowed = policy.allowAll === true || allowList.has(entry.name);
    if (!allowed) {
      skipped.push(`${entry.name}@${entry.version}`);
      continue;
    }
    const pkgDir = path.join(nodeModulesDir, entry.name);
    const env = scriptEnv({
      lifecycle: 'install',
      pkgJsonPath: path.join(pkgDir, 'package.json'),
      pkg: m,
      command: 'install',
    });
    for (const hook of LIFECYCLE_ORDER) {
      const script = m.scripts?.[hook];
      if (script === undefined) continue;
      const code = await runShellScript(script, { cwd: pkgDir, env: { ...env, npm_lifecycle_event: hook } });
      if (code !== 0) {
        failures.push({ pkg: `${entry.name}@${entry.version}`, hook, code });
        console.error(`npm-oc: lifecycle script ${hook} of ${entry.name}@${entry.version} failed (exit ${code})`);
      }
    }
  }
  return { skipped, failures };
}

/** The root project's own prepare (developer code — always allowed). */
async function runRootPrepare(pkg, cwd) {
  const prepare = pkg.scripts?.prepare;
  if (prepare === undefined) return 0;
  const env = scriptEnv({
    lifecycle: 'prepare',
    script: prepare,
    pkgJsonPath: path.join(cwd, 'package.json'),
    pkg,
    command: 'install',
  });
  return runShellScript(prepare, { cwd, env });
}

module.exports = {
  binDirs, scriptEnv, shQuote, runShellScript, listScripts,
  npmRun, npmStart, runDependencyLifecycle, runRootPrepare, topoOrder,
};
