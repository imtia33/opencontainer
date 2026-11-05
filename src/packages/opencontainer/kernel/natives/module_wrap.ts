import type { Binding } from './index';

/** internalBinding('module_wrap') — ESM machinery symbols + stubs (CJS-first S1). */
export function makeModuleWrapBinding(): Binding {
  // Callback registry: node's C++ stores these and calls them on
  // import()/import.meta evaluation. S5's ModuleWrap will consume them;
  // initializeESM/setImportMetaResolveInitializer need them to exist NOW.
  const callbacks = new WeakMap<object, any>();
  let importModuleDynamicallyCallback: ((...args: any[]) => any) | null = null;
  let initializeImportMetaObjectCallback: ((...args: any[]) => any) | null = null;
  let importMetaResolveInitializer: ((...args: any[]) => any) | null = null;

  return {
    kUninitialized: 0,
    kUninstantiated: 1,
    kInstantiating: 2,
    kInstantiated: 3,
    kEvaluating: 4,
    kEvaluated: 5,
    kErrored: 6,
    // evaluation phases (strings, as in node's module_wrap)
    kSourcePhase: 'source',
    kEvaluationPhase: 'evaluation',
    kDeferPhase: 'defer',

    ModuleWrap: class ModuleWrap {
      constructor(...args: any[]) {
        throw new Error(
          'OpenContainer: native ESM ModuleWrap is not implemented yet (CJS runtime first; ESM lands in S5). ' +
          'If you see this during npm flows, file the command that triggered it.'
        );
      }
    },
    kEvaluatedSymbol: Symbol('nodejs.module.evaluate'),

    createRequiredModuleFacade() {
      throw new Error('OpenContainer: require(esm) facade not implemented yet (S5).');
    },
    registerESMLoader() {},
    compileSourceTextModule() {
      throw new Error('OpenContainer: ESM compile not implemented yet (S5).');
    },
    setPromiseHooks() {},
    callbackMap: callbacks,

    // ---- callback setters consumed by initializeESM / esm loader boot ----
    setImportModuleDynamicallyCallback(cb: ((...args: any[]) => any) | null) {
      importModuleDynamicallyCallback = cb;
    },
    setInitializeImportMetaObjectCallback(cb: ((...args: any[]) => any) | null) {
      initializeImportMetaObjectCallback = cb;
    },
    setImportMetaResolveInitializer(cb: ((...args: any[]) => any) | null) {
      importMetaResolveInitializer = cb;
    },
    getImportModuleDynamicallyCallback() { return importModuleDynamicallyCallback; },
    getInitializeImportMetaObjectCallback() { return initializeImportMetaObjectCallback; },
    getImportMetaResolveInitializer() { return importMetaResolveInitializer; },

    throwIfPromiseRejected(promiseLike: any) {
      if (promiseLike && typeof promiseLike.then === 'function') {
        promiseLike.then(undefined, (err: any) => {
          queueMicrotask(() => { throw err; });
        });
      }
    },
  };
}
