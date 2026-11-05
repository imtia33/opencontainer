import type { Binding, NativesContext } from './index';

/**
 * internalBinding('options') — getOptionValue for execArgv-ish options.
 * The kernel seeds options like --eval, --print when emulating `node -e`.
 */
export function makeOptionsBinding(ctx: NativesContext): Binding {
  const defaults: Record<string, any> = {
    '--eval': '',
    '--print': false,
    '--input-type': undefined,
    '--interactive': false,
    '--inspect': false,
    '--inspect-brk': false,
    '--experimental-strip-types': true,
    '--strip-types': true,
    '--experimental-transform-types': false,
    '--import': [],
    '--experimental-loader': [],
    '--experimental-network-imports': false,
    '--no-experimental-global-webcrypto': false,
    '--no-experimental-global-navigator': false,
    '--frozen-intrinsics': false,
    '--redirect-warnings': undefined,
    '--stack-trace-limit': 10,
    '--perf-basic-prof': false,
    '--title': 'node',
    '--conditions': [],
    '--experimental-require-module': true,
    '--experimental-default-type': undefined,
    // v26 defaults (verified against vendored lib consumers):
    '--experimental-repl-await': true,
    '--experimental-detect-module': true,
    // node v26 default: require(esm) is UNFLAGGED (v23+) — true. The engine
    // face (C++ ModuleWrap sync instantiate) cannot exist in a browser, so
    // the kernel implements require(esm) as an acorn ESM→CJS transform at
    // the Module._compile seam (kernel/esm-to-cjs.ts + boot.ts wiring).
    // Snapshot semantics + other divergences documented in COMPATIBILITY.md.
    '--require-module': true,
    '--experimental-vm-modules': false,
    '--warnings': true,
    '--enable-source-maps': false,
    '--dns-result-order': '',
    '--vfs-load': '',
    '--unhandled-rejections': 'throw',
    '--user-agent': 'node',
    '--heapsnapshot-signal': '',
    '--preserve-symlinks': false,
    '--preserve-symlinks-main': false,
    '--no-addons': false,
    '--entry-url': false,
    '[has_eval_string]': false,
    '[no_force_repl]': false,
    '[has_inspector]': false,
  };

  return {
    getOptionValue(opt: string): any {
      if (ctx.options.has(opt)) return ctx.options.get(opt);
      return defaults[opt] ?? undefined;
    },
    getCLIOptionsInfo() { return {}; },
    getCLIOptionsValues() {
      // Merge defaults with seeded runtime options — only option values that
      // behave as plain values (not arrays) are exposed here.
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(defaults)) {
        if (Array.isArray(v)) out[k] = [];
        else out[k] = v;
      }
      for (const [k, v] of ctx.options.entries()) {
        out[k] = v;
      }
      return out;
    },
    getCLIOptionsValuesWithSource() { return {}; },
    getOptionsAsFlags() { return []; },
    getEnvOptionsInputType() { return 'no-options'; },
    getNamespaceOptionsInputType() { return 'no-options'; },
    parseNodeOptionsEnvVar() { return { value: '', warnings: [] }; },
    getEmbedderOptions() {
      return {
        shouldNotRegisterESMLoader: false,
        globalServicing: false,
        shouldExitOnUncaughtException: false,
        noGlobalSearchPaths: false,
        compileSnapshotAsMainModule: false,
        hasInspector: false,
        hasEmbedderPreload: false,
        noBrowserGlobals: false,
      };
    },
    getOptionValueFromString: undefined,
    getOptions() { return { options: {} }; },
    shouldNotRegisterESMLoader: false,
  };
}
