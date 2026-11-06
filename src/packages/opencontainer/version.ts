/**
 * OpenContainer — build & engine identity.
 *
 * HONESTY NOTE (see COMPATIBILITY.md): OpenContainer executes the vendored,
 * unmodified Node.js v26.13.0 JavaScript standard library inside a Web
 * Worker, on the browser's own JavaScript engine. It is NOT a Node.js binary
 * distribution and NOT a Node C++→WASM build: the ~40 C++
 * `internalBinding` surfaces are re-implemented on browser primitives.
 *
 *  - `node -v` / process.version report the vendored Node lib version
 *    (v26.13.0, from the auto-generated runtime index — see runtime-index.ts).
 *  - npm is the genuine, unmodified upstream CLI (vendored, provenance
 *    recorded in vendor/npm-12.2.1/.provenance.json).
 */
export const OPENCONTAINER_VERSION = '1.0.0-beta.2';

export const ENGINE_IDENTITY = {
  /** Product identity of the `node` command provided by this runtime. */
  name: 'opencontainer-node',
  /** Node.js version whose standard library is vendored and executed. */
  nodeVersion: 'v26.13.0',
  /** What actually executes the JavaScript: the browser's own engine. */
  jsEngine: 'browser-native (V8 in Chromium; JavaScriptCore in WebKit)',
  /** The Node.js API level shipped (the vendored lib tree version). */
  nodeApiLevel: 26,
  /** Reported by process.platform — POSIX-style VFS (documented divergence). */
  platform: 'linux',
  arch: 'wasm32',
  /** Honesty marker, à la Bun/webpack: `process.browser === true`. */
  browser: true,
} as const;

export const NPM_IDENTITY = {
  /** The genuine upstream npm CLI, vendored unmodified. */
  name: 'npm',
  version: '12.2.1',
  /** Default registry, overridable via `npm config set registry`. */
  defaultRegistry: 'https://registry.npmjs.org',
} as const;

export const SHELL_IDENTITY = {
  /** OpenContainer's own POSIX-subset shell (not bash; honest `--version`). */
  name: 'oc-sh',
  version: OPENCONTAINER_VERSION,
} as const;
