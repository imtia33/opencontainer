import type { Binding, NativesContext } from './index';
import type { Vfs } from '../vfs';

/**
 * internalBinding('modules') — module compile helpers + the package.json
 * natives the CJS/ESM loaders call for resolution (helpers.js
 * nativeLoaderMethods → here).
 *
 * Tuple contract (package_json_reader.js deserializePackageJSON):
 *   [name, main, type, plainImports, plainExports, optionalFilePath]
 *   plainImports/plainExports: null when absent, else a string (plain or
 *   stringified JSON — starts with '[' or '{' triggers JSONParse).
 *   undefined return = "no package.json / cannot read".
 */

type PkgTuple = [string | undefined, string | undefined, string | undefined, string | null, string | null, string | undefined] | undefined;

function tupleFrom(jsonPath: string, text: string): PkgTuple {
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Malformed package.json: node's native treats it as not-readable → undefined
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  const name = typeof parsed.name === 'string' ? parsed.name : undefined;
  const main = typeof parsed.main === 'string' ? parsed.main : undefined;
  const type = parsed.type === 'module' || parsed.type === 'commonjs' ? parsed.type : undefined;
  const plainImports =
    parsed.imports === undefined || parsed.imports === null
      ? null
      : typeof parsed.imports === 'string' ? parsed.imports : JSON.stringify(parsed.imports);
  const plainExports =
    parsed.exports === undefined || parsed.exports === null
      ? null
      : typeof parsed.exports === 'string' ? parsed.exports : JSON.stringify(parsed.exports);
  return [name, main, type, plainImports, plainExports, jsonPath];
}

export function makeModulesBinding(ctx: NativesContext): Binding {
  const vfs: Vfs = ctx.vfs;

  /** dirname that never returns '' (node's path.dirname('/') is '/', ours too). */
  function dirOf(p: string): string {
    const norm = vfs.normalize(p);
    const i = norm.lastIndexOf('/');
    if (i <= 0) return '/';
    return norm.slice(0, i);
  }

  /** Walk from `startDir` up to '/' looking for package.json. Returns tuple. */
  function walkNearest(startDir: string): { dir: string | null; tuple: PkgTuple } {
    let dir = vfs.normalize(startDir);
    // Guard against pathological loops on weird normalizations.
    for (let hops = 0; hops < 128; hops++) {
      const candidate = dir === '/' ? '/package.json' : `${dir}/package.json`;
      if (vfs.exists(candidate)) {
        try {
          const text = vfs.readTextFile(candidate);
          const tuple = tupleFrom(candidate, text);
          if (tuple !== undefined) return { dir, tuple };
        } catch { /* unreadable → keep walking like node */ }
      }
      if (dir === '/') break;
      const parent = dirOf(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return { dir: null, tuple: undefined };
  }

  const scopeCache = new Map<string, { dir: string | null; tuple: PkgTuple }>();

  function nearestFor(checkPath: string): { dir: string | null; tuple: PkgTuple } {
    const norm = vfs.normalize(checkPath);
    // Traversal starts at the path itself if it is a directory, else its dir.
    const start = vfs.isDirectory(norm) ? norm : dirOf(norm);
    const key = start;
    let hit = scopeCache.get(key);
    if (hit === undefined) {
      hit = walkNearest(start);
      scopeCache.set(key, hit);
    }
    return hit;
  }

  return {
    // ---- compile-cache API (disabled in browser) ----
    enableCompileCache: () => ({ enabled: false, status: 2, message: '', directory: '' }),
    getCompileCacheDir: () => '',
    compileCacheStatus: ['ENABLED', 'FAILED', 'DISABLED'],
    flushCompileCache: () => {},

    kEmbedder: 1,
    kInternal: 2,
    kUser: 3,
    kESMSource: Symbol('nodejs.module.esm_source'),
    kRequiredModule: Symbol('nodejs.module.required_module'),
    kIsExecuting: Symbol('nodejs.module.is_executing'),
    kURL: Symbol('nodejs.module.url'),
    kModuleSource: Symbol('nodejs.module.source'),
    kModuleExport: Symbol('nodejs.module.export'),
    kModuleExportNames: Symbol('nodejs.module.export_names'),
    kModuleCircularVisited: Symbol('nodejs.module.circular_visited'),
    kFormat: Symbol('nodejs.module.format'),

    cachedCodeTypes: {
      kCommonJS: 0,
      kESM: 1,
      kStrippedTypeScript: 2,
    },
    getCompileCacheEntry() { return undefined; },
    saveCompileCacheEntry() {},

    compileFunction(options: any) { return undefined; },
    stripShebang: (shebang: string) => shebang.replace(/^#!.*/, (m) => ' '.repeat(m.length)),
    moduleSourceMapInfo() { return undefined; },
    source_map_cache_() { return undefined; },
    sourceTextModuleRundown: undefined,

    // ---- package.json natives (helpers.js loaderMethods) ----
    readPackageJSON(jsonPath: string, _isESM?: boolean, _base?: string, _specifier?: string): PkgTuple {
      try {
        const text = vfs.readTextFile(vfs.normalize(jsonPath));
        return tupleFrom(vfs.normalize(jsonPath), text);
      } catch {
        return undefined;
      }
    },

    getNearestParentPackageJSON(checkPath: string): PkgTuple {
      return nearestFor(checkPath).tuple;
    },

    getNearestParentPackageJSONType(checkPath: string): string | undefined {
      const { tuple } = nearestFor(checkPath);
      return tuple?.[2];
    },

    getPackageScopeConfig(resolved: string): PkgTuple | string {
      const norm = vfs.normalize(String(resolved).replace(/^file:\/\//, ''));
      const { dir, tuple } = nearestFor(norm);
      if (dir === null) {
        // No package.json above: node returns the root marker path.
        return '/package.json';
      }
      return tuple;
    },

    getPackageType(url: string): string | undefined {
      const norm = vfs.normalize(String(url).replace(/^file:\/\//, ''));
      return nearestFor(norm).tuple?.[2];
    },

    parsePackageJSON(_jsonPath: string, _isESM?: boolean, _base?: string, _specifier?: string): PkgTuple {
      // node uses this for --experimental-json-modules edge paths; alias of read.
      return undefined;
    },

    moduleFormats: {
      commonjs: { source: 'module' },
    },
  };
}
