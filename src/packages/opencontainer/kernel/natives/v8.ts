import type { Binding, NativesContext } from './index';

/**
 * internalBinding('v8') — flags/hooks with browser-safe values.
 * v8.js (lib) destructures the full statistics surface at LOAD time —
 * kHeapSpaces, the Float64Array buffers, and every k*Index constant —
 * so all of them must exist for `require('v8')` / `require('vm')` to load.
 */

// Order matters: getHeapSpaceStatistics() iterates kHeapSpaces.
const kHeapSpaces = [
  'read_only_space',
  'new_space',
  'old_space',
  'code_space',
  'shared_space',
  'trusted_space',
  'new_large_object_space',
  'old_large_object_space',
  'code_large_object_space',
  'shared_large_object_space',
  'trusted_large_object_space',
];

const kTotalHeapSizeIndex = 0;
const kTotalHeapSizeExecutableIndex = 1;
const kTotalPhysicalSizeIndex = 2;
const kTotalAvailableSizeIndex = 3;
const kUsedHeapSizeIndex = 4;
const kHeapSizeLimitIndex = 5;
const kMallocedMemoryIndex = 6;
const kPeakMallocedMemoryIndex = 7;
const kDoesZapGarbageIndex = 8;
const kExternalMemoryIndex = 9;
const kExternalMemoryLimitIndex = 10;
const kMaxExternalMemoryIndex = 11;
// v8.js also reads a few more (12..15) defensively — provide zeros.
const kHeapStatisticsCount = 16;

const kSpaceSizeIndex = 0;
const kSpaceUsedSizeIndex = 1;
const kSpaceAvailableSizeIndex = 2;
const kPhysicalSpaceSizeIndex = 3;

const kCodeAndMetadataSizeIndex = 0;
const kExternalScriptSourceSizeIndex = 1;
const kCpuProfilerMetaDataSizeIndex = 2;
const kEmbedderHeapTracerTypeIndex = 3;

export function makeV8Binding(_ctx: NativesContext): Binding {
  const heapStatisticsBuffer = new Float64Array(kHeapStatisticsCount);
  const heapSpaceStatisticsBuffer = new Float64Array(kHeapSpaces.length * 4);
  const heapCodeStatisticsBuffer = new Float64Array(4);

  const perfMemory = () => (globalThis as any).performance?.memory;

  function fillHeapStats(): void {
    const mem = perfMemory();
    const used = mem?.usedJSHeapSize ?? 0;
    const total = mem?.totalJSHeapSize ?? used;
    // Chrome exposes performance.memory on Window only — never in workers,
    // and not in the bun harness. When the platform hides the heap limit,
    // report the 64-bit V8-style default (2 GiB) instead of 0: a zero limit
    // makes @npmcli/arborist's PackumentCache size its LRU to zero and throw
    // "cannot set sizeCalculation without setting maxSize or maxEntrySize".
    // Documented divergence: this is a constant, not the real browser limit.
    const limit = mem?.jsHeapSizeLimit ?? 2147483648;
    heapStatisticsBuffer.fill(0);
    heapStatisticsBuffer[kTotalHeapSizeIndex] = total;
    heapStatisticsBuffer[kTotalHeapSizeExecutableIndex] = 0;
    heapStatisticsBuffer[kTotalPhysicalSizeIndex] = total;
    heapStatisticsBuffer[kTotalAvailableSizeIndex] = Math.max(0, limit - used);
    heapStatisticsBuffer[kUsedHeapSizeIndex] = used;
    heapStatisticsBuffer[kHeapSizeLimitIndex] = limit;
    heapStatisticsBuffer[kDoesZapGarbageIndex] = 0;
    heapStatisticsBuffer[kExternalMemoryIndex] = 0;
  }

  function fillHeapSpaceStats(): void {
    heapSpaceStatisticsBuffer.fill(0);
    const mem = perfMemory();
    const used = mem?.usedJSHeapSize ?? 0;
    // All heap in one space (old_space), rest zero — honest approximation.
    const oldUsed = used;
    heapSpaceStatisticsBuffer[kSpaceSizeIndex + 2 * 4] = oldUsed;
    heapSpaceStatisticsBuffer[kSpaceUsedSizeIndex + 2 * 4] = oldUsed;
    heapSpaceStatisticsBuffer[kSpaceAvailableSizeIndex + 2 * 4] = 0;
    heapSpaceStatisticsBuffer[kPhysicalSpaceSizeIndex + 2 * 4] = oldUsed;
  }

  fillHeapStats();
  fillHeapSpaceStats();

  return {
    // ---- flags ----
    setFlagsFromString(_flags: string) { /* no V8 flag access from browsers */ },
    setFlagsFromStringSafe(_flags: string) {},

    // ---- heap statistics (buffers + fillers) ----
    heapStatisticsBuffer,
    heapSpaceStatisticsBuffer,
    heapCodeStatisticsBuffer,
    updateHeapStatisticsBuffer: fillHeapStats,
    updateHeapSpaceStatisticsBuffer: fillHeapSpaceStats,
    updateHeapCodeStatisticsBuffer() {
      heapCodeStatisticsBuffer.fill(0);
    },
    getHeapStatistics() {
      fillHeapStats();
      const out: Record<string, number> = {};
      for (let i = 0; i < kHeapStatisticsCount; i++) out[i] = heapStatisticsBuffer[i];
      return out;
    },
    getHeapSpaceStatistics() {
      fillHeapSpaceStats();
      return kHeapSpaces.map((name, i) => ({
        space_name: name,
        space_size: heapSpaceStatisticsBuffer[i * 4 + kSpaceSizeIndex],
        space_used_size: heapSpaceStatisticsBuffer[i * 4 + kSpaceUsedSizeIndex],
        space_available_size: heapSpaceStatisticsBuffer[i * 4 + kSpaceAvailableSizeIndex],
        physical_space_size: heapSpaceStatisticsBuffer[i * 4 + kPhysicalSpaceSizeIndex],
      }));
    },
    getHeapCodeStatistics() {
      return {
        code_and_metadata_size: 0,
        cpu_profiler_metadata_size: 0,
        external_script_source_size: 0,
        embedder_heap_tracer_type: 0,
      };
    },
    getCppHeapStatistics() { return { cpp_heap_size: 0, external_memory: 0 }; },
    getMemorySavingsForStrings() { return 0; },

    // ---- heap statistics indexes (v8.js destructures these at load) ----
    kTotalHeapSizeIndex,
    kTotalHeapSizeExecutableIndex,
    kTotalPhysicalSizeIndex,
    kTotalAvailableSizeIndex,
    kUsedHeapSizeIndex,
    kHeapSizeLimitIndex,
    kMallocedMemoryIndex,
    kPeakMallocedMemoryIndex,
    kDoesZapGarbageIndex,
    kExternalMemoryIndex,
    kExternalMemoryLimitIndex,
    kMaxExternalMemoryIndex,

    kHeapSpaces,

    kSpaceSizeIndex,
    kSpaceUsedSizeIndex,
    kSpaceAvailableSizeIndex,
    kPhysicalSpaceSizeIndex,

    kCodeAndMetadataSizeIndex,
    kExternalScriptSourceSizeIndex,
    kCpuProfilerMetaDataSizeIndex,
    kEmbedderHeapTracerTypeIndex,

    // ---- cpu / heap profiling (not available in browsers) ----
    startCpuProfile: undefined,
    stopCpuProfile: undefined,
    startHeapProfile: undefined,
    stopHeapProfile: undefined,
    startSamplingHeapProfiler() { throw new Error('v8.startSamplingHeapProfiler is not supported in the browser'); },
    stopSamplingHeapProfiler() {},
    setHeapSnapshotNearHeapLimit() {},
    setHeapProfileNearHeapLimit() {},
    getHeapSnapshot() { throw new Error('v8.getHeapSnapshot is not supported in the browser'); },
    getHeapSnapshotStream() { throw new Error('not supported'); },
    triggerHeapSnapshot: undefined,

    // ---- misc ----
    isStringOneByteRepresentation(str: string): boolean {
      // One-byte = Latin-1 range only.
      for (let i = 0; i < str.length; i++) {
        if (str.charCodeAt(i) > 0xff) return false;
      }
      return true;
    },
    cachedDataVersionTag: () => 0,
    setHooksFromBinding() {},
    terminateExecution() { /* no V8 interrupt API in browsers — S4 uses cooperative checks */ },
    _setFlagsFromStringNoop: true,
    startupSnapshot: undefined,
    detailLevel: 0,

    // heap_profile.js sampling flags
    kSamplingNoFlags: 0,
    kSamplingForceGC: 1,
    kSamplingIncludeObjectsCollectedByMajorGC: 2,
    kSamplingIncludeObjectsCollectedByMinorGC: 4,

    // v8.measureMemory (binding-level; vm.js wraps it)
    measureMemory: async () => ({
      total: { jsMemoryEstimate: perfMemory()?.usedJSHeapSize ?? 0, jsMemoryRange: [0, perfMemory()?.jsHeapSizeLimit ?? 0] },
    }),
  };
}
