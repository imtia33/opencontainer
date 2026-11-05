/**
 * OpenContainer Kernel — Module ID resolution.
 *
 * Driven by vendor/node-v26.13.0/manifest.json — generated from the vendored
 * node source tree (mirrors node's build-time embedding of all lib/*.js).
 * The manifest is the single source of truth for:
 *   - which builtin ids exist (public + internal + vendored deps)
 *   - which vendor files the browser worker preloads before boot
 */

import manifest from '../vendor/node-v26.13.0/manifest.json';

export const NODE_VERSION: string = manifest.nodeVersion;
export const VENDOR_ROOT = 'node-v26.13.0';

/** id → vendor-relative file path (all builtin modules incl. internal). */
export const BUILTIN_FILES: Readonly<Record<string, string>> = manifest.ids;

/** Files the browser worker preloads before booting the kernel. */
export const PRELOAD_FILES: readonly string[] = manifest.files;

const normalized = new Map<string, string>();
for (const [id, file] of Object.entries(manifest.ids)) {
  normalized.set(id, `${VENDOR_ROOT}/${file}`);
}
// public builtins also addressable with node: prefix
for (const [id] of Object.entries(manifest.ids)) {
  if (!id.startsWith('internal/')) {
    normalized.set(`node:${id}`, `${VENDOR_ROOT}/${manifest.ids[id]}`);
  }
}

/** Resolved vendor-relative path for a builtin specifier, or null. */
export function resolveModuleFile(specifier: string): string | null {
  return normalized.get(specifier) ?? null;
}

/** The require() id space that CJS code inside the runtime can load as builtin. */
export function isBuiltinId(specifier: string): boolean {
  return resolveModuleFile(specifier) !== null;
}

/** Public builtin ids (the require('fs') surface, node: prefixed forms included). */
export const PUBLIC_BUILTINS: readonly string[] = Object.keys(manifest.ids)
  .filter((id) => !id.startsWith('internal/'));

/** Internal builtin ids. */
export const INTERNAL_BUILTINS: readonly string[] = Object.keys(manifest.ids)
  .filter((id) => id.startsWith('internal/'));
