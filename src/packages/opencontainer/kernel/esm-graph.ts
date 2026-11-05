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

/** Transport: publishes rewritten module texts and hands back the URL space
 *  under which `<prefix><encoded VFS path>` serves them. Relative specifiers
 *  resolve back through this space (the prefix carries a per-graph nonce so
 *  concurrent graphs never collide). */
export interface EsmServing {
  publish(nonce: string, entries: Map<string, string>): Promise<void>;
  prefix(nonce: string): string;
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
  const cjsShimPath = (p: string) => `/__oc_cjs${p}.mjs`;
  const jsonShimPath = (p: string) => `/__oc_json${p}.mjs`;

  /** ONE URL namespace per process (node's module map is process-wide):
   *  every graph publishes under the same nonce, so a module reached
   *  relatively from two graphs resolves to ONE URL — one V8 module record,
   *  one evaluation, one namespace — exactly node's caching semantics. */
  const processNonce = Math.random().toString(36).slice(2, 12);
  const prefix = serving.prefix(processNonce);
  const published = new Set<string>(); // VFS/shim paths with served text

  const urlOf = (p: string): string => `${prefix}${encodePath(p)}`;

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

  /** Rewrite one ESM module: minimal, range-based text edits. */
  function rewriteModule(mod: PendingModule, urlFor: (r: { kind: string; path?: string; id?: string }, spec: string) => string): string {
    const src = mod.source;
    const edits: Array<{ start: number; end: number; text: string }> = [];
    let metaUsed = false;

    for (const s of collectStaticSpecifiers(mod.ast)) {
      const r = resolver.resolve(s.value, mod.path);
      const isRelative = s.value.startsWith('./') || s.value.startsWith('../');
      if (r.kind === 'esm' && isRelative) {
        continue; // V8 resolves it against the mirrored URL space — untouched
      }
      const url = urlFor(r, s.value);
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
        edits.push({
          start: node.start, end: node.end,
          text: `globalThis.__ocDynImport(${JSON.stringify(dirnameOf(mod.path))}, ${argText})`,
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

  // ---- graph build ---------------------------------------------------------

  async function buildGraph(entryPath: string): Promise<string> {
    // Already-served module → its URL (node's module-map semantics: one
    // evaluation per resolved path per process).
    if (published.has(entryPath)) return urlOf(entryPath);

    const modules = new Map<string, PendingModule>();
    const shimPaths = new Set<string>();

    // phase 1 — resolve + parse walk (skipping already-published paths: their
    // subgraphs are served and their URLs are deterministic)
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
        } else if (r.kind === 'builtin') {
          shimPaths.add(builtinShimPath(r.id!));
        } else if (r.kind === 'cjs') {
          shimPaths.add(cjsShimPath(r.path!));
        } else if (r.kind === 'json') {
          shimPaths.add(jsonShimPath(r.path!));
        }
      }
      // Dynamic imports are NOT pre-walked: every dynamic import() is
      // rewritten to globalThis.__ocDynImport(dir, spec) (see rewriteModule)
      // which resolves + publishes its subgraph lazily at EVALUATION time and
      // arms the keep-alive while in flight — node's exact semantics.
    }

    // phase 2 — rewrite + generate shims + publish (one batch)
    const publish = new Map<string, string>();
    for (const mod of modules.values()) {
      publish.set(mod.path, rewriteModule(mod, urlFor));
    }
    for (const shimPath of shimPaths) {
      if (published.has(shimPath)) continue;
      if (shimPath.startsWith('/__oc_builtin/')) {
        const id = shimPath.slice('/__oc_builtin/'.length, -'.mjs'.length);
        publish.set(shimPath, builtinShimText(id));
      } else if (shimPath.startsWith('/__oc_cjs/')) {
        const real = shimPath.slice('/__oc_cjs'.length, -'.mjs'.length);
        publish.set(shimPath, cjsShimText(real));
      } else if (shimPath.startsWith('/__oc_json/')) {
        const real = shimPath.slice('/__oc_json'.length, -'.mjs'.length);
        publish.set(shimPath, jsonShimText(real));
      }
    }
    if (publish.size > 0) {
      await serving.publish(processNonce, publish);
      for (const p of publish.keys()) published.add(p);
    }
    return urlOf(entryPath);
  }

  /** URL for a dependency (shim for cjs/json/builtin; the module's own URL
   *  for esm — deterministic under the process nonce). */
  function urlFor(r: { kind: string; path?: string; id?: string }): string {
    const shim = r.kind === 'builtin' ? builtinShimPath(r.id!)
      : r.kind === 'cjs' ? cjsShimPath(r.path!)
      : r.kind === 'json' ? jsonShimPath(r.path!)
      : null;
    return urlOf(shim ?? r.path!);
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

  /** Publish a single shim module under the process nonce. */
  async function ensureShim(shimPath: string, text: string): Promise<string> {
    if (published.has(shimPath)) return urlOf(shimPath);
    const entries = new Map<string, string>();
    entries.set(shimPath, text);
    await serving.publish(processNonce, entries);
    published.add(shimPath);
    return urlOf(shimPath);
  }

  return { importEntry, dynamicImport };
}

// Re-export helpers used by the wiring layer.
export { dirnameOf, fileUrlOf, encodePath, moduleNotFound };
