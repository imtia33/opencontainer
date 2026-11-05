import type { Binding, NativesContext } from './index';

/** internalBinding('errors') — exit codes + V8 stack trace plumbing. */
export function makeErrorsBinding(_ctx: NativesContext): Binding {
  let stackCallback: ((globalThis: any, error: any, trace: any[]) => any) | null = null;
  let fatalEnhancers: { before?: (err: any) => any; after?: (err: any, after: any) => any } = {};

  return {
    exitCodes: {
      kNoFailure: 0,
      kInvalidArgument: 9,
      kCouldNotParseCommandLine: 9,
      kInvalidCommandLineArgument: 9,
      kInvalidUserArgument: 9,
      kGenericUserError: 1,
      kInternalException: 12,
      kUserAborted: 2147483646,
      kNoFailureDeprecated: 0,
    },
    kGenericUserError: 1,

    triggerUncaughtException(err, promiseType) {
      // Delegate to the host's uncaught exception path if set; default: rethrow async
      if (typeof (globalThis as any).__ocUncaught === 'function') {
        (globalThis as any).__ocUncaught(err, promiseType);
      } else {
        queueMicrotask(() => { throw err; });
      }
    },
    noSideEffectsToString(err: any): string {
      try { return String(err); } catch { return '[Error]'; }
    },

    // ---- V8 stack trace plumbing ----
    // realm.js installs Error.prepareStackTrace = ErrorPrepareStackTrace
    // (internal/errors JS) itself. The binding only needs these two hooks:
    setPrepareStackTraceCallback(cb: (globalThis: any, error: any, trace: any[]) => any) {
      stackCallback = cb;
    },
    getPrepareStackTraceCallback() { return stackCallback; },
    setEnhanceStackForFatalException(
      before?: (err: any) => any,
      after?: (err: any, enhanced: any) => any,
    ) {
      fatalEnhancers = { before, after };
    },
    setMaybeCacheGeneratedSourceMap(_cb: ((file: string, line: number, column: number, sourceURL: string) => void) | null) {
      // Source-map caching for generated code — no generator output in S1.
    },
    setSourceMapsEnabled(_enabled: boolean) {},
    setGetSourceMapErrorSource(_cb: ((id: string, url: string) => any) | null) {},
    getErrorSourcePositions(_id: string, _sourceURL: string) { return []; },
    enhanceFatalException(err: any) {
      try {
        const beforeResult = fatalEnhancers.before?.(err);
        if (beforeResult !== undefined) return beforeResult;
        const afterResult = fatalEnhancers.after?.(err, err);
        if (afterResult !== undefined) return afterResult;
      } catch { /* enhancement is best-effort */ }
      return err;
    },
    getPrepareStackTraceCallback() { return stackCallback; },

    // Used by errors.js to format errno exceptions
    errnoException(errno: number, syscall: string, message?: string, path?: string): Error {
      const err: any = new Error(`${syscall} ${message ?? ''} (errno ${errno})`.trim());
      err.errno = errno;
      err.code = errnoToCode(errno);
      err.syscall = syscall;
      if (path) err.path = path;
      return err;
    },
  };
}

function errnoToCode(errno: number): string | undefined {
  const table: Record<number, string> = {
    [-1]: 'EPERM', [-2]: 'ENOENT', [-3]: 'ESRCH', [-4]: 'EINTR', [-5]: 'EIO',
    [-9]: 'EBADF', [-11]: 'EAGAIN', [-12]: 'ENOMEM', [-13]: 'EACCES',
    [-16]: 'EBUSY', [-17]: 'EEXIST', [-18]: 'EXDEV', [-20]: 'ENOTDIR',
    [-21]: 'EISDIR', [-22]: 'EINVAL', [-24]: 'EMFILE', [-28]: 'ENOSPC',
    [-40]: 'ELOOP', [-98]: 'EADDRINUSE', [-104]: 'ECONNRESET',
    [-111]: 'ECONNREFUSED', [-110]: 'ETIMEDOUT',
  };
  return table[errno];
}
