# Bounded macro include traversal fix

Baseline: v0.1.32, `ca4162a`; preserve the current feature branch and checkpoint.
Use systematic-debugging, TDD and local review-work. No subagents are requested.

## Reproduced cause

`timeline()` bounds output define/undef events and recursion depth, but does not
bound visits to repeatedly included headers. An acyclic include diamond with no
macro events revisits the same sources exponentially. At depth 27 a real Worker
kept both derive and a following analyze request pending after 2,501 ms. Increasing
depth to 20 already costs about 792 ms despite just 22 files. The 10-second
callback budget starts after this macro stage and cannot stop it. This reproduces
the reported stalled resolving stage/queued updates; the user's private WSL
project has not been directly inspected, so its exact triggering include graph
is unconfirmed.

## Surgical implementation and checks

- [x] Add macro tests that fail without a visit bound and verify incomplete
  preprocessing never publishes confident expansion results from a prefix.
- [x] Add a real Worker test: derive a deep repeated include graph, then queue a
  fresh source analysis; both must finish within the test deadline.
- [x] Count include traversal attempts, using the existing 40,000 work scale,
  and stop the whole timeline when that new visit limit is reached. Preserve
  the earlier depth/event-limit handling and its existing expansion coverage.
- [x] Cache a clearly partial source-call fallback with a notice and incomplete
  call markers. Do not infer callbacks from incompletely preprocessed flow facts.
  Keep unchanged-file cache identity and dependency invalidation.
- [x] Verify all unit tests, Worker replay/new liveness test, native editor
  navigation and FreeRTOS. Add a native include-graph regression checking later
  source edits and Relation selections continue to work. Assert that the full
  FreeRTOS run retains more than 10,000 expanded call records; a nonzero count
  alone missed excessive fallback during review.
- [x] Run local review-work, update version to 0.1.33 and bundled Help/README,
  package/extract/test VSIX, commit and retain a reviewed checkpoint tag.

Success: pathological include traversal terminates with explicit partial-result
information, ordinary macro behavior remains tested, and following Worker/editor
requests continue. This is not a new wall-clock budget or an analysis-disable
setting. Keep review evidence in docs/reviews, not the user's memory folder.
Continue the user's preceding publication instruction for the corrective
v0.1.33 release after local review and the existing hosted three-OS test gate.
Verify public downloads/checksums and update recognition before reporting it.
