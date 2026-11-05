/**
 * OpenContainer — public API entry (the `opencontainer` package root).
 *
 * Two surfaces:
 *
 *  1. `WebContainer` — the drop-in facade for code written against
 *     `@webcontainer/api` (boot/mount/spawn/on/fs/path/workdir/teardown —
 *     see ./webcontainer-api.ts and docs/webcontainer-research.md).
 *  2. `OpenContainerRuntime` — the concrete terminal-oriented runtime the
 *     facade (and the IDE glue) build on.
 *
 * The IDE glue (`OpenContainerIDE`) is exported for embedders that want the
 * project store / import pipeline on top of the raw runtime.
 *
 * Zero npm dependencies: everything the kernel needs is bundled into the
 * served worker + runtime blobs (public/opencontainer/*).
 */

export { WebContainer } from './webcontainer-api';
export type { WebContainerBootOptions } from './webcontainer-api';
export { OpenContainerRuntime, FsRpcError, parseCommand } from './runtime';
export type { RuntimeEvents, RuntimeEventMap, ParsedCommand, ProgramHandle } from './runtime';
export { OPENCONTAINER_VERSION, ENGINE_IDENTITY, NPM_IDENTITY, SHELL_IDENTITY } from './version';
export { OpenContainerIDE } from './ide/container';
export type { ImportProgress, ImportResult, ProjectMeta } from './ide/container';
export * from './types';
