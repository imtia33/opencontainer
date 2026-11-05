import type { Binding, NativesContext } from './index';
import { UV_EOF, kArrayBufferOffset, kReadBytesOrError, getStreamBaseState, encodeChunk, encodeWritevList } from './stream-state';

/**
 * internalBinding('pipe_wrap') — REAL virtual pipes.
 *
 * A Pipe is a uv stream handle whose two ends live in (possibly) different
 * kernel processes; the HOST ProcessManager routes the bytes. Two flavors:
 *
 *   1. stdio pipes (fd 0/1/2 of a child spawned with stdio:'pipe'): the
 *      child's bootstrap does `new net.Socket({fd})` → createHandle(fd) →
 *      `new Pipe(SOCKET)` + `open(fd)` — open() binds the handle to the
 *      pipeId this process was booted with, and from then on writes route
 *      to the host and reads arrive from it.
 *
 *   2. parent-side child-stdio pipes (internal/child_process.js creates
 *      them BEFORE spawn): Process.spawn assigns their pipeIds; writes to
 *      child.stdin flow out through onPipeWrite, child stdout arrives
 *      through deliverPipeData.
 *
 * The uv StreamBase protocol is the exact one tty_wrap implements (the
 * same one lib/internal/stream_base_commons.js drives): write* return 0,
 * readStart sets `reading`, data arrives as state[kReadBytesOrError]=n +
 * handle.onread(arrayBuffer).
 */

export interface StdioMode {
  type: 'tty' | 'pipe' | 'ignore';
  pipeId?: number;
}

/** Per-process async-id source (net.js calls handle.getAsyncId() directly). */
let asyncIdCounter = 0;
function nextAsyncId(): number { return ++asyncIdCounter + 1000; }

export function makePipeWrapBinding(ctx: NativesContext): Binding {
  const hooks: any = ctx.hooks;
  /** pipeId → live Pipe handle (data delivery target). */
  const registry = new Map<number, any>();
  /** EOFs that arrived before a handle registered (never lost). */
  const eofSeen = new Set<number>();

  const PIPE_SOCKET = 1;
  const PIPE_SERVER = 0;
  const PIPE_IPC = 2;

  class Pipe {
    onread: ((arrayBuffer: ArrayBuffer) => void) | null = null;
    reading = false;
    fd = -1;
    /** Assigned by Process.spawn (parent side) or open() (child side). */
    pipeId: number | null = null;
    pending: Uint8Array[] = [];

    constructor(public pipeType: number = PIPE_SOCKET) {
      if (pipeType === PIPE_IPC) {
        throw new Error(
          "OpenContainer: pipe_wrap IPC handles (fork()/stdio:'ipc') are not supported");
      }
    }

    /** net.js calls this directly on fd-adopted sockets. */
    getAsyncId(): number { return nextAsyncId(); }

    /** net.js createHandle path: bind to this process's stdio pipe. */
    open(fd: number): number {
      this.fd = fd;
      const mode: StdioMode | undefined = (ctx as any).stdio?.[fd];
      if (mode && mode.type === 'pipe' && mode.pipeId !== undefined) {
        this.pipeId = mode.pipeId;
        registry.set(this.pipeId, this);
        if (eofSeen.has(this.pipeId)) {
          eofSeen.delete(this.pipeId);
          deliverEof(this);
        }
      }
      return 0;
    }

    // ---- write side (→ host) ---------------------------------------------
    private out(data: Uint8Array): void {
      if (this.pipeId !== null) hooks.onPipeWrite?.(this.pipeId, data);
    }
    writeUtf8String(req: any, data: string, cb?: (err?: Error | null) => void): number {
      this.out(new TextEncoder().encode(data));
      cb?.(null);
      return 0;
    }
    writeBuffer(req: any, data: Uint8Array): number {
      this.out(data);
      return 0;
    }
    writeLatin1String(req: any, data: string): number {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
      this.out(bytes);
      return 0;
    }
    writeAsciiString(req: any, data: string): number {
      this.writeLatin1String(req, data);
      return 0;
    }
    writeUcs2String(req: any, data: string): number {
      this.out(new TextEncoder().encode(data));
      return 0;
    }
    writev(req: any, chunks: Array<any>, allBuffers: boolean): number {
      // node's writevGeneric: [Buffer...] with allBuffers, else the
      // interleaved [chunk, encoding, chunk, encoding, ...] form.
      const data = encodeWritevList(chunks, allBuffers);
      this.out(data);
      return 0;
    }

    // ---- read side (host → JS) --------------------------------------------
    readStart() {
      this.reading = true;
      // Flush chunks that arrived before lib wanted data.
      while (this.pending.length > 0 && this.reading && typeof this.onread === 'function') {
        deliver(this, this.pending.shift()!);
      }
    }
    readStop() { this.reading = false; }
    shutdown(req: any): number {
      if (this.pipeId !== null) hooks.onPipeClose?.(this.pipeId, 'shutdown');
      queueMicrotask(() => req?.oncomplete?.(0));
      return 0;
    }
    close() {
      if (this.pipeId !== null) {
        if (registry.get(this.pipeId) === this) registry.delete(this.pipeId);
        hooks.onPipeClose?.(this.pipeId, 'close');
      }
    }
    ref() {}
    unref() {}
    getsockname() { return { address: '127.0.0.1', port: 0, family: 2 }; }
    getpeername() { return { address: '127.0.0.1', port: 0, family: 2 }; }
    setBlocking(_b: boolean): number { return 0; }
    /** Pipe servers (unix domain sockets) are not provided. */
    bind(name: string, _flags?: number): number {
      return uvErr('EACCES', `pipe bind(${name}) — unix domain sockets are not supported`);
    }
    connect(req: any, _name: string): number {
      const err = uvErr('EACCES', 'pipe connect — unix domain sockets are not supported');
      queueMicrotask(() => req?.oncomplete?.(err));
      return 0;
    }
    fchmod(_mode: number): number { return 0; }
  }

  function uvErr(name: string, message: string): number {
    (globalThis as any).__ocDebugHook?.(`[pipe_wrap] ${message}`);
    return -13; // UV_EACCES
  }

  /** uv's onStreamRead protocol — mirrors tty_wrap.deliverChunk. */
  function deliver(handle: Pipe, bytes: Uint8Array): void {
    if (typeof handle.onread !== 'function' || !handle.reading) {
      handle.pending.push(bytes);
      return;
    }
    const state = getStreamBaseState();
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    state[kReadBytesOrError] = bytes.byteLength;
    state[kArrayBufferOffset] = 0;
    try {
      handle.onread(ab);
    } catch (e: any) {
      (globalThis as any).__ocDebugHook?.(`[pipe onread error] ${e?.stack ?? e}`);
    }
  }

  function deliverEof(handle: Pipe): void {
    if (typeof handle.onread !== 'function') return;
    const state = getStreamBaseState();
    state[kReadBytesOrError] = UV_EOF;
    state[kArrayBufferOffset] = 0;
    try { handle.onread(new ArrayBuffer(0)); } catch { /* ignore */ }
  }

  return {
    Pipe,
    PipeConnectWrap: class {},
    constants: {
      SOCKET: PIPE_SOCKET,
      SERVER: PIPE_SERVER,
      IPC: PIPE_IPC,
      UV_READABLE: 0x10,
      UV_WRITABLE: 0x20,
    },
    kOwnedByPipe: Symbol('nodejs.pipe.owned'),

    // ---- host bridge surface (worker-entry RPC calls in) --------------------
    /** process_wrap: register a PARENT-side child-stdio handle (created by
     *  internal/child_process.js BEFORE spawn — open() is never called on
     *  these, so the registry needs an explicit hook). */
    __registerHandle(pipeId: number, handle: any): void {
      registry.set(Number(pipeId), handle);
      if (eofSeen.has(Number(pipeId))) {
        eofSeen.delete(Number(pipeId));
        deliverEof(handle);
      }
    },
    /** Host: bytes arrived for this pipeId (child stdout → parent, or
     *  parent's stdin write → child fd0 — each end's worker gets its own). */
    deliverPipeData(pipeId: number, bytes: Uint8Array): void {
      const handle = registry.get(pipeId);
      if (!handle) return; // not yet open — dropped (host retried on open? no: rare)
      deliver(handle, bytes);
    },
    /** Host: the other end closed → EOF (persisted until a handle opens). */
    deliverPipeEof(pipeId: number): void {
      const handle = registry.get(pipeId);
      if (handle) deliverEof(handle);
      else eofSeen.add(Number(pipeId));
    },
    /** Loop-drain truth: a pipe keeps the process alive only while its
     *  READ side is active (uv semantics: a stream is refed when reading or
     *  with pending writes — our writes complete synchronously). */
    activePipeCount(): number {
      let n = 0;
      for (const h of registry.values()) {
        if (h && h.reading === true) n++;
      }
      return n;
    },
    /** Diagnostics. */
    __pipeIds(): number[] { return [...registry.keys()]; },
  };
}
