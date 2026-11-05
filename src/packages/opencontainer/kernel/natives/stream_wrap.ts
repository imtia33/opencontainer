import type { Binding } from './index';
import { sharedSymbol } from './shared-symbols';
import {
  getStreamBaseState,
  kArrayBufferOffset,
  kBytesWritten,
  kIsBigEndian,
  kLastWriteErr,
  kLastWriteWasAsync,
  kReadBytesOrError,
  kUvErrno,
} from './stream-state';

/**
 * internalBinding('stream_wrap') — symbols + shared stream base state.
 *
 * streamBaseState indices follow node's stream_wrap.cc enum EXACTLY.
 * lib/internal/stream_base_commons.js reads [kReadBytesOrError] and
 * [kArrayBufferOffset] in onStreamRead() — both must exist, and the
 * array must be the SAME instance tty_wrap's stdin pump writes into.
 */
export {
  kReadBytesOrError,
  kArrayBufferOffset,
  kBytesWritten,
  kLastWriteWasAsync,
  kLastWriteErr,
  kUvErrno,
  kIsBigEndian,
};

export const UV_EOF = -4095;

export function makeStreamWrapBinding(): Binding {
  // Shared stream state array (module singleton — see stream-state.ts).
  const streamBaseState = getStreamBaseState();

  return {
    streamBaseState,

    // Request wrapper classes. In node these are C++ ReqWrap subclasses with
    // no JS-visible behavior of their own — net.js does `new ShutdownWrap()`
    // (socket.end → _final → handle.shutdown(req)) and child_process.js /
    // _http_agent.js do `new WriteWrap()`. They only carry the callbacks the
    // caller assigns. Plain classes are the faithful browser implementation.
    ShutdownWrap: class ShutdownWrap {},
    WriteWrap: class WriteWrap {},
    ConnectWrap: class ConnectWrap {},

    // TOP-LEVEL constants — stream_base_commons.js destructures these
    // directly from the binding (`const { kReadBytesOrError, ... } = ...`).
    kReadBytesOrError,
    kArrayBufferOffset,
    kBytesWritten,
    kLastWriteWasAsync,
    kLastWriteErr,
    kUvErrno,
    kIsBigEndian,

    // Nested form for any consumer using binding('stream_wrap').constants.
    constants: {
      kReadBytesOrError,
      kArrayBufferOffset,
      kBytesWritten,
      kLastWriteWasAsync,
      kLastWriteErr,
      kUvErrno,
      kIsBigEndian,
    },

    // symbols (node exposes these via stream_wrap symbols)
    kStreamOwner: sharedSymbol('nodejs.stream.owner'),
    kStreamBaseField: sharedSymbol('nodejs.stream.base.field'),
    kReadStop: sharedSymbol('nodejs.stream.read.stop'),
    kReadStart: sharedSymbol('nodejs.stream.read.start'),
    kWriteGeneric: sharedSymbol('nodejs.stream.write.generic'),
    kUpdateTimer: sharedSymbol('nodejs.stream.update.timer'),
    kSetSimulated: sharedSymbol('nodejs.stream.set.simulated'),
    kAfterAttachedWriteDone: sharedSymbol('nodejs.stream.after.attached.write.done'),
    kTimeout: sharedSymbol('nodejs.stream.timeout'),
    kBufBase: sharedSymbol('nodejs.stream.buf_base'),
    kAsyncIdField: sharedSymbol('nodejs.stream.async_id_field'),

    shutdown(req: any, _handle: any) { queueMicrotask(() => req?.oncomplete?.(0)); },
    StreamBase: class StreamBase {
      close() {}
      ref() {}
      unref() {}
    },
    writev(_req: any, _chunks: any[], _cb: any) { return 0; },
    LibuvStreamWrap: class LibuvStreamWrap { constructor(..._a: any[]) {} },
    providers: {},
  };
}
