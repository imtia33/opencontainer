import type { Binding, NativesContext } from './index';

const NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN = 7;
const NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN_TIMESTAMP = 6;

/** internalBinding('performance') — timers via performance.now. */
const perfObservers: Record<string, (list: any) => void> = {};

export function makePerformanceBinding(ctx: NativesContext): Binding {
  const now = () => (globalThis as any).performance?.now?.() ?? ctx.hooks.now();
  const t0ns = BigInt(Math.floor(now() * 1e6));
  // node's milestones are nanosecond entries indexed by NODE_PERFORMANCE_MILESTONE_*
  const milestones = new Float64Array(32);
  milestones[NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN] = Number(t0ns);
  milestones[NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN_TIMESTAMP] = Date.now() * 1e3;

  return {
    // Top-level `now` — internal/perf/utils.js destructures
    // `internalBinding('performance').now` (S3.1: its absence made
    // perf_hooks.performance.now() throw "now is not a function" — found
    // via Vite's `performance.now()` at bin startup).
    now,
    timerFast: { now },
    milestones,
    timerStart: undefined,
    timerEnd: undefined,
    timerInit: undefined,

    /** internal/perf/performance uses these */
    nowMilliseconds(): number { return now(); },
    setupObservers(observers: Record<string, (list: any) => void>) {
      // PerformanceObserver subscription hook — perf entries are minimal in
      // the browser runtime; observers are stored but rarely fire (S2).
      try { Object.assign(perfObservers, observers); } catch { /* frozen? */ }
    },
    /** Perf-observer counts per entry type (perf/observe.js hasObserver). */
    observerCounts: new Int32Array(16),
    constants: {
      NODE_PERFORMANCE_ENTRY_TYPE_NODE_START: 0,
      NODE_PERFORMANCE_ENTRY_TYPE_NODE_BOOTSTRAP_COMPLETE: 1,
      NODE_PERFORMANCE_ENTRY_TYPE_BOOTSTRAP_COMPLETE: 2,
      NODE_PERFORMANCE_ENTRY_TYPE_ENVIRONMENT: 3,
      NODE_PERFORMANCE_ENTRY_TYPE_LOOP_START: 4,
      NODE_PERFORMANCE_ENTRY_TYPE_LOOP_EXIT: 5,
      NODE_PERFORMANCE_ENTRY_TYPE_GC: 6,
      NODE_PERFORMANCE_ENTRY_TYPE_HTTP2: 7,
      NODE_PERFORMANCE_ENTRY_TYPE_HTTP: 8,
      NODE_PERFORMANCE_ENTRY_TYPE_NET: 9,
      NODE_PERFORMANCE_ENTRY_TYPE_DNS: 10,
      NODE_PERFORMANCE_ENTRY_TYPE_QUIC: 11,
      NODE_PERFORMANCE_MILESTONE_NODE_START: 0,
      NODE_PERFORMANCE_MILESTONE_NODE_BOOTSTRAP_COMPLETE: 1,
      NODE_PERFORMANCE_MILESTONE_BOOTSTRAP_COMPLETE: 2,
      NODE_PERFORMANCE_MILESTONE_ENVIRONMENT: 3,
      NODE_PERFORMANCE_MILESTONE_LOOP_START: 4,
      NODE_PERFORMANCE_MILESTONE_LOOP_EXIT: 5,
      NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN_TIMESTAMP: 6,
      NODE_PERFORMANCE_MILESTONE_TIME_ORIGIN: 7,
    },
    nowBigInt(): bigint { return BigInt(Math.floor(now() * 1e6)); },
    milestoneUpdateTimeOrigin: () => {},
    setupPerfDefaults: () => {},

    /** pre_execution.js:828 — marks bootstrap complete (perf milestone). */
    markBootstrapComplete() {
      milestones[2] = Number(BigInt(Math.floor(now() * 1e6)));
    },

    /** internal/perf/milestone — exposed via performance.getMilestones(). */
    getMilestones() { return milestones; },

    // eventLoopUtilization — internal/perf/performance
    eventLoopUtilization(usage1?: any, usage2?: any) {
      const idle = 0, active = 0;
      const u = { idle, active, utilization: 0 };
      return u;
    },
    loopIdleTime: () => 0,
  };
}
