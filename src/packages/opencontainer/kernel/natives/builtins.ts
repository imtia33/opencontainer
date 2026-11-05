import type { Binding } from './index';
import { PUBLIC_BUILTINS, INTERNAL_BUILTINS } from '../id-map';
import { resolveModuleFile } from '../id-map';

/** internalBinding('builtins') — the builtin module registry surface. */
export function makeBuiltinsBinding(): Binding {
  const allIds = [...PUBLIC_BUILTINS, ...INTERNAL_BUILTINS];
  return {
    builtinIds: allIds,
    canBeRequiredByUsers: PUBLIC_BUILTINS,
    canBeRequiredWithoutSuffix: PUBLIC_BUILTINS.filter((id) => !id.includes('/')),
    getBuiltinCategories: () => ({ canBeRequiredByUsers: PUBLIC_BUILTINS, cannotBeRequiredByUsers: INTERNAL_BUILTINS }),
    getBuiltinModule(id: string) { return undefined; },
    definedExportNames: () => [],
    // realm.js calls setInternalLoaders(internalBinding, requireBuiltin) —
    // requireBuiltin is realm's own loader (returning loaderExports for its
    // selfId). We capture it as THE require for all builtin modules.
    setInternalLoaders(internalBinding: any, requireBuiltin: any) {
      void internalBinding;
      (globalThis as any).__ocRealmRequire = requireBuiltin;
    },
    compileFunction(id: string) {
      // Audit hook: every builtin compiled through node's own BuiltinModule
      // system is recorded — lets the harness/e2e report real coverage of
      // the vendored tree (how many of the 449 modules actually execute).
      const g = globalThis as any;
      if (!g.__ocLoadedModules) g.__ocLoadedModules = new Set<string>();
      g.__ocLoadedModules.add(id);
      const file = resolveModuleFileForCompile(id);
      if (file === null) {
        const e: any = new Error(`Cannot find module '${id}'`);
        e.code = 'MODULE_NOT_FOUND';
        throw e;
      }
      const src = getSourceForCompile(file);
      if (src === undefined) {
        throw new Error(`OpenContainer: builtins.compileFunction source unavailable for '${id}' (store not wired yet)`);
      }
      return new Function(
        'exports', 'require', 'module', 'process', 'internalBinding', 'primordials',
        `'use strict';\n${src}\n//# sourceURL=opencontainer://${id}`,
      );
    },
  };
}

/** Late-wired by bootKernel: resolves vendored paths for compileFunction. */
let resolveModuleFileForCompile: (id: string) => string | null = () => null;
let getSourceForCompile: (file: string) => string | undefined = () => undefined;

export function wireBuiltinCompile(
  resolve: (id: string) => string | null,
  getSource: (file: string) => string | undefined,
) {
  resolveModuleFileForCompile = resolve;
  getSourceForCompile = getSource;
}
