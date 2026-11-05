/**
 * OpenContainer — the WebContainer-compatible API facade.
 *
 * A drop-in surface for code written against `@webcontainer/api`
 * (webcontainers.io API reference, researched 2026-11-06 — see
 * docs/webcontainer-research.md for the exact upstream shapes):
 *
 *   WebContainer.boot(options)              → Promise<WebContainer>
 *   container.mount(tree, { mountPoint })   → Promise<void>
 *   container.spawn(cmd, args, options)     → Promise<WebContainerProcess>
 *   container.on('server-ready'|'port'|'error'|'preview-message', fn)
 *                                           → unsubscribe function
 *   container.fs                            → FileSystemAPI
 *   container.path / container.workdir      → string
 *   container.teardown()
 *
 * Semantic deltas vs WebContainers (documented, never silent):
 *   - `coep` boot option is accepted and IGNORED — OpenContainer does not
 *     require cross-origin isolation (no SharedArrayBuffer dependency).
 *   - `WebContainerProcess.stderr` is an OpenContainer EXTENSION (upstream
 *     merges stderr into `output`; we do both).
 *   - mount() accepts FileSystemTree objects. Binary snapshots
 *     (`@webcontainer/snapshot` format) are NOT supported — mount a tree or
 *     use `importTree`.
 *   - The filesystem persists across page reloads (OPFS), with an ephemeral
 *     node_modules policy — BEYOND the WebContainer baseline (they reinstall
 *     every load); see COMPATIBILITY.md.
 */

import { OpenContainerRuntime } from './runtime';
import type {
  FileSystemTree, FileSystemEntry, DirectoryEntry, FileEntry,
  WebContainerProcess, ServerReadyListener, PortListener, ErrorListener,
  PreviewMessageListener,
} from './types';

export interface WebContainerBootOptions {
  /** Accepted for API compatibility. OpenContainer needs NO cross-origin
   *  isolation (no SharedArrayBuffer requirement) — this is a no-op. */
  coep?: 'require-corp' | 'credentialless' | 'none';
  /** Folder name of the working directory (default 'project'). */
  workdirName?: string;
  /** Accepted for compatibility; preview error forwarding is not wired. */
  forwardPreviewErrors?: boolean | 'exceptions-only';
  /** OpenContainer EXTENSION: adopt an already-booted OpenContainerRuntime
   *  (e.g. an IDE's terminal runtime) instead of booting a new one. The
   *  facade does not own its lifecycle — teardown() is a no-op then. */
  runtime?: OpenContainerRuntime;
}

type RuntimeEventListener = (info: any) => void;

export class WebContainer {
  private runtime: OpenContainerRuntime;
  private workdirPath: string;
  private unsubscribers: Array<() => void> = [];
  private tornDown = false;

  /** Default PATH handed to spawned processes (WebContainer exposes this). */
  readonly path = '/usr/local/bin:/usr/bin:/bin';

  private constructor(runtime: OpenContainerRuntime, workdirPath: string, private adopted: boolean) {
    this.runtime = runtime;
    this.workdirPath = workdirPath;
  }

  /** The underlying OpenContainerRuntime (embedding/test hook — e.g. to
   *  register the runtime with a page-level preview router). */
  get _runtime(): OpenContainerRuntime {
    return this.runtime;
  }

  /** Full path of the working directory. */
  get workdir(): string {
    return this.workdirPath;
  }

  /** Filesystem access (WebContainer FileSystemAPI shape). */
  readonly fs = {
    mkdir: async (path: string, options?: { recursive?: boolean }): Promise<void> => {
      // The VFS mkdir is inherently recursive-safe (ENOENT-free for parents);
      // the option is honored for API shape.
      void options;
      await this.runtime.mkdir(this.containerPath(path));
    },
    readdir: async (path: string): Promise<string[]> => {
      const entries = await this.runtime.readdir(this.containerPath(path));
      return entries.map((e) => e.name);
    },
    readFile: async (path: string, encoding?: 'utf-8' | 'utf8'): Promise<Uint8Array | string> => {
      const data = await this.runtime.readFile(this.containerPath(path));
      if (encoding === 'utf-8' || encoding === 'utf8') {
        return new TextDecoder().decode(data);
      }
      return data;
    },
    writeFile: async (path: string, contents: string | Uint8Array): Promise<void> => {
      const target = this.containerPath(path);
      if (typeof contents === 'string') {
        await this.runtime.writeFile(target, contents);
      } else {
        await this.runtime.writeBinaryFile(target, contents);
      }
    },
    rm: async (path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void> => {
      try {
        await this.runtime.rm(this.containerPath(path), { recursive: options?.recursive === true });
      } catch (err: any) {
        // force: ENOENT is not an error (node rm -f semantics).
        if (options?.force && err?.code === 'ENOENT') return;
        throw err;
      }
    },
    watch: async (
      path: string,
      listeners: {
        onWatchEvent?: (changeRecords: Array<{ path: string; type: 'created' | 'updated' | 'renamed' | 'deleted' }>) => void;
        onWatchError?: (error: unknown) => void;
        onWatchReady?: (dispose: () => void) => void;
      },
      _options?: { recursive?: boolean },
    ): Promise<() => void> => {
      const dispose = await this.runtime.watch(this.containerPath(path), (event) => {
        listeners.onWatchEvent?.([{
          path: event.filename ?? '',
          type: event.type === 'change' ? 'updated' : 'renamed',
        }]);
      });
      listeners.onWatchReady?.(dispose);
      return dispose;
    },
  };

  // -------------------------------------------------------------------- boot
  /** Boot a WebContainer. Mirrors the upstream single-instance contract:
   *  booting is expensive; call `teardown()` before booting a new one. */
  static async boot(options: WebContainerBootOptions = {}): Promise<WebContainer> {
    void options.coep; // no-op by design (no isolation requirement)
    void options.forwardPreviewErrors;
    const workdirName = options.workdirName ?? 'project';
    let runtime = options.runtime;
    let adopted = true;
    if (!runtime) {
      runtime = new OpenContainerRuntime({});
      await runtime.boot();
      adopted = false;
    }
    return new WebContainer(runtime, `/home/${workdirName}`, adopted);
  }

  // ------------------------------------------------------------------- mount
  /** Mount a FileSystemTree (files, symlinks, directories) into the
   *  container. `options.mountPoint` selects the target directory (default:
   *  the working directory). */
  async mount(tree: FileSystemTree, options?: { mountPoint?: string }): Promise<void> {
    this.assertNotTornDown();
    const base = options?.mountPoint
      ? this.containerPath(options.mountPoint)
      : this.workdirPath;
    const dirs: string[] = [];
    const files: Array<[string, Uint8Array]> = [];
    const symlinks: Array<[string, string]> = [];
    const walk = (node: FileSystemTree, prefix: string) => {
      for (const [name, entry] of Object.entries(node)) {
        const p = `${prefix}/${name}`;
        if ('directory' in (entry as DirectoryEntry)) {
          dirs.push(p);
          walk((entry as DirectoryEntry).directory, p);
        } else if ('file' in (entry as FileEntry)) {
          const spec = (entry as FileEntry).file as any;
          if (typeof spec.symlink === 'string') {
            symlinks.push([p, spec.symlink]);
          } else {
            const contents: Uint8Array = typeof spec.contents === 'string'
              ? new TextEncoder().encode(spec.contents)
              : spec.contents;
            files.push([p, contents]);
          }
        }
      }
    };
    walk(tree, base.replace(/\/+$/, ''));
    await this.runtime.importTree({ dirs, files, symlinks });
  }

  // ------------------------------------------------------------------- spawn
  /** Spawn a command with pipe stdio, WebContainer-process shaped. */
  async spawn(
    command: string,
    args: string[] | { cwd?: string; env?: Record<string, string>; output?: boolean; terminal?: { cols: number; rows: number } },
    options?: { cwd?: string; env?: Record<string, string>; output?: boolean; terminal?: { cols: number; rows: number } },
  ): Promise<WebContainerProcess> {
    this.assertNotTornDown();
    // Upstream overload: spawn(cmd, options) with no args.
    if (!Array.isArray(args)) {
      options = args as any;
      args = [];
    }
    const opts = options ?? {};
    const handle = await this.runtime.spawnProgram(command, args as string[], {
      cwd: opts.cwd ? this.containerPath(opts.cwd) : undefined,
      env: opts.env as Record<string, string> | undefined,
      terminal: opts.terminal,
    });
    // `output: false` — drop the output stream (accept + honor: cancel it).
    if (opts.output === false) {
      void handle.output.cancel();
    }
    return handle as unknown as WebContainerProcess;
  }

  // ------------------------------------------------------------------ events
  /** Subscribe; returns an unsubscribe function (upstream contract). */
  on(
    event: 'server-ready' | 'port' | 'error' | 'preview-message',
    listener: ServerReadyListener | PortListener | ErrorListener | PreviewMessageListener,
  ): () => void {
    this.assertNotTornDown();
    const rt = this.runtime;
    const wrap = (fn: (a: any, b: any) => void): RuntimeEventListener => (info: any) => fn(info.port, info);
    let off: () => void;
    switch (event) {
      case 'server-ready': {
        // 'listen' is our server-ready signal; the URL is the preview origin
        // (same-origin path form, like upstream's http://localhost:<port>).
        off = rt.on('listen', wrap((port, info) => {
          (listener as ServerReadyListener)(port, `http://localhost:${port}`);
          void info;
        }) as any);
        break;
      }
      case 'port': {
        const openOff = rt.on('listen', wrap((port) => {
          (listener as PortListener)(port, 'open', `http://localhost:${port}`);
        }) as any);
        const closeOff = rt.on('unlisten', wrap((port) => {
          (listener as PortListener)(port, 'close', `http://localhost:${port}`);
        }) as any);
        off = () => { openOff(); closeOff(); };
        break;
      }
      case 'error': {
        off = rt.on('error', ((err: any) => {
          (listener as ErrorListener)({ message: String(err?.message ?? err) });
        }) as any);
        break;
      }
      case 'preview-message': {
        // Preview error forwarding is not implemented; accept the listener
        // (no-op) so upstream code runs unmodified.
        off = () => {};
        break;
      }
      default:
        throw new Error(`WebContainer: unknown event '${String(event)}'`);
    }
    this.unsubscribers.push(off);
    return off;
  }

  // ---------------------------------------------------------------- teardown
  /** Destroy the container and release every resource. */
  teardown(): void {
    if (this.tornDown) return;
    this.tornDown = true;
    for (const off of this.unsubscribers) {
      try { off(); } catch { /* already unsubscribed */ }
    }
    this.unsubscribers = [];
    // An ADOPTED runtime is not ours to destroy (the embedder owns it).
    if (!this.adopted) this.runtime.teardown();
  }

  // ---------------------------------------------------------------- internal
  /** Resolve a WebContainer-style path (absolute or workdir-relative) to a
   *  container path. Upstream examples mount at the container root and use
   *  paths like '/package.json' RELATIVE TO the working directory. */
  private containerPath(p: string): string {
    if (p.startsWith('/')) {
      // Absolute WebContainer paths address the WORKDIR subtree.
      const joined = this.workdirPath + (p === '/' ? '' : p);
      return this.normalize(joined);
    }
    return this.normalize(`${this.workdirPath}/${p}`);
  }

  private normalize(p: string): string {
    const out: string[] = [];
    for (const seg of p.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') { out.pop(); continue; }
      out.push(seg);
    }
    return '/' + out.join('/');
  }

  private assertNotTornDown(): void {
    if (this.tornDown) throw new Error('WebContainer: this instance was torn down');
  }
}
