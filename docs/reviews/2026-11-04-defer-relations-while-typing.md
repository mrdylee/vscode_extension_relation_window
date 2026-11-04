# Typing and saved-file incremental analysis review

The subsequent approved one-hour scheduling policy supersedes the immediate-on-save
timing described below. See [the idle update review](2026-11-04-idle-relation-updates.md)
for current behavior and verification; this document records the preceding stage.

Typing inside a function restarted the bottom analysis activity without saving.
The follow-up requirement was to update only the changed file and affected
relationships when saving as well. Deferring the old project-wide pass until
save was insufficient.

## Reproduced causes

- The 100 ms editor debounce reparsed one file and immediately invoked project
  relations. Three dirty edits increased relation passes from one to four.
- Basic relations were rebuilt from the entire input snapshot. Detailed analysis
  joined all users of common headers and all files whenever token pasting existed.
- Same-named private functions, local names, typedefs, comments and string contents
  over-connected otherwise independent sources. Same-named fields also connected
  separate translation units' private callback storage.
- Every contextual result replaced the entire host RelationIndex, even when most
  Worker facts were unchanged. BuildAnalysis also serialized all disk records.

The typing reproductions are under /private/tmp/dynsight-typing-20261104/.
Follow-up red cases are under /private/tmp/dynsight-save-incremental-20261104/:
red.log, worker-red.log, generated-target-red.log, private-unit-red.log,
private-type-red.log, build-index-red.log and build-cache-red.log.

## Applied changes

- src/workspace.ts: keep live per-file symbols and direct references, cancel
  active relations at a dirty edit, and defer project work until eligible C/H
  buffers are saved or discarded. Pending detail is explicit in status and
  diagnostics. Idle waits finish after source jobs while detail waits for save.
- src/incremental-analysis.ts: distinguish affected outputs from reusable
  declaration/header context. Use resolved symbols, actual flow references and
  translation-unit ownership for value dependencies. Ignore comments and strings,
  honor private declarations, and retain unrelated objects. Unknown aggregate
  effects remain conservative. Unrelated edits retain unchanged limited groups;
  explicit retries with unchanged inputs still retry limited work.
- src/analyzer.ts and src/analysis-worker.ts: reuse per-file macro expansion
  before computing callback dependencies, including generated identifiers.
  Basic relations use affected groups too. The macro and callback stages retain
  their shared project budget and existing cancellation/memory guards.
- src/workspace.ts and src/analysis-worker.ts: preserve the contextual index
  while hiding its stale view during source updates. Worker version stamps update
  only changed entries; unrelated host facts keep their identity. Full responses
  remain available for retry after a discarded revision or build epoch.
- src/build-analysis.ts: reuse disk records only when both raw and derived facts
  match a saved or validated restored record. Changed facts are serialized;
  unchanged records use the existing cache linking/copy path. Saved identity maps
  are replaced after successful saves and cleared with the cache lifecycle.

Analysis compatibility remains **19**. Build extraction, stored format and
analysis budgets are unchanged. Changed shared headers, actual function/global
value flow and unresolved dependency evidence can still affect multiple files;
an unchanged common header or unused token-pasting definition alone cannot.

## Final verification

Twenty tests were added across the typing and save follow-ups, and the old blanket
token-pasting expectation was replaced with unrelated-file reuse. Coverage includes
save/discard, multiple dirty buffers, in-flight cancellation, rejected-cache
protection, callback dependencies, private translation units and typedefs, limited
results, generated external callback targets, header changes and target additions
or deletions. Selected outputs are compared with a fresh full analysis.

Fresh final checks passed after the runtime changes:

- **912** unit tests, **133** Worker/cache/workspace tests and **6** memory tests.
- Build, full TypeScript check, index and build-context performance checks.
- **32** native extension feature checks in an isolated macOS VS Code profile,
  enhanced with actual typing/save assertions and a shared-header save fixture.
  The latter records one source parse and two related functions, with the other
  consumer's host object unchanged. Log: native-extension-final.log.
- The selected-build save fixture preserves the existing RelationIndex and the
  unrelated contextual entry. A disk-cache test verifies unchanged records retain
  the same digest and filesystem inode in the new generation.
- Native large-workspace validation: **12,551** fixture source files, **2,501**
  indexed within its configured scope, **50,000** calls; 2,847 ms analysis,
  100 ms selection and 83 ms maximum event-loop tick gap. It passed; these local
  fixture timings are not private-project performance guarantees.

Evidence: /private/tmp/dynsight-save-incremental-20261104/, including
unit-final.log, worker-final.log, memory-final.log, typecheck.log,
performance-final.log, build-performance-final.log, native final logs and the
red/green regression records above. Startup, cache-version/settings rejection,
explicit rebuild, callback configuration and AI readiness regressions still pass.

The fix remains on codex/defer-relations-while-typing without publication. Native
execution was on macOS in temporary workspaces and profiles. The user's installed
extension, private source files and existing caches were not changed.
