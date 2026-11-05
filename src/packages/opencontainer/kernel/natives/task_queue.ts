import type { Binding, NativesContext } from './index';

/**
 * internalBinding('task_queue') — nextTick/microtask plumbing.
 * The browser runs V8's microtask queue natively; nextTick is drained by
 * lib/internal/process/task_queues.js on top of what we provide here.
 */
export function makeTaskQueueBinding(ctx: NativesContext): Binding {
  const tickInfo = new Float64Array(4); // [0]=index,[1]=length... lib reads indices
  let tickCallback: (() => void) | null = null;
  let promiseRejectCallback: ((event: number, promise: Promise<any>, reason: any) => void) | null = null;

  return {
    tickInfo,
    runMicrotasks() {
      // V8 microtasks drain automatically in the browser between tasks.
    },
    setTickCallback(cb: () => void) { tickCallback = cb; },
    getTickCallback() { return tickCallback; },
    enqueueMicrotask(fn: () => void) {
      // Wrap: node drains the nextTick queue between microtasks; we mirror
      // by draining ticks right after each kernel microtask completes.
      queueMicrotask(() => {
        try {
          fn();
        } finally {
          const drain = (globalThis as any).__ocDrainTicks;
          if (typeof drain === 'function') drain();
        }
      });
    },

    promiseRejectEvents: {
      kPromiseRejectWithNoHandler: 0,
      kPromiseHandlerAddedAfterReject: 1,
      kPromiseResolveAfterResolved: 2,
      kPromiseRejectAfterResolved: 3,
      kPromiseForceAsync: 4,
    },
    setPromiseRejectCallback(cb) { promiseRejectCallback = cb; return promiseRejectCallback; },
    getPromiseRejectCallback() { return promiseRejectCallback; },
  };
}
