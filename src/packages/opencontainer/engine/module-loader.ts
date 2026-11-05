/**
 * OpenContainer — host-side module resolution & loading.
 *
 * Implements Node's CommonJS/ESM resolution for the virtual filesystem:
 *  - relative / absolute / bare specifiers
 *  - node_modules walk-up
 *  - extensions: .js, .json, .mjs, exact file
 *  - package.json "main"/"browser"/"module" + index.js
 *  - a pragmatic subset of package.json "exports" (dot entry + ./subpath + wildcards)
 *  - ESM sources are transformed to CJS (see transformEsm)
 *
 * The VM-side require() calls __host_load_module(spec, parentDir) and gets
 * a JSON payload describing what to load.
 */
import { VirtualFileSystem, dirname, joinPath, normalizePath } from '../fs';

export interface LoadedModule {
  ok: true;
  filename: string;
  code: string;
  type: 'js' | 'json';
}

export interface LoadError {
  ok: false;
  error: string;
  code: string;
}

export type LoadResult = LoadedModule | LoadError;

const JS_EXTS = ['.js', '.mjs', '.cjs', '.json'];

export class ModuleLoader {
  constructor(private fs: VirtualFileSystem) {}

  load(spec: string, parentDir: string): LoadResult {
    const spec_n = spec.startsWith('node:') ? spec.slice(5) : spec;
    // 1. relative or absolute
    if (spec_n.startsWith('./') || spec_n.startsWith('../') || spec_n === '.' || spec_n === '..' || spec.startsWith('/')) {
      const base = spec.startsWith('/') ? normalizePath(spec) : joinPath(parentDir, spec_n);
      return this.loadAsFileOrDirectory(base);
    }
    // 2. bare specifier → node_modules walk-up
    let dir = parentDir;
    for (;;) {
      const candidate = joinPath(dir, 'node_modules', spec_n);
      const res = this.loadAsFileOrDirectory(candidate);
      if (res.ok) return res;
      if (dir === '/') break;
      dir = dirname(dir);
    }
    return { ok: false, error: `Cannot find module '${spec}'`, code: 'MODULE_NOT_FOUND' };
  }

  private loadAsFileOrDirectory(base: string): LoadResult {
    // exact file (with shebang handling done by caller)
    const direct = this.tryExtensions(base);
    if (direct) return direct;
    // directory with package.json
    const pkgPath = joinPath(base, 'package.json');
    if (this.fs.exists(pkgPath)) {
      try {
        const pkg = JSON.parse(this.fs.readTextFile(pkgPath));
        const entry =
          typeof pkg.browser === 'string' ? pkg.browser
          : typeof pkg.main === 'string' ? pkg.main
          : typeof pkg.module === 'string' ? pkg.module
          : null;
        // exports field (pragmatic subset)
        if (pkg.exports) {
          const dot = pkg.exports['.'] ?? pkg.exports;
          let target = dot;
          if (target && typeof target === 'object') {
            target = target.require ?? target.node ?? target.default;
          }
          if (typeof target === 'string') {
            const res = this.tryExtensions(joinPath(base, target));
            if (res) return res;
          }
        }
        if (entry) {
          const res = this.tryExtensions(joinPath(base, entry)) ?? this.tryExtensions(joinPath(base, entry, 'index.js'));
          if (res) return res;
        }
      } catch {
        /* malformed package.json */
      }
    }
    // directory index
    const idx = this.tryExtensions(joinPath(base, 'index.js')) ?? this.tryExtensions(joinPath(base, 'index.json'));
    if (idx) return idx;
    return { ok: false, error: `Cannot find module '${base}'`, code: 'MODULE_NOT_FOUND' };
  }

  private tryExtensions(p: string): LoadedModule | null {
    // exact
    if (this.fs.exists(p)) {
      const node = this.fs.lookup(p);
      if (node && node.type === 'file') return this.readModule(p);
    }
    for (const ext of JS_EXTS) {
      const withExt = p + ext;
      if (this.fs.exists(withExt)) return this.readModule(withExt);
    }
    return null;
  }

  private readModule(filename: string): LoadedModule | null {
    try {
      const code = this.fs.readTextFile(filename);
      const isJson = filename.endsWith('.json');
      const isEsm = filename.endsWith('.mjs') || (!isJson && this.isEsmByPackage(filename));
      const finalCode = isEsm && !isJson ? transformEsm(code) : stripShebang(code);
      return { ok: true, filename, code: finalCode, type: isJson ? 'json' : 'js' };
    } catch {
      return null;
    }
  }

  private isEsmByPackage(filename: string): boolean {
    // nearest package.json with type: module
    let dir = dirname(filename);
    for (;;) {
      const pkgPath = joinPath(dir, 'package.json');
      if (this.fs.exists(pkgPath)) {
        try {
          const pkg = JSON.parse(this.fs.readTextFile(pkgPath));
          return pkg.type === 'module';
        } catch {
          return false;
        }
      }
      if (dir === '/') return false;
      dir = dirname(dir);
    }
  }
}

function stripShebang(code: string): string {
  if (code.startsWith('#!')) {
    const nl = code.indexOf('\n');
    return nl === -1 ? '' : code.slice(nl + 1);
  }
  return code;
}

/* ---------------------------------------------------------------------- */
/* ESM → CJS transform (pragmatic subset)                                 */
/* ---------------------------------------------------------------------- */

/**
 * Transforms a practical subset of ECMAScript module syntax to a CJS wrapper:
 *  - import default / named / namespace / side-effect / type-less
 *  - export named declarations, export lists, default expressions/functions/classes
 *  - export * from '...'
 *  - dynamic import('...') → Promise of the CJS namespace (interop-wrapped)
 *  - import.meta.url → file:// URL string shim
 *
 * Limitations (documented in COMPATIBILITY.md): no top-level await; export
 * bindings are re-exported via getters captured at module end (covers the
 * overwhelmingly common top-level export patterns).
 */
export function transformEsm(code: string): string {
  const imports: string[] = [];
  const exportsFooter: string[] = [];
  const exportStar: string[] = [];
  let hasDefault = false;
  let out = code;

  // --- import statements ---
  out = out.replace(
    /^\s*import\s+(?:(?:'([^']+)'|"([^"]+)")\s*(?:;?))\s*$/gm,
    (_m, sq, dq) => {
      const spec = sq || dq;
      imports.push(`require(${JSON.stringify(spec)});`);
      return '';
    }
  );

  // import def, { a as b } from 'spec';
  out = out.replace(
    /^\s*import\s+([A-Za-z_$][\w$]*)\s*,\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/gm,
    (_m, def, named, spec) => {
      const lines: string[] = [];
      const v = fresh();
      lines.push(`var ${v} = __ocInterop(require(${JSON.stringify(spec)}));`);
      lines.push(`var ${def} = ${v}.default;`);
      for (const piece of named.split(',')) {
        const t = piece.trim();
        if (!t) continue;
        const asMatch = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(t);
        if (asMatch) {
          lines.push(`var ${asMatch[2]} = ${v}.${asMatch[1]};`);
        } else {
          lines.push(`var ${t} = ${v}.${t};`);
        }
      }
      imports.push(lines.join('\n'));
      return '';
    }
  );

  // import def from 'spec';
  out = out.replace(
    /^\s*import\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]\s*;?\s*$/gm,
    (_m, def, spec) => {
      const v = fresh();
      imports.push(`var ${v} = __ocInterop(require(${JSON.stringify(spec)}));\nvar ${def} = ${v}.default;`);
      return '';
    }
  );

  // import { a, b as c } from 'spec';
  out = out.replace(
    /^\s*import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/gm,
    (_m, named, spec) => {
      const lines: string[] = [];
      const v = fresh();
      lines.push(`var ${v} = __ocInterop(require(${JSON.stringify(spec)}));`);
      for (const piece of named.split(',')) {
        const t = piece.trim();
        if (!t) continue;
        const asMatch = /^([\w$]+)\s+as\s+([\w$]+)$/.exec(t);
        if (asMatch) {
          lines.push(`var ${asMatch[2]} = ${v}.${asMatch[1]};`);
        } else {
          lines.push(`var ${t} = ${v}.${t};`);
        }
      }
      imports.push(lines.join('\n'));
      return '';
    }
  );

  // import * as ns from 'spec';
  out = out.replace(
    /^\s*import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]\s*;?\s*$/gm,
    (_m, ns, spec) => {
      imports.push(`var ${ns} = __ocInterop(require(${JSON.stringify(spec)}));`);
      return '';
    }
  );

  // import type ... (typescript) — strip
  out = out.replace(/^\s*import\s+type\s+[^;]+;?\s*$/gm, '');
  out = out.replace(/^\s*export\s+type\s+[^;]+;?\s*$/gm, '');

  // --- export statements ---

  // export default function name(...) {}
  out = out.replace(
    /^\s*export\s+default\s+function\s+([A-Za-z_$][\w$]*)\s*\(/gm,
    (_m, name) => {
      hasDefault = true;
      exportsFooter.push(`__ocDefine(__exports, 'default', () => ${name});`);
      return `function ${name}(`;
    }
  );

  // export default class Name ...
  out = out.replace(
    /^\s*export\s+default\s+class\s+([A-Za-z_$][\w$]*)\s*(\{|\bextends\b)/gm,
    (_m, name, tail) => {
      hasDefault = true;
      exportsFooter.push(`__ocDefine(__exports, 'default', () => ${name});`);
      return `class ${name} ${tail}`;
    }
  );

  // export default <expression>  (single line to statement end)
  out = out.replace(
    /^\s*export\s+default\s+(?!function\b|class\b)(.+?);?\s*$/gm,
    (_m, expr) => {
      hasDefault = true;
      const v = fresh();
      exportsFooter.push(`var ${v} = ${expr}; __ocDefine(__exports, 'default', () => ${v});`);
      return '';
    }
  );

  // export default anonymous function/class (hoist into named temp)
  out = out.replace(
    /^\s*export\s+default\s+function\s*\(/gm,
    () => {
      hasDefault = true;
      exportsFooter.push(`__ocDefine(__exports, 'default', () => __ocDefaultFn);`);
      return 'function __ocDefaultFn(';
    }
  );

  // export function name / async function
  out = out.replace(
    /^\s*export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    (_m, asyncKw, name) => {
      exportsFooter.push(`__ocDefine(__exports, ${JSON.stringify(name)}, () => ${name});`);
      return `${asyncKw ?? ''}function ${name}`;
    }
  );

  // export class Name
  out = out.replace(
    /^\s*export\s+class\s+([A-Za-z_$][\w$]*)/gm,
    (_m, name) => {
      exportsFooter.push(`__ocDefine(__exports, ${JSON.stringify(name)}, () => ${name});`);
      return `class ${name}`;
    }
  );

  // export const/let/var declarations
  out = out.replace(
    /^\s*export\s+(const|let|var)\s+/gm,
    (_m, kw) => {
      return `${kw} `;
    }
  );
  // record names for the footer by scanning the transformed declarations
  for (const match of code.matchAll(/(?:^|\n)\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    exportsFooter.push(`__ocDefine(__exports, ${JSON.stringify(match[1])}, () => ${match[1]});`);
  }
  for (const match of code.matchAll(/(?:^|\n)\s*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g)) {
    if (!exportsFooter.some((f) => f.includes(`'${match[1]}'`) || f.includes(`"${match[1]}"`))) {
      exportsFooter.push(`__ocDefine(__exports, ${JSON.stringify(match[1])}, () => ${match[1]});`);
    }
  }
  for (const match of code.matchAll(/(?:^|\n)\s*export\s+class\s+([A-Za-z_$][\w$]*)/g)) {
    if (!exportsFooter.some((f) => f.includes(`'${match[1]}'`) || f.includes(`"${match[1]}"`))) {
      exportsFooter.push(`__ocDefine(__exports, ${JSON.stringify(match[1])}, () => ${match[1]});`);
    }
  }

  // export { a, b as c };
  out = out.replace(
    /^\s*export\s*\{([^}]*)\}\s*(?:from\s*['"]([^'"]+)['"]\s*)?;?\s*$/gm,
    (_m, list, fromSpec) => {
      const pairs = list
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
        .map((s: string) => {
          const asMatch = /^([\w$]+)\s+as\s+(default|[\w$]+)$/.exec(s);
          return asMatch ? [asMatch[1], asMatch[2]] : [s, s];
        });
      if (fromSpec) {
        const v = fresh();
        const lines = [`var ${v} = __ocInterop(require(${JSON.stringify(fromSpec)}));`];
        for (const [local, exported] of pairs) {
          if (exported === 'default') {
            lines.push(`__ocDefine(__exports, 'default', () => ${v}.default);`);
          } else {
            lines.push(`__ocDefine(__exports, ${JSON.stringify(exported)}, () => ${v}.${local});`);
          }
        }
        imports.push(lines.join('\n'));
      } else {
        for (const [local, exported] of pairs) {
          exportsFooter.push(`__ocDefine(__exports, ${JSON.stringify(exported)}, () => ${local});`);
        }
      }
      return '';
    }
  );

  // export * from 'spec';
  out = out.replace(
    /^\s*export\s*\*\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/gm,
    (_m, spec) => {
      exportStar.push(`__ocExportStar(__exports, __ocInterop(require(${JSON.stringify(spec)})));`);
      return '';
    }
  );

  // export * as ns from 'spec';
  out = out.replace(
    /^\s*export\s*\*\s+as\s+([A-Za-z_$][\w$]*)\s*from\s*['"]([^'"]+)['"]\s*;?\s*$/gm,
    (_m, ns, spec) => {
      exportsFooter.push(`__ocDefine(__exports, ${JSON.stringify(ns)}, () => __ocInterop(require(${JSON.stringify(spec)})));`);
      return '';
    }
  );

  // dynamic import('...')
  out = out.replace(
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    (_m, spec) => {
      return `Promise.resolve().then(function () { return __ocInterop(require(${JSON.stringify(spec)})); })`;
    }
  );

  // import.meta.url
  out = out.replace(/\bimport\.meta\.url\b/g, '__ocImportMetaUrl');

  const header = imports.length > 0 ? imports.join('\n') + '\n' : '';
  const footer =
    (exportStar.length > 0 ? exportStar.join('\n') + '\n' : '') +
    (exportsFooter.length > 0 ? exportsFooter.join('\n') + '\n' : '');
  const setMeta = 'var __ocImportMetaUrl = __filename ? ("file://" + __filename) : undefined;';

  return `${header}\n${setMeta}\n${out}\n;\n${footer}`;
}

let freshCounter = 0;
function fresh(): string {
  return `__oc_m${freshCounter++}`;
}
