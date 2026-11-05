import type { Binding, NativesContext } from './index';
import { uvDirentOfHelper as uvDirentOf } from './fs';

/**
 * internalBinding('fs_dir') — opendir handles.
 *
 * S3.1 rewrite: the previous shape (numeric handle ids + one {name,type}
 * object per readdir call) matched neither side of the contract. The REAL
 * contract (lib/internal/fs/dir.js):
 *   - opendirSync(path) → a HANDLE OBJECT with read/close methods
 *   - opendir(path, encoding, req) → async; req.oncomplete(null, handle)
 *   - handle.read(encoding, bufferSize) → flat [name0, type0, name1, type1,
 *     ...] with UV_DIRENT_* codes, or null when exhausted (sync mode);
 *     handle.read(encoding, bufferSize, req) → async → req.oncomplete
 *   - handle.close() / handle.close(req) → sync / async
 * Found via the fs.cp filter path (opendirSync → Dir#readSync).
 */
export function makeFsDirBinding(ctx: NativesContext): Binding {
  const makeHandle = (path: string) => {
    // Snapshot the entries at open time (matches the C++ fd semantics —
    // the kernel VFS has no concurrent mutation inside one process).
    const entries: Array<[string, number]> = ctx.vfs.dirents(path).map(
      (e: { name: string; type: number }) => [e.name, uvDirentOf(e.type)] as [string, number],
    );
    let pos = 0;
    let closed = false;

    const readBatch = (): Array<string | number> | null => {
      if (closed) throw Object.assign(new Error('EBADF: bad directory handle'), { errno: -9, code: 'EBADF' });
      if (pos >= entries.length) return null;
      const out: Array<string | number> = [];
      while (pos < entries.length) {
        const [name, type] = entries[pos++];
        out.push(name, type);
      }
      return out;
    };

    return {
      read(encoding?: unknown, bufferSize?: unknown, req?: any) {
        const maybeReq = req ?? (typeof bufferSize === 'object' && bufferSize !== null && 'oncomplete' in (bufferSize as any)
          ? (bufferSize as any) : undefined);
        if (maybeReq !== undefined) {
          queueMicrotask(() => {
            try {
              maybeReq.oncomplete(null, readBatch());
            } catch (e: any) {
              maybeReq.oncomplete(e?.errno ?? -2);
            }
          });
          return undefined;
        }
        return readBatch();
      },
      close(req?: any) {
        closed = true;
        if (req !== undefined && typeof req.oncomplete === 'function') {
          queueMicrotask(() => req.oncomplete(null));
        }
      },
    };
  };

  return {
    opendir(path: string, _encoding?: string, req?: any) {
      if (req !== undefined && typeof req.oncomplete === 'function') {
        queueMicrotask(() => {
          try {
            req.oncomplete(null, makeHandle(String(path)));
          } catch (e: any) {
            req.oncomplete(e?.errno ?? -2);
          }
        });
        return undefined;
      }
      return makeHandle(String(path));
    },
    opendirSync(path: string) {
      return makeHandle(String(path));
    },
  };
}
