import type { Binding, NativesContext } from './index';

/**
 * internalBinding('process_wrap') — the Process handle behind node's REAL
 * child_process.spawn().
 *
 * Browser-native execution model (documented divergence, not a fake):
 * there is no fork()/execve() in a worker, so every "process" is a fresh
 * kernel instance (worker) created by the HOST ProcessManager. This binding
 * is the PARENT side of that bridge:
 *
 *   - spawn() resolves the executable exactly like execvp (PATH lookup in
 *     the VFS), parses its shebang (the kernel's execve equivalent), assigns
 *     the pid + stdio pipe ids synchronously, then posts the spawn request
 *     to the host. exec failures surface through onexit(errno) — the same
 *     path node uses when execvp fails in the forked child.
 *   - kill() maps signals onto the host process manager: SIGINT is delivered
 *     to the child kernel (JS signal semantics, exit 130 by default);
 *     SIGTERM/SIGKILL terminate the child worker (the closest browser
 *     equivalent of a hard kill).
 *   - pipe stdio is routed through the pipe_wrap binding (virtual pipes).
 *
 * spawn_sync (execFileSync & friends) throws ENOSYS honestly — synchronous
 * nested execution cannot exist inside one JS turn.
 */

export interface StdioEntry {
  type: 'pipe' | 'inherit' | 'ignore' | 'fd' | 'wrap' | 'overlapped';
  handle?: any;
  readable?: boolean;
  writable?: boolean;
  ipc?: boolean;
  fd?: number;
}

export interface ChildSpawnRequest {
  pid: number;
  /** JS entry to run as the new node process (shebang-resolved). */
  file: string | null; // null = the node interpreter itself (`node …`)
  args: string[];
  interpreter: 'node';
  cwd: string;
  env: Record<string, string>;
  stdio: Array<{ type: 'pipe'; pipeId: number } | { type: 'inherit' } | { type: 'ignore' }>;
  nodeArgs: string[]; // for file === null: flags like -e/-p plus the script
}

export function makeProcessWrapBinding(ctx: NativesContext): Binding {
  const hooks: any = ctx.hooks;
  /** Children spawned by THIS process: pid → record. */
  const children = new Map<number, { file: string; alive: boolean }>();
  /** Live Process instances (host exit notifications fan out through onexit). */
  const liveProcesses = new Set<any>();
  let pidCounter = (globalThis as any).__ocPidBase ?? 100;
  let pipeIdCounter = (globalThis as any).__ocPipeIdBase ?? 1;

  /** execvp-equivalent PATH resolution against the VFS. */
  function resolveExecutable(file: string, env: Record<string, string>): string | number {
    if (file.includes('/')) {
      // Relative paths resolve against the cwd (execve semantics).
      const abs = file.startsWith('/') ? file : ctx.cwd() + '/' + file;
      try { ctx.vfs.stat(abs); } catch { return -2; } // UV_ENOENT
      return abs;
    }
    const path = (env.PATH ?? '').split(':').filter(Boolean);
    for (const dir of path) {
      const candidate = dir.endsWith('/') ? dir + file : dir + '/' + file;
      try { ctx.vfs.stat(candidate); return candidate; } catch { /* keep looking */ }
    }
    return -2; // UV_ENOENT
  }

  /** execve's interpreter step, in JS: parse the shebang line.
   *  `#!/usr/bin/env node` resolves the ARG as the interpreter (env(1)
   *  semantics) — flags like -S are skipped. */
  function parseShebang(path: string): { interpreter: string; arg?: string } | null {
    let head = '';
    try {
      head = new TextDecoder().decode(ctx.vfs.readFile(path).subarray(0, 256));
    } catch {
      return null;
    }
    const m = /^#!([^\n\r]*)/.exec(head);
    if (!m) return null;
    const parts = m[1].trim().split(/\s+/);
    let interp = parts[0] ?? '';
    if (interp.split('/').pop() === 'env' || interp === '/usr/bin/env' || interp === 'env') {
      // env: the program follows (skipping env flags like -S).
      const rest = parts.slice(1);
      const program = rest.find((p) => !p.startsWith('-')) ?? '';
      if (program) interp = program;
    }
    return { interpreter: interp, arg: parts[1] };
  }

  /** Normalize an interpreter path/name to our supported set. */
  function interpreterKind(interp: string): 'node' | 'sh' | 'unsupported' {
    const base = interp.split('/').pop() ?? interp;
    if (base === 'node' || base === 'node.exe' || interp === '/usr/local/bin/node' || interp === '/usr/bin/node') return 'node';
    if (base === 'sh' || base === 'bash' || base === 'dash' || base === 'zsh') return 'sh';
    return 'unsupported';
  }

  const NODE_BIN = new Set(['/usr/local/bin/node', '/usr/bin/node', '/bin/node']);

  class Process {
    onexit: ((exitCode: number, signalCode: string | null) => void) | null = null;
    pid: number = 0;
    private myPid: number | null = null;
    /** uv_unref semantics: an unref'd child no longer holds this process's
     *  loop open (its exit still fires). esbuild's service host unrefs its
     *  long-lived child so builds don't hang the parent. */
    unrefed = false;

    constructor() {
      liveProcesses.add(this);
    }

    /**
     * node's C++ uv_spawn entry (internal/child_process.js calls this with
     * exactly this positional signature).
     */
    spawn(file: string, args: string[], cwd: string | undefined,
          envPairs: string[] | undefined, stdio: StdioEntry[] | undefined,
          _flags: number, _uid: number | undefined, _gid: number | undefined): number {
      if (!file) return -2;

      // IPC ('fork()', stdio:'ipc') needs a node IPC channel — not provided.
      if (stdio && stdio.some((s) => s && s.ipc)) {
        throw new Error(
          "OpenContainer: child_process IPC channels (fork()/stdio:'ipc') are not supported — " +
          'spawn with pipe/inherit/ignore stdio works');
      }

      const env: Record<string, string> = {};
      for (const pair of envPairs ?? []) {
        const eq = pair.indexOf('=');
        if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
      }
      if (envPairs === undefined) {
        // node defaults to the parent's environment.
        Object.assign(env, (globalThis as any).__ocEnv?.() ?? {});
      }

      // ---- execvp: resolve the executable in the VFS -----------------------
      const resolved = resolveExecutable(file, env);
      if (typeof resolved === 'number') {
        queueMicrotask(() => this.onexit?.(resolved, null));
        return 0;
      }

      // ---- execve: interpret the shebang ------------------------------------
      // normalizeSpawnArguments UNSHIFTS the file (argv0) onto args — the
      // real arguments start at index 1.
      const argv = (args ?? []);
      const realArgs = argv.length > 0 ? argv.slice(1) : [];
      let script: string | null = null;   // JS file to run under node
      let nodeArgs: string[] = [];

      if (NODE_BIN.has(resolved)) {
        // `node [flags] [script]` — the interpreter itself.
        nodeArgs = realArgs;
        script = null;
      } else {
        const shebang = parseShebang(resolved);
        const kind = shebang ? interpreterKind(shebang.interpreter) : 'unsupported';
        if (shebang && kind === 'node') {
          script = resolved;
        } else if (shebang && kind === 'sh') {
          // Our sh IS a node program — uniform handling.
          script = shebang.interpreter.startsWith('/') ? shebang.interpreter : resolveExecutable(shebang.interpreter, env) as string;
          if (typeof script !== 'string') {
            queueMicrotask(() => this.onexit?.(-8, null)); // UV_ENOEXEC
            return 0;
          }
        } else if (!shebang) {
          queueMicrotask(() => this.onexit?.(-8, null)); // UV_ENOEXEC
          return 0;
        } else {
          // python/perl/ruby… — honest failure, exactly like execve ENOEXEC.
          queueMicrotask(() => this.onexit?.(-8, null));
          return 0;
        }
      }

      // ---- stdio pipes -------------------------------------------------------
      const childStdio: ChildSpawnRequest['stdio'] = [];
      const handles: any[] = [];
      if (stdio) {
        for (const s of stdio) {
          if (!s) { childStdio.push({ type: 'ignore' }); continue; }
          if (s.type === 'pipe' || s.type === 'overlapped') {
            const pipeId = pipeIdCounter++;
            childStdio.push({ type: 'pipe', pipeId });
            if (s.handle) {
              s.handle.pipeId = pipeId;
              handles.push(s.handle);
              // Register the parent-side handle in the pipe binding so
              // host-routed child output finds it (open() never runs here).
              const pipeB = (globalThis as any).getInternalBinding?.('pipe_wrap');
              pipeB?.__registerHandle?.(pipeId, s.handle);
            }
          } else if (s.type === 'inherit'
            // stdioStringToArray('inherit') → [0, 1, 2] fd numbers.
            || (s.type === 'fd' && s.fd !== undefined && s.fd >= 0 && s.fd <= 2)) {
            childStdio.push({ type: 'inherit' });
          } else {
            childStdio.push({ type: 'ignore' });
          }
        }
      } else {
        childStdio.push({ type: 'ignore' }, { type: 'ignore' }, { type: 'ignore' });
      }

      const pid = pidCounter++;
      this.pid = pid;
      this.myPid = pid;
      children.set(pid, { file: resolved, alive: true, unrefed: this.unrefed });

      const req: ChildSpawnRequest = {
        pid,
        file: script,
        args: script === null ? [] : realArgs,
        interpreter: 'node',
        cwd: cwd || ctx.cwd(),
        env,
        stdio: childStdio,
        nodeArgs,
      };
      // Flush any pending VFS deltas FIRST: the child boots from the host
      // snapshot, and writes made just before spawn() (e.g. .bin scripts)
      // must be visible to it. Without this the microtask flush lands after
      // the child's hydrate — a classic ordering trap.
      (globalThis as any).__ocFlushVfsDeltas?.();
      hooks.onChildSpawn?.(req);
      return 0;
    }

    kill(signal: number | string): number {
      const pid = this.myPid;
      if (pid === null) return 0;
      const child = children.get(pid);
      if (!child || !child.alive) return -3; // UV_ESRCH
      hooks.onChildKill?.(pid, typeof signal === 'string' ? signal : signalName(Number(signal)));
      return 0;
    }

    close() {
      liveProcesses.delete(this);
      if (this.myPid !== null && children.get(this.myPid)?.alive === false) {
        children.delete(this.myPid);
      }
    }
    ref() { this.unrefed = false; }
    unref() {
      this.unrefed = true;
      // Keep the registry entry (exit must still fire) but drop its loop
      // hold — node's ChildProcess.unref() does exactly this to the handle.
      if (this.myPid !== null) {
        const c = children.get(this.myPid);
        if (c) c.unrefed = true;
      }
    }
  }

  function signalName(n: number): string {
    // Signal numbering per node's constants (SIGINT=2, SIGTERM=15, SIGKILL=9).
    const names: Record<number, string> = { 2: 'SIGINT', 9: 'SIGKILL', 15: 'SIGTERM' };
    return names[n] ?? 'SIGTERM';
  }

  return {
    Process,
    constants: {
      kProcessFlagDetached: 1,
      kProcessFlagWindowsHide: 2,
      kProcessFlagWindowsVerbatimArguments: 4,
    },
    /** child_process.js: serialize this process's env as K=V pairs. */
    getEnvPairs(): string[] {
      const env = (globalThis as any).__ocEnv?.() ?? {};
      return Object.entries(env).map(([k, v]) => `${k}=${v}`);
    },

    // ---- host bridge surface (worker-entry RPC calls in) --------------------
    /** Host: the child exited. exitCode<0 means a spawn errno (error event). */
    notifyChildExit(pid: number, exitCode: number, signalCode: string | null): void {
      const child = children.get(pid);
      if (child) child.alive = false;
      // Every live Process instance with this pid gets its onexit — a pid is
      // owned by exactly one Process object, mirrored here for the registry.
      for (const p of liveProcesses) {
        if ((p as any).myPid === pid) {
          p.onexit?.(exitCode, signalCode);
        }
      }
    },
    /** Loop-drain truth: live children keep the parent process alive —
     *  EXCEPT unref'd ones (uv semantics). */
    activeChildCount(): number {
      let n = 0;
      for (const c of children.values()) if (c.alive && !c.unrefed) n++;
      return n;
    },
    /** Host: allocate pipe ids in a fresh base for this process. */
    __setPipeIdBase(base: number): void { pipeIdCounter = base; },
  };
}
