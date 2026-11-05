/**
 * OpenContainer pnpm-oc — pnpm-semantics package installer (scenario A).
 *
 * OpenContainer-authored module (NOT vendored Node source, NOT vendored pnpm).
 * Implements a genuine installation with pnpm's DEFINING semantics:
 *
 *   - per-range version resolution: every distinct (name, range) pair picks
 *     its own maxSatisfying version — conflicting versions coexist instead
 *     of npm's conflict-nesting,
 *   - symlinked node_modules layout:
 *
 *       node_modules/<direct-dep>              → .pnpm/<pkg>@<ver>/node_modules/<pkg>
 *       node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>          (real files)
 *       node_modules/.pnpm/<pkg>@<ver>/node_modules/<dep>          → ../../<dep>@<ver>/node_modules/<dep>
 *
 *     (scoped packages encode their directory as @scope+name@ver, exactly
 *     like real pnpm's virtual store),
 *   - STRICT resolution: a package can only require its declared deps —
 *     phantom dependencies fail loudly at require time (pnpm's default
 *     behavior, and the kernel enforces it for real — verified by test),
 *   - `.bin` links for direct deps at the project root and for each
 *     package's deps inside its virtual-store dir.
 *
 * Registry access, semver logic, SRI integrity and tar extraction are REUSED
 * from the sibling npm-oc module (single source of truth; both share the
 * vendored `semver` and the real node:fs/node:crypto of the kernel).
 *
 * Documented divergences from real pnpm (honesty policy — COMPATIBILITY.md):
 *   - peerDependencies are auto-installed (pnpm's auto-install-peers=true
 *     default) but WITHOUT peer-suffixed instance dirs (name@ver_peer@ver):
 *     a peer resolves to the single maxSatisfying version of its range,
 *   - no pnpm-lock.yaml yet (an install record is written instead); the real
 *     lockfile arrives with the real pnpm CLI in S5,
 *   - the "store" is the per-project .pnpm virtual store (within-project
 *     content-addressed reuse: an existing <pkg>@<ver> dir is never
 *     re-extracted). The cross-project global store arrives with the real
 *     CLI. Nothing is faked to look global.
 *   - no hidden-hoist pattern (.pnpm/node_modules hoisting of undeclared
 *     deps) — packages relying on phantom deps fail loudly, which is pnpm's
 *     own default behavior for direct requires.
 *
 * Scenario boundaries are identical to npm-oc's (docs/architecture-followup-S2.md §2):
 * lifecycle scripts (B), native builds (C), git/shell deps (D) and the real
 * pnpm CLI itself are NOT provided — the CLI needs user-land ESM + in-kernel
 * child_process (S5).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const npmOc = require('../npm-oc/installer.js');

const RECORD_FILE = '.opencontainer-install.json';

/** Virtual-store directory key: @scope/name@1.2.3 → @scope+name@1.2.3. */
function dirKey(name, version) {
  return name.replace(/\//g, '+') + '@' + version;
}

/** Parse a spec: pkg, pkg@range, @scope/pkg, @scope/pkg@range. */
function parseSpec(spec) {
  const at = spec.lastIndexOf('@');
  if (at > 0) return { name: spec.slice(0, at), range: spec.slice(at + 1) || '*' };
  return { name: spec, range: 'latest' };
}

/**
 * Resolve the dependency graph, pnpm-style: one version per (name, range).
 *
 * @param {Array<{name: string, range: string, group?: string, optional?: boolean}>} roots
 * @returns {{
 *   resolution: Map<string, Map<string, string>>,   // name → range → version
 *   packages: Map<string, object>,                   // "name@version" → {name, version, manifest, requiredBy}
 * }}
 */
async function resolveGraph(roots, log) {
  const resolution = new Map();
  const packages = new Map();
  const packuments = new Map();
  const queue = roots.map((r) => ({ ...r, parent: null }));
  const seen = new Set();

  const getPackument = async (name) => {
    if (!packuments.has(name)) {
      if (log) log(`resolving ${name}`);
      packuments.set(name, await npmOc.fetchPackument(name));
    }
    return packuments.get(name);
  };

  while (queue.length > 0) {
    const { name, range, parent, optional } = queue.shift();
    const key = (parent ?? '') + '|' + name + '|' + range;
    if (seen.has(key)) continue;
    seen.add(key);

    let packument;
    try {
      packument = await getPackument(name);
    } catch (e) {
      if (optional) { if (log) log(`skipping optional ${name} (${e.code ?? e.message})`); continue; }
      throw e;
    }

    let version = resolution.get(name)?.get(range);
    if (version === undefined) {
      version = npmOc.pickVersion(packument, range);
      if (!version) {
        if (optional) { if (log) log(`skipping optional ${name}@${range} (no matching version)`); continue; }
        const e = new Error(`No matching version found for ${name}@${range}` +
          (parent ? ` (required by ${parent})` : ''));
        e.code = 'ERR_PNPM_NO_MATCHING_VERSION';
        throw e;
      }
      if (!resolution.has(name)) resolution.set(name, new Map());
      resolution.get(name).set(range, version);
    }

    const id = `${name}@${version}`;
    if (!packages.has(id)) {
      packages.set(id, {
        name, version,
        manifest: packument.versions[version],
        requiredBy: new Set(),
      });
    }
    if (parent) packages.get(id).requiredBy.add(parent);

    // pnpm (auto-install-peers=true, our documented simplification) walks
    // dependencies + optionalDependencies + peerDependencies. devDependencies
    // are followed ONLY for the project root (a dependency's devDeps are
    // never installed by any manager).
    const m = packages.get(id).manifest;
    const walk = (obj, extra) => {
      for (const [dn, dr] of Object.entries(obj || {})) {
        queue.push({ name: dn, range: dr, parent: id, ...extra });
      }
    };
    walk(m.dependencies);
    walk(m.optionalDependencies, { optional: true });
    walk(m.peerDependencies);
  }

  return { resolution, packages };
}

/** Link helper: (re)create a symlink at `link` pointing at `target`. */
function link(target, linkPath) {
  try { fs.rmSync(linkPath, { recursive: true, force: true }); } catch { /* absent */ }
  fs.symlinkSync(target, linkPath);
}

/** Extract one package into its virtual-store dir (skipped if present). */
async function extractIntoStore(storeDir, name, version, manifest, log) {
  const key = dirKey(name, version);
  const pkgDir = path.join(storeDir, key, 'node_modules', name);
  if (fs.existsSync(pkgDir)) return { reused: true, stats: null };
  const dist = manifest.dist || {};
  if (!dist.tarball) throw new Error(`pnpm-oc: no tarball URL for ${name}@${version}`);
  if (log) log(`fetching ${name}@${version}`);
  const res = await fetch(dist.tarball);
  if (!res.ok) throw new Error(`tarball fetch failed ${res.status} for ${name}@${version}`);
  const gz = new Uint8Array(await res.arrayBuffer());
  npmOc.verifyIntegrity(gz, dist.integrity);
  const raw = await npmOc._gunzip(gz);
  fs.mkdirSync(pkgDir, { recursive: true });
  const stats = npmOc.extractTar(raw, {
    mkdirSync: fs.mkdirSync,
    writeFileSync: fs.writeFileSync,
    symlinkSync: fs.symlinkSync,
    chmodSync: fs.chmodSync,
    existsSync: fs.existsSync,
    readFileSync: fs.readFileSync,
  }, pkgDir);
  return { reused: false, stats };
}

/** Create .bin symlinks for `pkgManifest`'s bin entries inside `binDir`. */
function linkBinsOf(pkgManifest, name, binDir, relTargetBase) {
  const bin = pkgManifest && pkgManifest.bin;
  if (!bin) return 0;
  const pairs = typeof bin === 'string' ? { [name]: bin } : bin;
  let n = 0;
  for (const [binName, relPath] of Object.entries(pairs)) {
    try {
      link(path.join(relTargetBase, relPath), path.join(binDir, binName));
      n++;
    } catch { /* best-effort; a bad bin entry must not fail the install */ }
  }
  return n;
}

/** Read (or start) a package.json for cwd, npm-shape. */
function loadPackageJson(cwd, pkgJsonPath) {
  if (fs.existsSync(pkgJsonPath)) {
    return JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
  }
  return { name: path.basename(cwd), version: '1.0.0', private: true, license: 'ISC' };
}

/** Ensure a pnpm-oc-managed node_modules (refuse to silently mix layouts). */
function prepareNodeModules(nodeModulesDir, log) {
  const recordPath = path.join(nodeModulesDir, RECORD_FILE);
  if (fs.existsSync(recordPath)) {
    try {
      const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
      // Our own record identifies as "pnpm-oc (OpenContainer pnpm-layout
      // installer)" — prefix match; anything else is a foreign layout.
      if (record.manager && !String(record.manager).startsWith('pnpm-oc')) {
        // The VFS is project-scoped and everything is re-fetchable from the
        // registry, so replacing the layout is safe and reversible. Say it.
        log(`replacing ${record.manager} layout with the pnpm symlinked layout`);
        fs.rmSync(nodeModulesDir, { recursive: true, force: true });
      }
    } catch { /* unreadable record — rebuild anyway */ }
  }
  fs.mkdirSync(path.join(nodeModulesDir, '.pnpm'), { recursive: true });
}

/**
 * Install the given specs into cwd's node_modules, pnpm layout.
 * Genuine installation: real registry, real semver, real integrity check,
 * real tar extraction — symlinked like pnpm.
 *
 * @param {string[]} specs
 * @param {{cwd?: string, log?: Function, save?: 'dependencies'|'devDependencies'|'optionalDependencies'|null, saveExact?: boolean}} opts
 */
async function install(specs, opts) {
  const cwd = (opts && opts.cwd) || process.cwd();
  const save = opts && opts.save !== undefined ? opts.save : 'dependencies';
  const saveExact = !!(opts && opts.saveExact);
  const log = (opts && opts.log) || ((m) => console.log(m));
  const t0 = Date.now();

  const nodeModulesDir = path.join(cwd, 'node_modules');
  const storeDir = path.join(nodeModulesDir, '.pnpm');
  const pkgJsonPath = path.join(cwd, 'package.json');
  const pkg = loadPackageJson(cwd, pkgJsonPath);

  prepareNodeModules(nodeModulesDir, log);

  // Root deps: the requested specs PLUS everything package.json already
  // declares (pnpm install with args still ensures the full tree).
  const roots = [];
  const rootGroups = ['dependencies', 'devDependencies', 'optionalDependencies'];
  const pushRoot = (name, range, group, optional) => {
    if (!roots.some((r) => r.name === name)) roots.push({ name, range, group, optional });
  };
  for (const s of specs) {
    const { name, range } = parseSpec(s);
    pushRoot(name, range, save || 'dependencies', save === 'optionalDependencies');
  }
  for (const group of rootGroups) {
    for (const [name, range] of Object.entries(pkg[group] || {})) {
      pushRoot(name, range, group, group === 'optionalDependencies');
    }
  }

  const { resolution, packages } = await resolveGraph(roots, log);

  // ---- write the virtual store --------------------------------------------
  let downloaded = 0, reused = 0, files = 0, bytes = 0;
  for (const [id, entry] of packages) {
    const { reused: wasReused, stats } =
      await extractIntoStore(storeDir, entry.name, entry.version, entry.manifest, log);
    if (wasReused) reused++; else { downloaded++; files += stats.files + stats.symlinks + stats.hardlinks; bytes += stats.bytes; }
  }

  // ---- per-package dep links (inside each virtual dir) --------------------
  // This is the mechanism that makes strict resolution WORK: a package's
  // declared deps appear in ITS node_modules, and nothing else does.
  const versionOf = (name, range) => resolution.get(name)?.get(range);
  for (const [id, entry] of packages) {
    const m = entry.manifest;
    const ownNm = path.join(storeDir, dirKey(entry.name, entry.version), 'node_modules');
    const depGroups = [m.dependencies, m.optionalDependencies, m.peerDependencies];
    for (const group of depGroups) {
      for (const [depName, depRange] of Object.entries(group || {})) {
        const depVer = versionOf(depName, depRange);
        if (depVer === undefined) continue; // skipped optional
        const depId = `${depName}@${depVer}`;
        // relative link, exactly like real pnpm: ../../<dep>@<ver>/node_modules/<dep>
        link(
          path.join('..', '..', dirKey(depName, depVer), 'node_modules', depName),
          path.join(ownNm, depName),
        );
        // the dep's bins are linked into THIS package's .bin (pnpm layout)
        linkBinsOf(packages.get(depId)?.manifest, depName,
          path.join(ownNm, '.bin'), path.join('..', depName));
      }
    }
  }

  // ---- top-level links: DIRECT deps only (pnpm strictness) ----------------
  for (const r of roots) {
    const ver = versionOf(r.name, r.range);
    if (ver === undefined) continue;
    link(
      path.join('.pnpm', dirKey(r.name, ver), 'node_modules', r.name),
      path.join(nodeModulesDir, r.name),
    );
    // direct deps' bins → project node_modules/.bin (target ../<name>/<rel>)
    linkBinsOf(packages.get(`${r.name}@${ver}`)?.manifest, r.name,
      path.join(nodeModulesDir, '.bin'), path.join('..', r.name));
  }

  // ---- save to package.json (pnpm add semantics) --------------------------
  if (save) {
    for (const s of specs) {
      const { name } = parseSpec(s);
      const ver = versionOf(name, parseSpec(s).range);
      if (ver === undefined) continue;
      pkg[save] = pkg[save] || {};
      pkg[save][name] = saveExact ? ver : '^' + ver;
    }
    fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');
  }

  // ---- install record (NOT a pnpm-lock.yaml — honest stand-in) ------------
  const registry = (process.env && process.env.npm_config_registry) || 'https://registry.npmjs.org';
  const record = {
    manager: 'pnpm-oc (OpenContainer pnpm-layout installer)',
    layout: 'pnpm-symlinked',
    installedAt: new Date().toISOString(),
    registry,
    direct: Object.fromEntries(roots
      .filter((r) => versionOf(r.name, r.range) !== undefined)
      .map((r) => [r.name, `${r.name}@${versionOf(r.name, r.range)}`])),
    packages: Object.fromEntries([...packages.keys()].map((id) => [id, {
      requiredBy: [...packages.get(id).requiredBy],
    }])),
    // edges for reachability GC + `pnpm why`
    edges: Object.fromEntries([...packages.keys()].map((id) => {
      const m = packages.get(id).manifest;
      const deps = [];
      for (const group of [m.dependencies, m.optionalDependencies, m.peerDependencies]) {
        for (const [depName, depRange] of Object.entries(group || {})) {
          const depVer = versionOf(depName, depRange);
          if (depVer !== undefined) deps.push(`${depName}@${depVer}`);
        }
      }
      return [id, deps];
    })),
  };
  fs.writeFileSync(path.join(nodeModulesDir, RECORD_FILE), JSON.stringify(record, null, 2));

  const total = packages.size;
  console.log(`Packages: +${total}`);
  console.log(`Progress: resolved ${total + 1}, reused ${reused}, downloaded ${downloaded}, added ${total}, done`);
  console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  // Expose the resolved tree (with manifests) for lifecycle-script runs.
  record.__packagesArray = [...packages.entries()].map(([id, entry]) => ({
    name: entry.name, version: entry.version, manifest: entry.manifest,
  }));
  return record;
}

/** Read the pnpm-oc install record (or throw a pnpm-shaped error). */
function readRecord(cwd) {
  const recordPath = path.join(cwd || process.cwd(), 'node_modules', RECORD_FILE);
  if (!fs.existsSync(recordPath)) {
    const e = new Error(`No pnpm-oc installation found in ${cwd || process.cwd()} ` +
      `(no ${RECORD_FILE}). Run pnpm install first.`);
    e.code = 'ERR_PNPM_NO_INSTALL_RECORD';
    throw e;
  }
  return JSON.parse(fs.readFileSync(recordPath, 'utf8'));
}

/**
 * Remove packages: drop from package.json, unlink top-level links and .bin,
 * then garbage-collect virtual-store dirs unreachable from remaining roots.
 */
function remove(specs, opts) {
  const cwd = (opts && opts.cwd) || process.cwd();
  const log = (opts && opts.log) || ((m) => console.log(m));
  const nodeModulesDir = path.join(cwd, 'node_modules');
  const storeDir = path.join(nodeModulesDir, '.pnpm');
  const pkgJsonPath = path.join(cwd, 'package.json');
  const record = readRecord(cwd);
  const pkg = loadPackageJson(cwd, pkgJsonPath);

  const removed = [];
  for (const s of specs) {
    const { name } = parseSpec(s);
    let found = false;
    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      if (pkg[group] && pkg[group][name] !== undefined) {
        delete pkg[group][name];
        found = true;
      }
    }
    // top-level link + .bin links
    try { fs.rmSync(path.join(nodeModulesDir, name), { force: true }); } catch { /* absent */ }
    try { fs.rmSync(path.join(nodeModulesDir, '.bin', name), { force: true }); } catch { /* absent */ }
    const wasDirect = record.direct && name in record.direct;
    delete record.direct[name];
    if (found || wasDirect) removed.push(name);
  }
  fs.writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n');

  // ---- GC: reachability from the remaining direct deps --------------------
  const reachable = new Set();
  const stack = Object.values(record.direct ?? {});
  while (stack.length > 0) {
    const id = stack.pop();
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const dep of record.edges?.[id] ?? []) stack.push(dep);
  }
  let collected = 0;
  if (fs.existsSync(storeDir)) {
    for (const entry of fs.readdirSync(storeDir)) {
      // decode dir key back to "name@version"
      const id = entry.includes('+') ? unscopeKey(entry) : entry;
      if (!reachable.has(id) && !id.startsWith('.')) {
        fs.rmSync(path.join(storeDir, entry), { recursive: true, force: true });
        collected++;
      }
    }
  }
  fs.writeFileSync(path.join(nodeModulesDir, RECORD_FILE), JSON.stringify(record, null, 2));

  log(`removed ${removed.length} package${removed.length === 1 ? '' : 's'}${collected ? `, garbage-collected ${collected} store dir${collected === 1 ? '' : 's'}` : ''}`);
  return { removed, collected };
}

/** @scope+name@1.2.3 → @scope/name@1.2.3 (virtual-store key decode). */
function unscopeKey(key) {
  const at = key.lastIndexOf('@');
  const version = key.slice(at);
  const rest = key.slice(0, at); // "@scope+name" or "name"
  return rest.replace('+', '/') + version;
}

/** pnpm ls — direct dependencies (through the top-level links). */
function ls(cwd) {
  const dir = cwd || process.cwd();
  const nodeModulesDir = path.join(dir, 'node_modules');
  const pkg = loadPackageJson(dir, path.join(dir, 'package.json'));
  console.log(`${pkg.name ?? path.basename(dir)}@${pkg.version ?? '1.0.0'} ${dir}`);
  if (!fs.existsSync(nodeModulesDir)) {
    console.log('(empty) — no node_modules; run pnpm install');
    return;
  }
  const groups = [
    ['dependencies', 'dependencies:'],
    ['devDependencies', 'devDependencies:'],
    ['optionalDependencies', 'optionalDependencies:'],
  ];
  let any = false;
  for (const [group, label] of groups) {
    const names = Object.keys(pkg[group] || {}).sort();
    if (names.length === 0) continue;
    console.log(label);
    for (const name of names) {
      // read the version through the symlink (lstat → readlink → target key)
      let version = 'linked';
      try {
        const pj = path.join(nodeModulesDir, name, 'package.json');
        version = JSON.parse(fs.readFileSync(pj, 'utf8')).version ?? version;
      } catch { /* dangling link — report as linked */ }
      console.log(`  ${name} ${version}`);
      any = true;
    }
  }
  if (!any) console.log('(no direct dependencies in package.json)');
}

/** pnpm why <pkg> — dependency chains from direct deps to the package. */
function why(name, cwd) {
  const dir = cwd || process.cwd();
  const record = readRecord(dir);
  const edges = record.edges ?? {};
  const targets = Object.keys(edges).filter((id) => id === name ||
    id.startsWith(`${name}@`));
  if (targets.length === 0) {
    const e = new Error(`Cannot find package '${name}' in the installation record`);
    e.code = 'ERR_PNPM_PACKAGE_NOT_FOUND';
    throw e;
  }
  // BFS from each direct root down the edges, recording paths.
  const chains = [];
  const walk = (id, trail) => {
    if (targets.includes(id)) { chains.push([...trail, id]); return; }
    for (const dep of edges[id] ?? []) {
      walk(dep, [...trail, id]);
    }
  };
  for (const rootId of Object.values(record.direct ?? {})) walk(rootId, []);
  if (chains.length === 0) {
    console.log(`${name} is installed but not reachable from any direct dependency (peer/optional auto-install)`);
    return;
  }
  console.log(`Found ${chains.length === 1 ? '1 reason' : `${chains.length} reasons`}:`);
  const seenChains = new Set();
  for (const chain of chains) {
    const line = chain.join(' ← ');
    if (seenChains.has(line)) continue;
    seenChains.add(line);
    console.log('  ' + line);
  }
}

/** pnpm store path — honest: the per-project virtual store. */
function storePath(cwd) {
  const dir = cwd || process.cwd();
  console.log(path.join(dir, 'node_modules', '.pnpm'));
  console.log('(per-project virtual store — the cross-project content-addressed store arrives with the real pnpm CLI, S5)');
}

/** pnpm init — write a real package.json (non-interactive default shape). */
function initYes(cwd) {
  const dir = cwd || process.cwd();
  const pjPath = path.join(dir, 'package.json');
  const name = path.basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'project';
  const pkg = {
    name,
    version: '1.0.0',
    description: '',
    main: 'index.js',
    scripts: { test: 'echo "Error: no test specified" && exit 1' },
    keywords: [],
    author: '',
    license: 'ISC',
  };
  fs.writeFileSync(pjPath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`Wrote to ${pjPath}`);
  console.log(JSON.stringify(pkg, null, 2));
}

module.exports = {
  install, remove, ls, why, storePath, initYes,
  resolveGraph, parseSpec, dirKey, unscopeKey, readRecord,
};
