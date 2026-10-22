# Index compatibility and AI candidate replacement

Implemented on `fix/callback-candidates-progress`; not published as a release.

## Behavior

- `ANALYSIS_CACHE_VERSION = 1` owns analysis compatibility independently of
  extension release numbers. Both the local index and AI settings key use it.
- Manifest schema 2 records `analysisVersion`. Legacy schema 1, incompatible
  analysis versions (including downgrades), changed settings and damaged data
  have distinct states/messages. Incompatible or damaged indexes wait for manual
  Rebuild; compatible extension updates restore without parsing or deriving.
- Diagnostics and issue reports include the bounded incompatibility reason and
  current/saved analysis versions. Existing unversioned indexes require one Rebuild.
- Callees and the outgoing half of both mode replace an indirect/unresolved entry
  with valid AI candidates at the same URI/start/end. Raw references remain intact
  for cursor tracing, original callsite navigation, context collection and removal
  of AI results. Other invocations and local inferred/direct edges remain visible.
- Multiple candidates retain AI uncertainty. Negative/rejected results keep the
  original entry; clearing hints restores it.

## Verification

- TypeScript typecheck and production build passed.
- All 428 unit tests passed, including compatibility mismatch/malformed metadata,
  multiple candidates, per-invocation replacement, hint removal and source navigation.
- All 45 Worker/workspace tests passed with Node 22.23.4, matching CI's Node 22
  major. An independent extension manifest with version 999.0.0 restored a prior
  generation with zero parses, relation passes or rebuilds and an unchanged AI key.
- Browser validation uses the real `applyCallbackHints`/graph builder: the fixture
  changes from `callbacks.run` (indirect) to `callback_target` (AI candidate).
  Existing definition, original callsite, uncertainty and expansion checks are retained.

The environment's Node 24.19.0 failed the existing 128 MiB macro-growth Worker
test (timeout/OOM). The unchanged HEAD reproduced OOM in a separate temporary
checkout. Node 22 passed the entire Worker/workspace suite; memory-analysis
implementation and limits were not changed for this task.
