/**
 * OpenContainer — fetch-as-loop-handle accounting (P1, Workstream B).
 *
 * In node, every pending socket op is a live uv handle: the event loop stays
 * alive while a request is in flight, and `process.exit` cannot fire from
 * under it (npm's "Exit handler never was never called!" is exactly what
 * happens when it does). In the browser worker, an in-flight `fetch()` is
 * invisible to the kernel's timer/pipe/tcp handle census — so a long
 * packument fetch looked like an empty loop and the drain watcher killed
 * npm mid-request.
 *
 * Fix: every guest-visible fetch (and the fetch-backed http client's
 * requests) increments a global counter while in flight; the loop-drain
 * watcher (boot.ts kernelLoopEmpty) and hasLiveHandles() treat
 * `netPendingCount() > 0` as a live handle, exactly like a uv req.
 */

let pending = 0;

/** Number of guest network ops currently in flight (loop-handle census). */
export function netPendingCount(): number {
  return pending;
}

/**
 * Wrap a fetch implementation with in-flight accounting. Composable and
 * idempotent-safe: wrapping an already-counted fetch double-counts, so the
 * wrapper carries a marker and re-wraps are collapsed by wrapGuestFetch
 * (see below) rather than here.
 */
export function wrapFetchForNetPending(fetchImpl: typeof fetch): typeof fetch {
  const wrapped = ((input: any, init?: any) => {
    pending++;
    let p: Promise<any>;
    try {
      p = Promise.resolve((fetchImpl as any)(input, init));
    } catch (err) {
      pending--;
      throw err;
    }
    return p.finally(() => { pending--; });
  }) as any;
  (wrapped as any).__ocNetCounted = true;
  return wrapped;
}

/**
 * Install the accounting wrapper on globalThis.fetch exactly once per
 * realm (the kernel may boot multiple times in one harness process; the
 * worker installs its registry-rewriting wrapper separately — order does
 * not matter, counting happens at the innermost layer).
 */
export function installNetPendingGlobalFetch(): void {
  const g = globalThis as any;
  if (typeof g.fetch !== 'function') return;
  if ((g.fetch as any).__ocNetCounted) return;
  g.fetch = wrapFetchForNetPending(g.fetch);
}
