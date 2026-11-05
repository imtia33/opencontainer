import type { Binding } from './index';

/**
 * internalBinding('worker') — IN-PROCESS worker_threads.
 *
 * Real node runs each Worker on a separate thread; browsers cannot spawn
 * threads from a Worker, so OpenContainer runs worker scripts IN-PROCESS:
 * the script is loaded through the kernel's own CJS loader with a swapped
 * `worker_threads` builtin (worker view: parentPort/workerData/isMainThread
 * false), and ports are linked in-process event emitters. Semantics that
 * survive 1:1: message passing (async, ordered), workerData, exit/error/
 * online events, terminate(). Divergence (documented in COMPATIBILITY.md):
 * no parallelism — worker code shares the main thread and event loop, so a
 * busy worker blocks the process, and SharedArrayBuffer/Atomics.wait do not
 * synchronise anything.
 *
 * The vendored lib/worker_threads.js runs UNMODIFIED on top of this binding:
 *   internal/worker.js Worker class  →  WorkerImpl (below)
 *   internal/worker/io.js            →  MessagePort/MessageChannel from the
 *                                       messaging binding (EmuPort, shared
 *                                       with misc.ts via export below)
 */
import { EmuPort, EmuMessageChannel } from './messaging-ports';

/** Serialized form of nothing — boot errors surface as exit(1) (see below). */
const kMainThreadName = 'main';

let nextThreadId = 1;

export function makeWorkerBinding(): Binding {
  const g = globalThis as any;

  /** Active in-process workers by threadId (terminate/exit bookkeeping). */
  const workers = new Map<number, WorkerImpl>();

  class WorkerImpl {
    /** Main-side control port — the vendored Worker wires kOnMessage here. */
    messagePort: EmuPort;
    /** Assigned by internal/worker.js before startThread(). */
    onexit: ((code: number, customErr: string | null, reason: string | null) => void) | null = null;
    readonly threadId: number;
    readonly threadName: string;
    invalidExecArgv: string[] | null = null;
    invalidNodeOptions: string | null = null;
    private threadSide: EmuPort;
    private exited = false;

    constructor(
      _url: string,
      _env: Record<string, string> | null,
      execArgv: string[],
      _resourceLimits: any,
      _trackUnmanagedFds: boolean,
      _isInternal: boolean,
      name?: string,
    ) {
      if (Array.isArray(execArgv) && execArgv.length > 0) {
        this.invalidExecArgv = execArgv;
      }
      this.threadId = nextThreadId++;
      this.threadName = name ?? `WorkerThread-${this.threadId}`;
      const [mainSide, threadSide] = EmuPort.pair();
      this.messagePort = mainSide;
      this.threadSide = threadSide;
      this.threadSide.on('message', (m: any) => this.onControlMessage(m));
      workers.set(this.threadId, this);
    }

    /** The vendored Worker constructor posts LOAD_SCRIPT then calls this. */
    startThread(): void {
      // LOAD_SCRIPT is queued on the thread side (microtask after the
      // constructor returns); onControlMessage performs the in-process boot.
      void 0;
    }

    stopThread(): void {
      this.finish(1);
    }

    ref(): void { /* in-process workers share the main loop — nothing to ref */ }
    unref(): void { /* ditto */ }
    takeHeapSnapshot(): void { /* unsupported */ }

    // ------------------------------------------------------------- internals

    private onControlMessage(msg: any): void {
      if (!msg || msg.type !== 'loadScript') return; // only protocol we speak
      const filename = String(msg.filename ?? '');
      const workerData = (msg as any).workerData;
      const publicPort = (msg as any).publicPort ?? null; // EmuPort (worker side)
      void this.bootScript(filename, workerData, publicPort);
    }

    private async bootScript(filename: string, workerData: any, publicPort: EmuPort | null): Promise<void> {
      // Worker-side public port: deliveries into the script's parentPort
      // handlers run inside the dispatch window (process.exit → worker exit).
      if (publicPort) {
        publicPort.dispatchTrap = (deliver) => {
          const prev = g.__ocWorkerDispatch;
          g.__ocWorkerDispatch = this;
          try { deliver(); } finally { g.__ocWorkerDispatch = prev; }
        };
      }
      // worker view of the `worker_threads` builtin, installed while the
      // script (and only the script) loads. Later requires by main-thread
      // code see the real vendored module again.
      const view = {
        __proto__: null,
        isMainThread: false,
        parentPort: publicPort,
        workerData,
        threadId: this.threadId,
        threadName: this.threadName,
        resourceLimits: null,
        MessagePort: EmuPort,
        MessageChannel: EmuMessageChannel,
        BroadcastChannel: (globalThis as any).BroadcastChannel ?? class BroadcastChannel {},
        markAsUncloneable() {},
        moveMessagePortToContext() { throw new Error('OpenContainer: worker_threads context move is not supported'); },
        receiveMessageOnPort() { throw new Error('OpenContainer: synchronous receiveMessageOnPort() is not supported'); },
        postMessageToThread() { throw new Error('OpenContainer: postMessageToThread is not supported'); },
        SHARE_ENV: Symbol('nodejs.worker_threads.SHARE_ENV'),
        environmentData: new Map(),
        getEnvironmentData(this: any, k: any) { return this.environmentData.get(k); },
        setEnvironmentData(this: any, k: any, v: any) { if (v === undefined) this.environmentData.delete(k); else this.environmentData.set(k, v); },
      };
      (view as any).default = view;
      const restore = swapBuiltin('worker_threads', view);
      // Worker-script dispatch window: process.exit() inside the script's
      // top level or its parentPort handlers means "worker exits", never
      // "the whole process exits" (ownsProcessState semantics).
      g.__ocWorkerDispatch = this;
      try {
        const requireFile = g.__ocRequireFile;
        if (typeof requireFile !== 'function') {
          throw new Error('OpenContainer: kernel file-require hook not wired (worker boot)');
        }
        requireFile(filename);
        this.threadSide.postMessage({ type: 'upAndRunning' });
      } catch (err: any) {
        // Boot failures surface as a non-zero worker exit — the pool's
        // 'exit' handler reports them (node serializes via error_serdes;
        // exit(1) is the observable-compatible subset).
        g.__ocWorkerError = err;
        this.finish(1);
        return;
      } finally {
        g.__ocWorkerDispatch = null;
        restore();
      }
    }

    /** process.exit() from inside the worker dispatch window. */
    workerExit(code: number): void {
      this.finish(code);
    }

    private finish(code: number): void {
      if (this.exited) return;
      this.exited = true;
      workers.delete(this.threadId);
      try { this.threadSide.close(); } catch { /* already closed */ }
      try { this.messagePort.close(); } catch { /* already closed */ }
      try { this.onexit?.(code, null, null); } catch { /* listener crash — nothing more we can do */ }
    }
  }

  /** Swap a builtin module's cached exports (realm's BuiltinModule.map). */
  function swapBuiltin(id: string, exportsObj: any): () => void {
    try {
      const realm = g.__ocRealmRequire?.('internal/bootstrap/realm');
      const bm = realm?.BuiltinModule?.map?.get(id);
      if (!bm) return () => {};
      const saved = { exports: bm.exports, loaded: bm.loaded, loading: bm.loading };
      bm.exports = exportsObj;
      bm.loaded = true;
      bm.loading = false;
      return () => {
        bm.exports = saved.exports;
        bm.loaded = saved.loaded;
        bm.loading = saved.loading;
      };
    } catch {
      return () => {};
    }
  }

  return {
    ownsProcessState: true,
    isMainThread: true,
    isInternalThread: false,
    resourceLimits: null,
    threadId: 0,
    threadName: kMainThreadName,
    Worker: WorkerImpl,
    getEnvMessagePort() { return null; },
    messaging: null,
    getMsgChannel() { return null; },
    postMessage() { throw new Error('OpenContainer: worker-to-thread postMessage is not supported'); },
    parentPort: null,
    markAsUntransferable() {},
    moveMessagePortToContext() { throw new Error('OpenContainer: worker_threads context move is not supported'); },
    kMaxYoungGenerationSizeMb: 16,
    kMaxOldGenerationSizeMb: 4096,
    kCodeRangeSizeMb: 0,
    kStackSizeMb: 4,
    kTotalResourceLimitCount: 0,
    getHeapStatistics() { return { totalHeapSize: 0, usedHeapSize: 0, totalExternalSize: 0, totalAvailableSize: 0 }; },
    takeHeapSnapshot() { throw new Error('unsupported'); },
  };
}
