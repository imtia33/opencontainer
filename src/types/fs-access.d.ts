/**
 * File System Access API — minimal ambient surface for OPFS hydration.
 *
 * lib.dom.d.ts ships FileSystemHandle / FileSystemDirectoryHandle /
 * FileSystemFileHandle (kind, getFile, getFileHandle…), but with this
 * project's target (ES2017) the auto-attached lib.dom.asynciterable.d.ts —
 * which declares the async entries() iterator — is NOT loaded (fs.ts
 * iterates OPFS directory entries during boot hydration, see fs.ts
 * restoreFromOPFS). Only the surface we actually call is declared; if the
 * tsconfig target is ever raised to ES2018+ (which pulls in
 * lib.dom.asynciterable), delete the declaration below.
 */

interface FileSystemDirectoryHandle {
  /** Async iteration over [name, handle] pairs. The union return type
   *  narrows on handle.kind ('file' | 'directory') at the call site. */
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
}
