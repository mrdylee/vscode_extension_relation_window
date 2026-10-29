# Relation action undo and slot recall corrections

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for inline implementation. Do not delegate without explicit user authorization.

**Goal:** Backspace undoes the latest tree expansion or collapse without navigating to a previously selected function; recalling any slot preserves Following Selection.

**Architecture:** Keep the existing bounded expansion snapshots, storing only expansion overrides. Record explicit collapse with the same path as expansion. Keep slot recall independent of the follow flag and open its source before committing the recalled state so the current file selects the correct source/build index. Only the latest source open may release automatic tracking suppression.

**Tech Stack:** TypeScript, VS Code Extension Host, node:test, Playwright.

---

Scope assumption: undo applies to tree expansion/collapse, not editor navigation, settings, slot writes, or pan. Keep the current selection/Context even when undo hides its node. Root/options/source changes and slot recalls still start a new history. No version bump or publication is requested in this review.

### Task 1: Reproduce the reported behavior

**Files:** `src/view.ts`, `test/relation-navigation.test.ts`.

- [x] Add a regression which expands B then C, records C's preview, presses Back and verifies C collapses while the preview and selection remain unchanged.
- [x] Add a regression which expands B and C, collapses B, and uses Back to restore that collapsed branch before undoing C and B. Repeated no-op collapse must not consume history.
- [x] Add a regression recalling slots 1–5 with both follow states and assert the follow state does not change.
- [x] Add a regression recalling across separate source/build indexes and assert the saved source and branches still resolve with following enabled.
- [x] Run `npx tsx --test test/relation-navigation.test.ts` and verify the new expectations fail on the current implementation.

### Task 2: Apply minimal corrections

**Files:** `src/view.ts`, `test/relation-navigation.test.ts`, `webview/main.ts`, `USER_GUIDE.md`.

- [x] Replace expansion history entries with expansion overrides only; Back assigns the previous overrides without assigning selection or selected-node state.
- [x] Route collapse through `changeExpansion` and remove the obsolete collapse-reset test expectation. Keep graph no-ops excluded from history and retain the 100-entry bound/source invalidation guard.
- [x] Remove forced `state.locked = true` from slot recall. Extract the current source-open code into `openSource(location)` and reuse it for ordinary open and recall. Remember the returned editor; recall refreshes after opening the saved location so `indexFor` uses the saved file without pinning.
- [x] Review failure and overlap paths: verify a rejected source open leaves the old graph/options/history intact and an earlier open's timeout cannot resume tracking during a later open. Add failing tests before correcting state commit order and guarding the timeout with an open identity token.
- [x] Run `npx tsx --test test/relation-navigation.test.ts test/relation-slots.test.ts` and verify all cases pass.
- [x] Change the footer to `Backspace Undo`; update the guide to state that collapse is undoable, selection/Context are preserved, and recall keeps the follow state.

### Task 3: Verify integration

**Files:** `test/ui.mjs`, `test/extension.test.ts`.

- [x] Add UI assertions that slot recall sends no `lock` message and leaves the follow control unchanged in both states; preserve Backspace's existing editable-field guards.
- [x] Extend the native saved-slot flow to check Back preserves Context, collapse can be undone, recall keeps following enabled across files, subsequent explicit editor selection still follows, and recall retains an existing pin.
- [x] Run `npm run typecheck`, `npm test`, `npm run test:ui`, and `npm run test:extension`; inspect every result.
- [x] Run `git diff --check` and review the final diff for unrelated changes. Record verified results in the work state and report the local outcome.

Verification: five initial expectation failures reproduced before the fix; final 766 unit tests, typecheck, both browser UI suites, and the actual isolated macOS Extension Host suite passed. Self-review added a failing removed-callback-preview regression and restricted hidden-preview retention to a current graph. The follow-up review reproduced and corrected failed-open partial recall and overlapping-open timeout races; all final checks were rerun. See `docs/reviews/2026-10-29-relation-action-undo.md`. `git diff --check` passed. Changes remain local on `codex/relation-action-undo`; no version bump, install, or release.
