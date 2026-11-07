/**
 * OpenContainer — Virtual Filesystem.
 *
 * An in-memory POSIX-style tree with:
 *  - files (Uint8Array), directories, symlinks
 *  - permission bits + mtime
 *  - recursive/force rm, mkdir -p semantics
 *  - file watchers (fs.watch-compatible events)
 *
 *  The VFS is an EXECUTION filesystem for the active session only — it is
 *  never persisted across reloads (temporary-environment contract; the
 *  host supplies project files at boot, guests mutate them in memory).
 *
 * Errors follow Node.js errno conventions so user code sees familiar
 * messages (ENOENT / EEXIST / ENOTDIR / ENOTEMPTY / EISDIR).
 */

export interface VStats {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
  mode: number;
  mtimeMs: number;
}

export interface WatchListener {
  path: string;
  recursive?: boolean;
  onChange: (records: FSChangeRecord[]) => void;
}

export interface FSChangeRecord {
  path: string;
  type: 'created' | 'updated' | 'renamed' | 'deleted';
}

type VType = 'file' | 'dir' | 'symlink';

export interface VNode {
  type: VType;
  /** file bytes */
  data?: Uint8Array;
  /** dir children */
  children?: Map<string, VNode>;
  /** symlink target */
  target?: string;
  mode: number;
  mtimeMs: number;
}

export class VFSError extends Error {
  code: string;
  errno: number;
  syscall: string;
  path?: string;

  constructor(code: string, message: string, syscall: string, path?: string) {
    super(`${code}: ${message}${path ? `, '${path}'` : ''}`);
    this.code = code;
    this.errno = ERRNO[code] ?? -1;
    this.syscall = syscall;
    this.path = path;
    this.name = 'VFSError';
  }
}

const ERRNO: Record<string, number> = {
  ENOENT: -2,
  EEXIST: -17,
  EISDIR: -21,
  ENOTDIR: -20,
  ENOTEMPTY: -39,
  EPERM: -1,
  EINVAL: -22,
};

export function normalizePath(p: string): string {
  if (!p) return '/';
  if (!p.startsWith('/')) p = '/' + p;
  const parts = p.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return '/' + out.join('/');
}

export function joinPath(...segments: string[]): string {
  return normalizePath(segments.join('/'));
}

export function dirname(p: string): string {
  const n = normalizePath(p);
  if (n === '/') return '/';
  const idx = n.lastIndexOf('/');
  return idx <= 0 ? '/' : n.slice(0, idx);
}

export function basename(p: string): string {
  const n = normalizePath(p);
  if (n === '/') return '/';
  return n.slice(n.lastIndexOf('/') + 1);
}

const DEFAULT_FILE_MODE = 0o644;
const DEFAULT_DIR_MODE = 0o755;

function now(): number {
  return Date.now();
}

export class VirtualFileSystem {
  private root: VNode = { type: 'dir', children: new Map(), mode: DEFAULT_DIR_MODE, mtimeMs: now() };
  private watchers = new Set<WatchListener>();
  private pendingChanges: FSChangeRecord[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /* ----------------------------- path resolution ----------------------------- */

  /** Resolve a path to a node WITHOUT following the final symlink. */
  private lookupRaw(p: string, followAncestors = true): VNode | null {
    const n = normalizePath(p);
    if (n === '/') return this.root;
    const parts = n.split('/').filter(Boolean);
    let cur: VNode = this.root;
    for (let i = 0; i < parts.length; i++) {
      const last = i === parts.length - 1;
      if (cur.type !== 'dir') {
        if (!last || followAncestors) return null;
        return null;
      }
      const child = cur.children!.get(parts[i]);
      if (!child) return null;
      if (!last && child.type === 'symlink') {
        const resolved = this.lookupRaw(joinPath(dirname(n.slice(0, n.indexOf(parts[i]) + parts[i].length)), child.target!));
        if (!resolved) return null;
        cur = resolved;
        continue;
      }
      cur = child;
    }
    return cur;
  }

  /** Resolve following symlinks (stat semantics). Follows at most 40 links. */
  lookup(p: string): VNode | null {
    let current = normalizePath(p);
    for (let i = 0; i < 40; i++) {
      const node = this.lookupRaw(current);
      if (!node) return null;
      if (node.type === 'symlink') {
        current = joinPath(dirname(current), node.target!);
        continue;
      }
      return node;
    }
    return null;
  }

  private mustDir(p: string): VNode {
    const node = this.lookup(p);
    if (!node) throw new VFSError('ENOENT', 'no such file or directory', 'stat', p);
    if (node.type !== 'dir') throw new VFSError('ENOTDIR', 'not a directory', 'stat', p);
    return node;
  }

  private parentAndName(p: string): { parent: VNode; name: string; parentPath: string } {
    const n = normalizePath(p);
    if (n === '/') throw new VFSError('EPERM', 'cannot modify root', 'unlink', p);
    const parentPath = dirname(n);
    const parent = this.lookup(parentPath);
    if (!parent) throw new VFSError('ENOENT', 'no such file or directory', 'stat', parentPath);
    if (parent.type !== 'dir') throw new VFSError('ENOTDIR', 'not a directory', 'stat', parentPath);
    return { parent, name: basename(n), parentPath };
  }

  /* ----------------------------- core operations ----------------------------- */

  mkdir(p: string, options?: { recursive?: boolean }): void {
    const n = normalizePath(p);
    if (this.lookup(n)) {
      if (options?.recursive) {
        const ex = this.lookup(n);
        if (ex?.type === 'dir') return;
        throw new VFSError('EEXIST', 'file already exists', 'mkdir', p);
      }
      throw new VFSError('EEXIST', 'file already exists', 'mkdir', p);
    }
    if (!options?.recursive) {
      const parent = this.lookup(dirname(n));
      if (!parent) throw new VFSError('ENOENT', 'no such file or directory', 'mkdir', p);
      if (parent.type !== 'dir') throw new VFSError('ENOTDIR', 'not a directory', 'mkdir', p);
    }
    const parts = n.split('/').filter(Boolean);
    let cur = this.root;
    let created = false;
    for (const part of parts) {
      let child = cur.children!.get(part);
      if (!child) {
        child = { type: 'dir', children: new Map(), mode: DEFAULT_DIR_MODE, mtimeMs: now() };
        cur.children!.set(part, child);
        created = true;
      }
      if (child.type !== 'dir') {
        if (options?.recursive) throw new VFSError('ENOTDIR', 'not a directory', 'mkdir', p);
        throw new VFSError('EEXIST', 'file already exists', 'mkdir', p);
      }
      cur = child;
    }
    if (created) this.recordChange(n, 'created');
  }

  readdir(p: string): string[] {
    const node = this.mustDir(p);
    return [...node.children!.keys()];
  }

  readFile(p: string): Uint8Array {
    const node = this.lookup(p);
    if (!node) throw new VFSError('ENOENT', 'no such file or directory', 'open', p);
    if (node.type === 'dir') throw new VFSError('EISDIR', 'illegal operation on a directory, read', 'open', p);
    return node.data ? new Uint8Array(node.data) : new Uint8Array(0);
  }

  readTextFile(p: string): string {
    const bytes = this.readFile(p);
    return new TextDecoder('utf-8').decode(bytes);
  }

  writeFile(p: string, contents: Uint8Array | string): void {
    const data = typeof contents === 'string' ? new TextEncoder().encode(contents) : contents;
    const existed = this.lookup(p);
    if (existed && existed.type === 'dir') throw new VFSError('EISDIR', 'illegal operation on a directory, write', 'open', p);
    const { parent, name } = this.parentAndName(p);
    parent.children!.set(name, {
      type: 'file',
      data,
      mode: existed?.mode ?? DEFAULT_FILE_MODE,
      mtimeMs: now(),
    });
    this.recordChange(normalizePath(p), existed ? 'updated' : 'created');
  }

  symlink(target: string, path: string): void {
    const { parent, name } = this.parentAndName(path);
    parent.children!.set(name, { type: 'symlink', target, mode: 0o777, mtimeMs: now() });
    this.recordChange(normalizePath(path), 'created');
  }

  readlink(p: string): string {
    const node = this.lookupRaw(p);
    if (!node || node.type !== 'symlink') throw new VFSError('EINVAL', 'invalid argument, path is not a symlink', 'readlink', p);
    return node.target!;
  }

  unlink(p: string): void {
    const { parent, name } = this.parentAndName(p);
    const node = parent.children!.get(name);
    if (!node) throw new VFSError('ENOENT', 'no such file or directory', 'unlink', p);
    if (node.type === 'dir') throw new VFSError('EISDIR', 'illegal operation on a directory', 'unlink', p);
    parent.children!.delete(name);
    this.recordChange(normalizePath(p), 'deleted');
  }

  rmdir(p: string): void {
    const n = normalizePath(p);
    if (n === '/') throw new VFSError('EPERM', 'cannot remove root', 'rmdir', p);
    const { parent, name } = this.parentAndName(n);
    const node = parent.children!.get(name);
    if (!node) throw new VFSError('ENOENT', 'no such file or directory', 'rmdir', p);
    if (node.type !== 'dir') throw new VFSError('ENOTDIR', 'not a directory', 'rmdir', p);
    if (node.children!.size > 0) throw new VFSError('ENOTEMPTY', 'directory not empty', 'rmdir', p);
    parent.children!.delete(name);
    this.recordChange(n, 'deleted');
  }

  rm(p: string, options?: { force?: boolean; recursive?: boolean }): void {
    const n = normalizePath(p);
    const node = this.lookupRaw(n);
    if (!node) {
      if (options?.force) return;
      throw new VFSError('ENOENT', 'no such file or directory', 'rm', p);
    }
    if (node.type === 'dir') {
      if (!options?.recursive && node.children!.size > 0) {
        throw new VFSError('ENOTEMPTY', 'directory not empty', 'rm', p);
      }
      this.rmdir(n);
      return;
    }
    this.unlink(n);
  }

  stat(p: string): VStats {
    const node = this.lookup(p);
    if (!node) throw new VFSError('ENOENT', 'no such file or directory', 'stat', p);
    const self = this;
    return {
      isFile: () => node.type === 'file',
      isDirectory: () => node.type === 'dir',
      isSymbolicLink: () => node.type === 'symlink',
      size: node.type === 'file' ? (node.data?.length ?? 0) : 0,
      mode: node.mode,
      mtimeMs: node.mtimeMs,
    };
  }

  lstat(p: string): VStats {
    const node = this.lookupRaw(p);
    if (!node) throw new VFSError('ENOENT', 'no such file or directory', 'lstat', p);
    return {
      isFile: () => node.type === 'file',
      isDirectory: () => node.type === 'dir',
      isSymbolicLink: () => node.type === 'symlink',
      size: node.type === 'file' ? (node.data?.length ?? 0) : 0,
      mode: node.mode,
      mtimeMs: node.mtimeMs,
    };
  }

  exists(p: string): boolean {
    return this.lookup(p) !== null;
  }

  chmod(p: string, mode: number): void {
    const node = this.lookup(p);
    if (!node) throw new VFSError('ENOENT', 'no such file or directory', 'chmod', p);
    node.mode = mode;
  }

  copyFile(src: string, dest: string): void {
    const data = this.readFile(src);
    this.writeFile(dest, new Uint8Array(data));
  }

  rename(src: string, dest: string): void {
    const node = this.lookupRaw(src);
    if (!node) throw new VFSError('ENOENT', 'no such file or directory', 'rename', src);
    if (node.type === 'dir' && this.isSubPath(dest, src)) {
      throw new VFSError('EINVAL', `cannot move '${src}' to a subdirectory of itself, '${dest}'`, 'rename', src);
    }
    const { parent: srcParent, name } = this.parentAndName(src);
    const { parent: destParent, name: destName } = this.parentAndName(dest);
    srcParent.children!.delete(name);
    destParent.children!.set(destName, node);
    this.recordChange(normalizePath(src), 'renamed');
    this.recordChange(normalizePath(dest), node.type === 'dir' ? 'created' : 'updated');
  }

  private isSubPath(child: string, parent: string): boolean {
    const c = normalizePath(child);
    const p = normalizePath(parent);
    return c.startsWith(p + '/');
  }

  /* ----------------------------- tree mount/export ----------------------------- */

  mount(tree: Record<string, unknown>, at: string): void {
    this.mkdir(at, { recursive: true });
    this.mountInto(this.mustDir(at), tree);
  }

  private mountInto(dir: VNode, tree: Record<string, unknown>): void {
    for (const [name, entry] of Object.entries(tree)) {
      const spec = entry as Record<string, any>;
      if (spec && typeof spec === 'object' && 'directory' in spec) {
        const child: VNode = { type: 'dir', children: new Map(), mode: DEFAULT_DIR_MODE, mtimeMs: now() };
        dir.children!.set(name, child);
        this.mountInto(child, spec.directory as Record<string, unknown>);
      } else if (spec && typeof spec === 'object' && 'file' in spec) {
        const fileSpec = spec.file as Record<string, any>;
        const data =
          typeof fileSpec.contents === 'string'
            ? new TextEncoder().encode(fileSpec.contents)
            : new Uint8Array(fileSpec.contents);
        dir.children!.set(name, { type: 'file', data, mode: fileSpec.mode ?? DEFAULT_FILE_MODE, mtimeMs: now() });
      }
    }
  }

  exportTree(at = '/'): Record<string, any> {
    const node = this.lookup(at);
    if (!node) return {};
    const walk = (n: VNode): Record<string, any> => {
      if (n.type === 'dir') {
        const out: Record<string, any> = {};
        for (const [name, child] of n.children!) {
          if (child.type === 'dir') {
            out[name] = { directory: walk(child) };
          } else if (child.type === 'file') {
            out[name] = { file: { contents: child.data! } };
          }
        }
        return out;
      }
      return {};
    };
    return walk(node);
  }

  /** List every file path under `at` (host UI trees / snapshots). */
  listAllFiles(at = '/'): string[] {
    const out: string[] = [];
    const walk = (n: VNode, prefix: string) => {
      if (n.type !== 'dir') return;
      for (const [name, child] of n.children!) {
        const p = prefix ? `${prefix}/${name}` : `/${name}`;
        if (child.type === 'dir') {
          walk(child, p);
        } else if (child.type === 'file') {
          out.push(p);
        }
      }
    };
    const start = this.lookup(at);
    if (start?.type === 'dir') walk(start, normalizePath(at) === '/' ? '' : normalizePath(at).slice(1));
    return out;
  }

  /* ----------------------------- watchers ----------------------------- */

  addWatch(path: string, onChange: (records: FSChangeRecord[]) => void, recursive = false): () => void {
    const listener: WatchListener = { path: normalizePath(path), recursive, onChange };
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  private recordChange(path: string, type: FSChangeRecord['type']): void {
    this.pendingChanges.push({ path, type });
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        const records = this.pendingChanges;
        this.pendingChanges = [];
        if (records.length === 0) return;
        for (const w of this.watchers) {
          try {
            const relevant = records.filter((r) =>
              w.recursive
                ? r.path === w.path || r.path.startsWith(w.path === '/' ? '/' : w.path + '/')
                : dirname(r.path) === w.path || r.path === w.path
            );
            if (relevant.length > 0) w.onChange(relevant);
          } catch {
            /* watcher errors must not break the fs */
          }
        }
      }, 0);
    }
  }

  /** Approximate total bytes stored (memory usage reporting). */
  totalBytes(): number {
    let total = 0;
    const walk = (n: VNode) => {
      if (n.type === 'file') total += n.data?.length ?? 0;
      else if (n.type === 'dir') for (const child of n.children!.values()) walk(child);
    };
    walk(this.root);
    return total;
  }
}
