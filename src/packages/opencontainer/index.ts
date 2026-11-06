/**
 * OpenContainer — public API entry (the `opencontainer` package root).
 *
 * Two surfaces:
 *
 *  1. `WebContainer` — the drop-in facade for code written against
 *     `@webcontainer/api` (boot/mount/spawn/on/fs/path/workdir/teardown —
 *     see ./webcontainer-api.ts and docs/webcontainer-research.md).
 *  2. `OpenContainerRuntime` — the concrete terminal-oriented runtime the
 *     facade builds on (process events, preview ports, fs RPC).
 *
 * Zero npm dependencies: everything the kernel needs is bundled into the
 * runtime assets (worker + .ocrt.gz blobs), fetched at boot from the CDN
 * by default (see runtime.ts DEFAULT_ASSETS_BASE) or self-hosted via
 * { assetsBase }.
 */

export { WebContainer } from './webcontainer-api';
export type { WebContainerBootOptions } from './webcontainer-api';
export { OpenContainerRuntime, FsRpcError, parseCommand } from './runtime';
export type { RuntimeEvents, RuntimeEventMap, RuntimeOptions, ParsedCommand, ProgramHandle } from './runtime';
export { DEFAULT_ASSETS_BASE } from './runtime';
export { OPENCONTAINER_VERSION, ENGINE_IDENTITY, NPM_IDENTITY, SHELL_IDENTITY } from './version';
export * from './types';
