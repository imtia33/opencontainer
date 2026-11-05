/**
 * OpenContainer Kernel — in-process MessagePort/MessageChannel.
 *
 * Node MessagePort semantics on linked event emitters (no serialization:
 * in-process delivery passes the exact object — strictly more capable than
 * structured clone; port "transfer" is a no-op pass-through since both ends
 * live in the same realm). Used by:
 *   - internalBinding('messaging') (io.js's MessagePort/MessageChannel)
 *   - internalBinding('worker')    (worker_threads control + public ports)
 *
 * The class is deliberately surgery-tolerant: internal/worker/io.js
 * re-parents MessagePort.prototype onto NodeEventTarget.prototype at load
 * time and copies ref/unref/hasRef/close descriptors off a saved clone.
 * All methods here are own prototype properties, so they survive that
 * surgery untouched (verified against io.js's property juggling).
 */

type Listener = (...args: any[]) => void;

export class EmuPort {
  private peer: EmuPort | null = null;
  private listeners = new Map<string, Set<Listener>>();
  private closed = false;
  /**
   * When set, message delivery into THIS port's listeners runs inside the
   * callback — used to arm the worker-dispatch window so process.exit()
   * inside a worker script's parentPort handler exits only that worker.
   */
  dispatchTrap: ((deliver: () => void) => void) | null = null;

  static pair(): [EmuPort, EmuPort] {
    const a = new EmuPort();
    const b = new EmuPort();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  on(event: string, fn: Listener): this {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(fn);
    return this;
  }

  once(event: string, fn: Listener): this {
    const wrapped: Listener = (...args: any[]) => {
      this.off(event, wrapped);
      fn(...args);
    };
    return this.on(event, wrapped);
  }

  off(event: string, fn: Listener): this {
    this.listeners.get(event)?.delete(fn);
    return this;
  }

  emit(event: string, ...args: any[]): boolean {
    if (this.closed) return false;
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return false;
    for (const fn of [...set]) {
      try { fn(...args); } catch (err) {
        // A listener crash must not break delivery of remaining messages;
        // route to the uncaught machinery like node's async hooks would.
        queueMicrotask(() => { throw err; });
      }
    }
    return true;
  }

  /** Deliver `data` to the peer's 'message' listeners (async, ordered). */
  postMessage(data: any, _transferList?: any): void {
    if (this.closed || !this.peer || this.peer.closed) return;
    const peer = this.peer;
    if ((globalThis as any).__ocWorkerMsgDebug) {
      try {
        const d = data as any;
        (globalThis as any).__ocWorkerMsgDebug(
          `${data === false ? 'shutdown' : d?.type ?? (d?.status ? `reply:${d.status}` : '?')} ${d?.error ? 'ERROR code=' + d.error.code + ' msg=' + String(d.error.message).slice(0, 300) : ''} ${d?.value !== undefined ? 'value:' + (typeof d.value === 'object' ? Object.keys(d.value ?? {}).slice(0, 8).join(',') : String(d.value)) : ''}`,
        );
      } catch { /* probe must never break delivery */ }
    }
    queueMicrotask(() => {
      const deliver = () => peer.emit('message', data);
      if (peer.dispatchTrap) peer.dispatchTrap(deliver);
      else deliver();
    });
  }

  /** Explicit close: signals both ends (node emits 'close' on each). */
  close(_cb?: () => void): void {
    if (this.closed) return;
    this.closed = true;
    const peer = this.peer;
    this.listeners.clear();
    if (peer && !peer.closed) {
      peer.closed = true;
      peer.emit('close');
      peer.listeners.clear();
    }
    this.emit('close');
  }

  // -- node MessagePort API surface (no-ops / informational in-process) ----
  start(): void { /* browser ports auto-start; emitters always deliver */ }
  ref(): void { /* in-process workers share the main loop */ }
  unref(): void { /* ditto */ }
  hasRef(): boolean { return false; }
}

export class EmuMessageChannel {
  port1: EmuPort;
  port2: EmuPort;
  constructor() {
    [this.port1, this.port2] = EmuPort.pair();
  }
}
