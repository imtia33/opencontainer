/**
 * OpenContainer IDE — typed, UI-independent container API (§4 of the IDE
 * spec). This is the ONLY seam frontend code may use: it wraps the
 * OpenContainerRuntime process manager and adds the project registry,
 * import/export (ZIP, GitHub tarball) and diagnostics aggregation.
 *
 * No React, no DOM beyond what the runtime itself needs (IndexedDB for the
 * project registry, fetch for GitHub imports) — another application can
 * embed OpenContainer through this module directly.
 */

import type { OpenContainerRuntime } from '../runtime';
import { FsRpcError } from '../runtime';

// --------------------------------------------------------------------- types

export interface DirEntry {
  name: string;
  kind: 'file' | 'dir' | 'symlink';
  size: number;
  mtimeMs: number;
}

export interface StatInfo {
  kind: 'file' | 'dir' | 'symlink';
  size: number;
  mtimeMs: number;
  mode: number;
}

export type FsWatchEvent = { type: 'rename' | 'change'; filename: string | null };
export type Unsubscribe = () => void;

export interface ProjectMeta {
  id: string;
  name: string;
  /** Absolute VFS root of the project, e.g. /home/projects/my-app. */
  rootPath: string;
  createdAt: number;
  lastOpenedAt: number;
  /** Import provenance: 'new' | 'zip' | 'github' | 'directory' | 'legacy'. */
  source: string;
  /** GitHub origin (owner/repo) when imported from GitHub. */
  githubRepo?: string;
}

export interface ContainerEventMap {
  'fs-change': FsWatchEvent;
  'listen': { port: number; pid: number };
  'unlisten': { port: number; pid: number };
  'process-start': { pid: number; repl: boolean; background: boolean };
  'process-exit': { pid: number; code: number | null; signal: string | null };
  'stdio': { fd: 1 | 2; chunk: string };
  'ready': { nodeVersion: string; bootMs?: number };
  'boot-progress': { phase: string };
  'error': { message: string };
  'projects-changed': { reason: string; project?: ProjectMeta };
}

export interface Diagnostics {
  nodeVersion: string | null;
  bootMs: number | null;
  bootPhases: Record<string, number> | null;
  processCount: number;
  processes: Array<{ pid: number; repl: boolean; background: boolean; ports: number[]; exited: boolean }>;
  ports: number[];
  workerCount: number;
  mainThreadHeap: { usedJSHeapMB: number; totalJSHeapMB: number } | null;
  vfs?: {
    fileCount: number;
    dirCount: number;
    symlinkCount: number;
    vfsBytes: number;
    treeWalkMs: number;
    storage: { usage?: number; quota?: number } | null;
    pid: number | null;
    moduleCount: number | null;
  };
}

export interface ImportProgress {
  phase: 'fetch' | 'unpack' | 'write';
  /** 0..1 where measurable. */
  fraction?: number;
  detail?: string;
}

export interface ImportResult {
  project: ProjectMeta;
  fileCount: number;
  /** Paths dropped at import (node_modules, .git, caches…) — REPORTED,
   *  never silently discarded. Capped at 200 entries; use skippedCount. */
  skipped: string[];
  skippedCount: number;
}

/** Directory segments (at ANY depth) that are never imported — they are
 *  regenerated in-container by npm/pnpm install or pure local caches.
 *  S9: the user's rule — "uploading a local project ignores node_modules;
 *  we add them virtually as needed". */
const IGNORED_DIR_SEGMENTS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.turbo',
  '.cache',
  '.parcel-cache',
  '.pnpm-store',
  '.vercel',
  '.yarn',
  'coverage',
  '__MACOSX',
  'tmp',
]);

/** Filter for import paths (relative, `/`-separated). Keep dist/ and
 *  build/ — some projects ship needed committed artifacts. */
export function isIgnoredImportPath(rel: string): boolean {
  if (rel === '.DS_Store' || rel.endsWith('/.DS_Store')) return true;
  const segs = rel.split('/');
  return segs.some((s) => IGNORED_DIR_SEGMENTS.has(s));
}

/** Directory BASE-name check for the File System Access import walk —
 *  derived from the same IGNORED_DIR_SEGMENTS as isIgnoredImportPath so
 *  the two import paths can never drift apart. */
function isIgnoredDirName(name: string): boolean {
  return IGNORED_DIR_SEGMENTS.has(name);
}

// ------------------------------------------------------------- project store

/** Projects registry lives in main-thread IndexedDB (IDE metadata, not guest
 *  state — the guest VFS holds the actual files under /home/projects). */
const DB_NAME = 'opencontainer-ide';
const DB_VERSION = 1;
const STORE = 'projects';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
    t.oncomplete = () => db.close();
  });
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const all = await tx<ProjectMeta[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function putProject(meta: ProjectMeta): Promise<void> {
  await tx('readwrite', (s) => s.put(meta));
}

export async function deleteProject(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}

// ------------------------------------------------------------------ helpers

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return s || 'project';
}

/** Decode bytes → text unless they look binary (NUL or lone surrogates). */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

// ----------------------------------------------------------- host-side tar

/** Minimal ustar/GNU/pax tar READER for the main thread (GitHub imports).
 *  The kernel has the full npm-oc/tar.js; this is the host twin, kept
 *  deliberately small: header checksums, typeflags 0/'L'/'K'/'x'/'g',
 *  path-escape containment. Returns entries with relative paths. */
export interface TarEntry {
  path: string;
  data: Uint8Array;
}

export function parseTar(buf: Uint8Array): TarEntry[] {
  const out: TarEntry[] = [];
  let i = 0;
  let pendingLongName: string | null = null;
  let pendingLongLink: string | null = null;
  const readString = (off: number, len: number): string => {
    let end = off;
    const max = off + len;
    while (end < max && buf[end] !== 0) end++;
    let s = '';
    for (let j = off; j < end; j++) s += String.fromCharCode(buf[j]);
    return s;
  };
  const readOctal = (off: number, len: number): number => {
    const s = readString(off, len).trim();
    return s ? parseInt(s, 8) : 0;
  };
  while (i + 512 <= buf.length) {
    const block = buf.subarray(i, i + 512);
    if (block.every((b) => b === 0)) break; // end-of-archive
    // Checksum: sum of header bytes with chksum field as spaces.
    const stored = readOctal(i + 148, 8);
    let sum = 0;
    for (let j = 0; j < 512; j++) sum += j >= 148 && j < 156 ? 32 : block[j];
    if (sum !== stored) throw new Error(`tar: header checksum mismatch at byte ${i}`);
    const size = readOctal(i + 124, 12);
    const typeflag = String.fromCharCode(block[156]);
    const name = readString(i, 100);
    const prefix = readString(i + 345, 155);
    const dataStart = i + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) throw new Error('tar: truncated archive');
    const data = buf.slice(dataStart, dataEnd);
    if (typeflag === 'L') {
      pendingLongName = new TextDecoder().decode(data).replace(/\0+$/, '');
    } else if (typeflag === 'K') {
      pendingLongLink = new TextDecoder().decode(data).replace(/\0+$/, '');
    } else if (typeflag === 'x' || typeflag === 'g') {
      // pax headers: key=value records; we honor only path / linkpath.
      const text = new TextDecoder().decode(data);
      for (const m of text.matchAll(/(\d+) ([^=]+)=([^\n]*)\n/g)) {
        const [, , key, value] = m;
        if (key === 'path') pendingLongName = value;
        if (key === 'linkpath') pendingLongLink = value;
      }
    } else if (typeflag === '0' || typeflag === '\0' || typeflag === '7') {
      let path = pendingLongName ?? (prefix ? `${prefix}/${name}` : name);
      pendingLongName = null;
      pendingLongLink = null;
      // Path containment: no absolute paths, no .. escape.
      const norm = path.replace(/^\/+/, '');
      if (norm.split('/').some((seg) => seg === '..')) {
        // skip malicious entry
      } else if (norm.length > 0) {
        out.push({ path: norm, data });
      }
    } else if (typeflag === '2') {
      // symlink: store as a tiny sidecar the importer understands
      let path = pendingLongName ?? (prefix ? `${prefix}/${name}` : name);
      const target = pendingLongLink ?? readString(i + 157, 100);
      pendingLongName = null;
      pendingLongLink = null;
      const norm = path.replace(/^\/+/, '');
      if (norm.length > 0 && !norm.split('/').some((seg) => seg === '..')) {
        out.push({ path: norm, data: new TextEncoder().encode(`__oc_symlink__${target}`) });
      }
    } else if (typeflag === '5') {
      // directories are implied by file parents; no-op
    }
    // advance past header + data, padded to 512
    i = dataStart + Math.ceil(size / 512) * 512;
  }
  return out;
}

/** GitHub tarballs wrap everything in <repo>-<ref>/. Strip ONE leading
 *  directory component when every entry shares it. */
export function stripCommonRoot(entries: TarEntry[]): TarEntry[] {
  if (entries.length === 0) return entries;
  const first = entries[0].path.split('/')[0];
  if (!first) return entries;
  const allShare = entries.every((e) => e.path === first || e.path.startsWith(`${first}/`));
  if (!allShare) return entries;
  return entries
    .map((e) => ({ path: e.path.slice(first.length + 1), data: e.data }))
    .filter((e) => e.path.length > 0);
}

// -------------------------------------------------------------- the facade

export interface ContainerEvents {
  onListen?(info: { port: number; pid: number }): void;
  onUnlisten?(info: { port: number; pid: number }): void;
}

export class OpenContainerIDE {
  private runtime: OpenContainerRuntime | null = null;
  private listeners = new Map<keyof ContainerEventMap, Set<(arg: any) => void>>();
  private activeProjectId: string | null = null;

  /** Raw runtime (terminal needs its low-level surface: stdio, stdin). */
  get rt(): OpenContainerRuntime | null {
    return this.runtime;
  }

  get nodeVersion(): string | null {
    return this.runtime?.nodeVersion ?? null;
  }

  get activeProject(): Promise<ProjectMeta | null> {
    return this.activeProjectId ? this.getProject(this.activeProjectId) : Promise.resolve(null);
  }

  async getProject(id: string): Promise<ProjectMeta | null> {
    const all = await listProjects();
    return all.find((p) => p.id === id) ?? null;
  }

  // ------------------------------------------------------------------ boot

  /** Boot the runtime (shell keeper + OPFS hydration). Idempotent. */
  async boot(events: ContainerEvents = {}): Promise<OpenContainerRuntime> {
    if (this.runtime) return this.runtime.ready.then(() => this.runtime!);
    const { OpenContainerRuntime } = await import('../runtime');
    const rt = new OpenContainerRuntime({
      onListen: (info) => {
        this.emit('listen', info);
        events.onListen?.(info);
      },
      onUnlisten: (info) => {
        this.emit('unlisten', info);
        events.onUnlisten?.(info);
      },
      onProcessStart: (info) => this.emit('process-start', info),
      onExit: (info) => this.emit('process-exit', info),
      onStdio: (fd, chunk) => this.emit('stdio', { fd, chunk }),
      onReady: (info) => this.emit('ready', info),
      onBootProgress: (info) => this.emit('boot-progress', { phase: info.phase }),
      onError: (err) => this.emit('error', { message: err.message }),
      onFsChange: (event) => this.emit('fs-change', event),
    });
    this.runtime = rt;
    await rt.boot();
    return rt;
  }

  destroy(): void {
    this.runtime?.teardown();
    this.runtime = null;
    this.listeners.clear();
  }

  // ------------------------------------------------------------------- fs

  /** Node-style path resolution: relative paths resolve against the runtime
   *  cwd (which follows the active project). */
  private resolve(p: string): string {
    if (p.startsWith('/')) return p;
    const cwd = this.runtime?.getCurrentCwd() ?? '/home/project';
    return `${cwd}/${p}`.replace(/\/{2,}/g, '/');
  }

  private requireRt(): OpenContainerRuntime {
    if (!this.runtime) throw new Error('container not booted');
    return this.runtime;
  }

  async readFile(path: string): Promise<Uint8Array> {
    return this.requireRt().readFile(this.resolve(path));
  }

  async readTextFile(path: string): Promise<string> {
    return this.requireRt().readTextFile(this.resolve(path));
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const p = this.resolve(path);
    if (typeof content === 'string') await this.requireRt().writeFile(p, content);
    else await this.requireRt().writeBinaryFile(p, content);
  }

  async mkdir(path: string): Promise<void> {
    await this.requireRt().mkdir(this.resolve(path));
  }

  async rm(path: string, opts: { recursive?: boolean } = {}): Promise<void> {
    await this.requireRt().rm(this.resolve(path), opts);
  }

  async rename(from: string, to: string): Promise<void> {
    await this.requireRt().rename(this.resolve(from), this.resolve(to));
  }

  async readdir(path: string): Promise<DirEntry[]> {
    return this.requireRt().readdir(path);
  }

  async stat(path: string): Promise<StatInfo | null> {
    return this.requireRt().stat(path);
  }

  async watch(path: string, cb: (event: FsWatchEvent) => void): Promise<Unsubscribe> {
    return this.requireRt().watch(path, cb);
  }

  // ------------------------------------------------------------- processes

  /** Execute a shell command (the terminal is the tty; output flows through
   *  the 'stdio' event). */
  async exec(command: string, opts: { background?: boolean } = {}): Promise<void> {
    await this.requireRt().spawn(command, opts);
  }

  writeStdin(data: string): void {
    this.requireRt().writeStdin(data);
  }

  sendEof(): void {
    this.requireRt().sendEof();
  }

  async resize(cols: number, rows: number): Promise<void> {
    await this.requireRt().resize(cols, rows);
  }

  kill(pid: number, signal = 'SIGTERM'): boolean {
    return this.requireRt().killProcess(pid, signal);
  }

  processes(): Array<{ pid: number; repl: boolean; background: boolean; ports: number[]; exited: boolean }> {
    return this.runtime ? this.runtime.ps() : [];
  }

  // -------------------------------------------------------------- previews

  listeningPorts(): number[] {
    return this.runtime ? this.runtime.listeningPorts() : [];
  }

  previewUrl(port: number): string {
    return `/opencontainer/p/${port}/`;
  }

  // -------------------------------------------------------------- projects

  async projects(): Promise<ProjectMeta[]> {
    return listProjects();
  }

  private async uniqueRoot(name: string): Promise<string> {
    const slug = slugify(name);
    const taken = new Set((await listProjects()).map((p) => p.rootPath));
    let root = `/home/projects/${slug}`;
    let n = 2;
    while (taken.has(root)) root = `/home/projects/${slug}-${n++}`;
    return root;
  }

  /** Create a new empty project and open it. (API-level primitive — the
   *  IDE UI does NOT expose this: projects are created by TERMINAL
   * commands and picked up by auto-discovery. Kept for drivers/tests.) */
  async createProject(name: string): Promise<ProjectMeta> {
    const root = await this.uniqueRoot(name);
    await this.mkdir(root);
    const meta: ProjectMeta = {
      id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim() || 'untitled',
      rootPath: root,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      source: 'new',
    };
    await putProject(meta);
    await this.openProject(meta.id);
    this.emit('projects-changed', { reason: 'created', project: meta });
    return meta;
  }

  /** Register an EXISTING directory as a project — the auto-discovery
   *  path for projects created by terminal commands
   *  (`cd /home/projects && npm create vite@latest my-app`). No mkdir,
   *  no cwd switch; returns null if already registered or no package.json. */
  async registerProject(rootPath: string, source: string): Promise<ProjectMeta | null> {
    const known = await listProjects();
    if (known.some((p) => p.rootPath === rootPath)) return null;
    const pkg = await this.stat(`${rootPath}/package.json`).catch(() => null);
    if (!pkg) return null;
    const name = rootPath.split('/').filter(Boolean).pop() ?? 'project';
    const meta: ProjectMeta = {
      id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      rootPath,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      source,
    };
    await putProject(meta);
    this.emit('projects-changed', { reason: 'discovered', project: meta });
    return meta;
  }

  /** Scan /home/projects for unregistered directories containing a
   *  package.json (projects made via terminal commands). Returns the
   *  newly-registered metas. */
  async discoverProjects(): Promise<ProjectMeta[]> {
    if (!this.runtime) return [];
    const entries = await this.readdir('/home/projects').catch(() => []);
    const found: ProjectMeta[] = [];
    for (const e of entries) {
      if (e.kind !== 'dir') continue;
      const meta = await this.registerProject(`/home/projects/${e.name}`, 'command').catch(() => null);
      if (meta) found.push(meta);
    }
    return found;
  }

  /** Open (activate) a project: chdir the shell, remember lastOpenedAt. */
  async openProject(id: string): Promise<ProjectMeta | null> {
    const meta = await this.getProject(id);
    if (!meta) return null;
    this.activeProjectId = id;
    meta.lastOpenedAt = Date.now();
    await putProject(meta);
    if (this.runtime) this.runtime.chdir(meta.rootPath);
    this.emit('projects-changed', { reason: 'opened', project: meta });
    return meta;
  }

  /** Delete a project: VFS subtree + registry entry (with confirmation at
   *  the UI layer — this is the destructive primitive). */
  async deleteProject(id: string): Promise<void> {
    const meta = await this.getProject(id);
    if (!meta) return;
    await this.rm(meta.rootPath, { recursive: true });
    await deleteProject(id);
    if (this.activeProjectId === id) this.activeProjectId = null;
    this.emit('projects-changed', { reason: 'deleted', project: meta });
  }

  /** Import files into a NEW project from an already-parsed tree.
   *  Ignored paths (node_modules, .git, caches) are dropped here as a
   *  safety net no matter which importer produced the tree. */
  async importFiles(
    name: string,
    files: Array<{ path: string; data: Uint8Array }>,
    source: string,
    extra: { githubRepo?: string } = {},
    onProgress?: (p: ImportProgress) => void,
  ): Promise<ImportResult> {
    const root = await this.uniqueRoot(name);
    const skipped: string[] = [];
    let skippedCount = 0;
    const kept: Array<{ path: string; data: Uint8Array }> = [];
    for (const f of files) {
      if (isIgnoredImportPath(f.path)) {
        skippedCount++;
        if (skipped.length < 200) skipped.push(f.path);
      } else {
        kept.push(f);
      }
    }
    files = kept;
    onProgress?.({ phase: 'write', detail: `${files.length} files${skippedCount ? ` · ${skippedCount} skipped` : ''}` });
    // Batched ops: mkdir roots first, then writes (symlinks sidecars decoded).
    const dirs = new Set<string>([root]);
    for (const f of files) {
      const parts = f.path.split('/');
      for (let i = 1; i < parts.length; i++) dirs.add(`${root}/${parts.slice(0, i).join('/')}`);
    }
    const rt = this.requireRt();
    await rt.mkdir(root);
    const dirList = [...dirs].filter((d) => d !== root);
    const CHUNK = 300;
    let done = 0;
    const ops: Array<Record<string, any>> = [];
    for (const d of dirList) ops.push({ type: 'mkdir', path: d });
    for (const f of files) {
      const target = `${root}/${f.path}`;
      const asText = new TextDecoder().decode(f.data);
      if (asText.startsWith('__oc_symlink__')) {
        ops.push({ type: 'symlink', path: target, target: asText.slice('__oc_symlink__'.length) });
      } else {
        ops.push({ type: 'write', path: target, data: f.data });
      }
    }
    for (let i = 0; i < ops.length; i += CHUNK) {
      await rt.applyFsOps(ops.slice(i, i + CHUNK));
      done = Math.min(ops.length, i + CHUNK);
      onProgress?.({ phase: 'write', fraction: done / ops.length, detail: `${done}/${ops.length} ops` });
    }
    const meta: ProjectMeta = {
      id: `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      rootPath: root,
      createdAt: Date.now(),
      lastOpenedAt: Date.now(),
      source,
      githubRepo: extra.githubRepo,
    };
    await putProject(meta);
    await this.openProject(meta.id);
    this.emit('projects-changed', { reason: 'imported', project: meta });
    return { project: meta, fileCount: files.length, skipped, skippedCount };
  }

  /** Import from a ZIP archive (browser File). node_modules & co. are
   *  filtered BEFORE the VFS write (importFiles double-guards). */
  async importZip(file: File, onProgress?: (p: ImportProgress) => void): Promise<ImportResult> {
    const { unzipSync } = await import('fflate');
    onProgress?.({ phase: 'fetch', detail: `${(file.size / 1048576).toFixed(1)} MB` });
    const buf = new Uint8Array(await file.arrayBuffer());
    onProgress?.({ phase: 'unpack' });
    const unzipped = unzipSync(buf);
    const files: Array<{ path: string; data: Uint8Array }> = [];
    for (const [path, data] of Object.entries(unzipped)) {
      if (path.endsWith('/')) continue; // directory entries
      files.push({ path: path.replace(/^\/+/, ''), data });
    }
    const name = file.name.replace(/\.zip$/i, '') || 'imported';
    return this.importFiles(name, files, 'zip', {}, onProgress);
  }

  /** Import from a public GitHub repository — through OUR server proxy
   *  (/api/gh-import) because the browser cannot fetch codeload directly
   *  (CORS) and api.github.com is rate-limited to death on shared IPs.
   *  Accepts https://github.com/owner/repo or bare owner/repo; optional
   *  ?branch via repoUrl#branch or the second arg. */
  async importGithub(
    repoUrl: string,
    onProgress?: (p: ImportProgress) => void,
    branch?: string,
  ): Promise<ImportResult> {
    const raw = repoUrl.trim();
    const m = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/);
    const full = raw.match(/^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
    let owner = '';
    let repo = '';
    if (full) {
      [, owner, repo] = full;
    } else if (m && !raw.includes('://')) {
      [, owner, repo] = m;
    } else {
      throw new Error('Not a GitHub repository (https://github.com/owner/repo or owner/repo)');
    }
    onProgress?.({ phase: 'fetch', detail: `proxy → ${owner}/${repo}${branch ? ` (${branch})` : ''}` });
    const qs = new URLSearchParams({ url: `https://github.com/${owner}/${repo}` });
    if (branch) qs.set('branch', branch);
    const res = await fetch(`/api/gh-import?${qs.toString()}`);
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(j?.error ?? `GitHub import failed: HTTP ${res.status}`);
    }
    const gz = new Uint8Array(await res.arrayBuffer());
    onProgress?.({ phase: 'unpack', fraction: 0.3, detail: `${(gz.length / 1048576).toFixed(1)} MB gzip` });
    const { gunzipSync } = await import('fflate');
    const tar = gunzipSync(gz);
    const entries = stripCommonRoot(parseTar(tar));
    const files = entries.map((e) => ({ path: e.path, data: e.data }));
    if (files.length === 0) throw new Error('archive contained no files');
    return this.importFiles(`${owner}-${repo}`, files, 'github', { githubRepo: `${owner}/${repo}` }, onProgress);
  }

  /** Import through the directory picker (webkitdirectory FileList).
   *  node_modules/.git/caches are skipped BEFORE reading file bytes —
   *  uploading a 300 MB node_modules tree costs nothing. */
  async importDirectory(name: string, fileList: File[], onProgress?: (p: ImportProgress) => void): Promise<ImportResult> {
    const files: Array<{ path: string; data: Uint8Array }> = [];
    let skippedCount = 0;
    let i = 0;
    for (const f of fileList) {
      const rel = ((f as any).webkitRelativePath || f.name).replace(/^\/+/, '');
      if (isIgnoredImportPath(rel)) {
        skippedCount++;
        continue;
      }
      files.push({ path: rel, data: new Uint8Array(await f.arrayBuffer()) });
      if (++i % 50 === 0) onProgress?.({ phase: 'fetch', fraction: i / fileList.length, detail: `${i}/${fileList.length} files` });
    }
    const r = await this.importFiles(name || 'imported', files, 'directory', {}, onProgress);
    return { ...r, skippedCount: r.skippedCount + skippedCount };
  }

  /** Import via the File System Access API (window.showDirectoryPicker).
   *  WE walk the tree ourselves through handle.entries() and NEVER descend
   *  into ignored directories (isIgnoredDirName ← IGNORED_DIR_SEGMENTS) —
   *  the browser therefore never even LISTS node_modules/.git contents,
   *  unlike the webkitdirectory fallback where the browser enumerates
   *  every file up front and only our filter drops them afterwards.
   *  Guard rails: 20 000 files / 200 MB → Error (UI surfaces it); walk
   *  depth 12 → reported as skipped. Finishes through importFiles so
   *  project creation, VFS write, double-guard and progress are shared
   *  unchanged with the other importers. */
  async importDirectoryHandle(
    name: string,
    rootHandle: FileSystemDirectoryHandle,
    onProgress?: (p: ImportProgress) => void,
  ): Promise<ImportResult> {
    const MAX_FILES = 20_000;
    const MAX_BYTES = 200 * 1024 * 1024;
    const MAX_DEPTH = 12;
    const files: Array<{ path: string; data: Uint8Array }> = [];
    const skipped: string[] = [];
    let skippedCount = 0;
    let totalBytes = 0;
    let seen = 0;
    const reportSkip = (entry: string) => {
      skippedCount++;
      if (skipped.length < 200) skipped.push(entry); // ImportResult cap
    };

    /** depth = number of path segments above this dir's entries (root = 0),
     *  so entries yielded at depth d have d+1 path segments. */
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string, depth: number): Promise<void> => {
      for await (const [entryName, child] of dir.entries()) {
        if (child.kind === 'directory') {
          if (isIgnoredDirName(entryName)) {
            // The whole point of this importer: ignored dirs are never
            // ENTERED, so the browser never lists their (easily
            // 57 000-file) children — one reported entry per dir.
            reportSkip(`${prefix}${entryName} (dir skipped)`);
          } else if (depth + 1 >= MAX_DEPTH) {
            reportSkip(`${prefix}${entryName} (depth limit)`);
          } else {
            await walk(child as FileSystemDirectoryHandle, `${prefix}${entryName}/`, depth + 1);
          }
        } else {
          if (entryName === '.DS_Store') {
            reportSkip(`${prefix}.DS_Store`);
            continue;
          }
          if (files.length >= MAX_FILES) {
            throw new Error(`folder import aborted: more than ${MAX_FILES.toLocaleString('en-US')} files (ignored dirs like node_modules are already excluded)`);
          }
          const file = await (child as FileSystemFileHandle).getFile();
          if (totalBytes + file.size > MAX_BYTES) {
            throw new Error(`folder import aborted: over ${MAX_BYTES / 1048576} MB of file data`);
          }
          totalBytes += file.size;
          files.push({ path: `${prefix}${entryName}`, data: new Uint8Array(await file.arrayBuffer()) });
          if (++seen % 50 === 0) {
            onProgress?.({ phase: 'fetch', detail: `${seen} files · ${(totalBytes / 1048576).toFixed(1)} MB` });
          }
        }
      }
    };

    onProgress?.({ phase: 'fetch', detail: 'scanning folder…' });
    await walk(rootHandle, '', 0);
    if (files.length === 0) throw new Error('folder contained no importable files');
    const r = await this.importFiles(name || rootHandle.name || 'imported', files, 'directory', {}, onProgress);
    // The walk already excluded everything isIgnoredImportPath would catch,
    // so r.skipped / r.skippedCount are normally empty — merge defensively.
    const merged = skipped.concat(r.skipped).slice(0, 200);
    return { project: r.project, fileCount: r.fileCount, skipped: merged, skippedCount: r.skippedCount + skippedCount };
  }

  /** Raw FS tree export (search panel + exportZip source). */
  async exportTree(path: string): Promise<{ dirs: string[]; files: [string, Uint8Array][]; symlinks: [string, string][] }> {
    return this.requireRt().exportTree(this.resolve(path));
  }

  /** Export a project as a ZIP (source only — node_modules excluded by
   *  default, toggleable). Returns the zip bytes for download. */
  async exportZip(projectId: string, opts: { includeNodeModules?: boolean } = {}): Promise<Uint8Array> {
    const meta = await this.getProject(projectId);
    if (!meta) throw new Error('project not found');
    const tree = await this.requireRt().exportTree(meta.rootPath);
    const { zipSync, strToU8 } = await import('fflate');
    const files: Record<string, Uint8Array> = {};
    const skip = (p: string) => {
      if (opts.includeNodeModules) return false;
      const rel = p.slice(meta.rootPath.length + 1);
      return rel === 'node_modules' || rel.startsWith('node_modules/');
    };
    for (const [p, data] of tree.files) {
      if (skip(p)) continue;
      files[p.slice(meta.rootPath.length + 1)] = data;
    }
    // symlinks (.bin links) are represented as tiny text stubs
    for (const [p, target] of tree.symlinks) {
      if (skip(p)) continue;
      files[p.slice(meta.rootPath.length + 1)] = strToU8(`__oc_symlink__${target}`);
    }
    return zipSync(files, { level: 6 });
  }

  // ------------------------------------------------------------- persistence

  async persist(): Promise<void> {
    await this.requireRt().persist();
  }

  // ------------------------------------------------------------ diagnostics

  async diagnostics(): Promise<Diagnostics> {
    return (await this.requireRt().getDiagnostics()) as Diagnostics;
  }

  // ---------------------------------------------------------------- events

  on<K extends keyof ContainerEventMap>(event: K, cb: (arg: ContainerEventMap[K]) => void): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }

  private emit<K extends keyof ContainerEventMap>(event: K, arg: ContainerEventMap[K]): void {
    this.listeners.get(event)?.forEach((cb) => {
      try { cb(arg); } catch { /* listener errors must not break the runtime */ }
    });
  }
}

export { FsRpcError };
