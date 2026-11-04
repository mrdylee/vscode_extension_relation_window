# One-hour idle relation update review

This records the implementation before publication. The subsequent
[0.1.97 release review](2026-11-05-idle-updates-release-review.md) covers the
additional restart/read-order corrections and fresh release-candidate checks.

The approved policy batches automatic macro/callback analysis until one hour
after the last actual source change. This supersedes immediate analysis on save
in the earlier typing/incremental review. Live per-file symbols/direct references
and the affected-group Worker pipeline remain in place.

## Changes

- `src/workspace.ts` maintains one deadline and a set of changed eligible C/H
  URIs. Additional changes postpone the batch; unchanged save/watch/close events
  do not. Creation/deletion and external/discarded edits participate. Source
  parsing keeps its 100 ms debounce; waiting does not count as active work.
- The timer waits for saved source inputs. An expired timer can continue after
  saving an unchanged parsed buffer. Discarding to different text starts a new
  wait. Explicit Resume Local Analysis/Update now, rebuild and deliberate
  analysis-configuration changes bypass the delay. Manual update first waits for
  pending source parsing so a just-saved change is included in that request.
- A versioned `pending-analysis.json` record in workspace storage retains the
  deadline and distinct changed URIs. Writes are serialized and atomically
  replaced. Compatible cache restoration validates contents and inventory as
  before; redundant discarded-edit records clear without extra analysis.
  Completed current analysis clears the pending record. No workspace storage
  means session-only scheduling; write failure is reported in pending diagnostics.
- Index diagnostics and the local progress UI expose pending file count and the
  Update now action through the existing resume command. Unsaved sources,
  rejected caches and stopped Workers still prevent that action. Source failures
  retain their partial/error status instead of being hidden by the pending text.
- Stale revisions/build epochs remain rejected. Pending raw parsing cannot claim
  current detail; an early timer after clock correction re-arms rather than
  leaving the batch without a wakeup.

Analysis-cache compatibility stays **19**; package version stays **0.1.96**.
The analysis cache format, compiler/build extraction and analysis budgets are
unchanged. No persistent dependency graph or new storage engine is introduced.

## Verification

Evidence is under `/private/tmp/dynsight-idle-updates-20261104/`.

- `red.log`: eight initial regressions failed before scheduling changes, including
  immediate saved-source passes and rewriting the saved generation while pending.
- `manual-debounce-red.log`: manual update missed a source still inside the parse
  debounce. `timer-status-red.log`: early timers lacked a retry and pending raw
  parses could be reported current. `failure-status-red.log` reproduced a pending
  message hiding an oversized-source failure. Each has a passing regression.
- `ui-red.log` and `ui-blocked-red.log` reproduced missing pending controls and an
  enabled Update now action despite a rejected cache, before the UI corrections.
- Final full **912 unit tests** and **145 Worker/cache/workspace tests** pass
  (`unit-final.log`, `worker-final.log`). This follow-up adds **12 real-Worker
  regressions** covering deadline/reset/deduplication, coalescing, manual update,
  dirty expiry, deletion, restart before/after expiry, raw-result state and errors.
- Full TypeScript check and build pass (`typecheck-final.log`, `build-final.log`).
- Browser UI and scoped/narrow-panel UI pass (`ui-final.log`,
  `scoped-ui-final.log`), including pending count, manual dispatch and blocker states.
- Isolated macOS VS Code integration passes (`native-final.log`). Actual editor
  typing/save keeps relation-pass count unchanged. Update now runs one pass
  without another parse. The shared-header fixture retains the unrelated file
  object and evaluates only the two related functions. Existing extension
  navigation, settings, callback and cache/recovery checks remain covered.
- `git diff --check` passes; package files, `src/analysis-cache.ts` and
  `analysis.md` have no new diff from the branch base.

Hour-long delays were verified with a virtual clock in the host scheduling
harness and real analysis Workers; the native test verifies the actual pending
and manual-update behavior without waiting a physical hour. No new timing or
private-project speedup is claimed. Prior memory/large-workspace performance
evidence belongs to the earlier incremental stage, not a new benchmark here.

## Remaining boundaries

Continuous changes can postpone automatic detail indefinitely. The pending
indicator makes this visible and Update now is the immediate path. All eligible
dirty C/H buffers must be saved/discarded before project detail can run. Initial
indexing without a usable cache retains existing startup/rebuild behavior.
The one-hour policy reduces execution frequency; a broad dependency component
can still make an individual batch costly. Stored unmodified records and
unrelated host results retain the earlier reuse behavior.

Work remains local on `codex/defer-relations-while-typing`, without commit,
publication or installation into the user's VS Code. Tests used temporary
workspaces/storage/profiles; private firmware and existing user caches were not
modified. Windows/WSL runtime verification was not performed in this follow-up.
