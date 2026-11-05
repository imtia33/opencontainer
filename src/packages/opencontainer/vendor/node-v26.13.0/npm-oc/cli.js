/**
 * OpenContainer npm-oc — CLI entry (the `npm`/`npx` commands in the
 * OpenContainer shell). OpenContainer-authored module (NOT vendored Node
 * source, NOT vendored npm).
 *
 * Runs as a real node process with process.argv = [node, <bin>, ...args].
 * Honest compatibility banner: registry-faithful installer + script/exec
 * execution for scenario-A packages (pure JS). The real npm CLI requires
 * user-land ESM and arrives in S5.
 */
'use strict';

const installer = require('./installer.js');
const scripts = require('./scripts.js');
const { execMain } = require('./exec.js');

const args = process.argv.slice(2);
// The same CLI file backs /usr/local/bin/npm and /usr/local/bin/npx — npm
// itself ships one code base behind two bin entries (bin/npx-cli.js).
const invokedAs = (process.argv[1] ?? '').split('/').pop();
const IS_NPX = invokedAs === 'npx';

const VERSION = '11.20.0-oc (OpenContainer registry-faithful installer + scripts/exec; real npm CLI lands in S5)';

const HELP = [
  'npm-oc — OpenContainer npm (scenario A: pure-JS packages)',
  '',
  'Usage:',
  '  npm init [-y|--yes]           create a package.json',
  '  npm install [pkg[@ver]]       install packages from the real npm registry',
  '  npm install --ignore-scripts  install without lifecycle scripts',
  '  npm install --allow-scripts   install AND run dependency lifecycle scripts',
  '  npm run [script] [-- args…]   run a package.json script (pre/post honored)',
  '  npm test | start | stop       script aliases (start falls back to server.js)',
  '  npm exec [--package=pkg] -- cmd [args…]',
  '  npx <command> [args…]         same engine (npx bin entry)',
  '  npm ls                        list installed packages',
  '  npm -v | --version            print the npm-oc version',
  '',
  'Boundaries (documented, not hidden): native builds, git/shell deps and the',
  'real npm CLI itself are NOT supported — the CLI needs user-land ESM (S5).',
  'Dependency lifecycle scripts are BLOCKED by default (pnpm-10-style',
  'security model; enable with --allow-scripts or a package.json allowlist:',
  '"opencontainer": { "allowScripts": ["pkg"] }).',
].join('\n');

function fail(msg, code) {
  console.error(msg);
  process.exit(code ?? 1);
}

function keepAlive() {
  // Pending registry I/O keeps the process alive (node semantics: a socket
  // handle is a live ref; our timer stands in for it).
  return setInterval(() => {}, 1000);
}

function main() {
  const cmd = args[0];

  if (cmd === '-v' || cmd === '--version') {
    console.log(VERSION);
    process.exit(0);
    return;
  }

  // ---- npx bin entry --------------------------------------------------------
  if (IS_NPX) {
    const ka = keepAlive();
    execMain(args, { isNpx: true })
      .then((code) => { clearInterval(ka); process.exit(code); })
      .catch((err) => {
        clearInterval(ka);
        console.error(err && err.stack ? err.stack : String(err));
        process.exit(1);
      });
    return;
  }

  if (cmd === 'init' || cmd === 'create') {
    // npm init <initializer> = npm exec create-<initializer>.
    if (args[1] && !args.includes('-y') && !args.includes('--yes')) {
      const initializer = args[1].startsWith('@')
        ? (args[1].endsWith('/') || args[1].split('/').length > 2 ? args[1] : `${args[1]}/create`)
        : `create-${args[1]}`;
      const ka = keepAlive();
      const rest = args.slice(2);
      execMain(['--yes', '--', initializer, ...rest], { isNpx: false })
        .then((code) => { clearInterval(ka); process.exit(code); })
        .catch((err) => {
          clearInterval(ka);
          console.error(err && err.stack ? err.stack : String(err));
          process.exit(1);
        });
      return;
    }
    if (!args.includes('-y') && !args.includes('--yes')) {
      fail('npm-oc: npm init requires -y (interactive prompts need a TUI shell, S5)');
    }
    installer.initYes();
    process.exit(0);
    return;
  }

  if (cmd === 'install' || cmd === 'i' || cmd === 'add') {
    const specs = args.slice(1).filter((a) => !a.startsWith('-'));
    const ignoreScripts = args.includes('--ignore-scripts');
    const allowAllScripts = args.includes('--allow-scripts');
    const ka = keepAlive();
    console.log(`npm-oc: installing ${specs.length ? specs.join(', ') : 'dependencies from package.json'} from https://registry.npmjs.org`);
    installer.install(specs, {
      cwd: process.cwd(),
      log: (m) => console.log(m),
      scripts: { ignoreScripts, allowAllScripts },
    })
      .then(({ tree, nodeModulesDir, pkg }) => {
        // Lifecycle scripts (post-extraction), per the security model.
        return scripts.runDependencyLifecycle(
          [...tree.entries()].map(([name, entry]) => ({
            name, version: entry.version, manifest: entry.manifest,
          })),
          nodeModulesDir,
          {
            allowAll: allowAllScripts,
            allowList: allowAllScripts ? undefined : readAllowList(pkg),
          },
        ).then((result) => {
          clearInterval(ka);
          if (result.skipped.length > 0) {
            console.warn('npm warn: lifecycle scripts were BLOCKED for (pnpm-10-style default; use --allow-scripts):');
            for (const s of result.skipped) console.warn(`  ${s}`);
          }
          if (result.failures.length > 0) {
            console.error(`npm error: ${result.failures.length} lifecycle script(s) failed`);
            process.exit(result.failures[0].code || 1);
            return;
          }
          process.exit(0);
        });
      })
      .catch((err) => {
        clearInterval(ka);
        console.error(err && err.stack ? err.stack : String(err));
        process.exit(1);
      });
    return;
  }

  if (cmd === 'run' || cmd === 'run-script') {
    const sep = args.indexOf('--');
    const scriptName = sep >= 0 ? args[1] : (args[1] !== '--' ? args[1] : undefined);
    const scriptArgs = sep >= 0 ? args.slice(sep + 1) : (args[1] ? args.slice(2) : []);
    if (scriptName === undefined) {
      // npm run with no args lists available scripts.
      try {
        const pkg = JSON.parse(require('fs').readFileSync('package.json', 'utf8'));
        scripts.listScripts(pkg);
        process.exit(0);
      } catch {
        fail('npm-oc: no package.json in the current directory');
      }
      return;
    }
    scripts.npmRun(scriptName, scriptArgs)
      .then((code) => process.exit(code))
      .catch((err) => fail(err && err.message ? err.message : String(err)));
    return;
  }

  if (cmd === 'test' || cmd === 'tst' || cmd === 't') {
    scripts.npmRun('test', args.slice(1), { lifecycleAlias: 'test' })
      .then((code) => process.exit(code))
      .catch((err) => fail(err && err.message ? err.message : String(err)));
    return;
  }
  if (cmd === 'start') {
    scripts.npmStart()
      .then((code) => process.exit(code))
      .catch((err) => fail(err && err.message ? err.message : String(err)));
    return;
  }
  if (cmd === 'stop' || cmd === 'restart') {
    scripts.npmRun(cmd, args.slice(1))
      .then((code) => process.exit(code))
      .catch((err) => fail(err && err.message ? err.message : String(err)));
    return;
  }

  if (cmd === 'exec') {
    const ka = keepAlive();
    execMain(args.slice(1), { isNpx: false })
      .then((code) => { clearInterval(ka); process.exit(code); })
      .catch((err) => {
        clearInterval(ka);
        console.error(err && err.stack ? err.stack : String(err));
        process.exit(1);
      });
    return;
  }

  if (cmd === 'ls' || cmd === 'list') {
    installer.ls();
    process.exit(0);
    return;
  }

  if (cmd === '--help' || cmd === '-h' || cmd === 'help' || cmd === undefined) {
    console.log(HELP);
    process.exit(cmd === undefined ? 1 : 0);
    return;
  }

  const hint = cmd === 'run' || cmd === 'exec' || cmd === 'test' ? '' : '';
  fail(`npm-oc: unsupported command '${cmd}'. Supported: init -y, install, run, exec, test, start, ls, -v. ${hint}`);
}

function readAllowList(pkg) {
  try {
    return pkg?.opencontainer?.allowScripts ?? [];
  } catch {
    return [];
  }
}

main();
