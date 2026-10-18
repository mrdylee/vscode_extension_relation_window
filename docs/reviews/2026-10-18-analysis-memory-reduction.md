# Analysis memory reduction — review-work

Scope: the approved first stage of memory optimization, preserving relation
semantics. No scope filtering, on-demand analysis, heap-limit increases or
additional UI settings. Prepared as 0.1.39; publication is a separate step.

## Evidence and changes

The user's v0.1.38 WSL diagnostic photo shows callback resolution increasing
sampled Worker heap from 1,317.5 to 2,597.2 MiB, with the first guard hit in that
phase. It identifies a phase, not a particular retained allocation or a leak.

Local reproduction established these concrete paths:

- Worker reset cleared raw files but left the analyzer's macro cache alive.
- Callback project results were keyed by the first file; earlier projects could
  remain reachable while that file survived. The analyzer now owns one current
  project cache and its own weak per-file cache. Reset clears both derived caches.
- A source edited to contain no function bodies/initializers bypassed macro
  analysis without removing its old cache entry. That entry is now deleted.
- Allocation sampling on 1,200 synthetic functions highlighted value unions,
  evidence copies and full local-variable-array copies in writes. Internal values
  now use readonly maps/sets, share empty and unchanged values, allocate only
  nonempty union containers, and iterate locals without an intermediate array.

Readonly value sharing preserves normalization and the 64-candidate cap; it does
not merge distinct evidence, assignments or numeric indices. Public call-site
records and graph projection are unchanged.

## Review findings resolved

1. Empty input must clear the analyzer-owned callback cache as well. Otherwise
   removing all files would retain the last project through the live analyzer.
   Added a failing GC regression and fixed the empty-project path.
2. Reset now awaits parser initialization. Keep that await inside the existing
   Worker error boundary so a failed parser cannot reject the request queue.
3. Added regression coverage for independent analyzer caches, obsolete source
   removal, rebuild from preserved raw inputs, alias/evidence isolation, array
   indices and candidate limits.

No outstanding blocking findings in the reviewed diff. Remaining project-wide
callback state, branch copies and analysis limits are outside this first-stage
change. Private WSL validation is still required.

## Verification

- RED: two retained-cache regressions failed before lifecycle changes; body
  deletion and empty-project regressions were each observed failing before fixes.
- Four forced-GC regressions pass. GC is enabled only in the test process, never
  forced by the production extension. Added `npm run test:memory` to release CI.
- TypeScript check and 187 unit tests pass.
- Four real Worker tests pass, including actual small-heap partial analysis,
  literal callback preservation, reset, header edits, deletion and replay/ack.
- Eight completed C fixtures match v0.1.38's full analysis objects, including
  source locations, argument records and inference evidence.
- Native VS Code integration passes. Native FreeRTOS checks index all 655 files
  in 32,954 ms and verify caller/callee navigation, Context, callback arguments,
  member access and variable relations. Existing callback time/loop/mutation
  limits remain visible; this is not a claim of exhaustive C analysis.
- Native large-workspace regression passes: 12,551 source candidates, 2,501
  included files, 50,000 calls; 4,364 ms indexing and 83 ms selection response.
- Packaged 0.1.39 VSIX passes archive integrity and manifest-version checks;
  bundled runtime, WASM files, offline Help and changelog byte-match the tested
  build. README differs only by VSCE's existing link rewriting. The local package
  is `artifacts/c-relation-explorer-0.1.39.vsix`.

## Local memory observations

Standalone Node v22 runs parse the same 655-file FreeRTOS corpus (16,485,529 source
characters). GC is forced before measurement to normalize the starting heap; a
pressure callback samples heap during derive. These probes observe allocations
without enforcing the guard. The production 60% guard is unchanged and its real
low-heap Worker regression passes.

| Source | Sampled peak JS heap | Derive time |
| --- | ---: | ---: |
| v0.1.38, first run | 2,433,045,384 bytes (2.27 GiB) | 28.06 s |
| v0.1.38, repeat | 2,088,338,688 bytes (1.95 GiB) | 29.61 s |
| Final optimization | 1,494,097,896 bytes (1.39 GiB) | 28.38 s |

The final measured peak is 28–39% below those baseline runs. GC timing and the
existing 10-second callback budget affect measurements and the number of
completed inferred edges; these are observations, not memory/speed guarantees.
They are JS heap samples, not system RAM/RSS. The user's 1,820-file WSL project
has not been executed here. Full output equality is asserted on completed small
fixtures rather than claiming equality for time-limited FreeRTOS runs.

Ignored evidence: `test-results/analysis-memory-*`,
`test-results/callback-memory-*`, `test-results/callback-freertos-*`;
profiling/comparison helpers in `output/playwright/`.
