import type { Binding } from './index';
import { hostDefinedOptionSymbol, contextifyContextPrivateSymbol } from './shared-symbols';

/** internalBinding('util') — misc hidden-value/inspection helpers. */
export function makeUtilBinding(): Binding {
  const hidden = new WeakMap<object, Map<string, any>>();

  const INDEX_RE = /^(?:0|[1-9][0-9]*)$/;
  function isCanonicalIndex(p: string): boolean {
    if (!INDEX_RE.test(p)) return false;
    return p.length < 10 || Number(p) < 2 ** 32 - 1;
  }

  /** execution.js:48 — Int32Array the fatal-exception path toggles. */
  const shouldAbortOnUncaughtToggle = new Int32Array(1);

  const privateSymbols = {
    arrow_message_private_symbol: Symbol('nodejs.util.arrow_message'),
    decorated_private_symbol: Symbol('nodejs.util.decorated'),
    error_context_symbol: Symbol('nodejs.util.error_context'),
    maybe_error_position_symbol: Symbol('nodejs.util.maybe_error_position'),
    no_side_effects_symbol: Symbol('nodejs.util.no_side_effects'),
    host_defined_option_symbol: hostDefinedOptionSymbol,
    contextify_context_private_symbol: contextifyContextPrivateSymbol,
    // loader.js / run_main.js / worker / source-map hidden keys:
    exit_info_private_symbol: Symbol('nodejs.exit_info'),
    entry_point_promise_private_symbol: Symbol('nodejs.entry_point_promise'),
    module_source_private_symbol: Symbol('nodejs.module.module_source'),
    module_export_names_private_symbol: Symbol('nodejs.module.module_export_names'),
    module_circular_visited_private_symbol: Symbol('nodejs.module.module_circular_visited'),
    module_export_private_symbol: Symbol('nodejs.module.module_export'),
    module_first_parent_private_symbol: Symbol('nodejs.module.module_first_parent'),
    module_last_parent_private_symbol: Symbol('nodejs.module.module_last_parent'),
    source_map_data_private_symbol: Symbol('nodejs.source_map_data'),
    transfer_mode_private_symbol: Symbol('nodejs.transfer_mode'),
    untransferable_object_private_symbol: Symbol('nodejs.untransferable_object'),
  };

  return {
    privateSymbols,
    shouldAbortOnUncaughtToggle,

    /**
     * defineLazyProperties(target, id, keys, esm) — node installs lazy getters
     * that require() the module on first property access.
     */
    defineLazyProperties(target: any, id: string, keys: string[], esm?: boolean) {
      const realmRequire = () => (globalThis as any).__ocRealmRequire;
      for (const key of keys) {
        Object.defineProperty(target, key, {
          __proto__: null,
          configurable: true,
          enumerable: true,
          get() {
            const req = realmRequire();
            const mod = req ? req(id) : undefined;
            const value = mod?.[key];
            Object.defineProperty(target, key, {
              __proto__: null,
              configurable: true,
              enumerable: true,
              writable: true,
              value,
            });
            return value;
          },
          set(value) {
            Object.defineProperty(target, key, {
              __proto__: null,
              configurable: true,
              enumerable: true,
              writable: true,
              value,
            });
          },
        });
      }
    },

    constructSharedArrayBuffer(size: number): ArrayBuffer | SharedArrayBuffer {
      try { return new SharedArrayBuffer(size); } catch { return new ArrayBuffer(size); }
    },

    /** debuglog support: is a NODE_DEBUG / NODE_DEBUG_NATIVE category enabled? */
    testEnabled(set: string): boolean {
      try {
        const env = (globalThis as any).__ocEnv?.() ?? {};
        const debug = env.NODE_DEBUG ?? '';
        const debugNative = env.NODE_DEBUG_NATIVE ?? '';
        return new RegExp(`(?:^|,)${set}(?:,|$)`).test(debug) ||
               new RegExp(`(?:^|,)${set}(?:,|$)`).test(debugNative);
      } catch { return false; }
    },

    guessHandleType(fd: number): number {
      // Index into internal/util's handleTypes: 0 TCP, 1 TTY, 2 UDP,
      // 3 FILE, 4 PIPE, 5 UNKNOWN. Stdio fd 0-2 depend on this process's
      // stdio config (tty | pipe | ignore → UNKNOWN → black-hole stream).
      const mode = (globalThis as any).__ocStdio?.[fd];
      if (mode?.type === 'pipe') return 4;
      if (mode?.type === 'ignore') return 5;
      if (mode?.type === 'tty') return 1;
      return fd >= 0 && fd <= 2 ? 1 : 5;
    },

    constants: {
      ALL_PROPERTIES: 0,
      ONLY_WRITABLE: 1,
      ONLY_ENUMERABLE: 2,
      ONLY_CONFIGURABLE: 3,
      SKIP_STRINGS: 4,
      SKIP_SYMBOLS: 5,
      kPending: 0,
      kFulfilled: 1,
      kRejected: 2,
    },

    getOwnNonIndexProperties(obj: object, _filter: number): (string | symbol)[] {
      // node's C++ semantics: array-index string keys are ALWAYS excluded
      // (that's the "NonIndex" in the name); the filter flags then apply to
      // the rest (approximated: we return all non-index props).
      const out: (string | symbol)[] = [];
      try {
        const names = Object.getOwnPropertyNames(obj);
        for (const p of names) {
          if (isCanonicalIndex(p)) continue;
          out.push(p);
        }
        for (const p of Object.getOwnPropertySymbols(obj)) out.push(p);
      } catch { /* foreign object */ }
      return out;
    },

    // Used by internal/inspector_util? and diagnostics: (obj, key) => value | undefined
    getHiddenValue(inst: object, key: string): any {
      return hidden.get(inst)?.get(key);
    },
    setHiddenValue(inst: object, key: string, value: any): boolean {
      if (value === undefined) { hidden.get(inst)?.delete(key); return true; }
      if (!hidden.has(inst)) hidden.set(inst, new Map());
      hidden.get(inst)!.set(key, value);
      return true;
    },
    getProxyDetails(obj: any): [object, object] | undefined {
      try {
        if (obj && typeof obj === 'object' && obj.constructor?.name === 'Proxy...') return undefined;
      } catch {}
      // V8 API: %GetProxyDetails — we can't access without --allow-natives-syntax.
      // node's inspect uses it only when obj is a Proxy; detect heuristically:
      try {
        // A proxy whose handler is revoked throws on any trap
        const desc = Object.getOwnPropertyDescriptor(obj, 'then');
        void desc;
      } catch { return undefined; }
      return undefined;
    },
    getConstructorName(obj: any): string {
      try { return obj?.constructor?.name ?? ''; } catch { return ''; }
    },
    getExternalValue() { return { data: 0, size: 0 }; },
    getPromiseDetails(p: Promise<any>): { 0: number; 1?: any } | undefined {
      // %GetPromiseDetails equivalent — inspect.js destructures
      // {0: state, 1: result}. Approximation: attach a probe via .then.
      if (!p || typeof p.then !== 'function') return undefined;
      // Pending unless we have already observed a settled state.
      const details = promiseDetailsMap.get(p);
      if (details) return details;
      p.then(
        (v) => { promiseDetailsMap.set(p, { 0: 1, 1: v }); },
        (e) => { promiseDetailsMap.set(p, { 0: 2, 1: e }); },
      );
      return { 0: 0 };
    },
    previewEntries(iterator: any): [any[], boolean] | undefined {
      if (!iterator || typeof iterator !== 'object') return undefined;
      // node returns entries for Maps/Sets iterators (inspect.js uses it to
      // render live iterator previews). We safely consume up to 100 items.
      try {
        if (typeof iterator.next !== 'function') return undefined;
        const entries: any[] = [];
        let isKeyValue = false;
        for (let i = 0; i < 100; i++) {
          const r = iterator.next();
          if (r?.done) break;
          const v = r.value;
          if (Array.isArray(v)) { isKeyValue = true; entries.push([v[0], v[1]]); }
          else entries.push(v);
        }
        return [entries, isKeyValue];
      } catch { return undefined; }
    },
    isInsideNodeModules() { return false; },
    getCallSites(_err?: any, _count?: number) { return []; },
    getCallerLocation() { return undefined; },
    markPromiseAsHandled(_p: Promise<any>) {},
    getSharedArrayBufferGrowable(_sab: SharedArrayBuffer) { return false; },
    parseEnv(env: string): Record<string, string> {
      // Minimal env-string parser (used by fs.loadEnvFile / --env-file).
      const out: Record<string, string> = {};
      for (const line of String(env).split('\n')) {
        const m = /^\s*([\w.-]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!m) continue;
        let v = m[2];
        if (
          (v.startsWith('"') && v.endsWith('"')) ||
          (v.startsWith("'") && v.endsWith("'"))
        ) {
          v = v.slice(1, -1);
        }
        out[m[1]] = v;
      }
      return out;
    },
    enqueueDeprecationWarning() {},
    sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    getCwdSafe(): string | undefined {
      try { return (globalThis as any).__ocCwd?.() ?? undefined; } catch { return undefined; }
    },
  };
}

const promiseDetailsMap = new WeakMap<object, any>();
