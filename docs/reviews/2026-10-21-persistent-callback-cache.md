# Persistent indexing and Copilot candidate review

Reviewed against checkpoint `checkpoint/pre-persistent-copilot-cache-20261021`
(`55822812ce97063ba0f630f605fccaea464e211a`). Release target: 0.1.54.

## Findings corrected

- A missing wildcard slot was absent from cached summary dependencies. A later
  `table[i] = bar` could leave an earlier reader reporting only `foo` as complete.
  Record absent wildcard reads and test both caller/callee directions.
- Array-region lookup scanned all siblings. A segment trie preserves exact and
  wildcard overlap while avoiding those scans. Limits are unchanged.
- Cache pruning could remove a concurrent writer's staging generation. Prune
  only a known superseded ancestor; incomplete/orphan directories may remain.
- A superseded Rebuild awaiting an earlier cache write could clear a newer
  reconciled index. Recheck its epoch before mutation and after cache setup.
- Excluded files retained old read errors; deleting a file during restoration
  could requeue its now-missing source; failed discovery could later announce a
  ready index containing excluded files. Regression tests cover all three cases.
- Copilot consent denial could repeat a consent request for each callback in a
  batch. Consume the explicit gesture before the first send; background sends
  require native access information to report permission already granted.
- Slow cancellation could lose a model-change restore. Resume the model-specific
  cache restore after the old request settles; discard its result and cache write.
- AI/static duplicates at the same site are suppressed. Candidates remain
  explicitly uncertain and retain real invocation locations in both directions.
- Static callback analysis off still expanded callback-only macro initializers.
  Skip that work and generated data, key macro cache by mode, and test repeated
  off/on changes without losing macro calls or literal function arguments.

## Validation

- TypeScript checks pass.
- Unit suite: 315 tests passed before the final report-redaction assertion;
  final release CI runs the complete suite including that assertion.
- Real Worker/workspace suite: 36 tests pass. Includes restart with zero parses
  and relation passes, one changed file, offline additions/deletions, dirty-editor
  isolation, corrupted-cache recovery, stale generations and scope changes.
- Mocked Copilot service: six tests cover access denial, model selection without
  requests, A/B cache separation, unavailable models and delayed cancellation.
- Final report/AI-overlay focused tests pass, including the added sanitized cache
  and AI counters. Memory lifecycle checks pass (4/4). Browser UI tests pass,
  including the AI candidate label, evidence and explicit uncertainty text.
- Packaged 0.1.54 VSIX: 16 ZIP members; manifest identity, settings and model
  command verified. Extracted VSIX passes the native VS Code integration suite,
  including 93-file disk-cache save, default AI off and model setting registration.
- Local native large-workspace check: 12,551 source files, 2,501 selected files,
  50,000 calls; completed in 4.802 seconds with a 68 ms maximum sampled timer gap.
  This is a synthetic macOS observation, not a private-firmware timing claim.
- Same-input array-region benchmark, median of seven alternating runs: 256
  regions improved from 101.58 ms to 17.74 ms; 320 from 150.01 ms to 21.57 ms.
  Outputs and warnings were unchanged. These are focused lookup benchmarks.
- Copilot context smoke: 2,000 unresolved calls/6,000 references. Restore made
  zero requests; analysis made five with 1,995 pending. Runtime builds context
  only for cached/selected sites and yields between batches.

## Memory and scope boundaries

Tree-sitter trees are deleted after parsing. Pointer heap, summary and region maps
are temporary per derivation. Worker raw facts, current derived results and
incremental dependency information are retained deliberately. Raw flow programs
also support literal function-argument navigation, so removing them wholesale
would break a separate feature. Static inference remains enabled by default and
Copilot is an independent, disabled-by-default supplement.

Disk records store raw analysis once plus derived differences; unchanged records
reuse bytes. A prior local generation supports recovery. Model-specific AI caches
store validated identifiers and hashes without source prompts. Persistent caching
reduces repeated computation; it does not guarantee lower resident memory or
complete callback inference.

Common headers, unresolved shared names and token-pasting can broaden dependency
components to the whole project. Invalid/incompatible local caches request an
explicit Rebuild. Interrupted/concurrent writers can leave orphan disk generations.
The private WSL corpus and live Copilot account, quota and model quality have not
been validated here. Public release and final packaged-runtime evidence are
recorded separately after those checks complete.
