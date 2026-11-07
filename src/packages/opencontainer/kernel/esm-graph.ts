/**
 * OpenContainer Kernel — ESM graph importer (S3.1 Phase 6).
 *
 * Real V8 module semantics WITHOUT node's C++ ModuleWrap binding (which a
 * browser cannot expose):
 *
 *   resolve (node-compatible subset) → acorn parse (the vendored parser node
 *   itself uses) → rewrite ONLY what V8 cannot resolve natively:
 *     - bare specifiers ('react', 'fs', 'node:url')  → transport URL
 *     - absolute specifiers ('/x/y.mjs')             → transport URL
 *     - CJS / JSON dependencies                       → generated ESM shims
 *     - import.meta                                   → injected meta object
 *     - dynamic import(...) (literal or computed)    → __ocDynImport(...)
 *   Relative ESM-to-ESM specifiers are left BYTE-IDENTICAL so V8's own
 *   resolution — against the transport URL space that MIRRORS the VFS path
 *   structure — performs the linking. Live bindings, re-exports, cyclic
 *   graphs, top-level await and namespace objects are therefore REAL V8
 *   behavior, not a reimplementation.
 *
 *   Dynamic import() — literal AND computed — is rewritten to
 *   __ocDynImport(dir, spec): node resolves dynamic specifiers at EVALUATION
 *   time; that timing is preserved, the subgraph is published lazily, and a
 *   REFED keep-alive interval stands in for node's loader handle while the
 *   import is in flight (browser-fetch module loads register no kernel
 *   handle; without it the loop-drain watcher exits mid-import).
 *
 * This is NOT an ESM→CJS transpiler: no semantics are converted, no hoisting
 * is emulated — the engine links the graph.
 *
 * Module caching: one URL per resolved VFS path for the process lifetime
 * (Map below) — matching node's per-process module map. Re-imports (dynamic
 * or via a second graph) reuse the URL and therefore V8's module cache.
 *
 * Divergences from node (documented in COMPATIBILITY.md §ESM):
 *   - CJS dependencies are evaluated EAGERLY at graph-build time (node
 *     evaluates them post-order during the evaluation phase); named exports
 *     are the evaluated module's own enumerable keys (a superset of node's
 *     cjs-module-lexer static analysis).
 *   - require(esm) is unsupported (throws) — no synchronous evaluation path
 *     exists for browser module graphs.
 *   - package.json "imports" (#prefixed) and data:/file: URL specifiers are
 *     unsupported (descriptive errors).
 *   - The customization hooks API (module.registerModuleLoader) is not wired.
 */

import type { Vfs } from './vfs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Transport: receives rewritten module texts and hands back ONE importable
 *  URL per path. Called incrementally (deps before dependents within a
 *  graph). The returned URLs must be importable from THIS worker context —
 *  e.g. in-worker blob: URLs (browser kernel) or deterministic file:// URLs
 *  (bun harnesses). No origin, ServiceWorker, or network dependency is
 *  implied: a kernel booted from a cross-origin blob worker has no usable
 *  fetch base, so HTTP-based transports are not viable there. */
export interface EsmServing {
  serve(nonce: string, entries: Map<string, string>): Promise<Map<string, string>>;
}

export interface EsmGraphDeps {
  vfs: Vfs;
  /** realm require for builtins ('fs', 'internal/…'). */
  requireBuiltin: (id: string) => any;
  /** guest CJS loader for absolute VFS file paths (Module._load semantics). */
  requireCjs: (path: string) => any;
  /** node's builtin module id list (Module.builtinModules). */
  builtinModules: string[];
  acorn: any;
  serving: EsmServing;
}

export interface EsmGraphImporter {
  /** Import an ESM entry (absolute VFS path). Resolves when evaluation
   *  settles (TLA included). */
  importEntry(entryPath: string): Promise<void>;
  /** Dynamic import() from guest ESM code (computed specifiers). */
  dynamicImport(parentPath: string, spec: string): Promise<any>;
  /** Dynamic import() from an IN-PROCESS WORKER's module graph: binds
   *  `worker_threads` to that worker's view (parentPort/workerData). */
  dynamicImportWorker(threadId: number, parentPath: string, spec: string): Promise<any>;
}

// ---------------------------------------------------------------------------
// Errors (node-shaped)
// ---------------------------------------------------------------------------

function moduleNotFound(spec: string, parent: string): Error {
  const err: any = new Error(`Cannot find module '${spec}' imported from ${parent}`);
  err.code = 'ERR_MODULE_NOT_FOUND';
  return err;
}

function packagePathNotExported(spec: string, parent: string): Error {
  const err: any = new Error(
    `Package subpath '${spec}' is not defined by "exports" in its package.json, imported from ${parent}`);
  err.code = 'ERR_PACKAGE_PATH_NOT_EXPORTED';
  return err;
}

function invalidModuleSpecifier(spec: string, reason: string): Error {
  const err: any = new Error(`Invalid module specifier '${spec}' ${reason}`);
  err.code = 'ERR_INVALID_MODULE_SPECIFIER';
  return err;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function dirnameOf(p: string): string {
  const i = p.lastIndexOf('/');
  if (i <= 0) return '/';
  return p.slice(0, i);
}

function normalizeJoin(base: string, rel: string): string {
  const out: string[] = [];
  for (const seg of `${base}/${rel}`.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return `/${out.join('/')}`;
}

function encodePath(p: string): string {
  return p.split('/').map((s) => encodeURIComponent(s)).join('/');
}

function fileUrlOf(p: string): string {
  return `file://${encodePath(p)}`;
}

const RESERVED = new Set(['default', 'await', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'debugger', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false',
  'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null',
  'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void',
  'while', 'with', 'yield', 'let', 'static', 'implements', 'interface', 'package',
  'private', 'protected', 'public']);

function isSafeIdent(k: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) && !RESERVED.has(k);
}

// ---------------------------------------------------------------------------
// Resolver — node's ESM resolution algorithm, practical subset
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Package base resolution
// ---------------------------------------------------------------------------

/** Importing module → its owning package.json base dir ('' when the module
 *  is outside any package) — PACKAGE_IMPORTS_RESOLVE scopes '#' specifiers
 *  to the nearest ancestor package.json (node's exact rule). */
const packageBaseCache = new Map<string, string>();
function packageBaseOf(readPjson: (p: string) => any | null, modulePath: string): string {
  const hit = packageBaseCache.get(modulePath);
  if (hit !== undefined) return hit;
  let dir = dirnameOf(modulePath);
  let base = '';
  for (;;) {
    const pj = readPjson(dir);
    if (pj && typeof pj === 'object') { base = dir; break; }
    if (dir === '/') break;
    dir = dirnameOf(dir);
  }
  packageBaseCache.set(modulePath, base);
  return base;
}

class Resolver {
  private pjsonCache = new Map<string, any>();

  constructor(private deps: EsmGraphDeps) {}

  private read(p: string): string | null {
    try {
      const bytes = this.deps.vfs.readFile(p);
      return new TextDecoder().decode(bytes);
    } catch { return null; }
  }

  private existsFile(p: string): boolean {
    // stat (follows symlinks); NOT a directory. NB: `!isDirectory(p)` is
    // WRONG here — isDirectory returns false for MISSING paths too, which
    // made every nonexistent path "exist".
    try { return (this.deps.vfs.stat(p).mode & 0o170000) !== 0o040000; }
    catch { return false; }
  }

  private isDir(p: string): boolean {
    try { return this.deps.vfs.isDirectory(p); } catch { return false; }
  }

  /** Read a package.json (cached; null when absent/unparseable). */
  readPjson(p: string): any | null { return this.pjsonAt(p); }

  /** PACKAGE_IMPORTS_RESOLVE: exact key, then wildcards (longest base wins),
   *  conditions in import-context order. */
  private resolveImports(imports: any, base: string, spec: string, parentPath: string): { kind: 'esm' | 'cjs' | 'json'; path: string } {
    const conditions = ['node', 'import', 'module-sync', 'default'];
    const expandTarget = (target: any, captured: string | null): string | null => {
      if (typeof target === 'string') {
        return captured !== null ? target.replace(/\*/g, captured) : target;
      }
      if (target && typeof target === 'object' && !Array.isArray(target)) {
        for (const cond of conditions) {
          if (cond in target) {
            const t = expandTarget(target[cond], captured);
            if (t !== null) return t;
          }
        }
      }
      return null;
    };
    const toResolution = (target: string): { kind: 'esm' | 'cjs' | 'json'; path: string } => {
      const p = target.startsWith('/') ? target : normalizeJoin(base, target);
      if (this.existsFile(p)) return { kind: this.formatOf(p), path: p };
      const probed = this.loadAsFileOrDirectory(p);
      if (probed) return probed;
      throw moduleNotFound(spec, parentPath);
    };

    if (spec in imports) {
      const t = expandTarget(imports[spec], null);
      if (t === null) {
        throw invalidModuleSpecifier(spec, '(matched "imports" target has no compatible condition)');
      }
      return toResolution(t);
    }
    let best: { key: string; starIdx: number } | null = null;
    for (const key of Object.keys(imports)) {
      const starIdx = key.indexOf('*');
      if (starIdx < 0) continue;
      const keyBase = key.slice(0, starIdx);
      const keyTail = key.slice(starIdx + 1);
      if (!spec.startsWith(keyBase) || !spec.endsWith(keyTail)) continue;
      if (best === null || keyBase.length > best.key.slice(0, best.starIdx).length) {
        best = { key, starIdx };
      }
    }
    if (best) {
      const keyBase = best.key.slice(0, best.starIdx);
      const keyTail = best.key.slice(best.starIdx + 1);
      const captured = spec.slice(keyBase.length, spec.length - keyTail.length);
      const t = expandTarget(imports[best.key], captured);
      if (t === null) {
        throw invalidModuleSpecifier(spec, '(matched "imports" target has no compatible condition)');
      }
      return toResolution(t);
    }
    throw invalidModuleSpecifier(spec, `("imports" does not define '${spec}')`);
  }

  private pjsonAt(p: string): any | null {
    if (this.pjsonCache.has(p)) return this.pjsonCache.get(p);
    const text = this.read(`${p}/package.json`);
    let parsed: any = null;
    if (text !== null) {
      try { parsed = JSON.parse(text); } catch { parsed = null; }
    }
    this.pjsonCache.set(p, parsed);
    return parsed;
  }

  /** Format of a file path: extension + nearest package.json type field. */
  formatOf(p: string): 'esm' | 'cjs' | 'json' {
    if (p.endsWith('.mjs') || p.endsWith('.mts')) return 'esm';
    if (p.endsWith('.cjs') || p.endsWith('.cts')) return 'cjs';
    if (p.endsWith('.json')) return 'json';
    let dir = dirnameOf(p);
    for (;;) {
      const pj = this.pjsonAt(dir);
      if (pj && typeof pj === 'object') return pj.type === 'module' ? 'esm' : 'cjs';
      if (dir === '/') return 'cjs';
      dir = dirnameOf(dir);
    }
  }

  isBuiltin(spec: string): boolean {
    if (spec.startsWith('node:')) return true;
    return this.deps.builtinModules.includes(spec);
  }

  /** Resolve a specifier as if imported from a file inside `parentDir`.
   *  (resolve() takes the parent FILE path; dynamic imports know the dir.) */
  resolveFromDir(spec: string, parentDir: string): { kind: 'esm' | 'cjs' | 'json' | 'builtin'; path?: string; id?: string } {
    return this.resolve(spec, `${parentDir}/<module>`);
  }

  resolve(spec: string, parentPath: string): { kind: 'esm' | 'cjs' | 'json' | 'builtin'; path?: string; id?: string } {
    if (spec.startsWith('node:')) {
      const id = spec.slice(5);
      if (!this.deps.builtinModules.includes(id)) throw moduleNotFound(spec, parentPath);
      return { kind: 'builtin', id };
    }
    if (this.deps.builtinModules.includes(spec)) return { kind: 'builtin', id: spec };
    if (spec.startsWith('data:') || spec.startsWith('file:')) {
      throw invalidModuleSpecifier(spec, '(data:/file: URL specifiers are not supported in OpenContainer)');
    }
    if (spec.startsWith('#')) {
      // PACKAGE_IMPORTS_RESOLVE (S3.1): '#' specifiers resolve through the
      // nearest ancestor package.json "imports" map — required by Vite 8's
      // loader ('#module-sync-enabled' with module-sync/default conditions)
      // and a growing share of the ecosystem.
      const base = packageBaseOf((p) => this.pjsonAt(p), parentPath);
      if (base === '') {
        throw invalidModuleSpecifier(spec, '(no ancestor package.json defines "imports")');
      }
      const pj = this.pjsonAt(base);
      const imports = pj && typeof pj === 'object' ? pj.imports : undefined;
      if (!imports || typeof imports !== 'object') {
        throw invalidModuleSpecifier(spec, `("imports" not defined in ${base}/package.json)`);
      }
      return this.resolveImports(imports, base, spec, parentPath);
    }
    if (spec.startsWith('./') || spec.startsWith('../') || spec.startsWith('/')) {
      const base = spec.startsWith('/')
        ? normalizeJoin('', spec)
        : normalizeJoin(dirnameOf(parentPath), spec);
      const found = this.loadAsFileOrDirectory(base);
      if (!found) throw moduleNotFound(spec, parentPath);
      return found;
    }
    const resolved = this.resolvePackage(spec, dirnameOf(parentPath));
    if (!resolved) throw moduleNotFound(spec, parentPath);
    return resolved;
  }

  /** LOAD_AS_FILE then LOAD_AS_DIRECTORY. */
  private loadAsFileOrDirectory(base: string): { kind: 'esm' | 'cjs' | 'json'; path: string } | null {
    if (this.existsFile(base)) return { kind: this.formatOf(base), path: base };
    for (const ext of ['.mjs', '.cjs', '.js']) {
      const p = `${base}${ext}`;
      if (this.existsFile(p)) return { kind: this.formatOf(p), path: p };
    }
    if (this.isDir(base)) {
      const pj = this.pjsonAt(base);
      if (pj && typeof pj.main === 'string') {
        const viaMain = this.loadAsFileOrDirectory(normalizeJoin(base, pj.main));
        if (viaMain) return viaMain;
      }
      for (const idx of ['index.mjs', 'index.js', 'index.cjs']) {
        const p = `${base}/${idx}`;
        if (this.existsFile(p)) return { kind: this.formatOf(p), path: p };
      }
    }
    return null;
  }

  private resolvePackage(spec: string, fromDir: string): { kind: 'esm' | 'cjs' | 'json'; path: string } | null {
    let pkgName = spec;
    let subpath = '';
    if (spec.startsWith('@')) {
      const i = spec.indexOf('/');
      const j = i >= 0 ? spec.indexOf('/', i + 1) : -1;
      if (j >= 0) { pkgName = spec.slice(0, j); subpath = spec.slice(j + 1); }
    } else {
      const i = spec.indexOf('/');
      if (i >= 0) { pkgName = spec.slice(0, i); subpath = spec.slice(i + 1); }
    }

    let dir = fromDir;
    for (;;) {
      const nmRoot = dir === '/' ? '/node_modules' : `${dir}/node_modules`;
      const pkgDir = `${nmRoot}/${pkgName}`;
      if (this.isDir(pkgDir)) {
        const pj = this.pjsonAt(pkgDir);
        if (pj && typeof pj === 'object' && pj.exports !== undefined) {
          return this.resolveExports(pj.exports, pkgDir, spec, subpath, fromDir);
        }
        const target = subpath
          ? this.loadAsFileOrDirectory(`${pkgDir}/${subpath}`)
          : this.loadAsFileOrDirectory(pj && typeof pj.main === 'string' ? normalizeJoin(pkgDir, pj.main) : `${pkgDir}/index.js`)
            ?? this.loadAsFileOrDirectory(`${pkgDir}/index.js`);
        if (target) return target;
        // Found the package but its entry does not resolve — node treats this
        // as a hard error (no further node_modules walk-up).
        throw moduleNotFound(spec, fromDir);
      }
      if (dir === '/') break;
      dir = dirnameOf(dir);
    }
    return null;
  }

  /** PACKAGE_EXPORTS_RESOLVE — exact key, then wildcard patterns (longest
   *  pattern base wins); conditions in import-context order. */
  private resolveExports(exports: any, pkgDir: string, spec: string, subpath: string, fromDir: string): { kind: 'esm' | 'cjs' | 'json'; path: string } {
    const conditions = ['node', 'import', 'default'];

    const expandTarget = (target: any, captured: string | null): string | null => {
      if (typeof target === 'string') {
        if (!target.startsWith('./')) return null;
        return captured !== null ? target.replace(/\*/g, captured) : target;
      }
      if (target && typeof target === 'object' && !Array.isArray(target)) {
        for (const cond of conditions) {
          if (cond in target) {
            const t = expandTarget(target[cond], captured);
            if (t !== null) return t;
          }
        }
      }
      return null;
    };

    const toResolution = (target: string): { kind: 'esm' | 'cjs' | 'json'; path: string } => {
      const p = normalizeJoin(pkgDir, target);
      if (this.existsFile(p)) return { kind: this.formatOf(p), path: p };
      const probed = this.loadAsFileOrDirectory(p);
      if (probed) return probed;
      throw moduleNotFound(spec, fromDir);
    };

    const matchKey = subpath ? `./${subpath}` : '.';

    // exports as the "." target directly: a string, or an object whose keys
    // are all condition names (none starts with '.') — node's exact rule.
    const isDotShorthand = typeof exports === 'string'
      || (exports && typeof exports === 'object' && !Array.isArray(exports)
        && Object.keys(exports).length > 0
        && Object.keys(exports).every((k) => !k.startsWith('.')));
    if (isDotShorthand) {
      const t = expandTarget(exports, null);
      if (t === null) throw packagePathNotExported(spec, fromDir);
      return toResolution(t);
    }
    if (typeof exports !== 'object' || exports === null || Array.isArray(exports)) {
      throw packagePathNotExported(spec, fromDir);
    }

    if (matchKey in exports) {
      const t = expandTarget(exports[matchKey], null);
      if (t === null) throw packagePathNotExported(spec, fromDir);
      return toResolution(t);
    }
    // wildcard patterns
    let best: { key: string; starIdx: number } | null = null;
    for (const key of Object.keys(exports)) {
      const starIdx = key.indexOf('*');
      if (starIdx < 0 || !key.startsWith('./')) continue;
      const base = key.slice(0, starIdx);
      const tail = key.slice(starIdx + 1);
      if (!matchKey.startsWith(base) || !matchKey.endsWith(tail)) continue;
      if (best === null || base.length > key.slice(0, best.starIdx).length) {
        best = { key, starIdx };
      }
    }
    if (best) {
      const base = best.key.slice(0, best.starIdx);
      const tail = best.key.slice(best.starIdx + 1);
      const captured = matchKey.slice(base.length, matchKey.length - tail.length);
      const t = expandTarget(exports[best.key], captured);
      if (t === null) throw packagePathNotExported(spec, fromDir);
      return toResolution(t);
    }
    throw packagePathNotExported(spec, fromDir);
  }
}

// ---------------------------------------------------------------------------
// Graph builder + rewriter
// ---------------------------------------------------------------------------

interface PendingModule {
  path: string;
  source: string;
  ast: any;
}

export function makeEsmGraphImporter(deps: EsmGraphDeps): EsmGraphImporter {
  const resolver = new Resolver(deps);
  const { acorn, serving, vfs } = deps;

  const builtinShimPath = (id: string) => `/__oc_builtin/${id}.mjs`;
  const workerBuiltinShimPath = (id: string, threadId: number) => `/__oc_builtin_wt${threadId}/${id}.mjs`;
  const cjsShimPath = (p: string) => `/__oc_cjs${p}.mjs`;
  const jsonShimPath = (p: string) => `/__oc_json${p}.mjs`;
  const dynShimPath = (p: string) => `/__oc_dynshim${p}.mjs`;

  /** worker_threads inside an in-process worker's module graph resolves to
   *  a PER-WORKER shim URL: the worker view (parentPort/workerData/threadId,
   *  isMainThread:false) is per-thread state, while a shared shim would
   *  snapshot ONE view for every importer in the process (module records are
   *  URL-keyed). Distinct URL → distinct record → each worker's ESM import
   *  of `node:worker_threads` binds ITS view (natives/worker.ts registers it
   *  via globalThis.__ocWorkerViews before the graph builds). */
  const isWorkerThreadsId = (id: string): boolean =>
    id === 'worker_threads' || id === 'node:worker_threads';

  /** ONE URL per path per process (node's module map is process-wide): a
   *  module reached from two graphs resolves to ONE URL — one V8 module
   *  record, one evaluation, one namespace — exactly node's caching
   *  semantics. URLs are minted by the transport (serve) and cached here. */
  const processNonce = Math.random().toString(36).slice(2, 12);
  const published = new Set<string>(); // VFS/shim paths with served text
  const urlByPath = new Map<string, string>();

  const urlOf = (p: string): string => {
    const u = urlByPath.get(p);
    if (u === undefined) throw new Error(`OpenContainer: ESM internal — no URL minted for ${p}`);
    return u;
  };

  const readUtf8 = (p: string): string => {
    try { return new TextDecoder().decode(vfs.readFile(p)); }
    catch { throw moduleNotFound(p, '(entry)'); }
  };

  function parseModule(source: string, path: string): any {
    try {
      return acorn.Parser.parse(source, {
        __proto__: null,
        ecmaVersion: 'latest',
        sourceType: 'module',
        allowAwaitOutsideFunction: true,
      });
    } catch (e: any) {
      const loc = e?.loc ? `:${e.loc.line}:${e.loc.column}` : '';
      const err: any = new Error(`${path}${loc}: ${e?.message ?? String(e)}`);
      err.code = 'ERR_MODULE_SYNTAX';
      throw err;
    }
  }

  /** Collect STATIC specifier literals only (top-level import/export-from).
   *  Dynamic import() — literal or computed — is handled separately by the
   *  full-AST walk in rewriteModule: optional-peer patterns like vite's
   *  `try { await import('tsx/cjs/api') } catch {}` must fail at EVALUATION
   *  time (inside the guest's own catch), not at graph-build time —
   *  hoisting them eagerly turns every optional dependency into a hard
   *  error. */
  function collectStaticSpecifiers(ast: any): Array<{ value: string; node: any; isStaticDecl: boolean; declNode?: any }> {
    const out: Array<{ value: string; node: any; isStaticDecl: boolean; declNode?: any }> = [];
    for (const node of ast.body) {
      const srcNode = node.type === 'ImportDeclaration' ? node.source
        : node.type === 'ExportNamedDeclaration' ? node.source
        : node.type === 'ExportAllDeclaration' ? node.source
        : null;
      if (srcNode && typeof srcNode.value === 'string') {
        out.push({ value: srcNode.value, node: srcNode, isStaticDecl: true, declNode: node });
      }
    }
    return out;
  }

  /** Rewrite one ESM module: minimal, range-based text edits. EVERY static
   *  specifier (relative included) is rewritten to an explicit transport URL —
   *  blob: URLs cannot resolve relative specifiers, so nothing may be left
   *  to V8's URL-space mirroring. `wtid` (when set) marks modules of an
   *  in-process WORKER's graph: worker_threads binds the per-worker view and
   *  dynamic imports keep the worker context. */
  async function rewriteModule(mod: PendingModule, wtid: number | null = null): Promise<string> {
    const src = mod.source;
    const edits: Array<{ start: number; end: number; text: string }> = [];
    let metaUsed = false;

    for (const s of collectStaticSpecifiers(mod.ast)) {
      const r = resolver.resolve(s.value, mod.path);
      const url = await urlFor(r, wtid);
      if (r.kind === 'json' && s.isStaticDecl) {
        // The JSON shim is a JS module — the `with { type: 'json' }`
        // attribute must go (replacing through the declaration end drops it).
        edits.push({ start: s.node.start, end: s.declNode.end, text: JSON.stringify(url) });
      } else {
        edits.push({ start: s.node.start, end: s.node.end, text: JSON.stringify(url) });
      }
    }
    // import.meta + ALL dynamic import() expressions (literal AND computed,
    // nested anywhere).
    //
    // EVERY dynamic import routes through globalThis.__ocDynImport instead of
    // a bare URL: (1) node resolves dynamic specifiers at EVALUATION time —
    // routing through the importer at evaluation time matches node exactly
    // (build-time URL rewriting resolved eagerly, which broke optional-peer
    // patterns unless a __ocDynMissing fallback was special-cased); (2) the
    // importer arms a REFED keep-alive while the import is in flight — in
    // node a pending import() holds the event loop, but our module fetches
    // ride on browser fetch() which registers NO kernel handle, so the
    // loop-drain watcher would otherwise exit the process mid-import (found
    // via vite's bin: `start()` fire-and-forget-imports the CLI and the
    // process exited 0 before the CLI ever ran); (3) unresolvable specifiers
    // (optional peers like tsx/esbuild inside try/catch) reject with
    // ERR_MODULE_NOT_FOUND at evaluation time — handled by the guest's own
    // catch, exactly as in node.
    const walk = (node: any) => {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'ImportExpression') {
        const arg = node.source ?? node.argument;
        const argText = arg ? src.slice(arg.start, arg.end) : '';
        // In a worker's graph, dynamic imports stay IN the worker context —
        // a worker module's import() must resolve worker_threads to the
        // worker view, same as its static imports.
        const call = wtid !== null
          ? `globalThis.__ocDynImportW(${wtid}, ${JSON.stringify(dirnameOf(mod.path))}, ${argText})`
          : `globalThis.__ocDynImport(${JSON.stringify(dirnameOf(mod.path))}, ${argText})`;
        edits.push({
          start: node.start, end: node.end,
          text: call,
        });
      } else if (node.type === 'MetaProperty' && node.meta?.name === 'import' && node.property?.name === 'meta') {
        metaUsed = true;
        edits.push({ start: node.start, end: node.end, text: '__ocImportMeta' });
      }
      for (const key of Object.keys(node)) {
        const v = (node as any)[key];
        if (Array.isArray(v)) { for (const c of v) if (c && typeof c === 'object') walk(c); }
        else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v);
      }
    };
    walk(mod.ast);

    edits.sort((a, b) => b.start - a.start);
    let out = src;
    for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    // Shebang stripping FIRST: node's loader removes '#!' line 1 before
    // compiling; V8 (browser module loader) treats it as a syntax error.
    // (It must precede the __ocImportMeta prologue, or the shebang lands
    // mid-file — a guaranteed SyntaxError, found via vite's bin.)
    if (out.startsWith('#!')) {
      const nl = out.indexOf('\n');
      out = nl < 0 ? '' : out.slice(nl);
    }
    if (metaUsed) {
      out = `const __ocImportMeta = globalThis.__ocMetaFor(${JSON.stringify(mod.path)});\n` + out;
    }
    // TEMPORARY audit: evaluation order of guest modules — the last line
    // before a stall names the module whose top-level code pends forever.
    out = `;(globalThis).__ocEvalLog&&__ocEvalLog(${JSON.stringify(mod.path)});\n` + out;
    // TEMPORARY audit pair: evaluation COMPLETION (start-without-done = the
    // module whose top-level code or TLA never settles).
    out += `\n;(globalThis).__ocEvalDone&&__ocEvalDone(${JSON.stringify(mod.path)});`;
    return out;
  }

  // ---- shim text generators ----------------------------------------------

  function exportKeysOf(load: () => any): string[] {
    try {
      const m = load();
      if (m !== null && m !== undefined && (typeof m === 'object' || typeof m === 'function')) {
        return Object.keys(m).filter(isSafeIdent);
      }
    } catch { /* the error surfaces at shim evaluation, not graph build */ }
    return [];
  }

  function builtinShimText(id: string): string {
    // Builtins with function/class values (e.g. `module` exports the Module
    // constructor WITH statics like createRequire) — Object.keys works on
    // functions too; the typeof === 'object' guard wrongly skipped them
    // (found via vite's `import { createRequire } from 'node:module'`).
    let keys: string[] = [];
    try {
      const m = deps.requireBuiltin(id);
      if (m !== null && m !== undefined && (typeof m === 'object' || typeof m === 'function')) {
        keys = Object.keys(m).filter(isSafeIdent);
      }
    } catch { /* the error surfaces at shim evaluation, not graph build */ }
    let text = `const __m = globalThis.__ocEsmBuiltin(${JSON.stringify(id)});\nexport default __m;\n`;
    for (const k of keys) text += `export const ${k} = __m[${JSON.stringify(k)}];\n`;
    return text;
  }

  /** Per-worker variant of the builtin shim: resolves through
   *  globalThis.__ocEsmWorkerBuiltin(threadId, id) so worker_threads binds
   *  the importing WORKER's view. Key set mirrors the main module's. */
  function workerBuiltinShimText(id: string, threadId: number): string {
    let keys: string[] = [];
    try {
      const views: any = (globalThis as any).__ocWorkerViews;
      const view = views?.get?.(threadId);
      if (view && (typeof view === 'object' || typeof view === 'function')) {
        keys = Object.keys(view).filter(isSafeIdent);
      }
    } catch { /* fall back to the builtin's own keys below */ }
    if (keys.length === 0) {
      try {
        const m = deps.requireBuiltin(id);
        if (m !== null && m !== undefined && (typeof m === 'object' || typeof m === 'function')) {
          keys = Object.keys(m).filter(isSafeIdent);
        }
      } catch { /* surfaces at shim evaluation */ }
    }
    let text = `const __m = globalThis.__ocEsmWorkerBuiltin(${JSON.stringify(threadId)}, ${JSON.stringify(id)});\nexport default __m;\n`;
    for (const k of keys) text += `export const ${k} = __m[${JSON.stringify(k)}];\n`;
    return text;
  }

  function cjsShimText(p: string): string {
    // EAGER evaluation (divergence documented in the file header): the
    // named-export list must be static, so the CJS module runs at
    // graph-build time through node's own CJS loader (cached thereafter).
    const keys = exportKeysOf(() => deps.requireCjs(p));
    let text = `const __m = globalThis.__ocEsmCjs(${JSON.stringify(p)});\nexport default __m;\n`;
    for (const k of keys) text += `export const ${k} = __m[${JSON.stringify(k)}];\n`;
    return text;
  }

  function jsonShimText(p: string): string {
    let data: any;
    try { data = JSON.parse(readUtf8(p)); }
    catch (e: any) {
      const err: any = new Error(`Cannot parse JSON module '${p}': ${e?.message ?? e}`);
      err.code = 'ERR_INVALID_JSON';
      throw err;
    }
    const keys = data && typeof data === 'object' && !Array.isArray(data)
      ? Object.keys(data).filter(isSafeIdent) : [];
    let text = `const __j = globalThis.__ocEsmJson(${JSON.stringify(p)});\nexport default __j;\n`;
    for (const k of keys) text += `export const ${k} = __j[${JSON.stringify(k)}];\n`;
    return text;
  }

  /** Cycle back-edge shim: re-exports the target's namespace through a
   *  dynamic import at evaluation time (the one place where a static import
   * cannot be used — the target's URL does not exist yet when the importer
   * is minted). Named exports are parsed statically from the target; they
   * are SNAPSHOT bindings (the documented divergence for cyclic ESM graphs).
   * `export * from` in the target cannot be enumerated — such names are
   * missing on the shimmed edge only. */
  function dynShimText(p: string): string {
    let hasDefault = false;
    const names = new Set<string>();
    try {
      const ast = parseModule(readUtf8(p), p);
      for (const node of ast.body) {
        if (node.type === 'ExportDefaultDeclaration') hasDefault = true;
        if (node.type === 'ExportNamedDeclaration') {
          for (const spec of node.specifiers ?? []) {
            if (isSafeIdent(spec.exported.name)) names.add(spec.exported.name);
          }
          if (node.declaration?.type === 'VariableDeclaration') {
            for (const d of node.declaration.declarations ?? []) {
              if (d.id.type === 'Identifier' && isSafeIdent(d.id.name)) names.add(d.id.name);
            }
          } else if (node.declaration?.type === 'FunctionDeclaration' && node.declaration.id) {
            if (isSafeIdent(node.declaration.id.name)) names.add(node.declaration.id.name);
          } else if (node.declaration?.type === 'ClassDeclaration' && node.declaration.id) {
            if (isSafeIdent(node.declaration.id.name)) names.add(node.declaration.id.name);
          }
        }
      }
    } catch { /* unparseable target — the dyn import will surface the error */ }
    let text = `const __m = await globalThis.__ocDynImport(${JSON.stringify(dirnameOf(p))}, ${JSON.stringify(p)});\n`;
    if (hasDefault) text += `export default __m.default;\n`;
    for (const n of names) text += `export const ${n} = __m[${JSON.stringify(n)}];\n`;
    return text;
  }

  // ---- graph build ---------------------------------------------------------

  async function buildGraph(entryPath: string, wtid: number | null = null): Promise<string> {
    // Already-served module → its URL (node's module-map semantics: one
    // evaluation per resolved path per process).
    if (published.has(entryPath)) return urlOf(entryPath);
    // A worker's graph must NOT reuse a main-graph module URL for its entry:
    // the entry's own imports may bind the worker view. Worker graphs mint
    // from scratch only when the entry is not yet published; shared deps
    // (already-published paths) keep their URLs — node's per-thread module
    // map caches only SOURCE, and our shims are the sole per-view surface.
    const modules = new Map<string, PendingModule>();

    // phase 1 — resolve + parse walk (skipping already-published paths: their
    // subgraphs are served and their URLs are final). Shims (builtin/cjs/json)
    // are NOT collected here — they are minted on demand by urlFor during
    // phase 2, which also covers dynamic-import subgraphs.
    const stack: string[] = [entryPath];
    while (stack.length > 0) {
      const path = stack.pop()!;
      if (modules.has(path) || published.has(path)) continue;
      const source = readUtf8(path);
      const ast = parseModule(source, path);
      modules.set(path, { path, source, ast });
      for (const s of collectStaticSpecifiers(ast)) {
        const r = resolver.resolve(s.value, path);
        if (r.kind === 'esm') {
          if (!modules.has(r.path!) && !published.has(r.path!)) stack.push(r.path!);
        }
      }
      // Dynamic imports are NOT pre-walked: every dynamic import() is
      // rewritten to globalThis.__ocDynImport(dir, spec) (see rewriteModule)
      // which resolves + publishes its subgraph lazily at EVALUATION time and
      // arms the keep-alive while in flight — node's exact semantics.
    }

    // phase 2 — rewrite + mint, DEPENDENCIES FIRST (post-order over static
    // ESM edges). Minting is incremental because a module's rewritten text
    // must embed its dependencies' final URLs (blob: URLs are minted
    // per-text and cannot be precomputed). A dependency that is not yet
    // minted at rewrite time is a CYCLE back-edge (or a forward reference)
    // — those get a dynamic-import shim instead (real static linking
    // everywhere else; live bindings are lost ONLY on the shimmed edge).
    const order: string[] = [];
    const seenOrder = new Set<string>();
    const visit = (path: string, stack: Set<string>) => {
      if (seenOrder.has(path) || published.has(path)) return;
      if (stack.has(path)) return; // cycle back-edge — do not recurse
      stack.add(path);
      const mod = modules.get(path)!;
      for (const s of collectStaticSpecifiers(mod.ast)) {
        const r = resolver.resolve(s.value, path);
        if (r.kind === 'esm' && modules.has(r.path!)) visit(r.path!, stack);
      }
      stack.delete(path);
      seenOrder.add(path);
      order.push(path);
    };
    visit(entryPath, new Set());
    // Modules unreachable post-order from the entry (shouldn't happen —
    // phase 1 walks from the entry) are appended defensively.
    for (const p of modules.keys()) if (!seenOrder.has(p)) order.push(p);

    for (const path of order) {
      if (published.has(path)) continue;
      const mod = modules.get(path)!;
      const text = await rewriteModule(mod, wtid);
      const urls = await serving.serve(processNonce, new Map([[path, text]]));
      const url = urls.get(path);
      if (!url) throw new Error(`OpenContainer: ESM transport returned no URL for ${path}`);
      urlByPath.set(path, url);
      published.add(path);
    }
    return urlOf(entryPath);
  }

  /** URL for a dependency, minting shims on demand:
   *  - builtin/cjs/json → their shim modules (minted here if needed);
   *  - esm already minted → its URL (the common case: deps-first ordering);
   *  - esm NOT yet minted → cycle back-edge / forward reference → a
   *    dynamic-import shim (snapshot re-exports of the real module — the
   *    documented divergence for cyclic ESM graphs). */
  async function urlFor(r: { kind: string; path?: string; id?: string }, wtid: number | null = null): Promise<string> {
    if (r.kind === 'builtin') {
      // A worker's graph binds worker_threads to THAT worker's view via a
      // per-worker shim URL (see workerBuiltinShimPath).
      if (wtid !== null && isWorkerThreadsId(r.id!)) {
        return ensureShim(workerBuiltinShimPath(r.id!, wtid), workerBuiltinShimText(r.id!, wtid));
      }
      return ensureShim(builtinShimPath(r.id!), builtinShimText(r.id!));
    }
    if (r.kind === 'cjs') return ensureShim(cjsShimPath(r.path!), cjsShimText(r.path!));
    if (r.kind === 'json') return ensureShim(jsonShimPath(r.path!), jsonShimText(r.path!));
    if (urlByPath.has(r.path!)) return urlByPath.get(r.path!)!;
    return ensureShim(dynShimPath(r.path!), dynShimText(r.path!));
  }

  // ---- process lifetime (node semantics: pending import() keeps the loop) --

  // In real node, an in-flight import() holds the event loop (the module
  // loader keeps the process alive until the graph settles). Our module
  // fetches ride on browser fetch(), which registers NO kernel handle — so
  // the kernel's loop-drain watcher would exit the process mid-import (found
  // via vite's bin: start() fire-and-forget-imports the CLI; the process
  // exited 0 before the CLI ever ran). A REFED keep-alive interval stands in
  // for the loader handle (same pattern npm-oc uses for registry I/O).
  let pendingImports = 0;
  let keepAliveTimer: any = null;
  function armImport(): void {
    pendingImports++;
    if (keepAliveTimer === null && typeof (globalThis as any).setInterval === 'function') {
      keepAliveTimer = (globalThis as any).setInterval(() => {}, 1000);
    }
  }
  function disarmImport(): void {
    pendingImports = Math.max(0, pendingImports - 1);
    if (pendingImports === 0 && keepAliveTimer !== null) {
      (globalThis as any).clearInterval?.(keepAliveTimer);
      keepAliveTimer = null;
    }
  }

  async function importEntry(entryPath: string): Promise<void> {
    const url = await buildGraph(entryPath);
    armImport();
    try {
      await import(/* @vite-ignore */ url);
    } catch (err: any) {
      // A syntax/parse failure in ANY module of the graph surfaces here
      // without identifying the module — annotate the URL (node's loader
      // names the offending file; we must too, or diagnosis is impossible).
      if (err instanceof SyntaxError || /Invalid or unexpected token|Unexpected token|is not defined/.test(String(err?.message ?? ''))) {
        const better: any = new SyntaxError(`${err.message} [while evaluating module ${url}]`);
        better.code = err?.code;
        better.cause = err;
        throw better;
      }
      throw err;
    } finally {
      disarmImport();
    }
  }

  async function dynamicImport(parentDir: string, spec: string): Promise<any> {
    // Resolve like an import from a module inside parentDir; build (or
    // reuse) its graph. Unresolvable specifiers throw ERR_MODULE_NOT_FOUND
    // — which, because this is an async function, surfaces as a REJECTED
    // import() promise inside the guest's own catch (node's exact optional-
    // peer semantics; no silent stub).
    armImport();
    try {
      const r = resolver.resolveFromDir(spec, parentDir);
      if (r.kind === 'builtin') {
        return await import(/* @vite-ignore */ await ensureShim(builtinShimPath(r.id!), builtinShimText(r.id!)));
      }
      if (r.kind === 'cjs') {
        return await import(/* @vite-ignore */ await ensureShim(cjsShimPath(r.path!), cjsShimText(r.path!)));
      }
      if (r.kind === 'json') {
        return await import(/* @vite-ignore */ await ensureShim(jsonShimPath(r.path!), jsonShimText(r.path!)));
      }
      const url = await buildGraph(r.path!);
      return await import(/* @vite-ignore */ url);
    } finally {
      disarmImport();
    }
  }

  /** Dynamic import FROM AN IN-PROCESS WORKER'S MODULE (see
   *  natives/worker.ts): identical resolution to dynamicImport, but the
   *  resulting graph binds `worker_threads` to the importing worker's view
   *  (per-worker shim URLs) so parentPort/workerData/threadId are the
   *  worker's own — not the main thread's. */
  async function dynamicImportWorker(threadId: number, parentDir: string, spec: string): Promise<any> {
    armImport();
    try {
      const r = resolver.resolveFromDir(spec, parentDir);
      if (r.kind === 'builtin') {
        if (isWorkerThreadsId(r.id!)) {
          return await import(/* @vite-ignore */ await ensureShim(
            workerBuiltinShimPath(r.id!, threadId), workerBuiltinShimText(r.id!, threadId)));
        }
        return await import(/* @vite-ignore */ await ensureShim(builtinShimPath(r.id!), builtinShimText(r.id!)));
      }
      if (r.kind === 'cjs') {
        return await import(/* @vite-ignore */ await ensureShim(cjsShimPath(r.path!), cjsShimText(r.path!)));
      }
      if (r.kind === 'json') {
        return await import(/* @vite-ignore */ await ensureShim(jsonShimPath(r.path!), jsonShimText(r.path!)));
      }
      const url = await buildGraph(r.path!, threadId);
      return await import(/* @vite-ignore */ url);
    } finally {
      disarmImport();
    }
  }

  /** Mint a single shim module (no static deps — always mintable) and
   *  return its URL. */
  async function ensureShim(shimPath: string, text: string): Promise<string> {
    if (published.has(shimPath)) return urlOf(shimPath);
    const urls = await serving.serve(processNonce, new Map([[shimPath, text]]));
    const url = urls.get(shimPath);
    if (!url) throw new Error(`OpenContainer: ESM transport returned no URL for ${shimPath}`);
    urlByPath.set(shimPath, url);
    published.add(shimPath);
    return url;
  }

  return { importEntry, dynamicImport, dynamicImportWorker };
}

// Re-export helpers used by the wiring layer.
export { dirnameOf, fileUrlOf, encodePath, moduleNotFound };
