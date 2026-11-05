import type { Binding, NativesContext } from './index';
import { UV_EOF, kArrayBufferOffset, kReadBytesOrError, getStreamBaseState, encodeWritevList } from './stream-state';

/**
 * internalBinding('tty_wrap') — stdio TTY handles over the kernel's stdio
 * hooks. Implements node's StreamBase protocol:
 *
 * WRITE side: write* methods return 0 for synchronous success (or a uv
 * error number), never a WriteWrap — the real stream machinery in
 * lib/internal/stream_base_commons.js completes writes synchronously.
 *
 * READ side (the REPL's lifeline): the host feeds raw keystrokes via
 * feedStdin(); each chunk is delivered through the EXACT protocol
 * node's uv stream uses — set streamBaseState[kReadBytesOrError] = n
 * and [kArrayBufferOffset] = 0, then call handle.onread(arrayBuffer)
 * where lib's onStreamRead(arrayBuffer) picks it up and pushes it into
 * process.stdin's Readable. EOF: state[0] = UV_EOF.
 */

export function makeTtyBinding(ctx: NativesContext): Binding {
  class TtyHandle {
    /** Assigned by lib/internal/stream_base_commons.js (onread driver). */
    onread: ((arrayBuffer: ArrayBuffer) => void) | null = null;
    reading = false;
    /** UV raw-mode state (setRawMode receives UV_TTY_MODE_*). Cooked (0) is
     * the ONLY mode where the line discipline interprets control characters —
     * RAW_VT (3)/IO (2) pass bytes through to readline untouched. */
    rawMode = false;

    constructor(public fd: number, _ctx?: { code?: number }) {
      // node passes a ctx object for init errors — we never fail init.
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const handle: TtyHandle = this;
      if (fd === 0) stdinHandle = handle;
    }
    get owner(): any { return (this as any)[OWNER]; }
    writeUtf8String(req: any, data: string | Uint8Array, cb?: (err?: Error | null) => void): number {
      ctx.hooks.onStdio(this.fd as 1 | 2, data);
      cb?.(null);
      return 0;
    }
    writeBuffer(req: any, data: Uint8Array): number {
      ctx.hooks.onStdio(this.fd as 1 | 2, data);
      return 0;
    }
    writeLatin1String(req: any, data: string): number {
      ctx.hooks.onStdio(this.fd as 1 | 2, data);
      return 0;
    }
    writeAsciiString(req: any, data: string): number {
      ctx.hooks.onStdio(this.fd as 1 | 2, data);
      return 0;
    }
    writeUcs2String(req: any, data: string): number {
      ctx.hooks.onStdio(this.fd as 1 | 2, data);
      return 0;
    }
    writev(req: any, chunks: Array<any>, allBuffers: boolean): number {
      // node's writevGeneric: [Buffer...] with allBuffers, else interleaved
      // [chunk, encoding, ...] — encodings must NOT be written as data.
      const data = encodeWritevList(chunks, allBuffers);
      ctx.hooks.onStdio(this.fd as 1 | 2, data);
      return 0;
    }
    readStart() { this.reading = true; }
    readStop() { this.reading = false; }
    shutdown(req: any): number {
      queueMicrotask(() => req?.oncomplete?.(0));
      return 0;
    }
    close() { if (stdinHandle === this) stdinHandle = null; }
    ref() {}
    unref() {}
    /** tty.js ReadStream.setRawMode translates true→UV_TTY_MODE_RAW_VT(3),
     * false→UV_TTY_MODE_NORMAL(0). We record the state — the cooked-mode
     * line discipline below depends on it. */
    setRawMode(mode: number): number {
      this.rawMode = mode !== 0;
      return 0;
    }
    setBlocking(_blocking: boolean): number { return 0; }
    get isTTY() { return true; }
    get columns() { return (globalThis as any).__oc?.terminalSize?.cols ?? 80; }
    get rows() { return (globalThis as any).__oc?.terminalSize?.rows ?? 24; }
    /** node passes an Int32Array(2) [width, height] to fill. */
    getWindowSize(winSize: Int32Array): number {
      winSize[0] = (globalThis as any).__oc?.terminalSize?.cols ?? 80;
      winSize[1] = (globalThis as any).__oc?.terminalSize?.rows ?? 24;
      return 0;
    }
    getsockname() { return { address: '127.0.0.1', port: 0, family: 2 }; }
    getpeername() { return { address: '127.0.0.1', port: 0, family: 2 }; }
  }

  const OWNER = Symbol('nodejs.stream.owner');

  // ---- stdin delivery ------------------------------------------------------
  let stdinHandle: TtyHandle | null = null;
  const pendingChunks: Uint8Array[] = [];
  let eofDelivered = false;
  /** The kernel process object — attached from boot.ts after the EventEmitter
   *  prototype is installed; needed to raise SIGINT on the cooked-mode INTR. */
  let proc: any = null;

  /** Kernel TTY line discipline (cooked mode only): ETX (0x03, Ctrl+C) is the
   *  INTR character — a real kernel TTY converts it to SIGINT *instead of*
   *  delivering it as data, and echoes "^C" to the output side. Raw mode
   *  (readline owns the keyboard) passes every byte through untouched — that
   *  is why the REPL still receives \x03 as data and emits its own SIGINT. */
  function raiseSigint(): void {
    ctx.hooks.onStdio(1, '^C\n');
    try {
      if (proc && typeof proc.listenerCount === 'function' &&
          proc.listenerCount('SIGINT') > 0) {
        proc.emit('SIGINT', 'SIGINT');
        return; // a JS handler owns the signal now — node semantics
      }
      // Default SIGINT disposition: terminate. Shells report 128+2=130.
      proc?.exit?.(130);
    } catch (e: any) {
      (globalThis as any).__ocDebugHook?.('[sigint raise error] ' + String(e));
    }
  }

  /**
   * Host bridge: raw bytes from the terminal UI → node's stdin stream.
   * Mirrors uv__stream_read: allocates an ArrayBuffer, sets the shared
   * streamBaseState, then invokes handle.onread(buf).
   */
  function deliverChunk(bytes: Uint8Array): void {
    const handle = stdinHandle;
    if (!handle || typeof handle.onread !== 'function' || !handle.reading) {
      pendingChunks.push(bytes);
      return;
    }
    const state = getStreamBaseState();
    // Copy into a standalone ArrayBuffer the FastBuffer will view.
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    state[kReadBytesOrError] = bytes.byteLength;
    state[kArrayBufferOffset] = 0;
    try {
      handle.onread(ab);
    } catch (e: any) {
      // A throw inside onread must not kill the host loop; node would crash
      // the process — we log and keep the terminal alive.
      (globalThis as any).__ocDebugHook?.(`[stdin onread error] ${(e?.stack ?? String(e))}`);
    }
  }

  /** Flush chunks that arrived before lib called readStart(). */
  function flushPending(): void {
    while (pendingChunks.length > 0) {
      const handle = stdinHandle;
      if (!handle || !handle.reading || typeof handle.onread !== 'function') return;
      deliverChunk(pendingChunks.shift()!);
    }
  }

  // readStart on the handle means lib wants data now — flush early arrivals.
  const origReadStart = TtyHandle.prototype.readStart;
  TtyHandle.prototype.readStart = function (this: TtyHandle) {
    origReadStart.call(this);
    flushPending();
  };

  function feedStdin(data: string | Uint8Array): void {
    if (eofDelivered) return;
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    if (bytes.byteLength === 0) return;
    // Line discipline: in cooked mode (no raw-mode reader attached) the INTR
    // character never reaches the process — it becomes SIGINT, with the
    // surrounding bytes still delivered as data.
    if (!stdinHandle?.rawMode) {
      const idx = bytes.indexOf(0x03);
      if (idx >= 0) {
        const before = bytes.subarray(0, idx);
        if (before.byteLength > 0) deliverChunk(before);
        raiseSigint();
        const after = bytes.subarray(idx + 1);
        if (after.byteLength > 0) deliverChunk(after);
        return;
      }
    }
    deliverChunk(bytes);
  }

  function sendStdinEof(): void {
    if (eofDelivered) return;
    eofDelivered = true;
    const handle = stdinHandle;
    if (!handle || typeof handle.onread !== 'function') return;
    const state = getStreamBaseState();
    state[kReadBytesOrError] = UV_EOF;
    try { handle.onread(new ArrayBuffer(0)); } catch { /* ignore */ }
  }

  function resetStdin(): void {
    eofDelivered = false;
    pendingChunks.length = 0;
  }

  return {
    TTY: TtyHandle,
    isTTY(fd: number): boolean {
      // fd 0-2 are TTYs only when this process was booted with tty stdio
      // (piped/ignored children report isTTY=false — node semantics).
      if (fd !== 0 && fd !== 1 && fd !== 2) return false;
      const mode = (ctx as any).stdio?.[fd];
      return !mode || mode.type === 'tty';
    },
    getWindowWidth: (fd: number) => (globalThis as any).__oc?.terminalSize?.cols ?? 80,
    getWindowHeight: (fd: number) => (globalThis as any).__oc?.terminalSize?.rows ?? 24,
    UV_TTY_MODE_NORMAL: 0,
    UV_TTY_MODE_RAW: 1,
    UV_TTY_MODE_IO: 2,
    UV_TTY_MODE_RAW_VT: 3,
    ownerSymbol: OWNER,

    // ---- host bridge surface (used by worker-entry RPC) ----
    feedStdin,
    sendStdinEof,
    resetStdin,
    /** boot.ts wires the process here once its EventEmitter proto is ready. */
    attachProcess(p: any): void { proc = p; },
    /** Loop-drain detection: an open, readStarted stdin keeps node's loop alive. */
    stdinReading(): boolean { return stdinHandle?.reading === true; },
  };
}
