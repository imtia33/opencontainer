import type { StdinRawReader, StdinRawSource, NativesContext } from './index';
import { scheduleStdioCompletion } from './fs';

/**
 * The per-process fd-0 input bridge — ONE kernel pipe/TTY input buffer shared
 * by every consumer of stdin:
 *
 *   - raw fs.read/readSync(0, …) — Go's wasm_exec glue (esbuild-wasm's
 *     `--service` protocol), read(2)-style consumers — park their reqs here;
 *   - node's own stdin stream (a Pipe adopted by net.Socket({fd:0}), or the
 *     tty ReadStream) drains the same buffer when readStart-ed;
 *   - host deliveries ('stdin' RPC → pipe_wrap/tty_wrap) push here.
 *
 * Creation is IDEMPOTENT through the shared NativesContext — whichever
 * binding materializes first (fs always wins in practice; pipe_wrap/tty_wrap
 * follow) creates it, the others adopt the same instance. This closes the
 * race where fs.read(0) parked in a queue nothing ever fed (found via
 * esbuild's service: "all goroutines are asleep - deadlock!").
 */

export interface StdinBridge {
  /** The one kernel input buffer for fd 0. The stdin stream handle ADOPTS
   *  this array (adoptBuffer) so its readStart flush and raw reads converge
   *  on a single queue — do not hold long-lived references across adoptions. */
  readonly buffer: Uint8Array[];
  /** Parked raw fs.read(0, …) callback-mode reads. */
  readonly rawReaders: StdinRawReader[];
  /** EOF seen (other end closed / stdin-eof RPC). */
  eof: boolean;
  /** The fd was closed (stdin Socket destroyed): later raw reads EBADF. */
  closed: boolean;
  /** The fs-binding-facing source (ctx.stdinRaw). */
  readonly source: StdinRawSource;
  /** Host/terminal bytes arrived: parked raw readers first, rest → buffer. */
  deliver(bytes: Uint8Array): void;
  /** The stdin stream materialized: swap the buffer to the handle's queue
   *  (contents move; identity becomes the handle's pending array). */
  adoptBuffer(handlePending: Uint8Array[]): void;
  /** EOF: parked readers complete with 0 (Go's service loop exits cleanly). */
  markEof(): void;
  /** fd closed: parked readers complete with EBADF; later reads fail. */
  markClosed(): void;
}

export function ensureStdinBridge(ctx: NativesContext, fd0Type: string | undefined): StdinBridge {
  const existing: StdinBridge | undefined = (ctx as any).stdinBridge;
  if (existing) return existing;

  const rawReaders: StdinRawReader[] = [];
  let buffer: Uint8Array[] = [];
  let eof = false;
  let closed = false;

  function drain(b: Uint8Array, offset: number, length: number): number {
    let total = 0;
    while (total < length && buffer.length > 0) {
      const head = buffer[0];
      const n = Math.min(length - total, head.length);
      b.set(head.subarray(0, n), offset + total);
      total += n;
      if (n < head.length) buffer[0] = head.subarray(n);
      else buffer.shift();
    }
    return total;
  }

  const bridge: StdinBridge = {
    get buffer() { return buffer; },
    get rawReaders() { return rawReaders; },
    get eof() { return eof; },
    set eof(v: boolean) { eof = v; },
    get closed() { return closed; },
    set closed(v: boolean) { closed = v; },
    get source(): StdinRawSource {
      return {
        readSync(b: Uint8Array, offset: number, length: number): number {
          if (closed) throw ebadf();
          return drain(b, offset, length);
        },
        readAsync(b: Uint8Array, offset: number, length: number, req: StdinRawReader['req']): void {
          if (closed) { scheduleStdioCompletion(() => req.oncomplete?.(ebadf(), 0, b)); return; }
          const n = drain(b, offset, length);
          if (n > 0) { scheduleStdioCompletion(() => req.oncomplete?.(null, n, b)); return; }
          if (eof) { scheduleStdioCompletion(() => req.oncomplete?.(null, 0, b)); return; }
          rawReaders.push({ buffer: b, offset, length, req });
        },
        abort(err: Error): void {
          for (const r of rawReaders.splice(0)) {
            scheduleStdioCompletion(() => r.req.oncomplete?.(err, 0, r.buffer));
          }
        },
      };
    },
    deliver(bytes: Uint8Array): void {
      let rest = bytes;
      while (rawReaders.length > 0 && rest.length > 0) {
        const r = rawReaders.shift()!;
        const n = Math.min(r.length, rest.length);
        r.buffer.set(rest.subarray(0, n), r.offset);
        rest = rest.subarray(n);
        scheduleStdioCompletion(() => r.req.oncomplete?.(null, n, r.buffer));
      }
      if (rest.length > 0) buffer.push(rest);
    },
    adoptBuffer(handlePending: Uint8Array[]): void {
      for (const chunk of buffer) handlePending.push(chunk);
      buffer = handlePending;
    },
    markEof(): void {
      eof = true;
      for (const r of rawReaders.splice(0)) {
        scheduleStdioCompletion(() => r.req.oncomplete?.(null, 0, r.buffer));
      }
    },
    markClosed(): void {
      if (closed) return;
      closed = true;
      for (const r of rawReaders.splice(0)) {
        scheduleStdioCompletion(() => r.req.oncomplete?.(ebadf(), 0, r.buffer));
      }
    },
  };
  void fd0Type;
  (ctx as any).stdinBridge = bridge;
  return bridge;
}

function ebadf(): Error {
  const err: any = new Error('EBADF: read, 0');
  err.code = 'EBADF';
  err.errno = -9;
  err.syscall = 'read';
  return err;
}
