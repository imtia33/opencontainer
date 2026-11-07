/**
 * OpenContainer Kernel — Native bindings (browser-JS implementations of the
 * C++ `internalBinding` layer that node's lib/*.js expects).
 *
 * This is the seam StackBlitz filled with Emscripten-compiled C++.
 * We fill it with browser primitives.
 */

import { Vfs } from '../vfs';
import { PUBLIC_BUILTINS, NODE_VERSION } from '../id-map';

export interface KernelHooks {
  /** Called when the guest calls process.exit(). */
  onExit(code: number, signal?: string | null): void;
  /** ESM graph transport (S3.1 Phase 6): publishes rewritten module texts
   *  and defines the URL space V8 links the graph in. Browser workers pass
   *  the app-server-backed transport; test harnesses pass a file-backed one.
   *  Absent → ESM entries fail with the honest "not implemented" error. */
  esmServing?: import('../esm-graph').EsmServing;
  /** Stdout/stderr bytes leaving the runtime. */
  onStdio(fd: 1 | 2, chunk: Uint8Array | string): void;
  /** Current wall clock (ms). */
  now(): number;
  /** Environment seed. */
  env(): Record<string, string>;
  /** cwd management is VFS-backed. */
  initialCwd: string;

  // ---- multi-process host bridge (worker-entry provides these) -------------
  /** Parent kernel → host: create a child process (child_process.spawn). */
  onChildSpawn?(req: {
    pid: number;
    file: string | null;      // null = the node interpreter itself
    args: string[];
    interpreter: 'node';
    cwd: string;
    env: Record<string, string>;
    stdio: Array<{ type: 'pipe'; pipeId: number } | { type: 'inherit' } | { type: 'ignore' }>;
    nodeArgs: string[];
  }): void;
  /** Parent kernel → host: deliver a signal to a child process. */
  onChildKill?(pid: number, signal: string): void;
  /** Kernel → host: bytes written into a pipe (stdio routing). */
  onPipeWrite?(pipeId: number, chunk: Uint8Array): void;
  /** Kernel → host: this pipe end closed (EOF for the other side). */
  onPipeClose?(pipeId: number, reason: string): void;
  /** Kernel → host: a TCP server started listening on a virtual port. */
  onTcpListen?(info: { listenId: number; port: number; host: string; backlog?: number }): void;
  /** Kernel → host: a listening server was closed. */
  onTcpUnlisten?(listenId: number, port: number): void;
  /** Kernel → host: connect a virtual socket to a LOCAL port. */
  onTcpConnect?(info: { connId: number; reqId: number; port: number; host: string }): void;
  /** Kernel → host: bytes written to a virtual connection. */
  onTcpWrite?(connId: number, chunk: Uint8Array): void;
  /** Kernel → host: our side of a connection closed. */
  onTcpClose?(connId: number): void;
  /** Kernel → host: our side finished writing (FIN). */
  onTcpShutdown?(connId: number): void;
}

export type Binding = Record<string, any>;

/** A parked raw fs.read(fd 0) in callback mode (node's FSReqCallback shape). */
export interface StdinRawReader {
  buffer: Uint8Array;
  offset: number;
  length: number;
  req: {
    oncomplete: ((err: number | Error | null, ...args: any[]) => void) | null;
    context?: any;
  };
}

/** Raw fd-0 read source: registered by pipe_wrap/tty_wrap once this process's
 *  stdin handle exists, so raw fs.read/readSync(0, …) — Go's wasm_exec glue
 *  (esbuild-wasm's --service), read(2)-style consumers — and node's own stdin
 *  stream draw from ONE kernel pipe buffer instead of two. */
export interface StdinRawSource {
  /** Sync: drain buffered bytes into buffer (0 = none/EOF). */
  readSync(buffer: Uint8Array, offset: number, length: number): number;
  /** Async: park the read; the source completes req.oncomplete(err, n, buffer). */
  readAsync(buffer: Uint8Array, offset: number, length: number, req: StdinRawReader['req']): void;
  /** The handle went away (close/destroy): parked readers get err. */
  abort(err: Error): void;
}

export interface NativesContext {
  vfs: Vfs;
  hooks: KernelHooks;
  /** mutable cwd path inside the vfs */
  cwd(): string;
  chdir(p: string): void;
  /** execArgv-style options the runtime was booted with (e.g. --eval). */
  options: Map<string, any>;
  /** This process's stdio modes (tty | pipe | ignore) per fd. */
  stdio?: Array<{ type: 'tty' | 'pipe' | 'ignore'; pipeId?: number }>;
  /** Set by pipe_wrap/tty_wrap when the fd-0 handle exists; fs.read(0, …)
   *  delegates here (ONE shared stdin buffer for streams and raw fd reads). */
  stdinRaw?: StdinRawSource | null;
}

import { makeErrorsBinding } from './errors';
import { makeConfigBinding } from './config';
import { makeConstantsBinding } from './constants';
import { makeSymbolsBinding } from './symbols';
import { makeTaskQueueBinding } from './task_queue';
import { makeProcessMethodsBinding } from './process_methods';
import { makeUvBinding } from './uv';
import { makeFsBinding } from './fs';
import { makeFsDirBinding } from './fs_dir';
import { makeFsEventBinding } from './fs_event';
import { makeBufferBinding } from './buffer';
import { makeUtilBinding } from './util';
import { makeOptionsBinding } from './options';
import { makeBuiltinsBinding } from './builtins';
import { makeModulesBinding } from './modules';
import { makeUrlBinding, makeUrlPatternBinding } from './url';
import { makePerformanceBinding } from './performance';
import { makeWorkerBinding } from './worker';
import { makeCredentialsBinding } from './credentials';
import { makeOsBinding } from './os';
import { makeCryptoBinding } from './crypto';
import { makeContextifyBinding } from './contextify';
import { makeModuleWrapBinding } from './module_wrap';
import { makeV8Binding } from './v8';
import { makeTimersBinding } from './timers';
import { makeTtyBinding } from './tty_wrap';
import { makeStreamWrapBinding } from './stream_wrap';
import { makeEncodingBinding } from './encoding';
import { makeStringDecoderBinding } from './string_decoder';
import { makeTypesBinding } from './types';
import { makeCjsLexerBinding } from './cjs_lexer';
import { makeMiscBindings } from './misc';
import { makeZlibBinding } from './zlib';
import { makeProcessWrapBinding } from './process_wrap';
import { makePipeWrapBinding } from './pipe_wrap';
import { makeTcpWrapBinding } from './tcp_wrap';
import { makeHttpParserBinding } from './http_parser';
import { makeHttp2Binding } from './http2';
import { makeStreamPipeBinding } from './stream_pipe';
import { makeWasiBinding } from './wasi';

export class Natives {
  private bindings = new Map<string, Binding>();

  constructor(private ctx: NativesContext) {
    const reg = <T extends Binding>(name: string, make: () => T) => {
      this.bindings.set(name, make());
    };

    reg('errors', () => makeErrorsBinding(ctx));
    reg('config', () => makeConfigBinding());
    reg('constants', () => makeConstantsBinding());
    reg('symbols', () => makeSymbolsBinding());
    reg('task_queue', () => makeTaskQueueBinding(ctx));
    reg('process_methods', () => makeProcessMethodsBinding(ctx));
    reg('uv', () => makeUvBinding());
    reg('fs', () => makeFsBinding(ctx));
    reg('fs_dir', () => makeFsDirBinding(ctx));
    reg('fs_event_wrap', () => makeFsEventBinding(ctx));
    reg('buffer', () => makeBufferBinding());
    reg('util', () => makeUtilBinding());
    reg('options', () => makeOptionsBinding(ctx));
    reg('builtins', () => makeBuiltinsBinding());
    reg('modules', () => makeModulesBinding(ctx));
    reg('url', () => makeUrlBinding());
    reg('url_pattern', () => makeUrlPatternBinding());
    reg('performance', () => makePerformanceBinding(ctx));
    reg('worker', () => makeWorkerBinding());
    reg('credentials', () => makeCredentialsBinding(ctx));
    reg('os', () => makeOsBinding());
    reg('crypto', () => makeCryptoBinding());
    reg('zlib', () => makeZlibBinding());
    reg('contextify', () => makeContextifyBinding());
    reg('module_wrap', () => makeModuleWrapBinding());
    reg('v8', () => makeV8Binding(ctx));
    reg('timers', () => makeTimersBinding());
    reg('tty_wrap', () => makeTtyBinding(ctx));
    reg('stream_wrap', () => makeStreamWrapBinding());
    reg('process_wrap', () => makeProcessWrapBinding(ctx));
    reg('pipe_wrap', () => makePipeWrapBinding(ctx));
    reg('tcp_wrap', () => makeTcpWrapBinding(ctx));
    reg('http_parser', () => makeHttpParserBinding(ctx));
    reg('http2', () => makeHttp2Binding());
    reg('stream_pipe', () => makeStreamPipeBinding());
    reg('encoding_binding', () => makeEncodingBinding());
    reg('string_decoder', () => makeStringDecoderBinding());
    reg('types', () => makeTypesBinding());
    reg('cjs_lexer', () => makeCjsLexerBinding());
    reg('wasi', () => makeWasiBinding(ctx));
    for (const [name, binding] of Object.entries(makeMiscBindings())) {
      if (binding !== undefined) this.bindings.set(name, binding);
    }
  }

  get(name: string): Binding {
    const b = this.bindings.get(name);
    if (!b) {
      // Unknown binding: return a Proxy that records property access and
      // throws a descriptive error — makes the error-driven porting loop fast.
      const missing: Record<string, boolean> = {};
      return new Proxy({}, {
        get(_t, prop) {
          if (prop === Symbol.toPrimitive) return () => `[missing binding: ${name}]`;
          missing[String(prop)] = true;
          throw new Error(
            `OpenContainer: internalBinding('${name}') is not implemented yet ` +
            `(accessed .${String(prop)}). Bindings seen so far: ${[...Object.keys(missing)].join(', ')}`
          );
        },
      });
    }
    return b;
  }
}

export { NODE_VERSION, PUBLIC_BUILTINS };
