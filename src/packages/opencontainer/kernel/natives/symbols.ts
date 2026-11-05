import type { Binding } from './index';

/** internalBinding('symbols') — internal symbols shared across modules. */
const registry = new Map<string, symbol>();
function sym(name: string): symbol {
  let s = registry.get(name);
  if (!s) { s = Symbol(name); registry.set(name, s); }
  return s;
}

export function makeSymbolsBinding(): Binding {
  return {
    get async_id_symbol() { return sym('async_id_symbol'); },
    get owner_symbol() { return sym('owner_symbol'); },
    get trigger_async_id_symbol() { return sym('trigger_async_id_symbol'); },
    get resource_symbol() { return sym('resource_symbol'); },
    get handle_wrap_symbol() { return sym('handle_wrap_symbol'); },
    get no_message_symbol() { return sym('no_message_symbol'); },
    get async_context_symbol() { return sym('async_context_symbol'); },
    get kAsyncIdCounter() { return sym('kAsyncIdCounter'); },
    get kDefaultTriggerAsyncId() { return sym('kDefaultTriggerAsyncId'); },
    get kTotals() { return sym('kTotals'); },
    get kBefore() { return sym('kBefore'); },
    get kAfter() { return sym('kAfter'); },
    get kPromiseResolve() { return sym('kPromiseResolve'); },
    get kDestroy() { return sym('kDestroy'); },
    get kExecutionAsyncId() { return sym('kExecutionAsyncId'); },
    get kTriggerAsyncId() { return sym('kTriggerAsyncId'); },
    get kAsyncContextFrame() { return sym('kAsyncContextFrame'); },
    get kImportedModuleDivElement() { return sym('kImportedModuleDivElement'); },
    get kStreamBaseField() { return sym('kStreamBaseField'); },
    get kEmitHasNewMessage() { return sym('kEmitHasNewMessage'); },
    get kMaybeLazyEndReadable() { return sym('kMaybeLazyEndReadable'); },
    get kEnhanceStackBeforeInspector() { return sym('kEnhanceStackBeforeInspector'); },
    get kTypeMapping() { return sym('kTypeMapping'); },
    kHandleClosureQueue: sym('kHandleClosureQueue'),
    kWeakRefTarget: sym('kWeakRefTarget'),

    // vm dynamic-import host-defined option ids (plain integers like node)
    vm_dynamic_import_default_internal: 0,
    vm_dynamic_import_main_context_default: 1,
    vm_dynamic_import_no_callback: 2,
    vm_dynamic_import_missing_flag: 3,

    // vm.js / esm loader symbols (vm.constants.DONT_CONTEXTIFY etc.)
    get vm_context_no_contextify() { return sym('vm_context_no_contextify'); },
    get imported_cjs_symbol() { return sym('imported_cjs_symbol'); },
    get embedder_module_hdo() { return sym('embedder_module_hdo'); },
    get source_text_module_default_hdo() { return sym('source_text_module_default_hdo'); },
    get handle_onclose() { return sym('handle_onclose'); },
    get oninit() { return sym('oninit'); },
  };
}
