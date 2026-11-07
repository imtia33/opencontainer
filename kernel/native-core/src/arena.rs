//! Chunked append-only bump arena for INBOUND data (paths, file payloads,
//! tar blobs) that the JS bridge writes into wasm linear memory (spec §2).
//!
//! Guarantees:
//! - `alloc` NEVER moves previous allocations: chunks are separate
//!   allocations with stable addresses. When the current 1 MiB chunk is
//!   exhausted a new chunk is pushed; a single allocation larger than 1 MiB
//!   gets a dedicated chunk sized to fit.
//! - Pointers stay valid until the next `reset()`. `reset` keeps the first
//!   chunk (recycles it) and drops the rest.
//!
//! Target mapping:
//! - wasm32: chunks are boxed slices living in the Rust heap, which IS the
//!   wasm linear memory — returned pointers are plain linear-memory
//!   addresses the embedder writes through its cached `Uint8Array` view.
//! - host (cargo test): chunks are sub-ranges of the growable `HOST_MEM`
//!   vector and returned "pointers" are offsets into it; the no-move
//!   property holds in offset space, which is exactly what the bridge
//!   observes.

const CHUNK: usize = 1 << 20; // 1 MiB (spec §2)

pub struct Arena {
    /// (base, len) per chunk. base = absolute address (wasm) or HOST_MEM
    /// offset (host).
    chunks: Vec<(usize, usize)>,
    cur: usize,
    off: usize,
}

impl Arena {
    pub fn new() -> Arena {
        Arena { chunks: Vec::new(), cur: 0, off: 0 }
    }

    /// Bump-allocate `n` bytes; returns the pointer (host: offset), or 0 for
    /// a negative `n` (OOM sentinel; a real allocation failure aborts the
    /// module before we could return — see README). Never panics.
    pub fn alloc(&mut self, n: i32) -> i32 {
        if n < 0 {
            return 0;
        }
        let n = n as usize;
        if self.chunks.is_empty() {
            self.push_chunk(CHUNK);
        }
        if n == 0 {
            // A stable, non-null pointer for zero-length writes.
            return self.chunks[self.cur].0 as i32;
        }
        let clen = self.chunks[self.cur].1;
        if n > clen - self.off {
            // Current chunk exhausted: append a new one (dedicated when the
            // single allocation exceeds the standard chunk size).
            self.push_chunk(if n > CHUNK { n } else { CHUNK });
        }
        let (base, _) = self.chunks[self.cur];
        let p = base + self.off;
        self.off += n;
        p as i32
    }

    fn push_chunk(&mut self, len: usize) {
        #[cfg(target_arch = "wasm32")]
        {
            let mut v: Vec<u8> = Vec::with_capacity(len);
            v.resize(len, 0);
            let b: Box<[u8]> = v.into_boxed_slice();
            // fat pointer -> thin pointer -> usize (raw slice ptrs can't cast
            // to usize directly, E0606)
            self.chunks.push((Box::into_raw(b) as *mut u8 as usize, len));
        }
        #[cfg(not(target_arch = "wasm32"))]
        {
            // Host: chunks are contiguous ranges of HOST_MEM. Base is offset
            // by +1 so the first allocation never returns 0 (the OOM
            // sentinel).
            let base = self.total_end() + 1;
            crate::hostmem::ensure(base - 1 + len);
            self.chunks.push((base, len));
        }
        self.cur = self.chunks.len() - 1;
        self.off = 0;
    }

    fn total_end(&self) -> usize {
        self.chunks.iter().map(|&(_, l)| l).sum()
    }

    /// Recycle: keep the first chunk, drop the rest, restart the bump
    /// pointer. All previously handed-out pointers become invalid — the
    /// bridge owns that discipline (it resets after each syscall wrapper).
    pub fn reset(&mut self) {
        if self.chunks.len() > 1 {
            self.chunks.truncate(1);
        }
        self.cur = 0;
        self.off = 0;
    }
}
