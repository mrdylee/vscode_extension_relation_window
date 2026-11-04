# Update relations after one hour without source changes

Approved in chat on 2026-11-04. This replaces the immediate-on-save policy in
the earlier defer-relations-while-typing design. It keeps that change's live
source parsing, cancellation, affected-group reuse and cache protections.

## Behavior

An actual change to an eligible C/H input postpones automatic macro/callback
analysis until one hour after that change. Further changes reset this single
workspace deadline and accumulate distinct changed URIs. Creation, deletion,
external edits and discarded buffers participate. Duplicate save/watch/close
notifications with unchanged text do not extend the deadline. The existing
100 ms per-file parse debounce and live direct navigation stay active.

The timer never analyzes unsaved buffers. If it expires while eligible buffers
are dirty, saving the already-parsed text permits analysis without another hour;
discarding to different text or making another real edit starts another hour.
Waiting is idle, not active analysis.
The status and local-analysis controls expose the pending file count and an
Update now action. That action uses the existing Resume Local Analysis command,
skips the delay and reuses parsed inputs. Explicit Rebuild Index and deliberate
analysis-configuration changes continue to run immediately. Startup without a
usable initial index retains the existing initial-index/rebuild behavior.

## Persistence and correctness

Store only the deadline and changed URIs in a small versioned pending-update
record under workspace storage, separate from analysis-cache format/version 19.
Serialize writes and use atomic replacement. Restore the remaining wait on
startup; an expired wait runs after cache loading. Existing cache validation
still compares saved source content and discovers additions/removals. A pending
record cannot make stale cached results current or bypass rejected caches.
Full successful analysis clears the record. Unchanged valid cache restoration
can clear a record left by discarded edits without running analysis. With no
workspace storage, scheduling remains session-only. Persistence failures must
be visible without blocking live navigation.

The existing Worker incremental dependency grouping determines affected work
when the batch runs. No persistent dependency graph, new cache schema, compiler
execution, public release or user-extension installation is included.

## Verification

Use an isolated virtual clock for workspace scheduling while retaining real
Workers. Verify no deep pass before one hour, deadline reset, distinct-file
coalescing, save/watch deduplication, deletion, unsaved expiry, manual bypass,
restart before/after the deadline, stale-result rejection and cache protection.
Update existing save-oriented integration expectations to wait or explicitly
request detail. Verify the visible pending action with the UI fixture and an
isolated native VS Code run, then run unit/Worker/type/build checks.
