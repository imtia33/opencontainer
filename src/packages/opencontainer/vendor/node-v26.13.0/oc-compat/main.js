/**
 * OpenContainer oc-compat — install-time WASM substitution for native-tool
 * packages (the WebContainer "private integrations" equivalent).
 *
 * Real npm installs native binaries that a browser kernel can never execute:
 *   esbuild  → @esbuild/* ELF binaries (child_process exec)
 *   rollup   → @rollup/rollup-<platform>-*.node (dlopen)          [vite ≤ 7]
 *   rolldown → @rolldown/binding-<platform>-*.node (dlopen)       [vite 8]
 * WebContainer's bundled npm swaps these for WASM builds silently; OpenContainer
 * does the same swap but OPENLY, in two modes:
 *
 *   replace (esbuild, rollup): the package directory itself is replaced by a
 *     symlink to its official WASM twin (published in lockstep versions):
 *       node_modules/esbuild -> .oc-compat/esbuild-wasm-<version>
 *     A .oc-swap.json marker names what was replaced and why.
 *
 *   ensure-binding (rolldown): the JS package stays as-is — its loader already
 *     falls back to @rolldown/binding-wasm32-wasi when the native binding is
 *     unusable. The pass just ensures that binding package is present at the
 *     top level (npm skips it on linux/x64 because it is an optionalDependency
 *     for the wasm32 cpu).
 *
 * Idempotent, self-healing (every install re-runs it), inspectable, and
 * disable-able with OC_COMPAT_WASM=0.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const npmOc = require('../npm-oc/installer.js');

// Swap table. mode 'replace' → symlink swap; 'ensure-binding' → just install
// the named package at top level (the loader finds it by resolution).
const SWAPS = {
  esbuild: { twin: 'esbuild-wasm', mode: 'replace' },
  rollup: { twin: '@rollup/wasm-node', mode: 'replace' },
  rolldown: { twin: '@rolldown/binding-wasm32-wasi', mode: 'ensure-binding' },
};

const REGISTRY = (process.env && process.env.npm_config_registry) || 'https://registry.npmjs.org';

/** GET over node's own http module — the same fetch-backed client npm's
 *  registry traffic uses. Deliberately NOT globalThis.fetch: inside the real
 *  npm process the global fetch has been swapped by npm's own tooling, and a
 *  raw browser fetch from that context can stall. */
const http = require('http');
const https = require('https');

function httpGet(url, headers) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { headers: headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(Uint8Array.from(c)));
      res.on('end', () => {
        let body = new Uint8Array(0);
        let total = 0;
        for (const c of chunks) total += c.length;
        body = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) { body.set(c, at); at += c.length; }
        resolve({ status: res.statusCode, body });
      });
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

/** Read a package.json safely. */
function readPkg(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Fetch a packument (abbreviated corgi doc like npm). */
async function fetchPackument(name) {
  const res = await httpGet(REGISTRY.replace(/\/+$/, '') + '/' + name, {
    accept: 'application/vnd.npm.install-v1+json',
  });
  if (res.status !== 200) throw new Error('registry error ' + res.status + ' for ' + name);
  return JSON.parse(new TextDecoder().decode(res.body));
}

/** Pick the manifest: exact lockstep version first, same-major fallback. */
async function resolveTwinManifest(wasmName, version, log) {
  const packument = await fetchPackument(wasmName);
  let manifest = packument.versions && packument.versions[version];
  if (manifest) return manifest;
  const semver = require('semver');
  const versions = Object.keys(packument.versions || {});
  const fallback = semver.maxSatisfying(versions, `^${semver.major(version)}`) ||
    semver.maxSatisfying(versions, '*');
  if (!fallback) throw new Error(`${wasmName}@${version} not published and no fallback`);
  log(`${wasmName}@${version} not published; using @${fallback}`);
  return packument.versions[fallback];
}

/**
 * Download + verify + extract `wasmName` at `manifest` into destDir.
 * Reuses npm-oc's tar extractor + integrity verification (the same ustar/GNU/
 * pax code path real installs use — no parallel implementation to drift).
 */
async function extractInto(wasmName, manifest, destDir) {
  const dist = manifest.dist || {};
  if (!dist.tarball) throw new Error('no tarball for ' + wasmName);
  const res = await httpGet(dist.tarball);
  if (res.status !== 200) throw new Error('tarball fetch failed ' + res.status + ' for ' + wasmName);
  const gz = res.body;
  npmOc.verifyIntegrity(gz, dist.integrity);
  const raw = await npmOc._gunzip(gz);
  fs.mkdirSync(destDir, { recursive: true });
  return npmOc.extractTar(raw, {
    mkdirSync: fs.mkdirSync,
    writeFileSync: fs.writeFileSync,
    symlinkSync: fs.symlinkSync,
    chmodSync: fs.chmodSync,
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
  }, destDir);
}

/**
 * Install a package WITH its full dependency tree into a node_modules dir
 * (npm-oc's resolveTree walks transitive deps; extractPackage verifies +
 * extracts each). Unlike npmOc.install this never touches package.json.
 */
async function installTree(rootName, rootVersion, nmDir, log) {
  const { tree, nested } = await npmOc.resolveTree(
    [{ name: rootName, range: rootVersion }], (m) => log(m),
  );
  for (const [name, entry] of tree) {
    await npmOc.extractPackage(name, entry.version, entry.manifest, nmDir, log);
  }
  for (const [nestedKey, version] of nested) {
    const [parentName, name] = nestedKey.split('/');
    const packument = await npmOc.fetchPackument(name);
    const manifest = packument.versions && packument.versions[version];
    if (manifest) {
      await npmOc.extractPackage(name, version, manifest, path.join(nmDir, parentName, 'node_modules'), log);
    }
  }
  return tree;
}

/**
 * 'replace' mode: swap one installed package directory for its WASM twin.
 * @returns {Promise<string|null>} notice line, or null when nothing to do.
 */
async function swapOne(pkgDir, name, wasmName, cacheDir, log) {
  // Already swapped (symlink) → nothing to do.
  let st;
  try { st = fs.lstatSync(pkgDir); } catch { return null; }
  if (st.isSymbolicLink()) return null;
  const pkg = readPkg(pkgDir);
  if (!pkg || !pkg.version) return null;

  const version = pkg.version;
  const markerDir = path.join(cacheDir, `${name}-wasm-${version}`);
  if (!fs.existsSync(path.join(markerDir, 'package.json'))) {
    log(`fetching ${wasmName}@${version} (WASM twin of ${name}@${version})`);
    const manifest = await resolveTwinManifest(wasmName, version, log);
    await extractInto(wasmName, manifest, markerDir);
    // Marker: what this directory replaces and why.
    try {
      fs.writeFileSync(path.join(markerDir, '.oc-swap.json'), JSON.stringify({
        opencontainer: true,
        replaces: name,
        replacedVersion: version,
        reason: `native binaries cannot execute in a browser kernel (${name} → ${wasmName})`,
        swappedAt: new Date().toISOString(),
      }, null, 2));
    } catch { /* best-effort */ }
  }

  // Replace the directory with a symlink to the WASM twin.
  fs.rmSync(pkgDir, { recursive: true, force: true });
  const target = path.relative(path.dirname(pkgDir), markerDir);
  fs.symlinkSync(target, pkgDir, 'dir');
  return `${name}@${version} → ${wasmName} (WASM — native binaries cannot run in the browser)`;
}

/**
 * 'ensure-binding' mode: make sure the wasm fallback binding package exists
 * at the top level next to its loader package (rolldown resolves it by name
 * after the native binding fails to load). @scoped names land at
 * node_modules/@scope/<name>.
 * @returns {Promise<string|null>} notice line, or null when nothing to do.
 */
async function ensureBinding(nm, hostName, wasmName, log) {
  const hostPkg = readPkg(path.join(nm, hostName));
  if (!hostPkg || !hostPkg.version) return null;
  const destDir = path.join(nm, wasmName);
  if (fs.existsSync(path.join(destDir, 'package.json'))) {
    const existing = readPkg(destDir);
    // Skip only when the binding AND its runtime deps are already present
    // (a partially-completed earlier pass must be able to self-heal).
    if (existing && existing.version === hostPkg.version
        && fs.existsSync(path.join(nm, '@napi-rs', 'wasm-runtime', 'package.json'))) {
      return null;
    }
  }
  log(`fetching ${wasmName}@${hostPkg.version} (wasm fallback binding for ${hostName})`);
  const manifest = await resolveTwinManifest(wasmName, hostPkg.version, log);
  log(`resolved ${wasmName}@${manifest.version}`);
  fs.rmSync(destDir, { recursive: true, force: true });
  // The binding package has runtime deps (@napi-rs/wasm-runtime, @emnapi/*) —
  // install the full tree, top-level, without touching package.json.
  await installTree(wasmName, manifest.version, nm, log);
  log(`installed ${wasmName} + deps into node_modules`);
  return `${hostName}@${hostPkg.version}: installed ${wasmName}@${manifest.version} (wasm fallback binding — native bindings cannot load in the browser)`;
}

/**
 * The post-install pass. Scans npm (flat + nested) and pnpm (.pnpm) layouts.
 * @param {string} cwd project root
 * @param {(err: Error|null, notices: string[]) => void} cb
 */
function postInstall(cwd, cb) {
  if (process.env && String(process.env.OC_COMPAT_WASM) === '0') {
    return cb(null, []);
  }
  const notices = [];
  const log = (m) => { try { process.stdout.write('  ' + m + '\n'); } catch { /* detached */ } };

  void (async () => {
    const nm = path.join(cwd, 'node_modules');
    if (!fs.existsSync(nm)) return cb(null, notices);
    const cacheDir = path.join(nm, '.oc-compat');
    fs.mkdirSync(cacheDir, { recursive: true });

    // 1. top-level npm layout
    for (const [name, spec] of Object.entries(SWAPS)) {
      try {
        if (spec.mode === 'ensure-binding') {
          if (fs.existsSync(path.join(nm, name))) {
            const n = await ensureBinding(nm, name, spec.twin, log);
            if (n) notices.push(n);
          }
        } else {
          const pkgDir = path.join(nm, name);
          if (fs.existsSync(pkgDir)) {
            const n = await swapOne(pkgDir, name, spec.twin, cacheDir, log);
            if (n) notices.push(n);
          }
        }
      } catch (e) {
        log(`compat pass skipped for ${name}: ${e.message}`);
      }
    }

    // 2. nested copies (npm conflict placement, depth 1)
    let entries = [];
    try { entries = fs.readdirSync(nm); } catch { /* gone */ }
    for (const ent of entries) {
      if (ent.startsWith('.')) continue;
      for (const [name, spec] of Object.entries(SWAPS)) {
        if (spec.mode !== 'replace') continue;
        const pkgDir = path.join(nm, ent, 'node_modules', name);
        if (fs.existsSync(pkgDir)) {
          const n = await swapOne(pkgDir, name, spec.twin, cacheDir, log).catch(() => null);
          if (n) notices.push(`${ent}/node_modules/${n}`);
        }
      }
    }

    // 3. pnpm layout (.pnpm/<name>@<v>/node_modules/<name>)
    const pnpmDir = path.join(nm, '.pnpm');
    if (fs.existsSync(pnpmDir)) {
      let pkgs = [];
      try { pkgs = fs.readdirSync(pnpmDir); } catch { /* gone */ }
      for (const p of pkgs) {
        for (const [name, spec] of Object.entries(SWAPS)) {
          if (spec.mode !== 'replace') continue;
          if (!p.startsWith(name + '@')) continue;
          const pkgDir = path.join(pnpmDir, p, 'node_modules', name);
          if (fs.existsSync(pkgDir)) {
            const n = await swapOne(pkgDir, name, spec.twin, cacheDir, log).catch(() => null);
            if (n) notices.push(`.pnpm/${p}/${n}`);
          }
        }
      }
    }

    cb(null, notices);
  })().catch((e) => cb(e, notices));
}

module.exports = { postInstall, SWAPS };
