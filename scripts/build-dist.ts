/**
 * OpenContainer — build the published dist bundles.
 *
 * Produces (same relative layout in the app monorepo and the standalone
 * package repo):
 *   dist/opencontainer.mjs   the public entry (facade + runtime + types + version)
 *   dist-types/**            TypeScript declarations
 *
 * Zero runtime dependencies: the browser entry imports nothing external;
 * everything the kernel needs is fetched at boot from the runtime assets
 * (CDN by default, self-hosted via assetsBase).
 *
 *   bun run scripts/build-dist.ts
 */
import { $ } from 'bun';

const entries: Array<[string, string]> = [
  ['src/packages/opencontainer/index.ts', 'dist/opencontainer.mjs'],
];

for (const [entry, outfile] of entries) {
  await $`bun build ${entry} --target=browser --format=esm --minify --outfile=${outfile}`;
}

// Declarations via the app repo's TypeScript (tsconfig.dist.json pins
// rootDir to the package so dist-types/ mirrors the package layout).
await $`bunx tsc -p tsconfig.dist.json`;

console.log('[opencontainer] dist + dist-types written.');
