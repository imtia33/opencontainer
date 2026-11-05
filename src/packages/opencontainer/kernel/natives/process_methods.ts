import type { Binding, NativesContext } from './index';
import { VfsError } from '../vfs';

/** internalBinding('process_methods') — the process syscall surface. */
export function makeProcessMethodsBinding(ctx: NativesContext): Binding {
  // hrtime buffer: 3 x uint32 seconds/nanos + bigint view
  const hrtimeBuffer = new ArrayBuffer(32);
  const u32 = new Uint32Array(hrtimeBuffer);
  const big = new BigUint64Array(hrtimeBuffer, 0, 1);
  const t0 = ctx.hooks.now() * 1e6; // ns

  function fillHrtime() {
    const ns = BigInt(Math.floor(ctx.hooks.now() * 1e6)) - BigInt(Math.floor(t0));
    const sec = Number(ns / 1_000_000_000n);
    const nsec = Number(ns % 1_000_000_000n);
    u32[0] = Math.floor(sec / 2 ** 32);
    u32[1] = sec >>> 0;
    u32[2] = nsec >>> 0;
    big[0] = BigInt(sec) * 1_000_000_000n + BigInt(nsec);
  }

  return {
    hrtimeBuffer,
    hrtime: fillHrtime,
    hrtimeBigInt: fillHrtime,

    exit(code: number) { ctx.hooks.onExit(code); },
    abort() { ctx.hooks.onExit(134); },
    chdir(p: string) {
      try {
        const st = ctx.vfs.stat(p);
        if ((st.mode & 0o170000) !== 0o040000) throw new Error('not dir');
        ctx.chdir(p);
      } catch (e) {
        const err: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, chdir '${p}'`) as any;
        err.code = 'ENOENT'; err.errno = -2; err.syscall = 'chdir'; err.path = p;
        throw err;
      }
    },
    cwd() { return ctx.cwd(); },

    umask(mask?: number) { return 0o022; },

    kill(pid: number, signal: number | string) {
      // S2 process manager will own real kill; for now only self-targeted
      // signals are meaningful.
      const { processManager } = (globalThis as any).__oc ?? {};
      if (processManager?.kill) return processManager.kill(pid, signal);
      return true;
    },

    getpid() { return (globalThis as any).__oc?.processManager?.pid ?? 1; },
    getppid() { return 0; },
    getuid() { return 0; },
    geteuid() { return 0; },
    getgid() { return 0; },
    getegid() { return 0; },
    getgroups() { return [0]; },

    cpuUsage() { return { user: 0, system: 0 }; },
    threadCpuUsage() { return { user: 0, system: 0 }; },
    memoryUsage() {
      const mem = (globalThis as any).performance?.memory;
      return {
        rss: mem ? mem.usedJSHeapSize : 0,
        heapTotal: mem ? mem.totalJSHeapSize : 0,
        heapUsed: mem ? mem.usedJSHeapSize : 0,
        external: 0,
        arrayBuffers: 0,
      };
    },
    resourceUsage() {
      const zero = { ru_utime: 0, ru_stime: 0, ru_maxrss: 0, ru_ixrss: 0, ru_idrss: 0, ru_isrss: 0, ru_minflt: 0, ru_majflt: 0, ru_nswap: 0, ru_inblock: 0, ru_oublock: 0, ru_msgsnd: 0, ru_msgrcv: 0, ru_nsignals: 0, ru_nvcsw: 0, ru_nivcsw: 0 };
      return zero;
    },
    availableMemory() { return 1 << 30; },
    constrainMemory() { return 0; },
    getConstrainedMemory() { return 0; },

    uptime() { return ctx.hooks.now() / 1000; },

    loadEnvFile() { /* no .env file loading from browser FS for now (S2) */ },
    execve() { throw new Error('process.execve is not supported in OpenContainer'); },
    dlopen() {
      const err: any = new Error('Process is missing required native module support in OpenContainer (process.dlopen)');
      err.code = 'ERR_DLOPEN_FAILED';
      throw err;
    },
    _rawDebug(msg: string) { ctx.hooks.onStdio(2, `rawDebug: ${msg}\n`); },
    reallyExit(code: number) { ctx.hooks.onExit(code); },
    setupProcessMethods() {},
    activeRequests() { return 0; },
    activeHandles() { return 0; },
    requestExit() { ctx.hooks.onExit(0); },
    rss() { return (globalThis as any).performance?.memory?.usedJSHeapSize ?? 0; },
    dlopenBinary() { throw new Error('process.dlopenBinary is not supported in OpenContainer'); },
    resetStdioForTesting() {},
    _debugProcess() {},
    _debugEnd() {},
    _kill(pid: number, signal: number | string) { return this.kill(pid, signal); },
    _getActiveRequests() { return []; },
    _getActiveHandles() { return []; },
    getActiveResourcesInfo() { return []; },
    constrainedMemory() { return 0; },

    /** pre_execution.js:338 — C++ installs native data props (node_process_object.cc). */
    patchProcessObject(process: any) {
      let title: string = process.title ?? 'node';
      Object.defineProperty(process, 'title', {
        __proto__: null,
        configurable: true,
        get() { return title; },
        set(v: string) { title = String(v); },
      });
      Object.defineProperty(process, 'argv', {
        __proto__: null,
        configurable: true,
        writable: true,
        value: process.argv,
      });
      Object.defineProperty(process, 'execArgv', {
        __proto__: null,
        configurable: true,
        writable: true,
        value: process.execArgv,
      });
      Object.defineProperty(process, 'pid', {
        __proto__: null,
        configurable: true,
        get: () => (globalThis as any).__oc?.processManager?.pid ?? 1,
      });
      Object.defineProperty(process, 'ppid', {
        __proto__: null,
        configurable: true,
        get: () => 0,
      });
    },

    /** bootstrap/node.js:357 — emitWarning mirror for native-side warnings. */
    setEmitWarningSync(cb: (warning: any, type: string) => void) {
      (globalThis as any).__ocEmitWarningSync = cb;
    },
  };
}
