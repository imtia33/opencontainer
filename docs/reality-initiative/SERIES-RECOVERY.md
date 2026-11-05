# The Reality Initiative — series recovery note

> **What this file is:** the six-document Reality Initiative series (`01`–`06`,
> plus the P1 write-up `07-oss-strategy-adoption.md`) was produced across
> sessions 8–11 in the development sandbox but **never committed to git**. The
> sandbox working-copy loss of 2026-11-05 destroyed all seven documents. They
> are not recoverable from history. This note records what is verifiably known
> about the series so future work does not silently treat it as nonexistent.

## What the series was (verified from session records)

The series was the "Runtime Reality Initiative" — the architecture program
that moved OpenContainer from an emulated/QuickJS-era runtime to **real
upstream Node.js `lib/*.js` running on the browser engine**:

1. **`01-reality-audit.md`** — the audit that started the initiative: what was
   real vs emulated at the time (the QuickJS engine era, see
   `src/packages/opencontainer/engine/`), and the honesty classification
   (Category A/B genuine-upstream vs reimplemented vs emulated) that still
   governs COMPATIBILITY.md.
2. **`02-*.md`** — the StackBlitz WebContainers baseline teardown: their core
   disciplines (port node's C++ bindings wholesale; every pending op is a uv
   handle) that sessions 11–12 adopted as code.
3. **`03-architecture-target.md`** — the target architecture: real node lib
   tree in a worker, ~25 C++ internalBinding surfaces in browser JS, OPFS
   VFS, real npm CLI vendored.
4. **`04-nodejs-approach-feasibility.md`** — the feasibility report incl. the
   **module_wrap / `require(esm)` shim design and patch budget** (the standing
   "continue on designed doc4" directive refers to this document). Its
   content is partially reflected in the P1 prompt (Workstream A: trace
   require() → Module._load → ModuleJobSync → importSyncForRequire →
   ModuleWrap; the Acorn-based ESM-to-CJS snapshot facade hypothesis and its
   semantic test matrix).
5. **`05-migration-plan.md`** — the staged migration plan (S-series stages).
6. **`06-poc-real-npm.md`** — the PoC that genuine upstream `npm@12.2.1` boots
   in the kernel and prints its version.
7. **`07-oss-strategy-adoption.md`** — the P1 "npm is npm" implementation
   report (lost final write-up; its results are recorded in
   `docs/worklog/WORKLOG.md` Session 11 and re-verified in Session 12).

## Where the surviving knowledge lives

- `docs/worklog/WORKLOG.md` — sessions 8–12 (incl. the reconstruction of the
  lost sessions 10–11 and the recovery audit).
- `COMPATIBILITY.md` — the honesty contract (real vs adapted vs divergent).
- `docs/adr-001-preview-networking.md`, `docs/bindings-matrix.json`,
  `docs/architecture-followup-S2.md` — surviving contemporaneous docs.
- The kernel code itself: `src/packages/opencontainer/kernel/` (buffer
  parity, net-pending, http-fetch-client, esm-to-cjs are the adopted
  strategy, in code).
- The P1 acceptance gate and its evidence are quoted verbatim in the session
  records; the evidence artifacts (`opencontainer-s12-p1-gate.*`) were lost
  with the sandbox and must be regenerated on the next browser E2E run.

## Standing directive affected

"Continue on designed doc4" (module_wrap shim): the design document is gone;
the design intent is recoverable from the P1 prompt's Workstream A section
and the `kernel/esm-to-cjs.ts` + `kernel/esm-graph.ts` implementation
start. The semantic test matrix from the P1 prompt (live bindings, circular
ESM, top-level-await rejection, error codes) is the acceptance list to
rebuild against.
