# review-work — Worker memory failure and missing function arguments (0.1.34)

## Symptom and established cause

The user confirms Include Function Arguments is enabled and Index ready is
displayed. Their WSL screenshot shows 1,818 files plus
ERR_WORKER_OUT_OF_MEMORY for queued source jobs and derived call analysis.
Thus the Worker has terminated; a traversal-limit notice is absent. The private
project's exact allocation hotspot has not been inspected on this Mac.

`derive()` swallowed its rejected Worker request into Analysis notices, then
`reindex()` unconditionally wrote Index ready. A failed Worker was never recreated
on rebuild. Both false completion and failed recovery are host-side defects.
Separately, the 0.1.33 traversal fallback discarded directly written function
arguments along with incomplete pointer flow; that omission was reproduced too,
but is not asserted to be the user's actual trigger.

## Reproduction evidence

- A 128-MB-old-generation Worker with 21 files, conditional macro alternatives
  and 20 literal callback arguments terminated with the exact fatal error in
  about 2.7–3.7 seconds before the protection. The real Worker regression failed
  with ERR_WORKER_OUT_OF_MEMORY, not a timeout or fake error.
- Native error-event injection failed because status became Index ready after
  a failed derived request. This verifies host error handling; it is distinct
  from the actual small-heap allocation reproduction.
- Three literal-argument regressions failed before the fallback correction.
- A phase probe of the full FreeRTOS tree observed approximately 181 MB heap
  after parsing, 1,413 MB after macro work and 639 MB after pointer analysis.
  These are instantaneous samples including uncollected objects, not retained
  memory sizes or an identification of the private SDK's exact hotspot.

## Change and review

- Check Worker V8 heap usage against its actual limit, reserving 40% headroom
  for indexes, direct argument collection, result transfer and later source work.
  Do not raise heap limits or alter folder scope automatically.
- Apply the pressure predicate before further source parsing and throughout
  macro timelines, expansion/variant parsing and callback propagation. Report
  skipped source files and partial derivation explicitly.
- Retain raw flow only for direct literal/address arguments in limited files.
  Never give it to callback execution propagation. Preserve the source call's
  incomplete reason and exact argument location in both graph directions.
- Strip argument-only flow before crossing the Worker boundary. Preserve Worker
  acknowledgement, replay, dependency invalidation and stable limited results;
  retry memory-limited derivation when pressure clears.
- Preserve fatal status and a global Worker notice. Memory-limited results use
  Partial index. Explicit Rebuild after either condition replaces the Worker;
  ignore events from the replaced instance. Never auto-restart an oversized
  project in a loop.
- Review checked initial/repeated derive, stale responses, recovered caches,
  aliases, unevaluated/shadowed arguments, candidate markers, native Context
  locations and both fatal/budget rebuild paths. No unresolved blocker found
  in these verified paths. Normal analysis bounds remain in place.

## Fresh verification

- Typecheck/build and **182 unit tests** passed.
- **3 real Worker tests** passed. The previously fatal small-heap fixture now
  finishes in about 1.5–1.9 seconds, retains each of the 20 literal callback
  targets and accepts a later request. Existing bounded-include liveness and
  acknowledgement/replay/dependency edits/deletion remain green.
- Native Extension Host passed source argument preview/callers, header repair,
  injected fatal status/rebuild and memory-budget status/fresh-Worker rebuild.
- Extracted final 0.1.34 VSIX passed that same native suite. Production JS/CSS
  bundles match the tested build; manifest, toolbar build and bundled Help use
  0.1.34 and explain memory/partial-result recovery.
- Full FreeRTOS **655 files**, **32,277 ms**, **13,406 expanded call records**,
  **837 function-argument records**, native caller/callee/member checks passed.
  Existing callback loop/mutation/time-budget notices remain. These counts are
  observations from this run, not a promise to resolve every SDK callback.
- Index performance: 12,500 files / 125,010 references; incremental replacement
  about 0.022 ms in this local synthetic run.
- Large-workspace native test passed: 12,551 source candidates, 2,501 included
  files, 50,000 calls, about 4.1 seconds to readiness and 100 ms selection.

Local package: `artifacts/c-relation-explorer-0.1.34.vsix`, **513,160 bytes**.
SHA-256: `e8209722a24f00fcb0a3943080abfa4f7f2e0f463e3c76b3b7ccd7fe6118006e`.
Ignored evidence: `test-results/package-0.1.34.json`, `extension.json`,
`freertos.json`, `index-performance.json`; reproduction logs use
`/tmp/c-rel-worker-memory-*`, `/tmp/c-rel-memory-*`, `/tmp/c-rel-worker-recovery-*`.

## Limits and remaining release checks

This is a best-effort heap safeguard. It cannot preempt every single large
allocation, account for all WASM/native/system memory, or prove the private WSL
project is fixed before testing there. A source file rejected under pressure
remains unavailable with a visible notice; narrow scope and rebuild to retry.

Status: **DONE_WITH_CONCERNS** for local implementation. Hosted
Windows/macOS/Linux release verification is recorded below when complete.
Do not treat this document or a pushed tag alone as publication confirmation.
