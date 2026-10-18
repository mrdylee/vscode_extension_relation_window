# Full-review fixes — review-work for 0.1.41

Scope: the three confirmed findings in `2026-10-18-full-review.md`, reviewed
against base `2a2bf7ef4b05e7b92f19de1d8e5ef7bc7b5809f9`. No new analysis mode,
heap-limit increase or unrelated refactoring.

## Changes and review

- Recheck disposal, workspace epoch and file version after asynchronous disk IO
  and before sending any parse to the real Worker. Recheck Worker failure at the
  same boundary. Older reads cannot overwrite newer buffered source, reintroduce
  deleted files or cross a rebuild. A persistent stale derive with an unchanged
  host revision now records an explicit partial-index failure; rebuild recovers.
- Reserve one file slot before IO, sharing the 10,000-file cap between the initial
  scan and live events. Updates reuse their slot. Current-version failures and
  deletion release it; obsolete failures cannot release a newer version's slot.
  Rebuild resets reservations. A rejected final debounce event still runs pending
  derivation, so a valid preceding edit does not lose callback postprocessing.
- Require an evaluated call for incoming Callers/both, matching outgoing Callees.
  Preserve References and the separate opt-in function-argument records. No change
  to argument-passing semantics or variable access filtering.
- The limit flag persists until rebuild because omitted files are not rescanned
  automatically when a slot becomes free. Help explains later-event replacement
  and rebuilding to choose the intended scope.

No remaining blocking findings in this diff after local review. The unchanged
60% memory guard and callback limits can still produce partial results. These
ordering regressions do not establish the cause of an earlier private WSL crash.

## Verification

- Added seven workspace regressions using controlled VS Code/filesystem adapters
  and the real Worker/parser/index. All seven failed on the reviewed source and
  passed after the fixes. Coverage includes out-of-order reads, deletion, rebuild,
  Worker termination during IO, persistent mismatch/recovery, watched-file limits,
  pending capacity, stale/current failures and slot reuse.
- Added raw/derived `sizeof((target()))` regression: failed before the incoming
  filter fix, passed afterward. Actual calls remain; References retains the use.
- Review found the rejected-final-event gap. A controlled build with that one
  fix removed fails the new assertion; the final build passes it.
- Typecheck, 197 unit tests, 11 real Worker/workspace regressions, four GC/cache
  tests and the index-performance checks pass. CI runs the new workspace suite
  on Windows, macOS and Ubuntu through the existing Worker test command.
- Native VS Code integration and browser UI checks pass. FreeRTOS: 655 files,
  34,508 ms indexing, 107–132 ms selection. Existing callback loop/mutation/time
  limit notices remain; passing navigation checks does not mean complete inference.
- Native large workspace: 12,551 candidates, 2,501 indexed files and 50,000 calls;
  4,984 ms indexing, 99 ms selection. Excluded files do not consume the file cap.
- Local VSIX manifest, runtime, Worker, webview, Help and changelog match the tested
  build. Publication and platform CI results are recorded separately after release.

Ignored evidence: `test-results/fix-0.1.41-*`, `test-results/release-0.1.41/`,
`test-results/{freertos,large-workspace,index-performance}.json`, and
`output/review/workspace-final-event-red.mjs`.
