import type { Binding } from './index';
import { NODE_VERSION } from '../id-map';

/** internalBinding('config') — build configuration (browser build values). */
export function makeConfigBinding(): Binding {
  return {
    // We are not a node binary built with gcc; expose browser-appropriate values.
    isDebugBuild: false,
    isDebugging: false,
    hasOpenSSL: false,        // node:crypto is provided by our JS binding, not OpenSSL
    hasIntl: false,           // browser Intl exists but internalBinding('icu') is a stub:
                              // hasIntl:true routes inspect/encoding through icu.getStringWidth
                              // which we don't implement — false makes node use its JS fallbacks.
    hasSmallICU: false,
    hasNodeOptions: false,
    hasTracing: false,
    hasInspector: false,
    noAsyncGlobalsChecks: false,
    shouldNotRegisterESMLoader: false,
    shouldAbortOnUncaughtException: false,
    fipsMode: false,
    exposedInternals: [],
    closingAllWorkers: false,
    canUseInspector: false,
    ownsProcessState: true,
    shouldCallNewOnWasmStreaming: (globalThis as any).WebAssembly?.StreamingFunctions !== undefined,
    simd: false,
    zlib: false,
    type: NODE_VERSION, // reported by process.config? node uses this for 'process.release'
    /** node 26 internal/config reads these */
    get hasQuic() { return false; },
    opensslSystemCaPath: '',
  };
}
