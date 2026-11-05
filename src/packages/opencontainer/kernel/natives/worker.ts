import type { Binding } from './index';

/** internalBinding('worker') — S1: main-thread-only stubs. */
export function makeWorkerBinding(): Binding {
  return {
    isMainThread: true,
    messaging: null,
    getMsgChannel() { return null; },
    postMessage() { throw new Error('worker_threads is not yet supported in OpenContainer (S5)'); },
    parentPort: null,
    threadId: 0,
    resourceLimits: null,
    markAsUntransferable() {},
    moveMessagePortToContext() { throw new Error('unsupported'); },
    getHeapStatistics() { return { totalHeapSize: 0, usedHeapSize: 0, totalExternalSize: 0, totalAvailableSize: 0 }; },
    takeHeapSnapshot() { throw new Error('unsupported'); },
  };
}
