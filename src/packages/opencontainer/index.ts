/**
 * OpenContainer — public API entry (the `opencontainer` package root).
 *
 * Drop-in oriented toward the `@webcontainer/api` surface (see ./types.ts);
 * the concrete class is `OpenContainerRuntime`. The IDE glue
 * (`OpenContainerIDE`) is exported for embedders that want the project
 * store / import pipeline on top of the raw runtime.
 *
 * Zero npm dependencies: everything the kernel needs is bundled into the
 * served worker + runtime blobs (public/opencontainer/*).
 */

export { OpenContainerRuntime, FsRpcError, parseCommand } from './runtime';
export type { RuntimeEvents, RuntimeEventMap, ParsedCommand } from './runtime';
export { OPENCONTAINER_VERSION, ENGINE_IDENTITY, NPM_IDENTITY, SHELL_IDENTITY } from './version';
export { OpenContainerIDE } from './ide/container';
export type { ImportProgress, ImportResult, ProjectMeta } from './ide/container';
export * from './types';
