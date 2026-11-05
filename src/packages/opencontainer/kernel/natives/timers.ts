import type { Binding } from './index';

/**
 * internalBinding('timers') — bridges node's timer queues onto the browser's
 * timer primitives with SINGLE-ARMED wakeups (uv's own design: the loop has
 * exactly ONE outstanding timeout).
 *
 * node's contract with the C++ loop (src/node_task_queue.cc / timers.cc):
 *   - `scheduleTimer(msecs)` — "a timer was inserted that expires in ~msecs";
 *     the loop arms its single timeout, moving it EARLIER only.
 *   - `processTimers(uv_now())` (called by the loop at timeout) returns the
 *     next expiry (>0 refed, <0 unrefed-only, 0 = nothing pending); the loop
 *     re-arms from that return value.
 *   - `timeoutInfo[0]` / `immediateInfo[kRefCount]` — node's OWN refed-timer
 *     counts (incRefCount/decRefCount in insertGuarded) — the source of truth
 *     for "is the loop empty".
 *
 * The single-armed design is what keeps this leak-free: every wakeup is
 * deduplicated against the armed one, so wakeups can never accumulate into
 * self-sustaining chains (the bug that left 3 phantom "timers" pending and
 * blocked loop-drain exit detection forever).
 */
export function makeTimersBinding(): Binding {
  const g = globalThis as any;

  const immediateInfo = new Float64Array(4);
  const timeoutInfo = new Int32Array(1);

  // ---- single-armed loop wakeup (the browser stand-in for uv's loop timeout)
  let armedTimer: ReturnType<typeof setTimeout> | null = null;
  let armedAt = Infinity; // absolute getLibuvNow() time the wakeup fires at

  function getLibuvNow(): number {
    return g.performance?.now?.() ?? Date.now();
  }

  /** Arm THE wakeup driving processTimers. Earlier deadline always wins;
   *  later requests are absorbed (uv semantics: loop timeout only moves up). */
  function scheduleTimer(msecs: number): void {
    const at = getLibuvNow() + Math.max(0, msecs);
    if (armedTimer !== null && armedAt <= at) return; // armed one is earlier
    if (armedTimer !== null) clearTimeout(armedTimer);
    armedAt = at;
    // ceil → the host wakeup never fires sub-ms EARLY (which caused
    // truncation churn: expiry 428.2 armed at 427.4 → 0ms → 0ms → …).
    armedTimer = setTimeout(() => {
      armedTimer = null;
      armedAt = Infinity;
      try {
        g.__ocProcessTimers?.();
      } catch (e: any) {
        g.__ocDebugHook?.('[processTimers error] ' + String(e));
      }
    }, Math.ceil(Math.max(0, msecs)));
  }

  // ---- immediates: one scheduled host tick while any are queued
  const immediateScheduled = { scheduled: false };

  function toggleImmediateRef(ref: boolean): void {
    if (ref && !immediateScheduled.scheduled) {
      immediateScheduled.scheduled = true;
      setTimeout(() => {
        immediateScheduled.scheduled = false;
        try {
          g.__ocProcessImmediate?.();
        } catch (e: any) {
          g.__ocDebugHook?.('[processImmediate error] ' + String(e));
        }
      }, 0);
    }
  }

  return {
    kTimeout: Symbol('nodejs.timeout'),
    kRefed: Symbol('nodejs.timeout.refed'),
    kUnrefed: Symbol('nodejs.timeout.unrefed'),
    immediateInfo,
    timeoutInfo,
    timerListMap: new Map(),

    getLibuvNow,
    scheduleTimer,
    toggleTimerRef(_ref: boolean): void { /* ref counting is a no-op in browser */ },
    toggleImmediateRef,

    // ---- loop-drain detection (node: empty loop ⇒ process exits) ----
    // node's own refed counts — NOT host-wakeup counts (those would count
    // our driver internals and never reach zero while any wakeup chain lives).
    getActiveTimerCount(): number { return timeoutInfo[0]; },
    getActiveImmediateCount(): number { return immediateInfo[1]; },
  };
}
