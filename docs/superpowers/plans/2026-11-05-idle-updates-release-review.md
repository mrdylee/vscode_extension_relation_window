# Idle Update Release Review Plan

**Goal:** Review and repair the pending change set, then publish and independently verify Dynsight 0.1.97.

**Architecture:** Preserve the approved one-hour automatic scheduling policy, live per-file navigation, affected-group analysis and cache format 19. Make only reproduced correctness fixes before packaging. Release the tested immutable source through the existing three-platform CI gate.

- [x] Verify the worktree, remote main and latest public release before choosing a version.
- [x] Review scheduler/cache startup and incremental dependency semantics against approved behavior; reproduce any findings before runtime changes.
- [x] Cover out-of-order file reads, restored dirty buffers and unchanged selected-build restoration with real-Worker regressions, then apply minimal fixes.
- [x] Run fresh unit/Worker/memory/type/build/performance/UI/native/large-workspace checks and review the final diff.
- [x] Prepare 0.1.97 version metadata, changelog and release notes; package and test the extracted VSIX.
- [x] Commit authorized changes, update main without force, tag and push the verified source; wait for Windows/macOS/Ubuntu/release jobs.
- [x] Download every public VSIX alias and checksum manifest, validate archive contents against the verified package, and test the actual updater selection/download.
- [x] Record CI/public-artifact evidence and verify local main matches remote main.
