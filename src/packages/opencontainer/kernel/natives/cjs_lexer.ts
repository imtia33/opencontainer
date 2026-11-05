import type { Binding } from './index';

/**
 * internalBinding('cjs_lexer') — named-export detection for CJS↔ESM interop.
 *
 * node uses a C++ lexer; we use regex heuristics over the module source.
 * Returns [exportNames: Set<string>, reexports: string[]] like node.
 */
export function makeCjsLexerBinding(): Binding {
  function parse(source: string): [Set<string>, string[]] {
    const exportNames = new Set<string>();
    const reexports: string[] = [];

    // exports.name = ... | module.exports.name = ...
    const memberRe = /(?:^|[\n;])\s*(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g;
    let m: RegExpExecArray | null;
    while ((m = memberRe.exec(source))) exportNames.add(m[1]);

    // module.exports = { a, b: c, ... }
    const objectRe = /(?:^|[\n;])\s*module\.exports\s*=\s*\{([^}]*)\}/g;
    while ((m = objectRe.exec(source))) {
      for (const raw of m[1].split(',')) {
        const part = raw.trim();
        if (!part) continue;
        const simple = /^([A-Za-z_$][\w$]*)\s*:$/.exec(part);
        const renamed = /^([A-Za-z_$][\w$]*)\s*:\s*[A-Za-z_$][\w$]*$/.exec(part);
        const shorthand = /^([A-Za-z_$][\w$]*)$/.exec(part);
        const name = simple?.[1] ?? renamed?.[1] ?? shorthand?.[1];
        if (name) exportNames.add(name);
      }
    }

    // module.exports = require('...') — full reexport
    const reexportRe = /(?:^|[\n;])\s*module\.exports\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((m = reexportRe.exec(source))) reexports.push(m[1]);

    return [exportNames, reexports];
  }

  return {
    parse,
    // detect ESM syntax in CJS sources (loader module detection)
    detectModuleSyntax: (source: string): boolean =>
      /(^|[\n;})])\s*(import\s+[\s({'"]|import\s*\.|export\s+(default|{|\*|const|let|var|function|class|async)\b)/.test(source),
  };
}
