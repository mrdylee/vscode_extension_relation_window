# Relation action undo review — 2026-10-29

Scope: the local Backspace and slot-recall corrections on `codex/relation-action-undo`, based on `4648757`. Review covers undo history, retained Context previews, follow-state independence, source/build index selection, slot queuing and asynchronous source opening.

## Findings corrected

1. **P2 — Failed source opening partially applied a recall.** `recallSlot` replaced the view options, root and expansion state and cleared undo history before awaiting the source editor. A rejected editor open left the old displayed graph alongside the new internal state. The new regression observed `callees` instead of the previous `both` mode after rejection. The view now commits the recalled state only after `openSource` succeeds. Existing graph, options and undo history survive an open failure, and the next recall can still run. See `src/view.ts:359` and `test/relation-navigation.test.ts:144`.

2. **P2 — An earlier source-open timeout released a later open's tracking guard.** A recall at time 0 scheduled a 150 ms timeout. Starting another recall at 100 ms did not stop the first timeout from allowing editor events at 150 ms, while the second source was still opening. With follow mode preserved, those events could replace the saved tree. The deterministic regression reproduced `track()` following a different function during that pending open. Each open now has an identity token; only the latest open's timeout releases the guard. Normal following resumes afterward. See `src/view.ts:396` and `test/relation-navigation.test.ts:161`.

Both tests failed before the corresponding corrections and pass afterward. No additional blocking findings remain from this review.

## Verification

- Focused navigation and slot tests: 26 passed.
- `npm run typecheck`: passed.
- `npm test`: 766 passed, zero failures.
- `npm run test:ui`: browser and scoped UI suites passed.
- `npm run test:extension`: isolated macOS Extension Host passed; process exit 0 at 2026-10-29T12:01:06Z.
- `git diff --check`: passed.

Logs: `/tmp/dynsight-undo-review-focused.log`, `/tmp/dynsight-undo-review-unit.log`, `/tmp/dynsight-undo-review-ui.log`, `/tmp/dynsight-undo-review-native.log`.

The timer race and rejected editor open are exercised through the VS Code boundary harness; the native suite exercises real source opening, cross-file recall, undo, persistence and follow/pin behavior. No package version change, installation, push or release is part of this review.
