# Dynsight 0.1.97 release review

Publication and public-asset/updater verification are complete in the
[delivery receipt](2026-11-05-release-0.1.97.md). The local checks below record
the release-candidate review; the immutable release source is identified there.

Reviewed the complete local change set against the approved one-hour idle
policy, live source navigation, affected-group analysis and cache compatibility
19. The preceding implementation and evidence are documented in the
[typing/incremental review](2026-11-04-defer-relations-while-typing.md) and
[idle scheduling review](2026-11-04-idle-relation-updates.md).

## Findings repaired

1. **An older read could shorten the idle wait.** A slow read from an earlier
   file event could finish after a newer file was indexed and replace its later
   deadline. `deferRelations` now retains the maximum pending deadline. A gated
   real-Worker test proves the later source change keeps its full hour.
2. **Restored dirty editors could lose their wait.** Disk-cache validation
   cleared pending state before reapplying VS Code's restored unsaved buffers.
   Saving that buffer could immediately restart detail. Pending state now clears
   only if there are no eligible dirty buffers; restored buffers without a
   pending record establish a new wait. Two restart tests cover both cases.
3. **Discarded edits could defer a valid selected-build cache.** A restored
   selected cache still needed contextual reconstruction, so its old pending
   marker was retained even when disk contents matched the complete saved
   generation. Valid unchanged restoration now clears that marker independently
   of contextual reconstruction, preserving zero source parses and the existing
   cache generation.

All four regressions failed before runtime changes (`review-red.log`) and pass
after the minimal scheduler/startup corrections (`review-green.log`). Existing
rejected-cache, saved-pending, save/discard and stale-result protections remain.

## Fresh release-candidate verification

Evidence: `/private/tmp/dynsight-release-097-20261105/`.

- **912 unit**, **149 Worker/cache/workspace**, and **6 memory** tests pass.
- Full TypeScript check, build, index-performance and build-context performance
  checks pass. The dependency/cache review also compared incremental outputs
  with fresh full analysis in **240** edit/removal/re-add cases across five
  callback/header/macro/private-storage fixtures (`incremental-probe.log`).
- Browser UI and scoped/narrow-screen UI pass, including Relations pending,
  Update now, save/cache/Worker blockers and existing analysis controls.
- Native macOS source integration and the **extracted 0.1.97 VSIX** both pass the
  existing **32** recorded feature checks and added typing/save/manual-update
  assertions. The shared-header fixture parses one changed source, evaluates
  only two related functions and retains the unrelated result object.
- Native large-workspace validation passes: **12,551** fixture files, **2,501**
  indexed in scope and **50,000** calls; 2,929 ms elapsed, 100 ms selection,
  29 ms incoming query and 88 ms maximum tick gap on this Mac. These figures
  describe the fixture run, not private-project performance guarantees.
- The local VSIX has **18** valid ZIP entries and is **770,989 bytes** with SHA-256
  `8124feb029b86934baec65a86e1deb7c87c1b14c4210b93ea817e4eb7049fdbd`.
  Its manifest/package version is 0.1.97; archive CRCs and required bundles,
  WASM and guides pass validation. Public archive contents will be compared with
  these verified entry hashes after release CI.
- `git diff --check` passes. Analysis-cache format/version stays 19; no compiler,
  private firmware build or user-cache mutation is included.

The one-hour boundaries use a virtual host clock with real analysis Workers.
Native checks verify actual pending/manual-update behavior without spending a
physical hour idle. Initial indexing and deliberate rebuild/configuration
changes retain their existing behavior. Ongoing edits can postpone automatic
detail indefinitely, and eligible dirty C/H buffers must be saved/discarded
before project detail runs. An individual broad dependency batch can still be
costly; this change reduces its frequency and reuses unrelated facts.

Release publication requires the existing Windows/macOS/Ubuntu CI jobs and
independent public-asset/updater verification; local checks alone do not establish
those outcomes. Tests used isolated temporary profiles/storage and did not
replace the user's installed extension.
