# native-core — the OpenContainer native kernel core

Rust → `wasm32-unknown-unknown`. The kernel's filesystem data plane: inode
arena, fd table, path resolution, file I/O, tar extraction. Called
synchronously from the kernel worker through the flat C ABI in
**docs/native-core-spec.md** (the frozen v1 contract — read it first).

## Build

```bash
~/.cargo/bin/cargo test                                           # host tests (65)
~/.cargo/bin/cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/native_core.wasm pkg/oc_core.wasm
node smoke.mjs                                                    # ABI smoke (42)
```

pkg/oc_core.wasm is shipped as the runtime asset `oc-core-<sha8>.wasm.gz`
(scripts/pack-runtime.ts) and cached by the kernel worker like the other
blobs. ~96 KB raw / 45 KB gz.

## Notes

- **memory_size**: use the const-generic form `memory_size::<0>()`. The
  deprecated runtime-arg shim (`memory_size(0)`) compiles but returns
  garbage — this cost an afternoon once; do not reintroduce it.
- Errno sign: resolve()/entry_dest return POSITIVE errnos; oc_* exports
  return NEGATIVE. Conversion happens exactly once, at the export layer.
- fds 0–2 are reserved for JS stdio; the table starts at 3.
- The deterministic internal clock (README deviation #1 in the research):
  mutations are stamped by a monotonic counter; oc_utimes pins real times.

## Deviations from the spec (none at v1 beyond those documented in the
worklog S23 fix-loop; the spec is authoritative).
