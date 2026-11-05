/**
 * OpenContainer oc-sh — `corepack` (honest stub).
 *
 * Corepack stopped shipping with Node.js 25 (nodejs/node#57617) and is now
 * an opt-in npm global. This runtime does not distribute it either; the
 * package-manager selection it performed lives in our own command
 * dispatcher. Every command answers honestly instead of faking shim
 * behavior.
 */
'use strict';

const args = process.argv.slice(2);
const VERSION = 'corepack/0.31.0-oc (not distributed — install package managers directly)';

const HELP = [
  'corepack (OpenContainer honest stub)',
  '',
  'Corepack is not distributed with this runtime (Node.js 25+ stopped',
  'distributing it too). The npm/pnpm/yarn commands are available directly.',
  '',
  'The packageManager field in package.json is informational here; this',
  'runtime does not yet select package-manager versions from it.',
].join('\n');

const cmd = args[0];

if (cmd === '--version' || cmd === '-v') {
  console.log(VERSION);
  process.exit(0);
}

if (cmd === '--help' || cmd === '-h' || cmd === undefined) {
  console.log(HELP);
  process.exit(cmd === undefined ? 1 : 0);
}

console.error(`corepack: '${cmd}' is not available in OpenContainer — use 'npm', 'pnpm' or 'npx' directly.`);
process.exit(1);
