/**
 * OpenContainer — build the published dist bundles.
 *
 * Produces (same relative layout in the app monorepo and the standalone
 * package repo):
 *   dist/opencontainer.mjs   the public entry (runtime + types + version)
 *   dist/ide.mjs             the IDE glue (project store, import pipeline)
 *   dist-types/**            TypeScript declarations for both entries
 *
 * Zero runtime dependencies: the browser entry imports nothing external;
 * everything the kernel needs is already bundled into the served worker
 * (public/opencontainer/kernel-worker.js) and the runtime blobs.
 *
 *   bun run scripts/build-dist.ts
 */
import { $ } from 'bun';

const entries: Array<[string, string]> = [
  ['src/packages/opencontainer/index.ts', 'dist/opencontainer.mjs'],
  ['src/packages/opencontainer/ide/container.ts', 'dist/ide.mjs'],
];

for (const [entry, outfile] of entries) {
  await $`bun build ${entry} --target=browser --format=esm --minify --outfile=${outfile}`;
}

// Declarations via the app repo's TypeScript (tsconfig.dist.json pins
// rootDir to the package so dist-types/ mirrors the package layout).
await $`bunx tsc -p tsconfig.dist.json`;

console.log('[opencontainer] dist + dist-types written.');
