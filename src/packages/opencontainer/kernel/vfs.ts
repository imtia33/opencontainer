/**
 * OpenContainer Kernel — Virtual Filesystem.
 *
 * An in-memory POSIX-flavored filesystem backing `internalBinding('fs')`.
 * Designed so a persistence layer (OPFS sync access handles) can mirror writes
 * without blocking the synchronous execution path.
 */

export interface StatFields {
  dev: number;
  ino: number;
  mode: number;
  nlink: number;
  uid: number;
  gid: number;
  rdev: number;
  size: number;
  blksize: number;
  blocks: number;
  atimeMs: number;
  mtimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
}

export interface VfsWatcher {
  path: string;
  onEvent: (event: { type: 'rename' | 'change'; filename: string | null }) => void;
  close(): void;
}

/** Persistence/delta hook op — emitted on every mutating VFS operation. */
export type VfsPersistOp =
  | { type: 'write'; path: string; data: Uint8Array }
  | { type: 'mkdir'; path: string }
  | { type: 'symlink'; path: string; target: string }
  | { type: 'unlink'; path: string }
  | { type: 'rename'; from: string; to: string };

/** Serializable VFS tree (snapshot for hydrate / OPFS persistence). */
export interface VfsTree {
  dirs: string[];
  files: Array<[string, Uint8Array]>;
  symlinks: Array<[string, string]>;
}

const S_IFMT = 0o170000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o040000;
const S_IFLNK = 0o120000;

let nextIno = 1;

interface VNode {
  name: string;
  parent: VNode | null;
  mode: number; // includes S_IFMT type bits
  data?: Uint8Array;
  target?: string; // symlink
  mtimeMs: number;
  atimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  ino: number;
  watchers: Set<VfsWatcher>;
}

export class VfsError extends Error {
  code: string;
  errno: number;
  syscall: string;
  path: string;
  constructor(code: string, errno: number, syscall: string, path: string, message?: string) {
    super(message ?? `${code}: ${syscall}, ${path}`);
    this.code = code;
    this.errno = errno;
    this.syscall = syscall;
    this.path = path;
  }
}

export function errnoOf(code: string): number {
  // Linux errno numbers (node uses libuv-converted ones; lib/internal/errors maps)
  const table: Record<string, number> = {
    EPERM: 1, ENOENT: 2, ESRCH: 3, EINTR: 4, EIO: 5, ENXIO: 6, E2BIG: 7,
    ENOEXEC: 8, EBADF: 9, ECHILD: 10, EAGAIN: 11, ENOMEM: 12, EACCES: 13,
    EFAULT: 14, EBUSY: 16, EEXIST: 17, EXDEV: 18, ENODEV: 19, ENOTDIR: 20,
    EISDIR: 21, EINVAL: 22, ENFILE: 23, EMFILE: 24, ENOTTY: 25, EFBIG: 27,
    ENOSPC: 28, ESPIPE: 29, EROFS: 30, EMLINK: 31, EPIPE: 32, ENAMETOOLONG: 36,
    ENOSYS: 38, ENOTEMPTY: 39, ELOOP: 40, ENODATA: 61, ENOTSOCK: 88,
    EDESTADDRREQ: 89, EMSGSIZE: 90, EPROTOTYPE: 91, ENOPROTOOPT: 92,
    EPROTONOSUPPORT: 93, EOPNOTSUPP: 95, EAFNOSUPPORT: 97, EADDRINUSE: 98,
    EADDRNOTAVAIL: 99, ENETDOWN: 100, ENETUNREACH: 101, ECONNABORTED: 103,
    ECONNRESET: 104, ENOBUFS: 105, EISCONN: 106, ENOTCONN: 107, ETIMEDOUT: 110,
    ECONNREFUSED: 111, EHOSTUNREACH: 113, EINPROGRESS: 115,
  };
  return table[code] ?? -1;
}

export class Vfs {
  private root: VNode;
  private watchersByDir = new Map<VNode, Set<VfsWatcher>>();
  /** Write-behind persistence hook (OPFS mirror / host deltas), best-effort. */
  persist?: (op: VfsPersistOp) => void;

  constructor(private now: () => number = () => Date.now()) {
    this.root = this.makeNode('/', null, S_IFDIR | 0o755);
  }

  private makeNode(name: string, parent: VNode | null, mode: number, data?: Uint8Array): VNode {
    const t = this.now();
    return {
      name, parent, mode, data,
      mtimeMs: t, atimeMs: t, ctimeMs: t, birthtimeMs: t,
      ino: nextIno++, watchers: new Set(),
    };
  }

  normalize(p: string): string {
    if (!p.startsWith('/')) throw new VfsError('ERR_INVALID_ARG_VALUE' as string, 22, 'normalize', p, `The "path" argument must be absolute, received ${p}`);
    const isDir = p.endsWith('/');
    const out: string[] = [];
    for (const seg of p.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') { out.pop(); continue; }
      out.push(seg);
    }
    return '/' + out.join('/') + (isDir && out.length ? '/' : '');
  }

  private lookup(p: string, followLast = true): VNode | null {
    const norm = this.normalize(p);
    if (norm === '/') return this.root;
    let cur: VNode = this.root;
    for (const seg of norm.split('/').filter(Boolean)) {
      if ((cur.mode & S_IFMT) === S_IFLNK && followLast !== false) {
        const t = cur.target ?? '/';
        cur = this.lookup(this.joinPaths(this.pathOf(cur.parent ?? this.root), t)) ?? cur;
      }
      if ((cur.mode & S_IFMT) !== S_IFDIR) return null;
      const child = this.childrenOf(cur).find((c) => c.name === seg);
      if (!child) return null;
      if ((child.mode & S_IFMT) === S_IFLNK && followLast) {
        const target = this.joinPaths(this.pathOf(child.parent ?? this.root), child.target ?? '/');
        const resolved = this.lookup(target);
        if (!resolved) return null;
        cur = resolved;
      } else {
        cur = child;
      }
    }
    return cur;
  }

  private childrenOf(dir: VNode): VNode[] {
    // children are stored on the parent via a map in this simple impl
    return (dir as any)._children ?? [];
  }

  private attach(parent: VNode, child: VNode) {
    (parent as any)._children = (parent as any)._children ?? [];
    (parent as any)._children.push(child);
  }

  private detach(parent: VNode, child: VNode) {
    const kids = (parent as any)._children as VNode[] | undefined;
    if (!kids) return;
    const i = kids.indexOf(child);
    if (i >= 0) kids.splice(i, 1);
  }

  pathOf(node: VNode): string {
    if (!node.parent) return '/';
    const segs: string[] = [];
    let cur: VNode | null = node;
    while (cur && cur.parent) { segs.unshift(cur.name); cur = cur.parent; }
    return '/' + segs.join('/');
  }

  joinPaths(a: string, b: string): string {
    if (b.startsWith('/')) return this.normalize(b);
    return this.normalize(a.replace(/\/+$/, '') + '/' + b);
  }

  stat(p: string, followSymlinks = true): StatFields {
    const node = this.lookup(p, followSymlinks);
    if (!node) throw new VfsError('ENOENT', errnoOf('ENOENT'), 'stat', p);
    return this.statOf(node);
  }

  lstat(p: string): StatFields {
    const node = this.lookup(p, false);
    if (!node) throw new VfsError('ENOENT', errnoOf('ENOENT'), 'lstat', p);
    return this.statOf(node);
  }

  private statOf(node: VNode): StatFields {
    // S3.1 IDE fix: `size: size ?? (isDir ? 0 : 0)` parsed as a conditional
    // expression (truthy → 0) — stat().size was ALWAYS 0. Nobody consumed
    // it before the IDE's stat/readdir RPCs surfaced the bug.
    const isDir = (node.mode & S_IFMT) === S_IFDIR;
    return {
      dev: 1,
      ino: node.ino,
      mode: node.mode,
      nlink: 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      size: isDir ? 0 : node.data?.byteLength ?? 0,
      blksize: 4096,
      blocks: Math.ceil((node.data?.byteLength ?? 0) / 512),
      atimeMs: node.atimeMs,
      mtimeMs: node.mtimeMs,
      ctimeMs: node.ctimeMs,
      birthtimeMs: node.birthtimeMs,
    };
  }

  exists(p: string): boolean {
    try { this.stat(p); return true; } catch { return false; }
  }

  isDirectory(p: string): boolean {
    try { return (this.stat(p).mode & S_IFMT) === S_IFDIR; } catch { return false; }
  }

  mkdir(p: string, recursive = false, mode = 0o777): string | null {
    const norm = this.normalize(p);
    if (norm === '/') {
      if (recursive) return null;
      throw new VfsError('EEXIST', errnoOf('EEXIST'), 'mkdir', p);
    }
    const existing = this.lookup(norm);
    if (existing) {
      if (recursive && (existing.mode & S_IFMT) === S_IFDIR) return null;
      throw new VfsError('EEXIST', errnoOf('EEXIST'), 'mkdir', p);
    }
    if (!recursive) {
      const parent = this.lookup(this.dirname(norm));
      if (!parent || (parent.mode & S_IFMT) !== S_IFDIR) {
        throw new VfsError('ENOENT', errnoOf('ENOENT'), 'mkdir', p);
      }
    }
    // create with parents
    const segs = norm.split('/').filter(Boolean);
    let cur = this.root;
    let createdAny = false;
    for (let i = 0; i < segs.length; i++) {
      const name = segs[i];
      let child = this.childrenOf(cur).find((c) => c.name === name);
      if (!child) {
        if (i === segs.length - 1 && this.lookup(this.joinPaths(this.pathOf(cur), name))) {
          throw new VfsError('EEXIST', errnoOf('EEXIST'), 'mkdir', p);
        }
        child = this.makeNode(name, cur, S_IFDIR | (mode & 0o777));
        this.attach(cur, child);
        this.fireRename(this.pathOf(cur));
        createdAny = true;
      } else if ((child.mode & S_IFMT) === S_IFLNK) {
        child = this.lookup(this.joinPaths(this.pathOf(cur), child.target ?? '/')) ?? child;
      }
      if ((child.mode & S_IFMT) !== S_IFDIR) {
        throw new VfsError('ENOTDIR', errnoOf('ENOTDIR'), 'mkdir', p);
      }
      cur = child;
    }
    if (createdAny) this.persist?.({ type: 'mkdir', path: norm });
    return norm;
  }

  dirname(p: string): string {
    const norm = this.normalize(p);
    if (norm === '/') return '/';
    const segs = norm.split('/').filter(Boolean);
    segs.pop();
    return segs.length ? '/' + segs.join('/') : '/';
  }

  basename(p: string): string {
    const segs = this.normalize(p).split('/').filter(Boolean);
    return segs.length ? segs[segs.length - 1] : '/';
  }

  readFile(p: string): Uint8Array {
    const node = this.mustFile(p, 'readFile');
    return node.data ? node.data.slice() : new Uint8Array(0);
  }

  readTextFile(p: string): string {
    return new TextDecoder().decode(this.readFile(p));
  }

  writeFile(p: string, data: Uint8Array | string, mode = 0o666): void {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const norm = this.normalize(p);
    const parentNode = this.lookup(this.dirname(norm));
    if (!parentNode || (parentNode.mode & S_IFMT) !== S_IFDIR) {
      throw new VfsError('ENOENT', errnoOf('ENOENT'), 'open', p);
    }
    let node = this.childrenOf(parentNode).find((c) => c.name === this.basename(norm));
    if (node && (node.mode & S_IFMT) === S_IFDIR) {
      throw new VfsError('EISDIR', errnoOf('EISDIR'), 'open', p);
    }
    if (node && (node.mode & S_IFMT) === S_IFLNK) {
      const target = this.joinPaths(this.dirname(norm), node.target ?? '/');
      this.writeFile(target, bytes);
      return;
    }
    const t = this.now();
    if (!node) {
      node = this.makeNode(this.basename(norm), parentNode, S_IFREG | (mode & 0o777), bytes.slice());
      this.attach(parentNode, node);
      this.fireRename(this.dirname(norm));
    } else {
      node.data = bytes.slice();
      node.mtimeMs = node.ctimeMs = t;
      this.fireChange(norm);
    }
    this.persist?.({ type: 'write', path: norm, data: bytes });
  }

  appendFile(p: string, data: Uint8Array | string): void {
    const existing = this.exists(p) ? this.readFile(p) : new Uint8Array(0);
    const add = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const merged = new Uint8Array(existing.byteLength + add.byteLength);
    merged.set(existing); merged.set(add, existing.byteLength);
    this.writeFile(p, merged);
  }

  readdir(p: string): string[] {
    const node = this.mustDir(p, 'readdir');
    return this.childrenOf(node)
      .filter((c) => (c.mode & S_IFMT) !== 0)
      .map((c) => c.name);
  }

  dirents(p: string): Array<{ name: string; type: number }> {
    const node = this.mustDir(p, 'readdir');
    return this.childrenOf(node).map((c) => ({
      name: c.name,
      type: c.mode & S_IFMT,
    }));
  }

  rm(p: string, opts: { recursive?: boolean; force?: boolean } = {}): void {
    const norm = this.normalize(p);
    const node = this.lookup(norm, false);
    if (!node) {
      if (opts.force) return;
      throw new VfsError('ENOENT', errnoOf('ENOENT'), 'rm', p);
    }
    const isDir = (node.mode & S_IFMT) === S_IFDIR;
    if (isDir && !opts.recursive && this.childrenOf(node).length > 0) {
      throw new VfsError('ENOTEMPTY', errnoOf('ENOTEMPTY'), 'rm', p);
    }
    const parent = node.parent ?? this.root;
    this.detach(parent, node);
    this.fireRename(this.pathOf(parent));
    this.persist?.({ type: 'unlink', path: norm });
  }

  rename(oldPath: string, newPath: string): void {
    const a = this.normalize(oldPath), b = this.normalize(newPath);
    const node = this.lookup(a, false);
    if (!node) throw new VfsError('ENOENT', errnoOf('ENOENT'), 'rename', oldPath);
    const parentB = this.lookup(this.dirname(b));
    if (!parentB || (parentB.mode & S_IFMT) !== S_IFDIR) {
      throw new VfsError('ENOENT', errnoOf('ENOENT'), 'rename', newPath);
    }
    const existing = this.childrenOf(parentB).find((c) => c.name === this.basename(b));
    if (existing) {
      if ((existing.mode & S_IFMT) === S_IFDIR && (node.mode & S_IFMT) === S_IFDIR && !this.childrenOf(existing).length) {
        this.detach(parentB, existing);
      } else if (existing !== node) {
        throw new VfsError('ENOTEMPTY', errnoOf('ENOTEMPTY'), 'rename', newPath);
      }
    }
    const oldParent = node.parent ?? this.root;
    this.detach(oldParent, node);
    node.name = this.basename(b);
    node.parent = parentB;
    this.attach(parentB, node);
    this.fireRename(this.pathOf(oldParent));
    this.fireRename(this.dirname(b));
    this.persist?.({ type: 'rename', from: a, to: b });
    if ((node.mode & S_IFMT) === S_IFREG && node.data) {
      this.persist?.({ type: 'write', path: b, data: node.data });
    }
  }

  symlink(target: string, path: string): void {
    const norm = this.normalize(path);
    const parentNode = this.lookup(this.dirname(norm));
    if (!parentNode) throw new VfsError('ENOENT', errnoOf('ENOENT'), 'symlink', path);
    const node = this.makeNode(this.basename(norm), parentNode, S_IFLNK | 0o777);
    node.target = target;
    this.attach(parentNode, node);
    this.fireRename(this.dirname(norm));
    this.persist?.({ type: 'symlink', path: norm, target });
  }

  readlink(p: string): string {
    const node = this.lookup(p, false);
    if (!node || (node.mode & S_IFMT) !== S_IFLNK) {
      throw new VfsError('EINVAL', errnoOf('EINVAL'), 'readlink', p);
    }
    return node.target ?? '';
  }

  copyFile(src: string, dest: string): void {
    this.writeFile(dest, this.readFile(src));
  }

  chmod(p: string, mode: number): void {
    const node = this.mustNode(p, 'chmod');
    node.mode = (node.mode & S_IFMT) | (mode & 0o7777);
    node.ctimeMs = this.now();
  }

  utimes(p: string, atimeMs: number, mtimeMs: number): void {
    const node = this.mustNode(p, 'utimes');
    node.atimeMs = atimeMs;
    node.mtimeMs = mtimeMs;
  }

  /** Recursively write a mount tree (WebContainer FileSystemTree format). */
  mountTree(dir: string, tree: Record<string, unknown>): void {
    for (const [name, node] of Object.entries(tree)) {
      const path = this.joinPaths(dir, name);
      const anyNode = node as any;
      if (anyNode && typeof anyNode === 'object' && 'file' in anyNode) {
        const contents = anyNode.file.contents;
        if (typeof contents === 'string') this.writeFile(path, contents);
        else if (contents instanceof Uint8Array) this.writeFile(path, contents);
      } else if (anyNode && typeof anyNode === 'object' && 'directory' in anyNode) {
        this.mkdir(path, true);
        this.mountTree(path, anyNode.directory.contents ?? {});
      } else if (typeof anyNode === 'string') {
        // plain string shorthand
        this.writeFile(path, anyNode);
      }
    }
  }

  watch(path: string, onEvent: VfsWatcher['onEvent']): VfsWatcher {
    const norm = this.normalize(path);
    const dirNode = this.mustDir(norm, 'watch');
    const watcher: VfsWatcher = {
      path: norm,
      onEvent,
      close: () => {
        dirNode.watchers.delete(watcher);
        this.watchersByDir.get(dirNode)?.delete(watcher);
      },
    };
    dirNode.watchers.add(watcher);
    if (!this.watchersByDir.has(dirNode)) this.watchersByDir.set(dirNode, new Set());
    this.watchersByDir.get(dirNode)!.add(watcher);
    return watcher;
  }

  private fireRename(dirPath: string) {
    const dir = this.lookup(dirPath, false);
    if (dir) for (const w of dir.watchers) w.onEvent({ type: 'rename', filename: null });
  }

  private fireChange(filePath: string) {
    const dir = this.lookup(this.dirname(filePath), false);
    if (dir) for (const w of dir.watchers) w.onEvent({ type: 'change', filename: this.basename(filePath) });
  }

  private mustNode(p: string, syscall: string): VNode {
    const node = this.lookup(p);
    if (!node) throw new VfsError('ENOENT', errnoOf('ENOENT'), syscall, p);
    return node;
  }

  private mustFile(p: string, syscall: string): VNode {
    const node = this.mustNode(p, syscall);
    if ((node.mode & S_IFMT) === S_IFDIR) {
      throw new VfsError('EISDIR', errnoOf('EISDIR'), syscall, p);
    }
    return node;
  }

  private mustDir(p: string, syscall: string): VNode {
    const node = this.mustNode(p, syscall);
    if ((node.mode & S_IFMT) !== S_IFDIR) {
      throw new VfsError('ENOTDIR', errnoOf('ENOTDIR'), syscall, p);
    }
    return node;
  }

  /** Debug: dump tree */
  dump(dir = '/', depth = 0): string {
    const lines: string[] = [];
    const node = this.lookup(dir);
    if (!node) return '(missing)';
    for (const c of this.childrenOf(node)) {
      lines.push('  '.repeat(depth) + c.name + ((c.mode & S_IFMT) === S_IFDIR ? '/' : ''));
      if ((c.mode & S_IFMT) === S_IFDIR) lines.push(this.dump(this.joinPaths(dir, c.name), depth + 1));
    }
    return lines.filter(Boolean).join('\n');
  }

  /** Serialize the whole tree (dirs, files, symlinks) for snapshots. */
  exportTree(dir = '/'): VfsTree {
    const dirs: string[] = [];
    const files: Array<[string, Uint8Array]> = [];
    const symlinks: Array<[string, string]> = [];
    const walk = (node: VNode, p: string) => {
      for (const c of this.childrenOf(node)) {
        const cp = p === '/' ? '/' + c.name : p + '/' + c.name;
        const t = c.mode & S_IFMT;
        if (t === S_IFDIR) { dirs.push(cp); walk(c, cp); }
        else if (t === S_IFLNK) symlinks.push([cp, c.target ?? '/']);
        else files.push([cp, c.data ?? new Uint8Array(0)]);
      }
    };
    walk(this.lookup(dir, false) ?? this.root, this.normalize(dir));
    return { dirs, files, symlinks };
  }

  /** Import a snapshot tree (hydrate). Skips the persist hook (the host
   *  already owns this state — hydrating must not echo deltas back). */
  importTree(tree: VfsTree): void {
    const prev = this.persist;
    this.persist = undefined;
    try {
      for (const d of tree.dirs) {
        try { this.mkdir(d, true); } catch { /* EEXIST etc. — idempotent */ }
      }
      // S3.1 fix: a file whose PARENT dir is missing from tree.dirs was
      // silently dropped (writeFile requires the parent to exist, exactly
      // like node's fs). Create ancestors first — the snapshot's dir set is
      // not guaranteed complete for host-written files.
      const ensureParents = (p: string) => {
        const i = p.lastIndexOf('/');
        if (i <= 0) return;
        try { this.mkdir(p.slice(0, i), true); } catch { /* exists */ }
      };
      for (const [p, data] of tree.files) {
        try { ensureParents(p); this.writeFile(p, data); } catch { /* best-effort */ }
      }
      for (const [p, target] of tree.symlinks) {
        try { ensureParents(p); this.symlink(target, p); } catch { /* best-effort */ }
      }
    } finally {
      this.persist = prev;
    }
  }

  /** Apply VFS ops broadcast from OTHER processes (cross-process file
   *  visibility — the host fans every process's deltas out to its peers).
   *  Mirrors the host snapshot's cascade semantics: a recursive rm emits a
   *  single unlink for the top path, so children under it are dropped too.
   *  Never re-emits persist ops (the host already distributed them). */
  applyExternalOps(ops: VfsPersistOp[]): void {
    const prev = this.persist;
    this.persist = undefined;
    try {
      for (const op of ops) {
        try {
          switch (op.type) {
            case 'write': this.writeFile(op.path, op.data); break;
            case 'mkdir': this.mkdir(op.path, true); break;
            case 'symlink': this.symlink(op.target, op.path); break;
            case 'unlink': {
              try { this.rm(op.path, { recursive: true, force: true }); } catch { /* gone */ }
              break;
            }
            case 'rename': {
              try { this.rename(op.from, op.to); } catch { /* best-effort */ }
              break;
            }
          }
        } catch { /* last-writer-wins divergence is tolerated (documented) */ }
      }
    } finally {
      this.persist = prev;
    }
  }
}

export const S_IF = { S_IFMT, S_IFREG, S_IFDIR, S_IFLNK };
