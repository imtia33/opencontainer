/**
 * OpenContainer Kernel — Builtin module loading via node's OWN realm loader.
 *
 * internal/bootstrap/realm.js is loaded first with a special wrapper (it
 * defines internalBinding itself). Its `BuiltinModule` class then becomes the
 * loader for every other builtin — exactly node's design:
 *
 *   require(id) → realmExports.require(id)            (realm's requireBuiltin)
 *               → BuiltinModule.map.get(id)
 *               → mod.compileForInternalLoader()
 *               → binding('builtins').compileFunction(id)   (wired to our store)
 *               → fn(exports, require, module, process, internalBinding, primordials)
 *
 * Single-instance caching comes free via BuiltinModule.map.
 */

import { resolveModuleFile } from './id-map';

/** Synchronous access to vendored sources (must be pre-populated). */
export interface SourceStore {
  get(path: string): string;
  /** Optional: list vendored file paths under a prefix (package mounting). */
  list?(prefix: string): string[];
}

export interface KernelRuntime {
  process: any;
  internalBinding(name: string): any;
  primordials: Record<string, any>;
  global: typeof globalThis;
}

const REALM_ID = 'internal/bootstrap/realm';

export class ModuleRegistry {
  private realmExports: any = null;
  /** Per-instance realm state — a second bootKernel in the same JS realm
   *  (harness multi-process flows, tests) must load ITS OWN realm, never
   *  silently reuse the previous kernel's module cache: realm module state
   *  (is_main_thread stdio, ESM loader conditions) is per-process. */
  private _realmLoaded = false;

  constructor(
    private store: SourceStore,
    private rt: KernelRuntime,
  ) {
    // Provide the compiler to realm's BuiltinModule system BEFORE realm loads.
    const g = globalThis as any;
    if (typeof g.__ocWireBuiltinCompile === 'function') {
      g.__ocWireBuiltinCompile(resolveModuleFile, (file: string) => this.store.get(file));
    }
  }

  /** The require() available to builtin modules (pre-realm: realm itself only). */
  readonly require = (id: string): any => {
    if (id === REALM_ID && !this._realmLoaded) {
      this.loadRealm();
    }
    // After realm boots, EVERY builtin require routes through realm's own
    // requireBuiltin (captured via binding('builtins').setInternalLoaders).
    if (this._realmLoaded) {
      const realmRequire = (globalThis as any).__ocRealmRequire;
      if (typeof realmRequire === 'function') {
        return realmRequire(id);
      }
    }
    throw new Error(`OpenContainer: cannot require '${id}' before the realm bootstrap is loaded`);
  };

  has(id: string): boolean {
    return resolveModuleFile(id) !== null;
  }

  get(id: string): any {
    return this.require(id);
  }

  private loadRealm(): void {
    const file = resolveModuleFile(REALM_ID)!;
    const source = this.store.get(file);
    // realm.js is compiled WITHOUT the internalBinding param — it defines
    // internalBinding() itself from the context global getInternalBinding.
    const fn = new Function(
      'exports', 'require', 'module', 'process',
      `'use strict';\n${source}\n//# sourceURL=opencontainer://${REALM_ID}`,
    ) as any;

    const mod = { id: REALM_ID, exports: {}, loaded: false };
    fn(mod.exports, this.require, mod, this.rt.process);
    mod.loaded = true;

    // Use realm's internalBinding for all subsequently compiled modules.
    const realmRequire = (globalThis as any).__ocRealmRequire;
    if (realmRequire) {
      const loaderExports = realmRequire(REALM_ID);
      if (typeof loaderExports.internalBinding === 'function') {
        this.rt.internalBinding = loaderExports.internalBinding;
      }
    }
    this._realmLoaded = true;
  }
}

/**
 * Loads primordials.js — the one builtin whose source references `primordials`
 * as an injected free variable BEFORE it is populated.
 */
export function loadPrimordials(store: SourceStore): Record<string, any> {
  const file = resolveModuleFile('internal/per_context/primordials')!;
  const source = store.get(file);
  const primordials: Record<string, any> = Object.create(null);
  const fn = new Function('primordials', `'use strict';\n${source}\n//# sourceURL=opencontainer://internal/per_context/primordials.js`);
  fn(primordials);
  return primordials;
}
