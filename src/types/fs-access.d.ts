/**
 * File System Access API — minimal ambient surface for the folder import
 * path (Sidebar "Folder" button → OpenContainerIDE.importDirectoryHandle).
 *
 * lib.dom.d.ts ships FileSystemHandle / FileSystemDirectoryHandle /
 * FileSystemFileHandle (kind, getFile, getFileHandle…), but with this
 * project's target (ES2017) the auto-attached lib.dom.asynciterable.d.ts —
 * which declares the async entries() iterator — is NOT loaded (see the
 * pre-existing error at opencontainer/fs.ts:503), and the picker entry
 * point on Window is not in lib.dom at all. Both are declared here.
 *
 * Chromium and derivatives ship showDirectoryPicker(); Firefox/Safari do
 * not and fall back to the legacy filtered webkitdirectory input
 * (Sidebar.tsx). Only the surface we actually call is declared; if the
 * tsconfig target is ever raised to ES2018+ (which pulls in
 * lib.dom.asynciterable), delete the entries() declaration below.
 */

interface FileSystemDirectoryHandle {
  /** Async iteration over [name, handle] pairs. The union return type
   *  narrows on handle.kind ('file' | 'directory') at the call site. */
  entries(): AsyncIterableIterator<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>;
}

interface Window {
  /** Opens a directory picker and resolves with a read handle for the
   *  chosen folder. Rejects with AbortError when the user cancels; only
   *  available in secure contexts (https / localhost). */
  showDirectoryPicker(options?: {
    id?: string;
    mode?: 'read' | 'readwrite';
  }): Promise<FileSystemDirectoryHandle>;
}
