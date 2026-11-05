import type { Binding } from './index';
import { EmuPort, EmuMessageChannel } from './messaging-ports';

/**
 * Grab-bag of small bindings used lazily by lib internals. Values chosen so
 * the code paths take browser-appropriate branches; unknown property access
 * still surfaces loudly via the Natives proxy for our porting loop.
 */
export function makeMiscBindings(): Record<string, Binding> {
  return {
    diagnostics_channel: (() => {
      const subscribers: any[] = [];
      const channels = new Map<string, any>();
      return {
        channelCount: 0,
        subscribers,
        channel(name: string) {
          let c = channels.get(name);
          if (!c) { c = { name, _subscribers: [] }; channels.set(name, c); }
          return c;
        },
        hasSubscribers(name: string) { return channels.has(name); },
        subscribe(name: string, onMessage: any) {
          const c = this.channel(name);
          c._subscribers.push(onMessage);
        },
        unsubscribe(name: string, onMessage: any) {
          const c = this.channel(name);
          c._subscribers = c._subscribers.filter((s: any) => s !== onMessage);
        },
        linkNativeChannel(link: (name: string, index: number) => any) {
          // In node this links JS channels to the C++ channel table; our
          // channels are pure JS — the linker can run against our channel().
          return (name: string, index: number) => {
            const linked = this.channel(name);
            (linked as any)._index = index;
            subscribers[index] = (linked as any)._subscribers?.length ?? 0;
            return linked;
          };
        },
      };
    })(),
    async_context_frame: {
      currentAsyncFrame() { return null; },
      captureAsyncFrame(fn: any) { return fn; },
      setAsyncFrame() {},
      kAsyncContextFrame: Symbol('nodejs.async_context_frame'),
    },
    async_wrap: (() => {
      const async_hook_fields = new Uint32Array(8);
      const async_id_fields = new Float64Array(8);
      const async_ids_stack = new Float64Array(32);
      const execution_async_resources: any[] = [];
      let stackTop = 0;
      return {
        async_hook_fields,
        async_id_fields,
        async_ids_stack,
        execution_async_resources,
        setCallbackTrampoline() {},
        setupHooks(hooks: any) { void hooks; },
        pushAsyncContext(executionAsyncId: number, triggerAsyncId: number) {
          stackTop += 2;
          if (stackTop >= async_ids_stack.length) return false;
          async_ids_stack[stackTop - 2] = executionAsyncId;
          async_ids_stack[stackTop - 1] = triggerAsyncId;
          return true;
        },
        popAsyncContext(executionAsyncId: number) {
          if (async_ids_stack[stackTop - 2] === executionAsyncId) { stackTop -= 2; return true; }
          return false;
        },
        clearAsyncIdStack() { stackTop = 0; },
        /** async_hooks.js: JS fallback path when kUsesExecutionAsyncResource. */
        executionAsyncResource() {
          return execution_async_resources[execution_async_resources.length - 1] ??
            Object.create(null);
        },
        constants: {
          kInit: 0, kBefore: 1, kAfter: 2, kDestroy: 3,
          kTotals: 4, kPromiseResolve: 5, kCheck: 6,
          kExecutionAsyncId: 0, kAsyncIdCounter: 1, kTriggerAsyncId: 2,
          kDefaultTriggerAsyncId: 3, kStackLength: 4, kUsesExecutionAsyncResource: 5,
        },
        registerDestroyHook(resource: any, asyncId: number) {},
        queueDestroyAsyncId(asyncId: number) {},
        destroyIdsInList() {},
        emitBeforeNative(asyncId: number) {},
        emitAfterNative(asyncId: number) {},
        emitInitNative(asyncId: number, type: string, triggerAsyncId: number, resource: any) {},
        emitDestroyNative(asyncId: number) {},
        enableHooks() {},
        disableHooks() {},
        resetDefaultTriggerAsyncId() {},
        setDefaultTriggerAsyncId(id: number) {},
        /** internal/promise_hooks.js — host-level promise hook installer.
         * Browsers have no promise-hook natives; the JS hook lists still run
         * for explicitly tracked hooks (AsyncLocalStorage context propagation
         * across `await` is a documented divergence — see COMPATIBILITY.md). */
        setPromiseHooks(init: any, before: any, after: any, settled: any) {
          void init; void before; void after; void settled;
        },
        Providers: { NONE: 0, DIRHANDLE: 1, PIPE: 2, PROCESS: 3, SIGNAL: 4, TCP: 5, TTY: 6, UDP: 7, FILELOAD: 8, FSREQ: 9, STATS: 10, CRYPTO: 11 },
      };
    })(),
    blob: {
      createBlob: () => null,
      BlobDataHandle: class {},
    },
    sea: {
      isSea: false,
      getSeaAssetOrAssetSync() { throw Object.assign(new Error('not in a sea executable'), { code: 'ERR_NOT_IN_SEA' }); },
      getRawAssetKeys: () => [],
    },
    inspector: {
      callAndPauseOnStart() {},
      enabled: false,
      registerAsyncHook() {},
      asyncTaskCanceled() {},
      asyncTaskFinished() {},
      asyncTaskScheduled() { return 0; },
      asyncTaskStarted() {},
      console: {},
      consoleCall() {},
      emitProtocolEvent() {},
      isEnabled: () => false,
      open() { throw new Error('inspector is not supported in OpenContainer'); },
      url: undefined,
      waitForDebugger() {},
      Connection: class Connection {},
      MainThreadConnection: class MainThreadConnection {},
      setupNetworkTracking() {},
      putNetworkResource() {},
      setConsoleExtensionInstaller() {},
    },
    profiler: {
      startProfiler: undefined,
      stopProfiler: undefined,
    },
    trace_events: (() => {
      // node's trace_categories: a byte buffer per category index. Tracing is
      // disabled in the browser — all categories stay 0.
      const categoryBuffer = new Uint8Array(32);
      class CategorySet {
        constructor(public categories: any[] = []) {}
        enable() { /* tracing disabled in browser */ }
        disable() {}
      }
      return {
        traceEventEnabled: false,
        emit: () => {},
        trace: () => {},
        hasAgent: () => false,
        usePerfetto: false,
        isTraceCategoryEnabled: (_category: string) => false,
        getEnabledCategories: () => '',
        CategorySet,
        getCategoryEnabledBuffer(_category: string): Uint8Array {
          // Return a persistent zeroed slice per category — always disabled.
          return categoryBuffer;
        },
        setTraceCategoryStateUpdateHandler() {},
      };
    })(),
    messaging: (() => {
      // internal/worker/io.js (worker_threads) destructures MessagePort,
      // MessageChannel, broadcastChannel, drainMessagePort,
      // moveMessagePortToContext, receiveMessageOnPort and stopMessagePort at
      // LOAD time. EmuPort/EmuMessageChannel are the kernel's in-process
      // ports (linked event emitters) — also the transport underneath the
      // in-process worker_threads implementation (natives/worker.ts). They
      // tolerate io.js's PROTOTYPE SURGERY (re-parenting onto NodeEventTarget
      // + descriptor copying) because every method is an own prototype
      // property; unlike the earlier browser-class stand-ins they also give
      // port1.on('message') — which the vendored Worker class requires.
      return {
      DOMException: (globalThis as any).DOMException ?? class DOMException extends Error { constructor(msg: string, name?: string) { super(msg); this.name = name ?? 'DOMException'; } },
      kTransfer: Symbol('nodejs.messaging.transfer'),
      kClone: Symbol('nodejs.messaging.clone'),
      kDeserialize: Symbol('nodejs.messaging.deserialize'),
      kTransferHelper: Symbol('nodejs.messaging.transfer_helper'),
      kCloneHelper: Symbol('nodejs.messaging.clone_helper'),
      kDeserializeHelper: Symbol('nodejs.messaging.deserialize_helper'),
      kMessageChannel: Symbol('nodejs.messaging.message_channel'),
      kInspect: Symbol('nodejs.messaging.inspect'),
      kToArrayBuffer: Symbol('nodejs.messaging.to_array_buffer'),
      kIsDetached: Symbol('nodejs.messaging.is_detached'),
      kUntransferable: Symbol('nodejs.messaging.untransferable'),
      kDeserializePrimitive: Symbol('nodejs.messaging.deserialize_primitive'),
        MessagePort: EmuPort,
        MessageChannel: EmuMessageChannel,
        broadcastChannel: (globalThis as any).BroadcastChannel ?? class {},
        drainMessagePort() {},
        stopMessagePort() {},
        moveMessagePortToContext() {
          throw new Error('OpenContainer: worker_threads context move is not supported');
        },
        receiveMessageOnPort() {
          throw new Error('OpenContainer: synchronous receiveMessageOnPort() is not supported (browser MessagePort has no synchronous read)');
        },
      };
    })(),
    js_stream: {
      JSStream: class JSStream {},
    },
    serdes: {
      Serializer: class {},
      Deserializer: class {},
    },
    ipc_serdes: {},
    // pipe_wrap, tcp_wrap, process_wrap and http_parser now have REAL
    // implementations (natives/{pipe_wrap,tcp_wrap,process_wrap,http_parser}.ts)
    // — registered before this grab-bag runs, so no stubs here.
    spawn_sync: {
      // Synchronous child execution cannot exist inside one JS turn — the
      // honest ENOSYS reaches execFileSync/execSync callers directly.
      spawn(_options: any) {
        const err: any = new Error(
          'OpenContainer: child_process sync execution (execSync/execFileSync/spawnSync) ' +
          'is not supported — async spawn/execFile work');
        err.code = 'ENOSYS';
        throw err;
      },
    },
    signal_wrap: {
      // JS-only signal emulation: "start" arms nothing (signals are delivered
      // by the host/tty bridge); stop/close are symmetric no-ops.
      Signal: class Signal {
        start() { return 0; }
        stop() { return 0; }
        close() {}
        ref() {}
        unref() {}
      },
    },
    udp_wrap: {
      // dgram loads in the module graph (child_process → cluster → dgram);
      // socket CREATION fails honestly at bind/send time — no fake UDP.
      UDP: class UDP {
        constructor() {
          throw new Error('OpenContainer: UDP sockets (dgram) are not supported — TCP virtual sockets only');
        }
      },
      SendWrap: class {},
      constants: {
        UV_UDP_IPV6ONLY: 1,
        UV_UDP_REUSEADDR: 4,
        UV_UDP_REUSEPORT: 8,
        UV_UDP_MMSG_CHUNK: 128,
        UV_UDP_MMSG_FREE: 256,
        UV_UDP_LRECVCAPACITY: 512,
        UV_UDP_LSENDCAPACITY: 1024,
      },
    },
    cares_wrap: {
      // DNS: HONEST localhost-only resolution. External hostnames fail with
      // ENOTFOUND (a browser worker has no resolver; faking 127.0.0.1 for
      // every host would silently misroute sockets). Registry traffic goes
      // through the real fetch bridge instead.
      //
      // Result contract (dns.js onlookup/onlookupall): oncomplete(err,
      // addresses) with addresses = array of IP STRINGS; the family comes
      // from the request's family hint or isIP(addr).
      getaddrinfo(req: any, hostname: string, family?: number, _hints?: number, _order?: number) {
        const wantV6 = family === 6;
        const local = hostname === 'localhost' || hostname === '127.0.0.1'
          || hostname === '::1' || hostname === '::' || hostname === '0.0.0.0'
          || (hostname === 'localhost' && wantV6);
        queueMicrotask(() => {
          if (local) {
            const ip = wantV6 || hostname === '::1' || hostname === '::' ? '::1' : '127.0.0.1';
            req.oncomplete?.(null, [ip]);
          } else {
            const err: any = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
            err.code = 'ENOTFOUND';
            err.errno = -3008;
            err.syscall = 'getaddrinfo';
            err.hostname = hostname;
            req.oncomplete?.(err);
          }
        });
      },
      cares_getaddrinfo(req: any, hostname: string, family?: number, hints?: number, order?: number) {
        this.getaddrinfo(req, hostname, family, hints, order);
      },
      cares_query: undefined,
      // dns/utils.js ChannelWrap: a resolver channel. Our resolution is
      // JS-only, so the channel carries the timeouts as state and nothing
      // else (queries route through getaddrinfo above).
      ChannelWrap: class ChannelWrap {
        constructor(public timeout: number, public tries: number, public maxTimeout: number) {}
      },
      Channel: class Channel {},
      // dns.js lookup(): the request wrap carries the callback family/hints.
      GetAddrInfoReqWrap: class GetAddrInfoReqWrap {},
      strerror(code: number): string { return `c-ares error ${code}`; },
    },
    tls_wrap: {
      TLSCallbacks: {},
      TLSWrap: class {},
    },
    quic: {},
    wasm_web_api: {
      // node's WebAssembly Web API (instantiateStreaming over fetch Response).
      // Guest code uses the browser's own WebAssembly global directly; this
      // binding only needs to exist for bootstrap/switches/is_main_thread.js
      // (bare reference) and exposed-window-or-worker.js (setImplementation).
      setImplementation(_fn: any): void {},
    },
    dtls: {},
    ffi: {},
    wasi: {},
    webstorage: {
      localStorage: undefined,
      sessionStorage: undefined,
    },
    watchdog: {
      start: () => {},
      stop: () => {},
      TraceSigintWatchdog: class TraceSigintWatchdog {
        start() { return true; }
        stop() { return false; }
      },
    },
    mksnapshot: {
      isBuildingSnapshotBuffer: new Uint8Array([0]),
      setSerializeCallback() {},
      setDeserializeCallback() {},
      setDeserializeMainFunction() {},
      startupSnapshot: {
        namespace: {
          addSerializeCallback() {},
          addDeserializeCallback() {},
          isBuildingSnapshot: () => false,
          addSerializeHooksToEmbedder() {},
        },
        runDeserializeCallbacks() {},
      },
    },
    report: {
      getReport: () => '',
      writeReport: () => '',
      // internal/process/report.js full surface (settings + predicates).
      getCompact: () => false,
      getDirectory: () => '',
      getExcludeEnv: () => '',
      getExcludeNetwork: () => false,
      getFilename: () => '',
      getSignal: () => 'SIGUSR2',
      setCompact(_v: boolean) {},
      setDirectory(_v: string) {},
      setExcludeEnv(_v: string) {},
      setExcludeNetwork(_v: boolean) {},
      setFilename(_v: string) {},
      setReportOnFatalError(_v: boolean) {},
      setReportOnSignal(_v: boolean) {},
      setReportOnUncaughtException(_v: boolean) {},
      setSignal(_v: string) {},
      shouldReportOnFatalError: () => false,
      shouldReportOnSignal: () => false,
      shouldReportOnUncaughtException: () => false,
    },
    permission: { isEnabled: () => false, isEnabledWhenHasNestedLookup: () => false },
    locks: {},
    heap_utils: {},
    internal_only_v8: {},
    sqlite: {
      DatabaseSync: class DatabaseSync { constructor() { throw new Error('node:sqlite is not supported in OpenContainer (S5 candidate via sql.js)'); } },
    },
    icu: {},
    block_list: {
      BlockList: class BlockList { addSubnet() {} addRange() {} addAddress() {} },
    },
  };
}
