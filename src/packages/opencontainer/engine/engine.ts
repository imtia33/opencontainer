/**
 * OpenContainer — Engine bridge.
 *
 * Executes a real JavaScript engine (QuickJS compiled to WebAssembly, via
 * quickjs-emscripten) inside the runtime worker. One isolated QuickJS
 * runtime+context per process, with:
 *  - host functions bridging the VM to the virtual filesystem, networking,
 *    process manager and stdio
 *  - a cooperative event loop (promise jobs + timers + host completions)
 *  - process termination via the QuickJS interrupt handler
 *  - per-process memory limits
 *
 * Engine identity is reported honestly — see version.ts and COMPATIBILITY.md.
 */
import type { QuickJSContext, QuickJSHandle, QuickJSRuntime, QuickJSWASMModule } from 'quickjs-emscripten';
import { newQuickJSWASMModule } from 'quickjs-emscripten/variants';
import SINGLEFILE from '@jitl/quickjs-singlefile-browser-release-sync';
import { VirtualFileSystem, VFSError, normalizePath } from '../fs';
import { ENGINE_IDENTITY } from '../version';
import { ModuleLoader } from './module-loader';

export { SINGLEFILE };

export interface EngineNetBridge {
  /** Register a listening virtual port. Resolves with an error string or null. */
  listen(port: number, engine: EngineProcess): Promise<string | null>;
  close(port: number): void;
  fetch(url: string, init: { method?: string; headers?: Record<string, string>; body?: Uint8Array }): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>;
  wsOpen(url: string, protocols: string[]): number;
  wsSend(id: number, data: string | Uint8Array): void;
  wsClose(id: number): void;
}

export interface EngineProcessOptions {
  pid: number;
  argv: string[];
  cwd: string;
  env: Record<string, string>;
  fs: VirtualFileSystem;
  net: EngineNetBridge;
  onStdout: (data: string) => void;
  onStderr: (data: string) => void;
  onExit: (code: number) => void;
  spawnChild: (command: string, args: string[], options: { cwd?: string; env?: Record<string, string> }) => Promise<{ pid: number | null; error?: string }>;
  childOps: {
    stdinWrite(pid: number, data: string): void;
    kill(pid: number): void;
    on(pid: number, event: 'stdout' | 'stderr' | 'exit', cb: (data: string | number) => void): void;
  };
  memoryLimitBytes?: number;
  moduleLoader: ModuleLoader;
}

interface TimerRecord {
  cb: QuickJSHandle;
  args: QuickJSHandle[];
  due: number;
  interval: number | null;
}

interface InboxItem {
  fn: QuickJSHandle;
  args: QuickJSHandle[];
  /** disposal callback for one-shot callbacks (e.g. setTimeout) */
  cleanup?: () => void;
}

const OCERR_PREFIX = '__OCERR__';

function hostError(e: unknown): never {
  if (e instanceof VFSError) {
    throw new Error(`${OCERR_PREFIX}${JSON.stringify({ message: e.message, code: e.code, errno: e.errno, syscall: e.syscall, path: e.path })}`);
  }
  throw e;
}

let wasmModulePromise: Promise<QuickJSWASMModule> | null = null;

export function getEngineWASMModule(): Promise<QuickJSWASMModule> {
  wasmModulePromise ??= newQuickJSWASMModule(SINGLEFILE);
  return wasmModulePromise;
}

export class EngineProcess {
  readonly pid: number;
  title = '';
  private ctx: QuickJSContext | null = null;
  private runtime: QuickJSRuntime | null = null;
  private timers = new Map<number, TimerRecord>();
  private nextTimerId = 1;
  private inbox: InboxItem[] = [];
  private deferreds = new Set<{ dispose(): void }>();
  private keepAlive = 0;
  private killed = false;
  private killDeadline = 0;
  private exitCode: number | null = null;
  private exited = false;
  private wakeResolve: (() => void) | null = null;
  private stdinCbs: QuickJSHandle[] = [];
  private stdinPaused = false;
  private stdinBuffer: string[] = [];
  private stdinEnded = false;
  private exitCbs: QuickJSHandle[] = [];
  private watchSeq = 0;
  private watches = new Map<number, () => void>();
  private hostFnDisposers: Array<() => void> = [];
  private disposed = false;
  private inFlightHttp = 0;
  private opts: EngineProcessOptions;

  /** Set by the network layer; used to route outbound HTTP responses. */
  onNetRespond: ((requestId: string, status: number, headers: Record<string, string>, body: Uint8Array | null) => void) | null = null;
  onNetWrite: ((requestId: string, chunk: Uint8Array) => void) | null = null;
  onNetFinish: ((requestId: string) => void) | null = null;

  constructor(opts: EngineProcessOptions, private mod: QuickJSWASMModule, private preludeCode: string) {
    this.opts = opts;
    this.pid = opts.pid;
  }

  get cwd(): string {
    return this.opts.cwd;
  }

  /* ------------------------------------------------------------------ */
  /* lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  async start(
    entry:
      | { kind: 'script'; filename: string }
      | { kind: 'eval'; code: string }
      | { kind: 'print'; code: string }
      | { kind: 'version' }
      | { kind: 'check'; code: string }
  ): Promise<void> {
    const runtime = this.mod.newRuntime();
    this.runtime = runtime;
    if (this.opts.memoryLimitBytes) runtime.setMemoryLimit(this.opts.memoryLimitBytes);
    runtime.setInterruptHandler(() => this.killed && Date.now() > this.killDeadline);
    const ctx = runtime.newContext();
    this.ctx = ctx;

    this.installHostFunctions(ctx);

    const finalizer = setTimeout(() => this.finish(this.exitCode ?? (this.killed ? 137 : 1)), 30000);
    try {
      ctx.unwrapResult(ctx.evalCode(this.preludeCode, 'opencontainer:prelude')).dispose();
    } catch (e) {
      this.opts.onStderr(`opencontainer-node: prelude failed: ${String(e)}\n`);
      this.finish(70);
      return;
    }

    const boot = {
      argv: this.opts.argv,
      env: this.opts.env,
      cwd: this.opts.cwd,
      identity: ENGINE_IDENTITY,
      entry,
      pid: this.pid,
    };
    try {
      const h = ctx.evalCode(`__ocBootstrap(${JSON.stringify(JSON.stringify(boot))})`);
      ctx.unwrapResult(h).dispose();
    } catch (e) {
      if (this.killed) {
        this.finish(137);
        return;
      }
      this.reportVMError(e);
      this.finish(1);
      return;
    }

    const code = await this.runLoop();
    this.finish(code);
    clearTimeout(finalizer);
  }

  /* ------------------------------------------------------------------ */
  /* event loop                                                          */
  /* ------------------------------------------------------------------ */

  private async runLoop(): Promise<number> {
    while (!this.exited && !this.disposed) {
      // 1. promise jobs (async/await continuations, promise callbacks)
      try {
        const res = this.runtime!.executePendingJobs();
        if (typeof res === 'object' && res !== null && 'error' in res) {
          const dumped = this.safeDump(res.error);
          res.error.dispose();
          this.uncaught(dumped);
        }
      } catch (e) {
        if (this.killed) return 137;
        this.reportVMError(e);
        return 1;
      }

      // 2. inbox: host→VM callbacks (timers, stdin, children, net)
      while (this.inbox.length > 0 && !this.exited) {
        const item = this.inbox.shift()!;
        try {
          const res = this.ctx!.callFunction(item.fn, this.ctx!.undefined, item.args);
          if ('error' in res) {
            const dumped = this.safeDump(res.error);
            res.error.dispose();
            this.uncaught(dumped);
          } else {
            res.value.dispose();
          }
        } catch (e) {
          item.cleanup?.();
          if (this.killed) return 137;
          this.reportVMError(e);
          return 1;
        }
        item.cleanup?.();
      }

      if (this.exited) break;

      // 3. timers due?
      this.fireTimers();

      // 4. anything left keeping the process alive?
      const busy =
        this.timers.size > 0 ||
        this.inbox.length > 0 ||
        this.deferreds.size > 0 ||
        this.keepAlive > 0 ||
        this.inFlightHttp > 0 ||
        (this.stdinCbs.length > 0 && !this.stdinEnded);

      if (!busy) break;

      // 5. sleep until work arrives or the next timer is due
      await this.waitWork(this.nextTimerDelay());
    }
    return this.exitCode ?? this.readPreludeExitCode() ?? 0;
  }

  private readPreludeExitCode(): number | null {
    try {
      const h = this.ctx!.evalCode('__ocExitCode');
      const v = this.ctx!.dump(this.ctx!.unwrapResult(h));
      h.dispose();
      return typeof v === 'number' ? v : null;
    } catch {
      return null;
    }
  }

  kick(): void {
    if (this.wakeResolve) {
      const r = this.wakeResolve;
      this.wakeResolve = null;
      r();
    }
  }

  private waitWork(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        if (this.wakeResolve === done) this.wakeResolve = null;
        resolve();
      }, ms);
      const done = () => {
        clearTimeout(t);
        resolve();
      };
      this.wakeResolve = done;
    });
  }

  private nextTimerDelay(): number {
    if (this.timers.size === 0) return 500;
    let min = Infinity;
    const now = Date.now();
    for (const t of this.timers.values()) {
      const d = t.due - now;
      if (d < min) min = d;
    }
    return Math.max(0, Math.min(min, 500));
  }

  private fireTimers(): void {
    if (this.timers.size === 0) return;
    const now = Date.now();
    for (const [id, t] of [...this.timers.entries()]) {
      if (t.due <= now) {
        if (t.interval === null) {
          this.timers.delete(id);
          this.inbox.push({ fn: t.cb, args: t.args, cleanup: () => { t.cb.dispose(); t.args.forEach((a) => a.dispose()); } });
        } else {
          t.due = now + t.interval;
          this.inbox.push({ fn: t.cb, args: t.args });
        }
      }
    }
  }

  private uncaught(dumped: unknown): void {
    // route through the VM so user 'uncaughtException' handlers run
    const ctx = this.ctx;
    if (!ctx) return;
    try {
      const h = ctx.evalCode('__ocUncaught');
      const fn = ctx.unwrapResult(h);
      const res = ctx.callFunction(fn, ctx.undefined, [ctx.newString(JSON.stringify(stringifyError(dumped)))]);
      fn.dispose();
      if ('error' in res) res.error.dispose();
      else res.value.dispose();
    } catch {
      /* ignore */
    }
  }

  private reportVMError(e: unknown): void {
    this.opts.onStderr(`${stringifyError(e)}\n`);
  }

  private safeDump(handle: QuickJSHandle): unknown {
    try {
      return this.ctx!.dump(handle);
    } catch {
      return { message: 'unknown VM error' };
    }
  }

  /* ------------------------------------------------------------------ */
  /* host function installation                                          */
  /* ------------------------------------------------------------------ */

  private bindHost(ctx: QuickJSContext, name: string, fn: (...args: QuickJSHandle[]) => QuickJSHandle | void): void {
    const wrapped: (...args: QuickJSHandle[]) => QuickJSHandle | void = (...args) => {
      try {
        return fn(...args);
      } catch (e) {
        // structured errors travel to the VM via the message prefix
        if (e instanceof VFSError) {
          throw new Error(`${OCERR_PREFIX}${JSON.stringify({ message: e.message, code: e.code, errno: e.errno, syscall: e.syscall, path: e.path })}`);
        }
        throw e;
      }
    };
    const h = ctx.newFunction(name, wrapped as never);
    ctx.setProp(ctx.global, name, h);
    this.hostFnDisposers.push(() => { try { h.dispose(); } catch { /* ignore */ } });
    h.dispose();
  }

  private str(ctx: QuickJSContext, h: QuickJSHandle): string {
    return ctx.getString(h);
  }
  private num(ctx: QuickJSContext, h: QuickJSHandle): number {
    return ctx.getNumber(h);
  }
  private boolish(ctx: QuickJSContext, h: QuickJSHandle): boolean {
    const v = ctx.dump(h);
    return v === true || v === 1;
  }
  private bytesArg(ctx: QuickJSContext, h: QuickJSHandle): Uint8Array | string | null {
    const t = ctx.typeof(h);
    if (t === 'string') return ctx.getString(h);
    if (t === 'object') {
      try {
        const buf = ctx.getArrayBuffer(h);
        const copy = new Uint8Array(buf.value);
        buf.dispose();
        return copy;
      } catch {
        return null;
      }
    }
    return null;
  }

  private installHostFunctions(ctx: QuickJSContext): void {
    const opts = this.opts;

    /* stdio */
    this.bindHost(ctx, '__host_stdout', (s) => { opts.onStdout(this.str(ctx, s)); });
    this.bindHost(ctx, '__host_stderr', (s) => { opts.onStderr(this.str(ctx, s)); });

    /* timers */
    this.bindHost(ctx, '__host_set_timeout', (cb, ms, ...rest) => {
      const delay = Math.max(0, this.num(ctx, ms) || 0);
      const id = this.nextTimerId++;
      this.timers.set(id, { cb, args: rest, due: Date.now() + delay, interval: null });
      return ctx.newNumber(id);
    });
    this.bindHost(ctx, '__host_set_interval', (cb, ms, ...rest) => {
      const delay = Math.max(1, this.num(ctx, ms) || 1);
      const id = this.nextTimerId++;
      this.timers.set(id, { cb, args: rest, due: Date.now() + delay, interval: delay });
      return ctx.newNumber(id);
    });
    this.bindHost(ctx, '__host_clear_timer', (idH) => {
      const id = this.num(ctx, idH);
      const t = this.timers.get(id);
      if (t) {
        t.cb.dispose();
        t.args.forEach((a) => a.dispose());
        this.timers.delete(id);
        return ctx.newNumber(1);
      }
      return ctx.newNumber(0);
    });
    this.bindHost(ctx, '__host_next_tick', (cb) => {
      this.inbox.unshift({ fn: cb, args: [] });
      this.kick();
    });

    /* process control */
    this.bindHost(ctx, '__host_exit', (codeH) => {
      const code = this.num(ctx, codeH);
      this.exitCode = Number.isFinite(code) ? code : 0;
      this.exited = true;
      this.kick();
    });
    this.bindHost(ctx, '__host_process_on', (eventH, cb) => {
      const event = this.str(ctx, eventH);
      if (event === 'exit') this.exitCbs.push(cb);
      if (event === 'stdin-data') this.stdinCbs.push(cb);
    });
    this.bindHost(ctx, '__host_stdin_resume', () => { this.stdinPaused = false; this.drainStdin(); });
    this.bindHost(ctx, '__host_stdin_pause', () => { this.stdinPaused = true; });
    this.bindHost(ctx, '__host_env_snapshot', () => ctx.newString(JSON.stringify(this.snapshotEnv())));
    this.bindHost(ctx, '__host_chdir', (dirH) => {
      const dir = this.str(ctx, dirH);
      const abs = join(this.opts.cwd, dir);
      const node = opts.fs.lookup(abs);
      if (!node || node.type !== 'dir') hostError(new VFSError('ENOENT', 'no such directory', 'chdir', abs));
      this.opts.cwd = abs;
    });
    this.bindHost(ctx, '__host_cwd', () => ctx.newString(this.opts.cwd));
    this.bindHost(ctx, '__host_set_title', (t) => { this.title = this.str(ctx, t); });
    this.bindHost(ctx, '__host_hrtime_ms', () => ctx.newNumber(performance.now()));

    /* misc */
    this.bindHost(ctx, '__host_random_bytes', (nH) => {
      const n = Math.min(Math.max(0, this.num(ctx, nH) | 0), 65536);
      const bytes = new Uint8Array(n);
      crypto.getRandomValues(bytes);
      return ctx.newArrayBuffer(bytes.buffer);
    });
    this.bindHost(ctx, '__host_memory_usage', () => {
      try {
        const info = this.runtime!.computeMemoryUsage();
        const dumped = this.ctx!.dump(info);
        info.dispose();
        return ctx.newString(JSON.stringify(dumped));
      } catch {
        return ctx.newString('{}');
      }
    });

    /* filesystem — sync */
    this.bindHost(ctx, '__host_fs', (opH, a, b, c) => {
      return this.fsSync(ctx, this.str(ctx, opH), a, b, c);
    });

    /* filesystem — async (promise-based) */
    this.bindHost(ctx, '__host_fs_async', (opH, a, b, c) => {
      const op = this.str(ctx, opH);
      // read handles synchronously (VM is paused during host calls)
      const pa = a ? this.peekArg(ctx, a) : null;
      const pb = b ? this.peekArg(ctx, b) : null;
      const pc = c ? this.boolish(ctx, c) : false;
      const deferred = ctx.newPromise();
      this.deferreds.add(deferred);
      this.keepAlive++;
      deferred.settled.then(() => {
        this.deferreds.delete(deferred);
        this.keepAlive--;
        this.kick();
      });
      void (async () => {
        try {
          const result = await this.fsAsync(op, pa, pb, pc);
          deferred.resolve(result === undefined ? (ctx.undefined as QuickJSHandle) : this.toVm(result));
        } catch (e) {
          deferred.reject(this.errorToVm(ctx, e));
        }
        this.kick();
      })();
      return deferred.handle;
    });

    /* module loading */
    this.bindHost(ctx, '__host_load_module', (specH, parentH) => {
      const spec = this.str(ctx, specH);
      const parentDir = this.str(ctx, parentH);
      const res = opts.moduleLoader.load(spec, parentDir);
      return ctx.newString(JSON.stringify(res));
    });

    /* watchers */
    this.bindHost(ctx, '__host_watch', (pathH, cb, recursiveH) => {
      const path = this.str(ctx, pathH);
      const recursive = this.num(ctx, recursiveH) !== 0;
      const id = ++this.watchSeq;
      const dispose = opts.fs.addWatch(path, (records) => {
        this.inbox.push({ fn: cb, args: [ctx.newString(JSON.stringify(records))] });
        this.kick();
      }, recursive);
      this.watches.set(id, dispose);
      return ctx.newNumber(id);
    });
    this.bindHost(ctx, '__host_unwatch', (idH) => {
      const dispose = this.watches.get(this.num(ctx, idH));
      if (dispose) { dispose(); this.watches.delete(this.num(ctx, idH)); }
    });

    /* networking — inbound servers */
    this.bindHost(ctx, '__host_net_listen', (portH) => {
      const port = this.num(ctx, portH);
      const deferred = ctx.newPromise();
      this.deferreds.add(deferred);
      this.keepAlive++;
      deferred.settled.then(() => {
        this.deferreds.delete(deferred);
        this.keepAlive--;
        this.kick();
      });
      void (async () => {
        const err = await opts.net.listen(port, this);
        if (err) {
          deferred.reject(this.errorToVm(ctx, new VFSError('EADDRINUSE', `address already in use ${port}`, 'listen')));
        } else {
          deferred.resolve(ctx.undefined as QuickJSHandle);
        }
        this.kick();
      })();
      return deferred.handle;
    });
    this.bindHost(ctx, '__host_net_close', (portH) => { opts.net.close(this.num(ctx, portH)); });
    this.bindHost(ctx, '__host_net_respond', (reqIdH, statusH, headersH, bodyH, hasBodyH) => {
      const requestId = this.str(ctx, reqIdH);
      const status = this.num(ctx, statusH);
      const headers = JSON.parse(this.str(ctx, headersH) || '{}');
      let body: Uint8Array | null = null;
      if (this.num(ctx, hasBodyH) !== 0) {
        const buf = ctx.getArrayBuffer(bodyH);
        body = new Uint8Array(buf.value);
        buf.dispose();
      }
      this.onNetRespond?.(requestId, status, headers, body);
    });
    this.bindHost(ctx, '__host_net_write', (reqIdH, chunkH) => {
      const requestId = this.str(ctx, reqIdH);
      const buf = ctx.getArrayBuffer(chunkH);
      const copy = new Uint8Array(buf.value);
      buf.dispose();
      this.onNetWrite?.(requestId, copy);
    });
    this.bindHost(ctx, '__host_net_finish', (reqIdH) => {
      this.inFlightHttp--;
      this.onNetFinish?.(this.str(ctx, reqIdH));
    });

    /* networking — outbound HTTP (fetch bridge) */
    this.bindHost(ctx, '__host_net_fetch', (urlH, initH) => {
      const url = this.str(ctx, urlH);
      const init = JSON.parse(this.str(ctx, initH) || '{}');
      const deferred = ctx.newPromise();
      this.deferreds.add(deferred);
      this.keepAlive++;
      deferred.settled.then(() => {
        this.deferreds.delete(deferred);
        this.keepAlive--;
        this.kick();
      });
      void (async () => {
        try {
          const res = await opts.net.fetch(url, init);
          deferred.resolve(this.toVm({ status: res.status, headers: res.headers, body: res.body ?? new Uint8Array(0) }));
        } catch (e) {
          deferred.reject(this.errorToVm(ctx, e));
        }
        this.kick();
      })();
      return deferred.handle;
    });

    /* networking — outbound WebSocket bridge */
    this.bindHost(ctx, '__host_ws_open', (urlH, protocolsH) => {
      const url = this.str(ctx, urlH);
      const protocols = JSON.parse(this.str(ctx, protocolsH) || '[]');
      return ctx.newNumber(opts.net.wsOpen(url, protocols));
    });
    this.bindHost(ctx, '__host_ws_send', (idH, dataH, isBinaryH) => {
      const id = this.num(ctx, idH);
      if (this.num(ctx, isBinaryH) !== 0) {
        const buf = ctx.getArrayBuffer(dataH);
        const copy = new Uint8Array(buf.value);
        buf.dispose();
        opts.net.wsSend(id, copy);
      } else {
        opts.net.wsSend(id, this.str(ctx, dataH));
      }
    });
    this.bindHost(ctx, '__host_ws_close', (idH) => { opts.net.wsClose(this.num(ctx, idH)); });

    /* child processes */
    this.bindHost(ctx, '__host_child_spawn', (cmdH, argsH, optsH) => {
      const command = this.str(ctx, cmdH);
      const args = JSON.parse(this.str(ctx, argsH) || '[]');
      const spawnOpts = JSON.parse(this.str(ctx, optsH) || '{}');
      const deferred = ctx.newPromise();
      this.deferreds.add(deferred);
      this.keepAlive++;
      deferred.settled.then(() => {
        this.deferreds.delete(deferred);
        this.keepAlive--;
        this.kick();
      });
      void (async () => {
        const res = await opts.spawnChild(command, args, spawnOpts);
        if (res.pid === null || res.pid === undefined) {
          deferred.reject(this.errorToVm(ctx, new VFSError('ENOENT', `spawn ${command}`, 'spawn', command)));
        } else {
          deferred.resolve(ctx.newNumber(res.pid));
        }
        this.kick();
      })();
      return deferred.handle;
    });
    this.bindHost(ctx, '__host_child_stdin_write', (pidH, dataH) => {
      opts.childOps.stdinWrite(this.num(ctx, pidH), this.str(ctx, dataH));
    });
    this.bindHost(ctx, '__host_child_kill', (pidH) => { opts.childOps.kill(this.num(ctx, pidH)); });
    this.bindHost(ctx, '__host_child_on', (pidH, eventH, cb) => {
      const pid = this.num(ctx, pidH);
      const event = this.str(ctx, eventH) as 'stdout' | 'stderr' | 'exit';
      opts.childOps.on(pid, event, (data) => {
        this.inbox.push({ fn: cb, args: [typeof data === 'number' ? ctx.newNumber(data) : ctx.newString(data)] });
        this.kick();
      });
    });
    this.bindHost(ctx, '__host_child_await', (pidH) => {
      const pid = this.num(ctx, pidH);
      const deferred = ctx.newPromise();
      this.deferreds.add(deferred);
      this.keepAlive++;
      deferred.settled.then(() => {
        this.deferreds.delete(deferred);
        this.keepAlive--;
        this.kick();
      });
      opts.childOps.on(pid, 'exit', (code) => {
        deferred.resolve(ctx.newNumber(typeof code === 'number' ? code : 0));
        this.kick();
      });
      return deferred.handle;
    });
  }

  /** Read a VM arg into a plain host value (string | number | Uint8Array | boolean). */
  private peekArg(ctx: QuickJSContext, h: QuickJSHandle): unknown {
    const t = ctx.typeof(h);
    if (t === 'string') return ctx.getString(h);
    if (t === 'number') return ctx.getNumber(h);
    if (t === 'boolean') return ctx.dump(h);
    if (t === 'object') {
      try {
        const buf = ctx.getArrayBuffer(h);
        const copy = new Uint8Array(buf.value);
        buf.dispose();
        return copy;
      } catch {
        return null;
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ */
  /* fs dispatchers                                                      */
  /* ------------------------------------------------------------------ */

  private fsSync(ctx: QuickJSContext, op: string, a: QuickJSHandle, b: QuickJSHandle, c: QuickJSHandle): QuickJSHandle | void {
    const fs = this.opts.fs;
    const S = (h: QuickJSHandle) => ctx.getString(h);
    const N = (h: QuickJSHandle) => ctx.getNumber(h);
    switch (op) {
      case 'readFile':
        return ctx.newArrayBuffer(fs.readFile(S(a)).slice().buffer);
      case 'writeFile': {
        const data = this.bytesArg(ctx, b);
        fs.writeFile(S(a), (data as string | Uint8Array) ?? '');
        return;
      }
      case 'appendFile': {
        const existing = fs.exists(S(a)) ? fs.readFile(S(a)) : new Uint8Array(0);
        const add = this.bytesArg(ctx, b);
        const addBytes = typeof add === 'string' ? new TextEncoder().encode(add) : (add ?? new Uint8Array(0));
        const merged = new Uint8Array(existing.length + addBytes.length);
        merged.set(existing);
        merged.set(addBytes, existing.length);
        fs.writeFile(S(a), merged);
        return;
      }
      case 'stat':
      case 'lstat': {
        const s = op === 'stat' ? fs.stat(S(a)) : fs.lstat(S(a));
        return ctx.newString(JSON.stringify({ isFile: s.isFile(), isDirectory: s.isDirectory(), isSymbolicLink: s.isSymbolicLink(), size: s.size, mode: s.mode, mtimeMs: s.mtimeMs }));
      }
      case 'exists':
        return ctx.newNumber(fs.exists(S(a)) ? 1 : 0);
      case 'readdir':
        return ctx.newString(JSON.stringify(fs.readdir(S(a))));
      case 'mkdir':
        fs.mkdir(S(a), { recursive: N(b) !== 0 });
        return;
      case 'rm':
        fs.rm(S(a), { force: N(b) !== 0, recursive: N(c) !== 0 });
        return;
      case 'rmdir':
        fs.rmdir(S(a));
        return;
      case 'unlink':
        fs.unlink(S(a));
        return;
      case 'rename':
        fs.rename(S(a), S(b));
        return;
      case 'copyFile':
        fs.copyFile(S(a), S(b));
        return;
      case 'chmod':
        fs.chmod(S(a), N(b));
        return;
      case 'symlink':
        fs.symlink(S(a), S(b));
        return;
      case 'readlink':
        return ctx.newString(fs.readlink(S(a)));
      case 'realpath':
        return ctx.newString(normalizePath(S(a)));
      case 'truncate': {
        const data = fs.readFile(S(a));
        fs.writeFile(S(a), data.slice(0, N(b) || 0));
        return;
      }
      default:
        hostError(new VFSError('EINVAL', `unknown fs op: ${op}`, op));
    }
  }

  private async fsAsync(op: string, pa: unknown, pb: unknown, pc: boolean): Promise<unknown> {
    await Promise.resolve();
    const fs = this.opts.fs;
    const S = (v: unknown) => String(v);
    switch (op) {
      case 'readFile':
        return new Uint8Array(fs.readFile(S(pa)));
      case 'writeFile':
        fs.writeFile(S(pa), (typeof pb === 'string' ? pb : (pb as Uint8Array)) ?? '');
        return;
      case 'appendFile': {
        const p = S(pa);
        const existing = fs.exists(p) ? fs.readFile(p) : new Uint8Array(0);
        const add = typeof pb === 'string' ? new TextEncoder().encode(pb) : ((pb as Uint8Array) ?? new Uint8Array(0));
        const merged = new Uint8Array(existing.length + add.length);
        merged.set(existing);
        merged.set(add, existing.length);
        fs.writeFile(p, merged);
        return;
      }
      case 'mkdir':
        fs.mkdir(S(pa), { recursive: pb === 1 || pb === true });
        return;
      case 'readdir':
        return fs.readdir(S(pa));
      case 'stat':
      case 'lstat': {
        const s = op === 'stat' ? fs.stat(S(pa)) : fs.lstat(S(pa));
        return { isFile: s.isFile(), isDirectory: s.isDirectory(), isSymbolicLink: s.isSymbolicLink(), size: s.size, mode: s.mode, mtimeMs: s.mtimeMs };
      }
      case 'rm':
        fs.rm(S(pa), { force: pb === 1 || pb === true, recursive: pc });
        return;
      case 'unlink':
        fs.unlink(S(pa));
        return;
      case 'rmdir':
        fs.rmdir(S(pa));
        return;
      case 'rename':
        fs.rename(S(pa), S(pb));
        return;
      case 'copyFile':
        fs.copyFile(S(pa), S(pb));
        return;
      default:
        hostError(new VFSError('EINVAL', `unknown async fs op: ${op}`, op));
    }
  }

  /** Marshal a host value into the VM. */
  private toVm(value: unknown): QuickJSHandle {
    const ctx = this.ctx!;
    if (value === null || value === undefined) return ctx.undefined as QuickJSHandle;
    if (typeof value === 'number') return ctx.newNumber(value);
    if (typeof value === 'string') return ctx.newString(value);
    if (typeof value === 'boolean') return ctx.newNumber(value ? 1 : 0);
    if (value instanceof Uint8Array) return ctx.newArrayBuffer(value.slice().buffer);
    if (Array.isArray(value)) {
      const arr = ctx.newArray();
      let i = 0;
      for (const item of value) {
        ctx.setProp(arr, i++, this.toVm(item));
      }
      return arr;
    }
    // structured object → build a real VM object
    const obj = ctx.newObject();
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      ctx.setProp(obj, k, this.toVm(v));
    }
    return obj;
  }

  private errorToVm(ctx: QuickJSContext, e: unknown): QuickJSHandle {
    const payload = e instanceof VFSError
      ? { message: e.message, code: e.code, errno: e.errno, syscall: e.syscall, path: e.path }
      : { message: e instanceof Error ? e.message : String(e), code: 'EUNKNOWN', errno: -1, syscall: '' };
    const h = ctx.evalCode('(function (o) { const e = new Error(o.message); e.code = o.code; e.errno = o.errno; e.syscall = o.syscall; e.path = o.path; return e; })');
    const fn = ctx.unwrapResult(h);
    const res = ctx.callFunction(fn, ctx.undefined, [ctx.newString(JSON.stringify(payload))]);
    fn.dispose();
    if ('error' in res) throw new Error(payload.message);
    return res.value;
  }

  private snapshotEnv(): Record<string, string> {
    try {
      const h = this.ctx!.evalCode('JSON.stringify(globalThis.process && globalThis.process.env || {})');
      const s = this.ctx!.getString(this.ctx!.unwrapResult(h));
      h.dispose();
      const parsed = JSON.parse(s);
      return typeof parsed === 'object' && parsed !== null ? parsed : this.opts.env;
    } catch {
      return this.opts.env;
    }
  }

  /* ------------------------------------------------------------------ */
  /* inbound HTTP dispatch (from the virtual network)                   */
  /* ------------------------------------------------------------------ */

  dispatchHttp(port: number, requestId: string, method: string, path: string, headers: Record<string, string>, body: Uint8Array | null): void {
    const ctx = this.ctx;
    if (!ctx || this.exited || this.disposed) {
      this.onNetRespond?.(requestId, 503, { 'content-type': 'text/plain' }, encode('runtime process unavailable'));
      this.onNetFinish?.(requestId);
      return;
    }
    this.inFlightHttp++;
    try {
      const h = ctx.evalCode('__ocNetDispatch');
      const fn = ctx.unwrapResult(h);
      const res = ctx.callFunction(fn, ctx.undefined, [
        ctx.newNumber(port),
        ctx.newString(requestId),
        ctx.newString(method),
        ctx.newString(path),
        ctx.newString(JSON.stringify(headers)),
        ctx.newArrayBuffer((body ?? new Uint8Array(0)).slice().buffer),
      ]);
      fn.dispose();
      if ('error' in res) {
        const dumped = this.safeDump(res.error);
        res.error.dispose();
        this.onNetRespond?.(requestId, 500, { 'content-type': 'text/plain' }, encode(`Error: ${stringifyError(dumped)}`));
        this.onNetFinish?.(requestId);
        this.inFlightHttp--;
      } else {
        res.value.dispose();
      }
    } catch (e) {
      this.onNetRespond?.(requestId, 500, { 'content-type': 'text/plain' }, encode(`Error: ${e instanceof Error ? e.message : String(e)}`));
      this.onNetFinish?.(requestId);
      this.inFlightHttp--;
    }
  }

  /* ------------------------------------------------------------------ */
  /* websocket events                                                    */
  /* ------------------------------------------------------------------ */

  wsEvent(id: number, event: string, data?: string | Uint8Array): void {
    const ctx = this.ctx;
    if (!ctx || this.exited || this.disposed) return;
    try {
      const h = ctx.evalCode('__ocWsEvent');
      const fn = ctx.unwrapResult(h);
      const argData = typeof data === 'string' ? ctx.newString(data) : data ? ctx.newArrayBuffer(data.slice().buffer) : (ctx.null as QuickJSHandle);
      const res = ctx.callFunction(fn, ctx.undefined, [ctx.newNumber(id), ctx.newString(event), argData]);
      fn.dispose();
      if ('error' in res) res.error.dispose();
      else res.value.dispose();
    } catch {
      /* process exiting */
    }
  }

  /* ------------------------------------------------------------------ */
  /* stdin / resize / kill                                               */
  /* ------------------------------------------------------------------ */

  writeStdin(data: string): void {
    if (this.stdinEnded) return;
    this.stdinBuffer.push(data);
    this.drainStdin();
    this.kick();
  }

  endStdin(): void {
    this.stdinEnded = true;
    this.drainStdin();
    this.kick();
  }

  private drainStdin(): void {
    if (this.stdinPaused || this.stdinCbs.length === 0 || this.stdinBuffer.length === 0) return;
    const ctx = this.ctx!;
    while (this.stdinBuffer.length > 0 && !this.stdinPaused) {
      const chunk = this.stdinBuffer.shift()!;
      for (const cb of this.stdinCbs) {
        this.inbox.push({ fn: cb, args: [ctx.newString(chunk)] });
      }
    }
    this.kick();
  }

  resize(cols: number, rows: number): void {
    const ctx = this.ctx;
    if (!ctx || this.exited) return;
    try {
      const h = ctx.evalCode('__ocResize');
      const fn = ctx.unwrapResult(h);
      const res = ctx.callFunction(fn, ctx.undefined, [ctx.newNumber(cols), ctx.newNumber(rows)]);
      fn.dispose();
      if ('error' in res) res.error.dispose();
      else res.value.dispose();
    } catch {
      /* ignore */
    }
  }

  kill(): void {
    if (this.exited || this.killed) return;
    this.killed = true;
    this.exitCode = 137;
    this.killDeadline = Date.now() - 1;
    this.exited = true;
    this.kick();
    // if the loop is wedged in host code, force-finish shortly
    setTimeout(() => this.finish(137), 150);
  }

  get isExited(): boolean {
    return this.exited;
  }

  private finish(code: number): void {
    if (this.disposed) return;
    this.disposed = true;
    this.exited = true;
    const ctx = this.ctx;
    // best-effort exit callbacks (skip when force-interrupted mid-execution)
    if (ctx && !this.killed) {
      for (const cb of this.exitCbs) {
        try {
          const res = ctx.callFunction(cb, ctx.undefined, [ctx.newNumber(code)]);
          if ('error' in res) res.error.dispose();
          else res.value.dispose();
        } catch {
          /* ignore */
        }
      }
    }
    for (const t of this.timers.values()) {
      t.cb.dispose();
      t.args.forEach((a) => a.dispose());
    }
    this.timers.clear();
    for (const d of this.deferreds) {
      try { d.dispose(); } catch { /* ignore */ }
    }
    this.deferreds.clear();
    for (const dispose of this.hostFnDisposers) {
      try { dispose(); } catch { /* ignore */ }
    }
    this.hostFnDisposers = [];
    try {
      this.ctx?.dispose();
      this.runtime?.dispose();
    } catch {
      /* forceful teardown can abort QuickJS; swallow */
    }
    this.ctx = null;
    this.runtime = null;
    this.opts.onExit(code);
  }
}

/* -------------------------------------------------------------------- */
/* helpers                                                              */
/* -------------------------------------------------------------------- */

function join(cwd: string, p: string): string {
  return normalizePath(p.startsWith('/') ? p : `${cwd}/${p}`);
}

function stringifyError(e: unknown): string {
  if (e && typeof e === 'object') {
    const d = e as Record<string, unknown>;
    if (typeof d.stack === 'string' && d.stack) {
      return typeof d.message === 'string' ? `${String(d.name ?? 'Error')}: ${d.message}\n${d.stack}` : d.stack;
    }
    if (typeof d.message === 'string') return `${String(d.name ?? 'Error')}: ${d.message}`;
    return JSON.stringify(e);
  }
  return String(e);
}

function encode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export { hostError };
