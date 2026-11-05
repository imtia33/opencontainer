import type { Binding } from './index';

/**
 * internalBinding('stream_pipe') — node's src/node_stream_pipe.cc.
 *
 * node's lib/internal/http2/core.js destructures { StreamPipe } at module
 * load; StreamPipe instances are only constructed when an HTTP/2 session
 * pipes a stream to a socket handle. HTTP/2 sessions cannot start in the
 * browser runtime (no ALPN sockets — see natives/http2.ts), so the class is
 * an honest failure at construction time rather than an inert fake.
 */
export function makeStreamPipeBinding(): Binding {
  return {
    StreamPipe: class StreamPipe {
      constructor() {
        const err: any = new Error(
          'stream_pipe: StreamPipe is not implemented in the browser runtime ' +
          '(only reachable from HTTP/2 session piping, which requires sockets)');
        err.code = 'ERR_NOT_IMPLEMENTED';
        throw err;
      }
    },
  };
}
