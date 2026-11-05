import type { Binding } from './index';
import { hostDefinedOptionSymbol, contextifyContextPrivateSymbol } from './shared-symbols';

/**
 * internalBinding('contextify') — the vm/compilation engine.
 *
 * In node this is V8 C++; here the browser's Function constructor does the
 * compilation on the same JIT. This binding is the seam through which ALL
 * user code (CJS modules, `node -e`, vm.Script) gets compiled and executed.
 */

const CJS_PARAMS = ['exports', 'require', 'module', '__filename', '__dirname'];

/**
 * Guest CJS dynamic `import()` routing (P1): node's CJS loader compiles a
 * module whose dynamic import() resolves through the GUEST module system
 * (node ≥ 22 unifies this via importSyncForRequire machinery). A bare
 * `new Function` compiled in the host engine would instead resolve bare
 * specifiers against the HOST's node_modules (verified host leak: npm's
 * display.js got the host's chalk@4 instead of the VFS's chalk@6) or fail
 * outright in the browser worker. We therefore rewrite every
 * statement-position `import(` in CJS sources to the kernel transport shim
 * `__ocShimImport(__dirname, spec)` — boot.ts wires `__ocDynImport` to the
 * real ESM graph importer (resolution, package exports, node_modules walk
 * all guest-side), which also arms a REFED loop handle while in flight.
 */
const DYN_IMPORT_TEST = /(?<![.\w$])import\s*\(/;
const DYN_IMPORT_REWRITE = /(?<![.\w$])import\s*\(/g;

if (typeof (globalThis as any).__ocShimImport !== 'function') {
  (globalThis as any).__ocShimImport = (dir: string, spec: string) => {
    const dyn = (globalThis as any).__ocDynImport;
    if (typeof dyn === 'function') return dyn(dir, spec);
    // No ESM transport wired (a bare harness without esmServing): refuse
    // rather than silently resolving against the HOST's module system —
    // host leakage is a correctness AND security violation.
    return Promise.reject(new Error(
      `OpenContainer: dynamic import(${JSON.stringify(spec)}) from CJS at ${dir} ` +
      `requires the kernel ESM transport (no __ocDynImport wired)`));
  };
}

/**
 * Fast module-syntax detection (node uses the C++ cjs_lexer). We use a
 * statement-position regex scan — good enough for loader module-detection;
 * vendored acorn can replace it if edge cases surface.
 */
function containsModuleSyntaxImpl(content: string): boolean {
  // Strip comments crudely, then look for top-level-ish import/export tokens
  const cleaned = content
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return /(^|[\n;})])\s*(import\s+[\s({'"]|import\s*\.|export\s+(default|{|\*|const|let|var|function|class|async|type|interface|declare|enum|abstract)\b|export\s*{)/.test(cleaned);
}

const contextifiedObjects = new WeakSet<object>();

/** Mirror node's C++ StripShebang + BOM handling (node_contextify.cc):
 *  compiled sources never see `#!/usr/bin/env node` lines. */
function stripBOMAndShebang(content: string): string {
  if (content.charCodeAt(0) === 0xfeff) content = content.slice(1);
  if (content.charCodeAt(0) === 35 /* '#' */) {
    const nl = content.indexOf('\n');
    content = nl === -1 ? '' : content.slice(nl);
  }
  return content;
}

export function makeContextifyBinding(): Binding {
  class ContextifyScript {
    private fn: ((...args: any[]) => any) | null = null;
    private sourceWithMap: string = '';
    sourceMapURL: string | undefined;
    sourceURL: string | undefined;

    constructor(
      code: string,
      filename?: string,
      lineOffset?: number,
      columnOffset?: number,
      cachedData?: any,
      produceCachedData?: boolean,
      parsingContext?: any,
      hostDefinedOptionId?: any,
    ) {
      this.sourceURL = filename;
      // node's C++ Script objects carry host-defined options; we store the
      // id under the shared private symbol so esm/utils.registerModule can
      // find it (see internal/modules/esm/utils.js).
      (this as any)[hostDefinedOptionSymbol] = hostDefinedOptionId;
      const sourcemapMatch = /\/\/[#@]\s*sourceMappingURL=(\S+)/.exec(code);
      this.sourceMapURL = sourcemapMatch?.[1];
      try {
        // node compiles Script sources with SCRIPT completion semantics:
        // `new vm.Script('1+1').runInThisContext() === 2`. Function bodies
        // do not fall off completion values — direct `eval` does, and it
        // executes in the enclosing (sloppy, global-reachable) scope exactly
        // like node's main-context scripts. The source rides inside a JSON
        // string literal so no wrapper bindings leak into the eval scope.
        this.sourceWithMap = `${code}\n//# sourceURL=${filename ?? '<anonymous>'}`;
        this.fn = new Function(
          `return eval(${JSON.stringify(this.sourceWithMap)});`,
        ) as (...args: any[]) => any;
      } catch (err: any) {
        // Match node's error decoration: SyntaxError from compilation carry filename
        if (err instanceof SyntaxError && filename) {
          try { err.message = `${err.message} at ${filename}`; } catch { /* ignore */ }
        }
        throw err;
      }
    }

    runInContext(
      sandbox: any,
      _timeout: number,
      _displayErrors: boolean,
      _breakOnSigint: boolean,
      _breakOnFirstLine: boolean,
    ): any {
      if (!this.fn) throw new Error('Script is not compiled');
      // Sandbox run: direct eval INSIDE the with-block sees the sandbox's
      // properties (vm context semantics — approximation, see COMPATIBILITY.md).
      if (sandbox && typeof sandbox === 'object') {
        const withFn = new Function(
          'sandbox',
          `with (sandbox) { return eval(${JSON.stringify(this.sourceWithMap)}); }`,
        ) as any;
        return withFn(sandbox);
      }
      return this.fn();
    }

    runInThisContext(_options?: any): any {
      return this.runInContext(null, -1, true, false, false);
    }
  }

  return {
    kMakeContexts: Symbol('nodejs.make_contexts'),

    ContextifyScript,

    /** CJS loader fast path: compile with the node module wrapper. */
    compileFunctionForCJSLoader(
      content: string,
      filename: string,
      isSeaMain: boolean,
      shouldDetectModule: boolean,
    ) {
      let source = stripBOMAndShebang(content);
      // Route guest CJS dynamic import() through the kernel's ESM transport
      // (see the __ocShimImport doc above). Only pays the regex when the
      // source actually contains a statement-position import( token.
      if (DYN_IMPORT_TEST.test(source)) {
        source = source.replace(DYN_IMPORT_REWRITE, '__ocShimImport(__dirname, ');
      }
      let fn: any;
      try {
        fn = new Function(
          ...CJS_PARAMS,
          `${source}\n//# sourceURL=${filename}`,
        );
      } catch (err: any) {
        if (err instanceof SyntaxError) {
          try { err.message = `${err.message} at ${filename}`; } catch { /* ignore */ }
        }
        throw err;
      }
      const result: any = { __proto__: null, function: fn, sourceMapURL: undefined, sourceURL: filename };
      if (shouldDetectModule) {
        result.canParseAsESM = containsModuleSyntaxImpl(content);
      }
      return result;
    },

    /** Module syntax detection used by the loader for .js files without package.json type. */
    containsModuleSyntax(content: string, _filename: string): boolean {
      return containsModuleSyntaxImpl(content);
    },

    makeContext(sandbox: object | undefined, options?: any) {
      const ctx: any = { ...((sandbox as object) ?? {}) };
      // internal/vm.js isContext() checks the private-symbol stamp (node's
      // C++ sets it to the context pointer; any defined value works).
      Object.defineProperty(ctx, contextifyContextPrivateSymbol, {
        __proto__: null,
        configurable: true,
        enumerable: false,
        writable: true,
        value: { context: true },
      });
      contextifiedObjects.add(ctx);
      return ctx;
    },
    isContext(sandbox: any) {
      if (contextifiedObjects.has(sandbox)) return true;
      try { return sandbox?.[contextifyContextPrivateSymbol] !== undefined; }
      catch { return false; }
    },

    /** vm.js destructures these at load time (measureMemory modes/executions). */
    constants: {
      measureMemory: {
        mode: { SUMMARY: 0, DETAILED: 1 },
        execution: { DEFAULT: 0, EAGER: 1 },
      },
    },

    /** vm.measureMemory() — browser approximation over performance.memory. */
    measureMemory(_options?: any): Promise<{ total: { jsMemoryEstimate: number; jsMemoryRange: number[] } }> {
      const mem = (globalThis as any).performance?.memory;
      return Promise.resolve({
        total: {
          jsMemoryEstimate: mem?.usedJSHeapSize ?? 0,
          jsMemoryRange: [0, mem?.jsHeapSizeLimit ?? 0],
        },
      });
    },

    /** repl.js installs these around every REPL eval (SIGINT watchdog).
     * No real signals in the browser: report "no pending interrupts" so the
     * REPL never fabricates a phantom SIGINT at eval end. */
    startSigintWatchdog(): boolean { return true; },
    stopSigintWatchdog(): boolean { return false; },

    /** vm.compileFunction — node's POSITIONAL signature (10 args). */
    compileFunction(
      code: string,
      filename?: string,
      lineOffset?: number,
      columnOffset?: number,
      cachedData?: any,
      produceCachedData?: boolean,
      parsingContext?: any,
      contextExtensions?: any[],
      params?: string[],
      hostDefinedOptionId?: any,
    ): any {
      const args = params ?? [];
      let fn: any;
      try {
        fn = new Function(...args, `${code}\n//# sourceURL=${filename ?? '<anonymous>'}`);
      } catch (err: any) {
        if (err instanceof SyntaxError && filename) {
          try { err.message = `${err.message} at ${filename}`; } catch { /* ignore */ }
        }
        throw err;
      }
      if (hostDefinedOptionId !== undefined) {
        try { (fn as any)[hostDefinedOptionSymbol] = hostDefinedOptionId; } catch { /* ignore */ }
      }
      const result: any = {
        __proto__: null,
        function: fn,
        cachedDataProduced: false,
        cachedData: cachedData,
        cachedDataRejected: cachedData !== undefined,
        sourceMapURL: undefined,
        sourceURL: filename,
      };
      return result;
    },

    runInThisContext(code: string, options?: any): any {
      return new ContextifyScript(code, options?.filename).runInThisContext();
    },
    scriptOriginOptions: undefined,
  };
}
