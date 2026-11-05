/**
 * OpenContainer — require(esm) via acorn ESM→CJS transform (P1, Workstream A).
 *
 * Node v26 supports `require()` of ES Modules natively (unflagged): the CJS
 * loader routes format-'module' targets through the cascaded ESM loader's
 * importSyncForRequire, which leans on the C++ ModuleWrap binding to
 * synchronously instantiate + evaluate the module graph.
 *
 * A browser JS engine has NO synchronous module instantiation — `import()`
 * is async, full stop. What we do instead (smallest justified compatibility
 * layer, using node's own vendored acorn):
 *
 *   1. Parse the ESM source with acorn (top-level await allowed).
 *   2. Rewrite ONLY import/export statements (byte-exact surgery on their
 *      ranges — every other statement is preserved verbatim):
 *        - imports become hoisted require() calls + interop bindings,
 *        - exports become Object.defineProperty getters on `exports`
 *          (live for `let`/`var`/function bindings, TDZ-faithful for const),
 *        - `export default` becomes a `default` getter (+ `__esModule`),
 *        - re-exports (`export {x} from`, `export * from`, `export * as`)
 *          become getters over the required source namespace,
 *        - `import.meta` becomes an inline meta object,
 *        - top-level `this` becomes undefined (ESM spec) via an IIFE.
 *   3. The transformed source is compiled through the REAL CJS pipeline
 *      (node's loader + our contextify compile — which also routes any
 *      dynamic `import(` inside it through the kernel ESM transport).
 *
 * Documented divergences from native require(esm) (see COMPATIBILITY.md):
 *   - Snapshot semantics: the require() call evaluates the module body
 *     synchronously; bindings are exposed via getters (close to node's
 *     facade for live `let`/function bindings), but named-import
 *     destructuring yields `undefined` instead of a link-time error when
 *     the export is missing.
 *   - Top-level await: detected during the walk and rejected with
 *     ERR_REQUIRE_ASYNC_MODULE, exactly like node's sync path.
 *   - Circular require(esm): CJS partial-exports semantics (node detects
 *     the cycle and throws ERR_REQUIRE_CYCLE on the sync path).
 *   - `import * as ns` of a transformed ESM module includes `__esModule`.
 */

/** Error thrown for top-level-await modules required synchronously. */
export class RequireAsyncModuleError extends Error {
  code: string;
  constructor(filename: string) {
    super(
      `Top-level await is not available in required ES modules ` +
      `(ESM file ${filename} uses top-level await).`);
    this.code = 'ERR_REQUIRE_ASYNC_MODULE';
    this.name = 'Error';
  }
}

export interface TransformResult {
  code: string;
  /** names exported (for diagnostics) */
  exports: string[];
  hasDefault: boolean;
}

interface AcornNode { type: string; start: number; end: number; [k: string]: any }

const INTEROPHelper = 'const __ocDef = (m) => (m && m.__esModule && "default" in m) ? m.default : m;';

/**
 * Transform one ESM source text to CommonJS.
 * @param source module text (UTF-8)
 * @param filename guest path (for errors + import.meta)
 * @param acorn the vendored acorn module (require('internal/deps/acorn/acorn/dist/acorn'))
 * @param fileUrl file URL string of the module (import.meta.url)
 */
export function transformEsmToCjs(
  source: string,
  filename: string,
  acorn: any,
  fileUrl: string,
): TransformResult {
  let ast: AcornNode;
  try {
    ast = acorn.parse(source, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: false,
      allowHashBang: true,
      locations: false,
      ranges: false,
    }) as AcornNode;
  } catch (err: any) {
    // Syntax errors surface as node-shaped SyntaxError with the filename.
    if (err instanceof SyntaxError) {
      try { err.message = `${err.message} at ${filename}`; } catch { /* keep */ }
    }
    throw err;
  }

  if (hasTopLevelAwait(ast)) {
    throw new RequireAsyncModuleError(filename);
  }

  // ---- classify top-level statements ------------------------------------
  const prelude: string[] = [];      // hoisted require() calls + bindings
  const epilogue: string[] = [];     // export getters
  const removals: Array<{ start: number; end: number; replacement: string }> = [];
  const exportNames: string[] = [];
  let hasDefault = false;
  let modSeq = 0;

  const metaObj =
    `const __ocImportMeta = { url: ${JSON.stringify(fileUrl)}, ` +
    `filename: ${JSON.stringify(filename)}, dirname: ${JSON.stringify(dirOf(filename))} };`;

  const requireModule = (raw: string): string => {
    const v = `__oc_m${modSeq++}`;
    prelude.push(`const ${v} = require(${JSON.stringify(raw)});`);
    return v;
  };

  for (const stmt of ast.body as AcornNode[]) {
    switch (stmt.type) {
      case 'ImportDeclaration': {
        const src = stmt.source.value as string;
        const mvar = requireModule(src);
        for (const spec of stmt.specifiers as AcornNode[]) {
          if (spec.type === 'ImportDefaultSpecifier') {
            prelude.push(`const ${localName(spec.local)} = __ocDef(${mvar});`);
          } else if (spec.type === 'ImportNamespaceSpecifier') {
            prelude.push(`const ${localName(spec.local)} = ${mvar};`);
          } else { // ImportSpecifier
            const imported = spec.imported.type === 'Identifier'
              ? spec.imported.name : JSON.stringify(spec.imported.value);
            prelude.push(
              `const ${localName(spec.local)} = ${mvar}[${imported === 'default' ? '"default"' : JSON.stringify(imported)}];`);
          }
        }
        removals.push({ start: stmt.start, end: stmt.end, replacement: '' });
        break;
      }
      case 'ExportDefaultDeclaration': {
        hasDefault = true;
        const decl = stmt.declaration as AcornNode;
        if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
          // export default function/class [name]() {} — keep the declaration
          // (named or anonymous) and expose it as `default`.
          let text = slice(source, stmt.start, decl.start) +
            slice(source, decl.start, stmt.end);
          // strip the leading `export default `
          text = text.replace(/^export\s+default\s+/, '');
          const name = decl.id?.name;
          removals.push({ start: stmt.start, end: stmt.end, replacement: text });
          epilogue.push(defineGetter('default', name ?? `__ocDefault_${exportNames.length}`));
          if (!name) {
            // anonymous default function/class: give it a stable binding
            const patched = text.replace(
              /^(async\s+)?function\s*\(/, `$1function __ocDefault_${exportNames.length}(`)
              .replace(/^class\s+\{/, `class __ocDefault_${exportNames.length} {`)
              .replace(/^class\s*\{/, `class __ocDefault_${exportNames.length} {`);
            removals[removals.length - 1] = { start: stmt.start, end: stmt.end, replacement: patched };
          }
        } else {
          // export default <expression>
          const exprText = slice(source, decl.start, decl.end);
          const v = `__ocDefault`;
          removals.push({
            start: stmt.start, end: stmt.end,
            replacement: `const ${v} = ${exprText};`,
          });
          epilogue.push(defineGetter('default', v));
        }
        exportNames.push('default');
        break;
      }
      case 'ExportNamedDeclaration': {
        const decl = stmt.declaration as AcornNode | null | undefined;
        const srcNode = stmt.source as AcornNode | null | undefined;
        if (decl) {
          // export const/let/var/function/class ...
          const declText = slice(source, decl.start, decl.end);
          removals.push({ start: stmt.start, end: stmt.end, replacement: declText });
          if (decl.type === 'VariableDeclaration') {
            for (const d of decl.declarations as AcornNode[]) collectPattern(d.id).forEach((n) => {
              exportNames.push(n);
              epilogue.push(defineGetter(n, n));
            });
          } else if (decl.id?.name) {
            exportNames.push(decl.id.name);
            epilogue.push(defineGetter(decl.id.name, decl.id.name));
          }
        } else if (srcNode) {
          // export { a, b as c } from 'x'
          const mvar = requireModule(srcNode.value as string);
          for (const spec of stmt.specifiers as AcornNode[]) {
            const exported = spec.exported.type === 'Identifier'
              ? spec.exported.name : JSON.stringify(spec.exported.value);
            const imported = spec.imported.type === 'Identifier'
              ? spec.imported.name : JSON.stringify(spec.imported.value);
            const acc = imported === 'default' ? `${mvar}["default"]` : `${mvar}[${JSON.stringify(imported)}]`;
            exportNames.push(exported);
            epilogue.push(defineGetterExpr(exported, acc));
          }
          removals.push({ start: stmt.start, end: stmt.end, replacement: '' });
        } else {
          // export { a, b as c }  (local bindings)
          for (const spec of stmt.specifiers as AcornNode[]) {
            const exported = spec.exported.type === 'Identifier'
              ? spec.exported.name : JSON.stringify(spec.exported.value);
            const local = spec.local.name;
            exportNames.push(exported);
            epilogue.push(defineGetter(exported, local));
          }
          removals.push({ start: stmt.start, end: stmt.end, replacement: '' });
        }
        break;
      }
      case 'ExportAllDeclaration': {
        const src = stmt.source.value as string;
        const mvar = requireModule(src);
        if (stmt.exported) {
          // export * as ns from 'x'
          const ns = stmt.exported.type === 'Identifier' ? stmt.exported.name : stmt.exported.value;
          exportNames.push(ns);
          epilogue.push(defineGetterExpr(ns, mvar));
        } else {
          // export * from 'x' — all enumerable keys except default
          prelude.push(
            `for (const __k of Object.keys(${mvar})) { if (__k !== "default" && !(` +
            `Object.prototype.hasOwnProperty.call(exports, __k))) ` +
            `Object.defineProperty(exports, __k, { enumerable: true, ` +
            `configurable: true, get: () => ${mvar}[__k] }); }`);
        }
        removals.push({ start: stmt.start, end: stmt.end, replacement: '' });
        break;
      }
      default:
        break; // keep verbatim
    }
  }

  // ---- rebuild source -----------------------------------------------------
  // Apply removals/replacements back-to-front so offsets stay valid.
  removals.sort((a, b) => b.start - a.start);
  let out = source;
  for (const r of removals) {
    out = out.slice(0, r.start) + r.replacement + out.slice(r.end);
  }

  // import.meta → inline meta object (token-level; import.meta cannot appear
  // inside strings in valid positions we care about in practice).
  if (out.includes('import.meta')) {
    out = out.split('import.meta').join('__ocImportMeta');
  }

  const head =
    '"use strict";\n' +
    `${INTEROPHelper}\n` +
    `${metaObj}\n`;
  const body = prelude.length > 0 ? `\n${prelude.join('\n')}\n` : '';
  const tail = epilogue.length > 0 ? `\n${epilogue.join('\n')}\n` : '';
  const esModuleFlag = hasDefault ? '\nexports.__esModule = true;\n' : '';

  const code =
    head +
    `(function () {\n` +
    body + out +
    tail + esModuleFlag +
    `\n}).call(undefined);\n`;

  return { code, exports: exportNames, hasDefault };
}

// ---------------------------------------------------------------- helpers

function slice(s: string, a: number, b: number): string { return s.slice(a, b); }

function localName(id: AcornNode): string { return id.name as string; }

/** getter on `exports` reading a local binding (live for let/function). */
function defineGetter(exported: string, local: string): string {
  const key = JSON.stringify(exported);
  return `Object.defineProperty(exports, ${key}, { enumerable: true, configurable: true, ` +
    `get: () => ${local} });`;
}

/** getter on `exports` reading an arbitrary expression. */
function defineGetterExpr(exported: string, expr: string): string {
  const key = JSON.stringify(exported);
  return `Object.defineProperty(exports, ${key}, { enumerable: true, configurable: true, ` +
    `get: () => (${expr}) });`;
}

/** names declared by a binding pattern (identifiers + destructuring). */
function collectPattern(node: AcornNode, out: string[] = []): string[] {
  if (!node) return out;
  if (node.type === 'Identifier') out.push(node.name);
  else if (node.type === 'ObjectPattern') {
    for (const p of node.properties as AcornNode[]) {
      collectPattern(p.value as AcornNode, out);
    }
  } else if (node.type === 'ArrayPattern') {
    for (const el of node.elements as AcornNode[]) collectPattern(el as AcornNode, out);
  } else if (node.type === 'AssignmentPattern') {
    collectPattern(node.left as AcornNode, out);
  } else if (node.type === 'RestElement') {
    collectPattern(node.argument as AcornNode, out);
  }
  return out;
}

function dirOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

/** Detect top-level await (outside any function). */
function hasTopLevelAwait(ast: AcornNode): boolean {
  const fnTypes = new Set([
    'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression',
    'ClassDeclaration', 'ClassExpression',
  ]);
  let found = false;
  const visit = (node: any, depth: number): void => {
    if (!node || typeof node !== 'object' || found) return;
    if (typeof node.type !== 'string') {
      // arrays / plain objects of nodes
      if (Array.isArray(node)) { for (const n of node) visit(n, depth); return; }
      for (const k of Object.keys(node)) {
        if (k === 'type' || k.startsWith('_')) continue;
        visit(node[k], depth);
      }
      return;
    }
    if (node.type === 'AwaitExpression') { found = true; return; }
    if (node.type === 'ForOfStatement' && node.await) { found = true; return; }
    const enterFn = fnTypes.has(node.type);
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range' || k.startsWith('_')) continue;
      const v = (node as any)[k];
      if (v && typeof v === 'object') visit(v, enterFn ? depth + 1 : depth);
    }
  };
  // Only the module top-level scope counts: statements directly in body, and
  // everything below EXCEPT nested function bodies.
  for (const stmt of ast.body as AcornNode[]) {
    if (found) break;
    visitTopLevel(stmt);
  }
  function visitTopLevel(node: any): void {
    if (!node || typeof node !== 'object' || found) return;
    if (typeof node.type !== 'string') {
      if (Array.isArray(node)) { for (const n of node) visitTopLevel(n); return; }
      for (const k of Object.keys(node)) { if (k !== 'type') visitTopLevel(node[k]); }
      return;
    }
    if (node.type === 'AwaitExpression') { found = true; return; }
    if (node.type === 'ForOfStatement' && node.await) { found = true; return; }
    if (fnTypes.has(node.type)) return; // stop at function boundaries
    for (const k of Object.keys(node)) {
      if (k === 'type' || k === 'start' || k === 'end' || k === 'loc' || k === 'range') continue;
      const v = (node as any)[k];
      if (v && typeof v === 'object') visitTopLevel(v);
    }
  }
  void visit;
  return found;
}
