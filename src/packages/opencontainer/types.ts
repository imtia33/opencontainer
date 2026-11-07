/**
 * OpenContainer — public API types (drop-in compatible with @webcontainer/api).
 *
 * These types mirror the publicly documented WebContainer API so that
 * `import { WebContainer } from '@open-webcontainer/api'` is a drop-in
 * replacement for `@webcontainer/api`. Field semantics follow the public
 * docs; see COMPATIBILITY.md for documented behavioral differences.
 */

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

/** COEP value required by the embedding page (OpenContainer works with any; kept for API compat). */
export type COEPCrossOriginIsolated = 'credentialless' | 'require-corp';

export interface WebContainerOptions {
  /** Where to place the project working directory. Default: 'project'. */
  workdirName?: string;
  /**
   * COOP/COEP header configuration of the embedding page.
   * NOTE: unlike WebContainers, OpenContainer's default engine does NOT
   * require SharedArrayBuffer, so this option is accepted for API
   * compatibility but has no effect on functionality.
   */
  coep?: COEPCrossOriginIsolated;
  /** Forward console errors of preview iframes to the WebContainer 'error' event. */
  forwardPreviewErrors?: boolean;
  /**
   * OpenContainer extension: extra boot options (not part of the WebContainer API).
   */
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/* Filesystem tree (mount format — exact @webcontainer/api shapes)      */
/* ------------------------------------------------------------------ */

export interface DirectoryEntry {
  /** Marks the entry as a directory. */
  directory: Record<string, FileSystemEntry>;
}

export interface BinaryFile {
  /** Raw binary contents. */
  contents: Uint8Array;
}

export interface TextFile {
  /** UTF-8 text contents. */
  contents: string;
}

/** Upstream FileNode: `{ file: { contents: string | Uint8Array } }`. */
export interface FileEntry { file: TextFile | BinaryFile }

/** Upstream SymlinkNode: `{ file: { symlink: 'target' } }` — first-class
 *  symlinks in the mount format (webcontainers.io API reference). */
export interface SymlinkEntry {
  file: { symlink: string };
}

export type FileSystemEntry = DirectoryEntry | FileEntry | SymlinkEntry;

export type FileSystemTree = Record<string, FileSystemEntry>;

/* ------------------------------------------------------------------ */
/* Filesystem API                                                      */
/* ------------------------------------------------------------------ */

export type FileContents = Uint8Array | string;

export interface FileSystemAPIClient {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  readFile(path: string, encoding: 'utf-8' | 'utf8'): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, contents: FileContents): Promise<void>;
  rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>;
  /**
   * WebContainer extension: watch a path for changes.
   * Callbacks receive an array of file system change records.
   */
  watch(
    path: string,
    listeners: {
      onWatchEvent?: (changeRecords: FileSystemChangeRecord[]) => void;
      onWatchError?: (error: unknown) => void;
      onWatchReady?: (dispose: () => void) => void;
    },
    options?: { recursive?: boolean }
  ): Promise<() => void>;
}

export interface FileSystemChangeRecord {
  /** The path of the file entry that changed. */
  path: string;
  /** The type of change. */
  type: 'created' | 'updated' | 'renamed' | 'deleted';
}

/* ------------------------------------------------------------------ */
/* Processes                                                           */
/* ------------------------------------------------------------------ */

export interface SpawnOptions {
  /** Command is executed with a custom current working directory. */
  cwd?: string;
  /** Environment variables accessible to the command. */
  env?: Record<string, string>;
  /**  Specifications for the stdio pipes (accepted for API compatibility). */
  stdio?: { stdout?: 'pipe'; stderr?: 'pipe' };
}

export interface ExecOptions extends SpawnOptions {
  /** Command is executed with a custom environment variable. */
  env?: Record<string, string>;
}

export interface WriteBuffer {
  write(data: string): void | Promise<void>;
}

export interface ServerReadyEvent {
  port: number;
  type: 'server-ready';
}

export interface PortEvent {
  port: number;
  type: 'open' | 'close';
}

export interface WebContainerProcess {
  /** The exit code of the process. */
  readonly exit: Promise<number>;
  /** A writable stream for stdin. */
  readonly input: WritableStream<string>;
  /** A readable stream for stdout. */
  readonly output: ReadableStream<string>;
  /** A readable stream for stderr. */
  readonly stderr: ReadableStream<string>;
  /** Resize the terminal window of the process. */
  resize(size: { cols: number; rows: number }): void;
  /** Terminate the process (SIGINT → SIGKILL semantics; see COMPATIBILITY.md). */
  kill(): void;
}

export type ServerReadyListener = (port: number, url: string) => void;
export type PortListener = (port: number, type: 'open' | 'close', url: string) => void;
/** Upstream shape: receives `{ message }` (webcontainers.io API reference). */
export type ErrorListener = (error: { message: string }) => void;
export type PreviewMessageListener = (data: unknown) => void;

export interface RuntimeInfo {
  /** Honest identity of the executing runtime (never a fake Node.js version). */
  engine: {
    name: string;
    version: string;
    jsEngine: string;
    nodeApiLevel: number;
    platform: string;
    arch: string;
  };
  npm: {
    name: string;
    version: string;
    registry: string;
  };
  shell: {
    name: string;
    version: string;
  };
  memoryUsage?: number;
}
