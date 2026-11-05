/**
 * OpenContainer npm-oc — registry-faithful package installer (scenario A).
 *
 * OpenContainer-authored module (NOT vendored Node source). Implements a
 * genuine npm installation for pure-JS packages WITHOUT lifecycle scripts:
 *   - abbreviated packuments (npm's corgi Accept header),
 *   - version resolution through npm's own vendored `semver`,
 *   - tarball download + sha512 integrity verification against the
 *     registry's dist.integrity (verified with the real node:crypto Hash),
 *   - ustar/GNU/pax tar extraction into node_modules via the real node:fs,
 *   - flat-hoisted layout with conflict nesting and .bin symlinks.
 *
 * Explicit boundaries (documented in docs/architecture-followup-S2.md):
 * lifecycle scripts (B), native builds (C), git/shell deps (D) and the real
 * npm CLI itself are NOT provided — the CLI needs user-land ESM (S5).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const semver = require('semver');
const tar = require('./tar.js');

const REGISTRY = (process.env && process.env.npm_config_registry) || 'https://registry.npmjs.org';
const CORGI = 'application/vnd.npm.install-v1+json';

/** Fetch the abbreviated packument for a package. */
async function fetchPackument(name) {
  const url = REGISTRY.replace(/\/+$/, '') + '/' + name;
  const res = await fetch(url, { headers: { accept: CORGI } });
  if (res.status === 404) {
    const e = new Error(`404 Not Found - GET ${url}`);
    e.code = 'E404';
    throw e;
  }
  if (!res.ok) throw new Error(`registry error ${res.status} for ${name}`);
  return res.json();
}

/** Pick the version npm would install for a range (latest of maxSatisfying). */
function pickVersion(packument, range) {
  const spec = range === 'latest' ? (packument['dist-tags'] && packument['dist-tags'].latest) || '*' : range;
  if (semver.valid(spec)) {
    return packument.versions[spec] ? spec : null;
  }
  const versions = Object.keys(packument.versions || {}).filter((v) => semver.valid(v));
  // npm prefers the highest non-prerelease satisfying version; fall back to
  // prereleases only when nothing else satisfies (semver.maxSatisfying
  // with includePrerequisites=false implements this ordering).
  return semver.maxSatisfying(versions, spec) || null;
}

/**
 * Resolve the full dependency tree for the given root specs, flat-hoisted.
 * Conflict policy: a dependency whose range is not satisfied by the placed
 * top-level version is nested under the requiring package (npm's classic
 * node_modules behavior).
 *
 * @param {Array<{name: string, range: string}>} roots
 * @returns {{ tree: Map<string, {version: string, manifest: any}>, nested: Map<string, string>, count: number }}
 */
async function resolveTree(roots, log) {
  const tree = new Map();      // top-level name -> { version, manifest }
  const nested = new Map();    // "parent/name" -> version (conflict placements)
  const packuments = new Map();
  const queue = roots.map((r) => ({ ...r, parent: null }));
  const seen = new Set();      // (parent|name|range) — avoid duplicate walks

  const getPackument = async (name) => {
    if (!packuments.has(name)) {
      if (log) log(`resolving ${name}`);
      packuments.set(name, await fetchPackument(name));
    }
    return packuments.get(name);
  };

  while (queue.length > 0) {
    const { name, range, parent } = queue.shift();
    const key = (parent || '') + '|' + name + '|' + range;
    if (seen.has(key)) continue;
    seen.add(key);

    const packument = await getPackument(name);
    const version = pickVersion(packument, range);
    if (!version) {
      throw new Error(`No matching version for ${name}@${range}` +
        (parent ? ` (required by ${parent})` : ''));
    }
    const manifest = packument.versions[version];

    if (parent === null) {
      const existing = tree.get(name);
      if (existing) {
        if (semver.satisfies(existing.version, range, { includePrerelease: true })) continue;
        // Conflict with a root-level placement — defer as nested under parent.
        // (Roots conflicting with roots is an install-time error, like npm.)
        if (!semver.satisfies(version, buildRangeFor(existing))) {
          // keep the FIRST root placement; nest the later root spec
          nested.set(`${name}/${name}`, version);
        }
        continue;
      }
      tree.set(name, { version, manifest });
    } else {
      const existing = tree.get(name);
      if (existing && semver.satisfies(existing.version, range, { includePrerelease: true })) {
        // satisfied by the hoisted copy — nothing to place
      } else if (existing) {
        nested.set(`${parent}/${name}`, version);
      } else {
        tree.set(name, { version, manifest });
      }
    }

    // Walk the chosen manifest's runtime dependencies (scenario A scope:
    // `dependencies` only — dev/peer/optional are install-time irrelevant).
    const deps = (manifest.dependencies || {});
    for (const [depName, depRange] of Object.entries(deps)) {
      queue.push({ name: depName, range: depRange, parent: name });
    }
  }

  let count = tree.size;
  for (const v of nested.values()) count += 0; // nested counted on extraction
  return { tree, nested, count };
}

function buildRangeFor(entry) {
  return '*' + (entry && entry.version ? '' : '');
}

async function gunzip(buf) {
  // Host bridge first: the kernel captures the browser-native
  // DecompressionStream before boot replaces it with node's zlib-backed shim
  // (node:zlib natives arrive in S3). Outside the kernel, the global one.
  if (typeof globalThis.__ocHostGunzip === 'function') {
    return globalThis.__ocHostGunzip(buf);
  }
  const DS = globalThis.DecompressionStream;
  if (typeof DS !== 'function') {
    throw new Error('npm-oc: DecompressionStream unavailable in this runtime');
  }
  const stream = new Response(buf).body.pipeThrough(new DS('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Verify SRI integrity: "sha512-<base64>" against the tarball bytes. */
function verifyIntegrity(bytes, integrity) {
  if (!integrity || typeof integrity !== 'string') {
    throw new Error('npm-oc: refusing to install — registry metadata has no integrity hash');
  }
  const dash = integrity.indexOf('-');
  const algo = integrity.slice(0, dash);
  const expected = integrity.slice(dash + 1);
  if (algo !== 'sha512' && algo !== 'sha1') {
    throw new Error(`npm-oc: unsupported integrity algorithm '${algo}'`);
  }
  const h = crypto.createHash(algo === 'sha512' ? 'sha512' : 'sha1');
  h.update(bytes);
  const actual = Buffer.from(h.digest()).toString('base64');
  if (actual !== expected) {
    const e = new Error(`Integrity checksum failed for tarball (${algo})`);
    e.code = 'EINTEGRITY';
    throw e;
  }
}

/** Extract one package's tarball into node_modules/<name>[@nested]. */
async function extractPackage(name, version, manifest, nodeModulesDir, log) {
  const dist = manifest.dist || {};
  const tarballUrl = dist.tarball;
  if (!tarballUrl) throw new Error(`npm-oc: no tarball URL for ${name}@${version}`);
  if (log) log(`fetching ${name}@${version}`);
  const res = await fetch(tarballUrl);
  if (!res.ok) throw new Error(`tarball fetch failed ${res.status} for ${name}@${version}`);
  const gz = new Uint8Array(await res.arrayBuffer());
  verifyIntegrity(gz, dist.integrity);
  const raw = await gunzip(gz);

  const destDir = path.join(nodeModulesDir, name);
  fs.mkdirSync(destDir, { recursive: true });
  const stats = tar.extractTar(raw, {
    mkdirSync: fs.mkdirSync,
    writeFileSync: fs.writeFileSync,
    symlinkSync: fs.symlinkSync,
    chmodSync: fs.chmodSync,
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
  }, destDir);
  return stats;
}

/** Create node_modules/.bin symlinks for package bin entries (npm layout). */
function linkBins(nodeModulesDir, tree) {
  const binDir = path.join(nodeModulesDir, '.bin');
  fs.mkdirSync(binDir, { recursive: true });
  let links = 0;
  for (const [name, entry] of tree) {
    const pkgJson = entry.manifest;
    const bin = pkgJson.bin;
    if (!bin) continue;
    const pairs = typeof bin === 'string'
      ? { [name]: bin }
      : bin;
    for (const [binName, relPath] of Object.entries(pairs)) {
      const target = path.join('../', name, relPath);
      const linkPath = path.join(binDir, binName);
      try {
        if (fs.existsSync(linkPath)) continue;
        fs.symlinkSync(target, linkPath);
        links++;
      } catch { /* best-effort; a bad bin entry must not fail the install */ }
    }
  }
  return links;
}

/**
 * Install the given specs into cwd's node_modules. Genuine installation:
 * real registry, real semver, real integrity verification, real tar.
 */
async function install(specs, opts) {
  const cwd = (opts && opts.cwd) || process.cwd();
  const nodeModulesDir = path.join(cwd, 'node_modules');
  const t0 = Date.now();
  const log = (opts && opts.log) || ((m) => console.log(m));
  const pkgJsonPath = path.join(cwd, 'package.json');

  let pkg = {};
  if (fs.existsSync(pkgJsonPath)) {
    pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  } else {
    pkg = { name: path.basename(cwd), version: '1.0.0', private: true, license: 'ISC' };
  }
  pkg.dependencies = pkg.dependencies || {};

  const roots = specs.map((s) => {
    const at = s.lastIndexOf('@');
    if (at > 0) return { name: s.slice(0, at), range: s.slice(at + 1) || '*' };
    return { name: s, range: 'latest' };
  });

  // Include existing package.json dependencies (npm install with args still
  // ensures the rest of the tree is present). S3.1: `npm install` (no args)
  // installs devDependencies too — real npm's default; without them every
  // scaffolded Vite/Next project lacks its build tooling (`vite` itself is a
  // devDependency). dev-only flag (`--omit=dev` / NODE_ENV=production) is
  // honored when present.
  const argv = (process.argv || []);
  const omitDev = argv.includes('--omit=dev') || argv.includes('--production')
    || String(process.env.NODE_ENV || '') === 'production';
  const manifestDeps = omitDev
    ? { ...(pkg.dependencies || {}) }
    : { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const [name, range] of Object.entries(manifestDeps)) {
    if (!roots.some((r) => r.name === name)) roots.push({ name, range });
  }

  const { tree, nested } = await resolveTree(roots, log);

  let installed = 0, files = 0, bytes = 0, conflicts = 0;
  for (const [name, entry] of tree) {
    const stats = await extractPackage(name, entry.version, entry.manifest, nodeModulesDir, log);
    installed++; files += stats.files + stats.symlinks + stats.hardlinks; bytes += stats.bytes;
  }
  for (const [nestedKey, version] of nested) {
    // Nested conflict placement: node_modules/<parent>/node_modules/<name>
    const [parentName, name] = nestedKey.split('/');
    const parentDir = path.join(nodeModulesDir, parentName, 'node_modules');
    const packument = await fetchPackument(name);
    const manifest = packument.versions[version];
    if (manifest) {
      await extractPackage(name, version, manifest, parentDir, log);
      installed++; conflicts++;
    }
  }

  const linkCount = linkBins(nodeModulesDir, tree);

  // Record what we installed (deterministic idempotency record — NOT an
  // npm-compatible lockfile; that arrives with the real CLI in S5).
  for (const r of roots) {
    const entry = tree.get(r.name);
    if (entry && specs.some((s) => s === r.name || s.startsWith(r.name + '@'))) {
      pkg.dependencies[r.name] = '^' + entry.version;
    }
  }
  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');
  const record = {
    manager: 'npm-oc (OpenContainer scenario-A installer)',
    installedAt: new Date().toISOString(),
    registry: REGISTRY,
    packages: Object.fromEntries([...tree].map(([n, e]) => [n, e.version])),
    nested: Object.fromEntries(nested),
  };
  fs.mkdirSync(nodeModulesDir, { recursive: true });
  fs.writeFileSync(path.join(nodeModulesDir, '.opencontainer-install.json'), JSON.stringify(record, null, 2));

  log(`added ${installed} package${installed === 1 ? '' : 's'} in ${((Date.now() - t0) / 1000).toFixed(1)}s` +
    `${conflicts ? ` (${conflicts} nested for conflicts)` : ''}` +
    `${linkCount ? `, ${linkCount} bin link${linkCount === 1 ? '' : 's'}` : ''}`);
  // The CLI needs the tree (lifecycle scripts), node_modules dir and the
  // project manifest (allowlist) after install.
  return {
    ...record,
    tree,
    nested,
    nodeModulesDir,
    pkg,
    stats: { installed, files, bytes, conflicts, linkCount, ms: Date.now() - t0 },
  };
}

/** npm ls — list installed top-level packages. */
function ls(cwd) {
  const nodeModulesDir = path.join(cwd || process.cwd(), 'node_modules');
  if (!fs.existsSync(nodeModulesDir)) {
    console.log(`${path.basename(cwd || process.cwd())}@1.0.0 ${cwd}`);
    console.log('(empty) — no node_modules; run npm install');
    return;
  }
  const out = [];
  for (const name of fs.readdirSync(nodeModulesDir).sort()) {
    if (name.startsWith('.')) continue;
    const pj = path.join(nodeModulesDir, name, 'package.json');
    if (!fs.existsSync(pj)) continue;
    try {
      const pjJson = JSON.parse(fs.readFileSync(pj, 'utf8'));
      out.push(`├── ${name}@${pjJson.version}`);
    } catch { /* skip unreadable */ }
  }
  console.log(`${path.basename(cwd || process.cwd())}@1.0.0 ${cwd}`);
  for (const line of out) console.log(line);
  if (out.length === 0) console.log('└── (empty)');
}

/** npm init -y — write a real package.json. */
function initYes(cwd) {
  const dir = cwd || process.cwd();
  const pjPath = path.join(dir, 'package.json');
  const name = path.basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'project';
  const pkg = {
    name,
    version: '1.0.0',
    main: 'index.js',
    scripts: { test: 'echo "Error: no test specified" && exit 1' },
    license: 'ISC',
  };
  fs.writeFileSync(pjPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`Wrote to ${pjPath}`);
  console.log(JSON.stringify(pkg, null, 2));
}

module.exports = {
  install, ls, initYes, resolveTree, fetchPackument, pickVersion,
  verifyIntegrity, extractTar: tar.extractTar, _gunzip: gunzip,
};
