# WSL memory investigation — v0.1.41

Status: diagnosis of the private heap peak remains incomplete. The navigation
reanalysis path reproduced below is addressed by the v0.1.42 change; publication
evidence is recorded separately after release. The user's
screenshots establish a callback memory-budget incident, not a Worker crash or
proof of a retained-memory leak. Do not claim the local probes reproduce the
private project's allocation cause.

## Report transcribed from the screenshots

- Extension 0.1.41, VS Code 1.142.0, Linux x64, WSL.
- Capture: 2026-10-19T00:44:35.114Z; status `partial-memory-budget`.
- 1,820 indexed files, 69,573,624 source characters, 319,385 raw references,
  10,993 raw flow programs and **196** macro-enabled files.
- Both directions, depth 2, following selection, inactive skipping and function
  arguments enabled; source sorting, combined full width, callees on the left.
- Notices: 8,323 total; 8,216 syntax, 1 callback limit, 1 memory budget,
  37 macro limits, 68 other. Worker error: none.
- Last Worker sample: **200 seconds old**, idle, heap 2,531.2 MiB of 4,288 MiB;
  external memory 35.4 MiB; sampled peak 2,573.8 MiB.
- Guard: 60%, or 2,572.8 MiB. First hit: callbacks, 2,573.8 MiB.
- Latest checkpoints (MiB): sources 2,185.6 → 2,209.1; macros 2,209.1 → 2,234.0;
  callbacks 2,234.0 → 2,531.1; transfer 2,531.1 → 2,531.2. These are latest
  phase checkpoints and must not be presented as a cold-start breakdown.

## Code trace and local evidence

- `analyzer.analyze()` constructs flow facts for all indexed files. Macro folder
  settings control expansion, not the scope of raw callback-flow construction.
  Worker derivation passes all current indexed files into the analyzer.
- The report snapshots existing diagnostics without refreshing the Worker.
  Its 2,531.2 MiB figure does not establish current memory usage at capture time.
- Current-source synthetic callback probe: 61 files, 1,025,048 source characters,
  194,402 result references. Sampled peak about 230.6 MiB; retained heap after
  test-only GC about 163.8 MiB. Reference count alone cannot explain the private
  project's measured peak. Input content and size differ substantially.
- Current-source FreeRTOS probe: 655 files, 16,485,529 characters; sampled peak
  1,465.0 MiB, post-analysis sample 958.4 MiB, after test-only GC 359.8 MiB.
  This establishes substantial reclaimable allocation in a public workload.
  The measurement callback does not enforce the production 60% guard; the normal
  callback time budget remains. This is not an exhaustive inference benchmark.
- A separate fall-through-switch probe confirms repeated flow-statement creation:
  400 cases without breaks produce 80,601 statement occurrences from 7,817 source
  characters. Break-terminated cases produce 801 occurrences. This is a concrete
  amplification path, but no evidence yet ties that construct to the private
  project's incident. No unrelated switch fix has been shipped.

## Next discriminating observations

### User follow-up and navigation probe

- The user reports the warning first appeared after navigating functions without
  editing code. The affected window was already closed, so the requested fresh
  memory sample cannot be recovered.
- Selection tracking in `view.track()` queries the host index; it does not itself
  send parse/derive requests. However, `WorkspaceIndex` schedules analysis on every
  `onDidCloseTextDocument`, without checking whether the source has changed.
- A local probe using the real Worker and a simulated document-close event
  reproduced three parses and three project derivations for three unchanged
  closes (revision 2 to 5). Probe: `output/review/navigation-close-probe.mjs`.
  This confirms unnecessary reanalysis during unchanged-document closure. It
  does not establish that document closures occurred in the user's WSL session
  or that this path caused its specific heap peak.
- Any fix must preserve analysis of edits, disk changes, and discarded unsaved
  edits on close. Removing the close handler outright would be unsafe.

- Refresh Diagnostics without Rebuild/Reload and compare the new Worker sample.
  A large decrease would support reclaimable allocation. No decrease alone does
  not prove a leak because a quiet Worker need not have run collection.
- Establish whether the first warning followed initial indexing, an edit/save,
  or selection-only navigation. Graph rendering and host heap are separate from
  the Worker heap shown here.
- Preserve the heap guard until a concrete allocation change has a failing
  regression, output-equivalence checks and fresh memory measurements.

Ignored evidence: `test-results/wsl-memory-*`, `test-results/memory-switch-probe.log`,
`output/review/{analyzer-current.mjs,memory-switch-probe.ts}`.
