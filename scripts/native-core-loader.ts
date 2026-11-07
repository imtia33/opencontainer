/**
 * Shared native-core loader for the bun gate harnesses.
 *
 * Loads kernel/native-core/pkg/oc_core.wasm (the Rust→WASM kernel core,
 * ABI v1) so gates exercise the NATIVE data plane exactly as the browser
 * worker does. Set OC_NO_NATIVE=1 to force the JS VFS fallback (A/B runs).
 *
 *   import { nativeCoreOpt } from './native-core-loader';
 *   bootKernel({ ...opts, nativeCore: nativeCoreOpt() });
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

const WASM_PATH = nodePath.resolve(import.meta.dir, '../kernel/native-core/pkg/oc_core.wasm');

let cached: ArrayBuffer | undefined | null = null; // null = probed, absent

export function nativeCoreOpt(): ArrayBuffer | WebAssembly.Module | undefined {
  if (process.env.OC_NO_NATIVE === '1') return undefined;
  if (cached !== null) return cached;
  try {
    const buf = nodeFs.readFileSync(WASM_PATH);
    cached = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength,
    ) as ArrayBuffer;
    process.stderr.write(`[native-core] ${WASM_PATH.split('/').pop()} loaded (${buf.byteLength} B)\n`);
  } catch {
    cached = undefined;
    process.stderr.write(
      `[native-core] ${WASM_PATH} not found — gates run the JS VFS fallback (build it: cd kernel/native-core && cargo build --release --target wasm32-unknown-unknown && cp target/wasm32-unknown-unknown/release/native_core.wasm pkg/oc_core.wasm)\n`,
    );
  }
  return cached;
}

/** True when the native core is active (for gate result labeling). */
export function nativeCoreActive(): boolean {
  return nativeCoreOpt() !== undefined;
}
