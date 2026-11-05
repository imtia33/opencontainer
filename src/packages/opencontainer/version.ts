/**
 * OpenContainer — build & engine identity.
 *
 * IMPORTANT HONESTY NOTE (see COMPATIBILITY.md):
 * OpenContainer ships `opencontainer-node`, a Node-API-compatible engine
 * built on QuickJS. It is NOT a genuine Node.js binary distribution.
 * All version strings below describe the artifacts that ACTUALLY execute:
 *  - `version`            = the OpenContainer runtime you are running
 *  - `jsEngine`           = the JavaScript engine inside every `node` process
 *  - `nodeApiLevel`       = the Node.js API surface we aim to be compatible with
 * `node -v` / `process.version` report `v{version}` — the real runtime version,
 * never a hardcoded Node.js release number.
 */
export const OPENCONTAINER_VERSION = '1.0.0-beta.1';

export const ENGINE_IDENTITY = {
  /** Product identity of the `node` executable provided by this runtime. */
  name: 'opencontainer-node',
  /** Semver of the OpenContainer runtime itself (what `node -v` reports, prefixed with v). */
  version: OPENCONTAINER_VERSION,
  /** The actual JavaScript engine executing user code. */
  jsEngine: 'QuickJS 2024-01-13 (quickjs-emscripten 0.32.0)',
  /** The Node.js API level we target for compatibility (docs/parity target, NOT a claim of being that Node version). */
  nodeApiLevel: 22,
  /** Reported by process.platform — POSIX-style VFS (documented divergence from a real OS). */
  platform: 'linux',
  arch: 'wasm32',
  /** Honesty marker, à la Bun/webpack: `process.browser === true`. */
  browser: true,
} as const;

export const NPM_IDENTITY = {
  /** Product identity of the `npm` executable provided by this runtime. */
  name: 'opennpm',
  /** Real version of the npm-compatible client shipped in this runtime. */
  version: OPENCONTAINER_VERSION,
  /** Default registry, overridable via `npm config set registry`. */
  defaultRegistry: 'https://registry.npmjs.org',
} as const;

export const SHELL_IDENTITY = {
  name: 'ocsh',
  version: OPENCONTAINER_VERSION,
} as const;
