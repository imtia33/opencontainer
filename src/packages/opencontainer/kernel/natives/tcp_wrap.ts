import type { Binding, NativesContext } from './index';
import { UV_EOF, kArrayBufferOffset, kReadBytesOrError, getStreamBaseState, encodeChunk, encodeWritevList } from './stream-state';

/**
 * internalBinding('tcp_wrap') — REAL virtual TCP sockets.
 *
 * Browser reality: a worker cannot open a TCP socket. What it CAN do is
 * route a *virtual* connection through the host ProcessManager:
 *
 *   LISTEN  — `server.listen(port)` (net.js → TCP.bind + TCP.listen) posts
 *             the port to the host. Incoming connections are synthesized by
 *             the host (preview fetches, other local processes) and delivered
 *             as `onconnection(0, clientHandle)` — uv's exact accept protocol
 *             — so node's REAL net.Server/http.Server machinery runs.
 *
 *   CONNECT — localhost/127.0.0.1 only: the kernel asks the host to route a
 *             virtual connection to whichever process owns the port (or to
 *             the preview bridge). External hosts fail ENOSYS/ENOTFOUND
 *             honestly — no fake network.
 *
 * Bytes flow through the same uv StreamBase protocol as tty_wrap/pipe_wrap.
 * All of node's http.Server/Express/Vite code runs unmodified on top.
 */

export interface TcpListenInfo { listenId: number; port: number; host: string; backlog?: number }

const TCP_SOCKET = 0;
const TCP_SERVER = 1;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '::']);

let tcpAsyncId = 0;

/** Connection-level lifecycle trace, OFF by default. Enable per process with
 *  env OC_TRACE_TCP=1 (worker-entry sets __ocTcpTrace from it). Every event
 *  carries the connId, the handle's delivery state and a timestamp so the
 *  ordering of data/EOF/close across the virtual transport is provable from
 *  the logs. Diagnostic only — never changes behavior. */
function tcpTrace(ev: string, connId: number | null, extra?: Record<string, unknown>): void {
  const hook = (globalThis as any).__ocTcpTrace;
  if (typeof hook !== 'function') return;
  try {
    hook(`[tcp ${Date.now()}] ${ev} conn=${connId ?? '-'}${extra ? ' ' + JSON.stringify(extra) : ''}`);
  } catch { /* diagnostics must never throw */ }
}

export function makeTcpWrapBinding(ctx: NativesContext): Binding {
  const hooks: any = ctx.hooks;
  /** connId → live TCP handle. */
  const sockets = new Map<number, any>();
  /** listenId → listening server handle. */
  const servers = new Map<number, any>();
  /** reqId → pending connect request. */
  const pendingConnects = new Map<number, any>();
  let listenIdCounter = 1;
  let connIdCounter = (globalThis as any).__ocConnIdBase ?? 1;
  let reqIdCounter = 1;

  /** Local mirror of ports in use across ALL processes (host broadcasts it).
   *  Used for synchronous EADDRINUSE in bind() — uv checks in the kernel. */
  let portsInUse = new Set<number>();

  class TCP {
    onread: ((arrayBuffer: ArrayBuffer) => void) | null = null;
    onconnection: ((err: number, clientHandle: any) => void) | null = null;
    reading = false;
    connId: number | null = null;
    listenId: number | null = null;
    localPort = 0;
    localHost = '0.0.0.0';
    remotePort = 0;
    closed = false;
    pending: Uint8Array[] = [];
    /** EOF arrived while reads were stopped — delivered on the next readStart
     *  AFTER the pending bytes, never dropped (libuv observes EOF only during
     *  an active read cycle; deferring preserves byte-then-EOF ordering). */
    eofPending = false;
    /** EOF delivered once — re-delivery on a raced cleanup would push a second
     *  `null` into the readable side and corrupt the stream state. */
    eofDelivered = false;

    constructor(public handleType: number = TCP_SOCKET) {}

    /** net.js calls this directly on fd-adopted sockets. */
    getAsyncId(): number { return ++tcpAsyncId + 2000; }

    // ---- server side --------------------------------------------------------
    bind(address: string, port: number, _flags?: number): number {
      return this.bindInternal(address, port);
    }
    bind6(address: string, port: number, _flags?: number): number {
      return this.bindInternal(address, port);
    }
    private bindInternal(address: string, port: number): number {
      if (port > 0 && portsInUse.has(port)) {
        return -98; // UV_EADDRINUSE — uv reports it from bind()
      }
      this.localHost = address;
      this.localPort = port;
      return 0;
    }

    listen(backlog: number): number {
      if (this.handleType !== TCP_SERVER) return -9; // UV_EBADF
      let port = this.localPort;
      if (port === 0) {
        // Ephemeral port: the kernel picks one (uv's bind() does the same);
        // the host validates uniqueness on registration.
        for (let i = 0; i < 200; i++) {
          const candidate = 40000 + Math.floor(Math.random() * 20000);
          if (!portsInUse.has(candidate)) { port = candidate; break; }
        }
        if (port === 0) return -98;
        this.localPort = port;
      }
      portsInUse.add(port);
      const listenId = listenIdCounter++;
      this.listenId = listenId;
      servers.set(listenId, this);
      hooks.onTcpListen?.({ listenId, port, host: this.localHost, backlog } satisfies TcpListenInfo);
      return 0;
    }

    /** Host: registration failed (true conflict) — surface EADDRINUSE. */
    __listenFailed(listenId: number): void {
      const server = servers.get(Number(listenId));
      if (!server) return;
      servers.delete(Number(listenId));
      portsInUse.delete(server.localPort);
      const owner = (server as any)[OWNER];
      const err: any = new Error(`listen EADDRINUSE :::${server.localPort}`);
      err.code = 'EADDRINUSE'; err.errno = -98; err.syscall = 'listen';
      owner?.emit?.('error', err);
    }

    // ---- client side ---------------------------------------------------------
    connect(req: any, address: string, port: number): number {
      return this.connectInternal(req, address, port);
    }
    connect6(req: any, address: string, port: number): number {
      return this.connectInternal(req, address, port);
    }
    private connectInternal(req: any, address: string, port: number): number {
      if (!LOCAL_HOSTS.has(address)) {
        // External hosts cannot be reached from a browser worker — honest
        // error, never a fake connection.
        return -38; // UV_ENOSYS
      }
      const connId = connIdCounter++;
      const reqId = reqIdCounter++;
      this.connId = connId;
      this.remotePort = port;
      this.localPort = 0;
      sockets.set(connId, this);
      pendingConnects.set(reqId, { req, handle: this });
      hooks.onTcpConnect?.({ connId, reqId, port, host: address });
      return 0;
    }

    /** Host: the virtual connect resolved. */
    __connectComplete(reqId: number, status: number): void {
      const entry = pendingConnects.get(Number(reqId));
      if (!entry) return;
      pendingConnects.delete(Number(reqId));
      const { req, handle } = entry;
      if (status !== 0) {
        sockets.delete(handle.connId);
        handle.connId = null;
      }
      queueMicrotask(() => req?.oncomplete?.(status, handle, req, status === 0, status === 0));
    }

    /** Host (server side): an incoming connection was accepted. */
    __accept(connId: number, remotePort: number): any {
      const client = new TCP(TCP_SOCKET);
      client.connId = connId;
      client.remotePort = remotePort;
      client.localPort = this.localPort;
      sockets.set(connId, client);
      tcpTrace('accept', connId, { port: this.localPort, remotePort });
      return client;
    }

    // ---- stream protocol (both sides) ---------------------------------------
    private out(data: Uint8Array): void {
      if (this.connId !== null && !this.closed) {
        tcpTrace('write', this.connId, { bytes: data.byteLength });
        hooks.onTcpWrite?.(this.connId, data);
      }
    }
    writeUtf8String(req: any, data: string, cb?: (err?: Error | null) => void): number {
      this.out(new TextEncoder().encode(data));
      cb?.(null);
      return 0;
    }
    writeBuffer(req: any, data: Uint8Array): number { this.out(data); return 0; }
    writeLatin1String(req: any, data: string): number {
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
      this.out(bytes);
      return 0;
    }
    writeAsciiString(req: any, data: string): number { return this.writeLatin1String(req, data); }
    writeUcs2String(req: any, data: string): number { this.out(new TextEncoder().encode(data)); return 0; }
    writev(req: any, chunks: Array<any>, allBuffers: boolean): number {
      // node's writevGeneric: [Buffer...] with allBuffers, else the
      // interleaved [chunk, encoding, chunk, encoding, ...] form.
      const data = encodeWritevList(chunks, allBuffers);
      this.out(data);
      return 0;
    }
    readStart() {
      this.reading = true;
      tcpTrace('readStart', this.connId, { pending: this.pending.length, eofPending: this.eofPending });
      while (this.pending.length > 0 && this.reading && typeof this.onread === 'function') {
        deliverChunk(this, this.pending.shift()!);
      }
      // A deferred EOF flushes only after every queued byte was delivered.
      if (this.eofPending && this.reading && typeof this.onread === 'function') {
        this.eofPending = false;
        deliverEof(this);
      }
    }
    readStop() {
      this.reading = false;
      tcpTrace('readStop', this.connId, { pending: this.pending.length, eofPending: this.eofPending });
    }
    shutdown(req: any): number {
      if (this.connId !== null) hooks.onTcpShutdown?.(this.connId);
      queueMicrotask(() => req?.oncomplete?.(0));
      return 0;
    }
    close(cb?: () => void): void {
      tcpTrace('close', this.connId, { closed: this.closed, pending: this.pending.length, eofPending: this.eofPending });
      this.closed = true;
      this.pending.length = 0; // the handle is gone; queued bytes die with it
      this.eofPending = false;
      if (this.connId !== null) {
        if (sockets.get(this.connId) === this) sockets.delete(this.connId);
        hooks.onTcpClose?.(this.connId);
        this.connId = null;
      }
      if (this.listenId !== null) {
        const id = this.listenId;
        this.listenId = null;
        const server = servers.get(id);
        if (server === this) {
          servers.delete(id);
          portsInUse.delete(this.localPort);
          hooks.onTcpUnlisten?.(id, this.localPort);
        }
      }
      // node's HandleWrap.close(cb) invokes cb on completion — net.js
      // closeSocketHandle emits the Socket 'close' event from it.
      if (typeof cb === 'function') queueMicrotask(() => cb());
    }
    ref() {}
    unref() {}
    setNoDelay(_v?: boolean): number { return 0; }
    setKeepAlive(_v?: boolean, _d?: number): number { return 0; }
    setSimultaneousAccepts(_v?: boolean): number { return 0; }
    getsockname(out?: any): any {
      const info = {
        address: this.localHost || '127.0.0.1',
        port: this.localPort || 0,
        family: this.localHost?.includes(':') ? 10 : 2,
      };
      // uv convention: fill `out` and return 0 (a truthy return is an errno —
      // net.js Server.address() threw ERR_INVALID_ARG_TYPE on the info object).
      if (out && typeof out === 'object') {
        out.address = info.address; out.port = info.port; out.family = info.family;
        return 0;
      }
      return info;
    }
    getpeername(out?: any): any {
      const info = { address: '127.0.0.1', port: this.remotePort || 0, family: 2 };
      if (out && typeof out === 'object') {
        out.address = info.address; out.port = info.port; out.family = info.family;
        return 0;
      }
      return info;
    }
    open(_fd: number): number { return 0; }
    /** TCP handles are StreamBase-capable, but http's socket consumption
     *  path is NOT used (no isStreamBase flag) — the 'data' event path keeps
     *  node's parser wiring completely standard. */
  }

  /** uv's onStreamRead protocol. */
  function deliverChunk(handle: TCP, bytes: Uint8Array): void {
    if (typeof handle.onread !== 'function' || !handle.reading) {
      handle.pending.push(bytes);
      tcpTrace('data→pending', handle.connId, { bytes: bytes.byteLength, queued: handle.pending.length });
      return;
    }
    tcpTrace('data', handle.connId, { bytes: bytes.byteLength });
    const state = getStreamBaseState();
    const ab = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(ab).set(bytes);
    state[kReadBytesOrError] = bytes.byteLength;
    state[kArrayBufferOffset] = 0;
    try { handle.onread(ab); } catch (e: any) {
      (globalThis as any).__ocDebugHook?.(`[tcp onread error] ${e?.stack ?? e}`);
    }
  }

  function deliverEof(handle: TCP): void {
    // Idempotent: EOF is a one-shot per connection. A raced cleanup path
    // (WS close frame + transport EOF both arriving) must not push null
    // twice into the readable side.
    if (handle.eofDelivered) {
      tcpTrace('eof(dup,dropped)', handle.connId);
      return;
    }
    // libuv observes EOF only while a read cycle is active. If reads are
    // stopped — or the socket has not adopted the handle yet — remember the
    // EOF and deliver it on the next readStart, AFTER queued bytes. This is
    // what keeps `end` from firing before buffered data on a paused socket.
    if (!handle.reading || typeof handle.onread !== 'function') {
      handle.eofPending = true;
      tcpTrace('eof→deferred', handle.connId, { pending: handle.pending.length });
      return;
    }
    handle.eofDelivered = true;
    tcpTrace('eof', handle.connId);
    const state = getStreamBaseState();
    state[kReadBytesOrError] = UV_EOF;
    state[kArrayBufferOffset] = 0;
    try { handle.onread(new ArrayBuffer(0)); } catch { /* ignore */ }
  }

  const OWNER = Symbol('nodejs.stream.owner');

  return {
    TCP,
    TCPConnectWrap: class {},
    ConnectWrap: class {},
    constants: {
      SOCKET: TCP_SOCKET,
      SERVER: TCP_SERVER,
      UV_TCP_IPV6ONLY: 1,
      UV_TCP_REUSEPORT: 2,
    },
    ownerSymbol: OWNER,

    // ---- host bridge surface (worker-entry RPC calls in) --------------------
    /** Host: bytes for a connection (either an accepted socket or a client). */
    deliverTcpData(connId: number, bytes: Uint8Array): void {
      const handle = sockets.get(Number(connId));
      if (!handle) {
        tcpTrace('data(no-handle,dropped)', Number(connId), { bytes: bytes?.byteLength ?? 0 });
        return;
      }
      deliverChunk(handle, bytes);
    },
    /** Host: connection closed by the remote end → EOF. */
    deliverTcpEof(connId: number): void {
      const handle = sockets.get(Number(connId));
      if (!handle) {
        tcpTrace('eof(no-handle)', Number(connId));
        return;
      }
      deliverEof(handle);
    },
    /** Host: the virtual connect resolved (reqId → pendingConnects entry). */
    __connectComplete(reqId: number, status: number): void {
      const entry = pendingConnects.get(Number(reqId));
      if (!entry) return;
      pendingConnects.delete(Number(reqId));
      const { req, handle } = entry;
      if (status !== 0) {
        sockets.delete(handle.connId);
        handle.connId = null;
      }
      queueMicrotask(() => req?.oncomplete?.(status, handle, req, status === 0, status === 0));
    },
    /** Host: a listen registration truly conflicted → EADDRINUSE. */
    __listenFailed(listenId: number): void {
      const server = servers.get(Number(listenId));
      if (!server) return;
      servers.delete(Number(listenId));
      portsInUse.delete(server.localPort);
      const owner = (server as any)[OWNER];
      const err: any = new Error(`listen EADDRINUSE :::${server.localPort}`);
      err.code = 'EADDRINUSE'; err.errno = -98; err.syscall = 'listen';
      try { owner?.emit?.('error', err); } catch { /* surfaced via server error path */ }
    },
    /** Host: a connection arrived at one of OUR listening ports. */
    acceptConnection(port: number, connId: number, remotePort: number): boolean {
      for (const server of servers.values()) {
        if (server.localPort === port) {
          // A listening handle without net.js's onconnection is not
          // accepting — report that honestly so the host can tear the
          // connection down instead of leaking a socket nobody owns.
          if (typeof server.onconnection !== 'function') {
            tcpTrace('accept(no-onconnection)', connId, { port });
            return false;
          }
          const client = server.__accept(connId, remotePort);
          tcpTrace('accept→onconnection', connId, { port, onread: typeof client.onread, reading: client.reading });
          server.onconnection?.(0, client);
          tcpTrace('accept-done', connId, { onread: typeof client.onread, reading: client.reading, pending: client.pending.length });
          return true;
        }
      }
      tcpTrace('accept(no-listener)', connId, { port });
      return false;
    },
    /** Host: full port registry (broadcast) — the EADDRINUSE mirror. */
    setPortsInUse(ports: number[]): void {
      portsInUse = new Set(ports.map(Number));
    },
    /** Loop-drain truth: sockets + listening servers keep the process alive. */
    activeTcpCount(): number {
      return sockets.size + servers.size;
    },
    listeningPorts(): number[] {
      return [...servers.values()].map((s) => s.localPort).filter((p) => p > 0);
    },
    /** Host: connection ids owned by this kernel (cleanup on exit). */
    __connIds(): number[] { return [...sockets.keys()]; },
  };
}
