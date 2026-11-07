/**
 * OpenContainer — RPC protocol between the main thread (SDK client) and the
 * runtime worker. All messages are structured-clone friendly.
 */

export const RPC_PROTOCOL_VERSION = 1;

/* ------------------------------ requests ----------------------------- */

export type RpcRequest =
  | { id: number; kind: 'fs'; op: 'mkdir'; path: string; options?: { recursive?: boolean } }
  | { id: number; kind: 'fs'; op: 'readdir'; path: string }
  | { id: number; kind: 'fs'; op: 'readFile'; path: string; encoding?: 'utf-8' | 'utf8' }
  | { id: number; kind: 'fs'; op: 'writeFile'; path: string; contents: string | Uint8Array }
  | { id: number; kind: 'fs'; op: 'rm'; path: string; options?: { force?: boolean; recursive?: boolean } }
  | { id: number; kind: 'fs'; op: 'readDirRecursive'; path: string }
  | { id: number; kind: 'fs'; op: 'tree'; path: string }
  | { id: number; kind: 'runtime'; op: 'boot'; options: Record<string, unknown> }
  | { id: number; kind: 'runtime'; op: 'mount'; tree: unknown }
  | { id: number; kind: 'runtime'; op: 'spawn'; command: string; args: string[]; options?: { cwd?: string; env?: Record<string, string> } }
  | { id: number; kind: 'runtime'; op: 'spawnJSH'; options?: { cwd?: string; env?: Record<string, string> } }
  | { id: number; kind: 'runtime'; op: 'teardown' }
  | { id: number; kind: 'runtime'; op: 'info' }
  | { id: number; kind: 'runtime'; op: 'listProcesses' }
  | { id: number; kind: 'runtime'; op: 'listPorts' }
  | { id: number; kind: 'process'; op: 'stdin'; pid: number; data: string }
  | { id: number; kind: 'process'; op: 'kill'; pid: number }
  | { id: number; kind: 'process'; op: 'resize'; pid: number; cols: number; rows: number }
  /** Preview traffic routed through the service worker → page → worker. */
  | { id: number; kind: 'net'; op: 'previewFetch'; port: number; requestId: string; method: string; path: string; headers: Record<string, string>; body?: ArrayBuffer }
  | { id: number; kind: 'net'; op: 'previewAbort'; requestId: string }

/* ------------------------------ responses ---------------------------- */

export interface RpcError {
  message: string;
  code?: string;
  errno?: number;
  syscall?: string;
  path?: string;
}

export type RpcResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: RpcError };

/* ------------------------------ events ------------------------------- */

export type RuntimeEvent =
  | { event: 'server-ready'; port: number; url: string }
  | { event: 'port'; port: number; type: 'open' | 'close'; url: string }
  | { event: 'error'; message: string }
  | { event: 'preview-message'; data: unknown }
  | { event: 'fs-change'; records: Array<{ path: string; type: 'created' | 'updated' | 'renamed' | 'deleted' }> };

export type ProcessStreamEvent =
  | { event: 'proc:stdout'; pid: number; data: string }
  | { event: 'proc:stderr'; pid: number; data: string }
  | { event: 'proc:exit'; pid: number; code: number };

export type PreviewStreamEvent =
  | { event: 'preview:chunk'; requestId: string; chunk: Uint8Array }
  | { event: 'preview:close'; requestId: string }
  | { event: 'preview:abort'; requestId: string };

export type RpcEvent = RuntimeEvent | ProcessStreamEvent | PreviewStreamEvent;

export type RpcMessage = RpcRequest | RpcResponse | RpcEvent;
