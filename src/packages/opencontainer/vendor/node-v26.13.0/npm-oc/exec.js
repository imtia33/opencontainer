/**
 * OpenContainer npm-oc — `npm exec` / `npx` (registry-faithful, honest).
 *
 * OpenContainer-authored module (NOT vendored npm code) implementing the
 * documented modern npm semantics (npm 10/11):
 *
 *   Lookup order (no --package):
 *     1. local node_modules/.bin walk-up  → run, no install
 *     2. treat the command as a package spec → install into the _npx cache
 *        (~/.npm/_npx/<hash>) → run its bin
 *   `npx` ≡ `npm exec` with argv rewritten: `--` is inserted before the
 *   first positional so trailing args belong to the command.
 *   Prompt (TTY): "Need to install the following packages: … Ok to
 *   proceed? (y)" — default y. Non-TTY: warn + proceed (npm's CI behavior).
 *   Exit codes: the command's own code; 127 when not found; 1 on install
 *   failure / declined prompt / no bin.
 *
 * The executed command is a REAL node process (sh → PATH → shebang), never
 * a main-file shortcut.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const installer = require('./installer.js');
const { binDirs, shQuote, scriptEnv } = require('./scripts.js');

const NPX_CACHE_ROOT = '/home/node/.npm/_npx';

/** Hash the sorted spec set → 16 hex chars (npm's cache-key shape). */
function npxCacheKey(specs) {
  // sha512 of the sorted specs joined with \n, first 16 hex chars — npm's
  // exact recipe, using our REAL crypto (sha512 hex, truncated).
  const { createHash } = require('crypto');
  const input = [...specs].sort().join('\n');
  return createHash('sha512').update(input).digest('hex').slice(0, 16);
}

/** Find a command in the walk-up .bin dirs. */
function findLocalBin(cmd, cwd) {
  for (const dir of binDirs(cwd)) {
    const candidate = path.join(dir, cmd);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Parse a package spec: pkg, pkg@ver, @scope/pkg, @scope/pkg@ver. */
function parseSpec(spec) {
  const at = spec.lastIndexOf('@');
  if (at > 0) return { name: spec.slice(0, at), range: spec.slice(at + 1) || '*' };
  return { name: spec, range: 'latest' };
}

/** npm's get-bin-from-manifest: single bin, sole-equivalent bin, or the
 *  unscoped-name match; undefined when ambiguous. */
function pickBin(manifest, name) {
  const bin = manifest?.bin;
  if (!bin) return undefined;
  if (typeof bin === 'string') return { binName: name.split('/').pop(), target: bin };
  const entries = Object.entries(bin);
  if (entries.length === 0) return undefined;
  if (entries.length === 1) return { binName: entries[0][0], target: entries[0][1] };
  const allSame = entries.every(([, t]) => t === entries[0][1]);
  if (allSame) return { binName: entries[0][0], target: entries[0][1] };
  const unscoped = name.startsWith('@') ? name.split('/')[1] : name;
  const match = entries.find(([bn]) => bn === unscoped);
  if (match) return { binName: match[0], target: match[1] };
  return undefined;
}

/** TTY prompt (npm's exact wording, default y). */
function promptInstall(packages) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      // npm's non-TTY/CI behavior: warn, then proceed.
      console.warn('npm warn exec The following package was not found and will be installed: ' +
        packages.join(', '));
      resolve(true);
      return;
    }
    process.stdout.write('Need to install the following packages:\n');
    for (const p of packages) process.stdout.write(`  ${p}\n`);
    process.stdout.write('Ok to proceed? ');
    let answer = '';
    const onData = (c) => {
      answer += c.toString();
      if (answer.includes('\n') || answer.includes('\r')) {
        process.stdin.removeListener('data', onData);
        if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
          // keep the terminal usable (raw mode may have been set by readline)
        }
        const first = answer.trim().charAt(0).toLowerCase();
        process.stdout.write('\n');
        resolve(first === '' || first === 'y');
      }
    };
    process.stdin.on('data', onData);
    // A closed stdin answers with the default.
    process.stdin.on('end', () => resolve(true));
  });
}

/**
 * The exec engine shared by `npm exec` and `npx`.
 *
 * @param {string[]} rawArgs arguments AFTER the exec/npx command name
 * @param {{isNpx: boolean}} mode
 */
async function execMain(rawArgs, { isNpx }) {
  const packages = [];
  let yes = null;           // tri-state: null = prompt (TTY) / proceed (non-TTY)
  let call = null;
  let positional = [];
  let sawSeparator = false;

  // npx's argv rewrite: `--` is inserted before the first non-flag token so
  // everything after it belongs to the command.
  const args = isNpx ? rewriteNpxArgs(rawArgs) : rawArgs;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (sawSeparator) { positional.push(a); continue; }
    if (a === '--') { sawSeparator = true; continue; }
    if (a === '-y' || a === '--yes') { yes = true; continue; }
    if (a === '--no' || a === '--no-yes') { yes = false; continue; }
    if (a === '-p' || a === '--package') {
      packages.push(args[++i]);
      continue;
    }
    if (a.startsWith('--package=')) { packages.push(a.slice('--package='.length)); continue; }
    if (a === '-c' || a === '--call') { call = args[++i]; continue; }
    if (a.startsWith('--call=')) { call = a.slice('--call='.length); continue; }
    if (a === '-h' || a === '--help') { printHelp(isNpx); return 0; }
    if (a.startsWith('-')) {
      // Unknown flag: npm-oc's honest surface — flag it loudly.
      console.error(`${isNpx ? 'npx' : 'npm exec'}: unsupported option '${a}'`);
      return 1;
    }
    positional.push(a);
  }

  const cmd = positional[0];
  const cmdArgs = positional.slice(1);
  if (!cmd && !call) {
    console.error(`${isNpx ? 'npx' : 'npm exec'}: interactive exec subshells are not supported in OpenContainer — specify a command`);
    return 1;
  }
  if (cmd && call) {
    console.error('cannot use --call with positional arguments');
    return 1;
  }

  const cwd = process.cwd();

  // ---- 1. Local resolution: .bin walk-up (no --package) --------------------
  if (packages.length === 0 && cmd) {
    const local = findLocalBin(cmd, cwd);
    if (local) {
      return runCommand(cmd, cmdArgs, { cwd, extraPath: [] });
    }
  }

  // ---- 2. Install into the _npx cache, then run ----------------------------
  const specs = packages.length > 0 ? packages : (cmd ? [cmd] : []);
  if (specs.length === 0 && call) {
    // npm exec --call without --package: shell-only, PATH already set.
    return runShell(call, cwd, []);
  }

  // Resolve versions for the prompt text (npm shows pkg@ver).
  const resolved = [];
  for (const spec of specs) {
    const { name, range } = parseSpec(spec);
    try {
      const packument = await installer.fetchPackument(name);
      const version = installer.pickVersion(packument, range);
      if (!version) throw new Error(`No matching version found for ${spec}`);
      resolved.push({ spec, name, range, version, packument });
    } catch (err) {
      console.error(`npm error code E404`);
      console.error(`npm error could not resolve ${spec}: ${err.message}`);
      return 1;
    }
  }

  if (yes === false) {
    console.error(`npx canceled due to missing packages and no YES option: [${resolved.map((r) => `${r.name}@${r.version}`).join(', ')}]`);
    return 1;
  }
  if (yes === null) {
    const ok = await promptInstall(resolved.map((r) => `${r.name}@${r.version}`));
    if (!ok) {
      process.stdout.write('canceled\n');
      return 1;
    }
  }

  // Cache dir: hash over the SPEC SET (bare names re-resolve each run —
  // npm's own behavior for non-pinned specs).
  const cacheDir = path.join(NPX_CACHE_ROOT, npxCacheKey(resolved.map((r) => r.spec)));
  const cachePkgJson = path.join(cacheDir, 'package.json');
  let needInstall = true;
  try {
    const existing = JSON.parse(fs.readFileSync(cachePkgJson, 'utf8'));
    const existingSpecs = Object.keys(existing.dependencies ?? {});
    needInstall = existingSpecs.length !== resolved.length ||
      !resolved.every((r) => existingSpecs.includes(r.name));
    // Exact-version specs short-circuit (npm's reuse rule).
    if (!needInstall) {
      const wantPins = resolved.every((r) => /^\d+\.\d+\.\d+/.test(r.range));
      const havePins = resolved.every((r) => existing.dependencies[r.name] === r.version);
      needInstall = !(wantPins && havePins);
    }
  } catch { /* no cache entry */ }

  if (needInstall) {
    fs.mkdirSync(cacheDir, { recursive: true });
    // The temp package.json pins the RESOLVED versions (npm writes specs;
    // pinning keeps our reuse rule exact — documented divergence).
    const deps = {};
    for (const r of resolved) deps[r.name] = r.version;
    fs.writeFileSync(cachePkgJson, JSON.stringify({
      name: 'npx-exec-cache',
      private: true,
      dependencies: deps,
    }, null, 2));
    console.log(`npm-oc: installing to _npx cache: ${resolved.map((r) => `${r.name}@${r.version}`).join(', ')}`);
    await installer.install([], { cwd: cacheDir, log: () => {} });
  }

  // ---- 3. Resolve the bin to run --------------------------------------------
  const cacheNodeModules = path.join(cacheDir, 'node_modules');
  const cacheBinDir = path.join(cacheNodeModules, '.bin');
  let binName = cmd;
  if (packages.length > 0 || !cmd) {
    // --package mode: the command names a bin of one of the packages.
    const primary = resolved[0];
    const manifest = readManifest(path.join(cacheNodeModules, primary.name));
    const bin = pickBin(manifest, primary.name);
    if (!bin) {
      console.error('npm error could not determine executable to run');
      return 1;
    }
    binName = call ? undefined : bin.binName;
  } else {
    // Command-as-spec mode: the command runs from the cache .bin (its own
    // bin name; fall back to the unscoped package name when single-bin).
    const primary = resolved[0];
    const manifest = readManifest(path.join(cacheNodeModules, primary.name));
    const bin = pickBin(manifest, primary.name);
    if (bin && !fs.existsSync(path.join(cacheBinDir, bin.binName))) {
      console.error('npm error could not determine executable to run');
      return 1;
    }
    binName = bin ? bin.binName : cmd;
  }

  const command = call ?? binName;
  const callArgs = call ? [] : cmdArgs;
  return runCommand(command, callArgs, { cwd, extraPath: [cacheBinDir] });
}

/** npx's argv rewrite: insert `--` before the first non-flag token. */
function rewriteNpxArgs(raw) {
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    const isFlag = a.startsWith('-') && a !== '-';
    if (!isFlag && !out.includes('--')) {
      // npm's npx-cli inserts -- before the first positional (flags with
      // separate values keep their value).
      out.push('--');
    }
    out.push(a);
  }
  return out;
}

function readManifest(pkgDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** Run a command through sh with the augmented PATH (npm's exec shape). */
function runCommand(cmd, args, { cwd, extraPath }) {
  const dirs = [...extraPath, ...binDirs(cwd)];
  const PATH = [...dirs, process.env.PATH].join(':');
  const script = [shQuote(cmd), ...args.map(shQuote)].join(' ');
  return runShell(script, cwd, [PATH]);
}

function runShell(script, cwd, extraPaths) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (extraPaths[0]) env.PATH = extraPaths[0];
    const child = spawn('sh', ['-c', script], { cwd, env, stdio: 'inherit' });
    child.on('error', (err) => {
      process.stderr.write(`sh: ${err.message}\n`);
      resolve(127);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

function printHelp(isNpx) {
  console.log([
    `${isNpx ? 'npx' : 'npm exec'} — execute a package binary (OpenContainer npm-oc)`,
    '',
    'Usage:',
    `  ${isNpx ? 'npx <command> [args…]' : 'npm exec [--package=<pkg>]… -- <command> [args…]'}`,
    '  --package, -p <spec>   package(s) providing the command',
    '  --yes, -y              skip the install prompt',
    '  --no                    never install (fails when missing)',
    '  --call, -c <script>    run a shell command instead of a bin',
    '',
    'Local node_modules/.bin wins; otherwise the package installs into the',
    '~/.npm/_npx cache and its bin runs — real node processes through sh.',
  ].join('\n'));
}

module.exports = { execMain, findLocalBin, pickBin, npxCacheKey, binDirs };
