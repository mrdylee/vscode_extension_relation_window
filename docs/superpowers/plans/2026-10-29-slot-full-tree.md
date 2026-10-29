# Full Relation tree slots implementation plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans inline. Do not delegate without explicit user authorization.

**Goal:** A slot saved by right-clicking B restores the complete A-rooted view and selects B.

**Architecture:** Store the root in the existing first branch record and optionally identify the selected branch by index. Capture the whole view; reconstruct the root graph and restore the selected target separately. Graph and editor symbol lookups use their respective files' source/build indexes.

**Tech Stack:** TypeScript, VS Code workspaceState, node:test, native Extension Host and Playwright.

---

### Task 1: Schema and host regressions

**Files:** `test/relation-slots.test.ts`, `test/relation-navigation.test.ts`.

- [x] Add a schema round trip with root A and target B at `targetBranch: 1`; reject negative/out-of-range/noninteger indices and mismatched target branches. Keep legacy round trips unchanged.
- [x] Replace the descendant re-root expectation with full-tree equality and B source/Context/selection assertions. Save after expanding an unrelated Side branch and both caller/callee directions.
- [x] Add reload coverage for the full view, an explicitly collapsed node, and an unavailable saved root. Add duplicate-symbol occurrence selection across both directions.
- [x] Add a different-file/source-build projection regression that keeps A as graph root while B is opened, then explicitly tracks another editor through its own index.
- [x] Run `npx tsx --test test/relation-navigation.test.ts test/relation-slots.test.ts` and inspect expected failures.

### Task 2: Save and restore the complete view

**Files:** `src/relation-slots.ts`, `src/view.ts`, `src/view-state.ts`, `webview/main.ts`, `test/ui.mjs`.

- [x] Extend `SavedSlot` with `targetBranch?: number`. Validate the selected index and selected record ID; clone it when present without adding undefined properties to legacy records.
- [x] Capture from `graph.root`, always traverse `graph.callers`, and record the index when the exact clicked node key is visited.
- [x] Reconstruct from `branches[0].symbol`, resolve the target independently, remember its restored node key, open its source and preview its symbol while keeping the saved root. Reveal the root ID and retain partial-restore notifications.
- [x] Select the graph index using the graph root URI. In `track`, use `workspace.indexFor(editor URI)` for contexts/callbacks/symbols; let `contextKey` accept that index.
- [x] Publish the exact selected node key when previewing that node's definition, and use it to mark the selected occurrence in the webview. Verify a callee definition preview selects its node with a failing host and browser regression first; keep existing call-site selection behavior.
- [x] Run focused tests and `npm run typecheck`; correct confirmed failures while preserving previous Backspace/recall race regressions.

### Task 3: Native verification and documentation

**Files:** `test/extension.test.ts`, `USER_GUIDE.md`.

- [x] Extend the native fixture with an unrelated expanded branch; save B and verify all branches restore under A, B opens in source/Context, the result survives delayed editor events and reload, and follow/pin state remains unchanged.
- [x] Update the guide to describe whole-tree recall with the right-clicked symbol selected. Mark specification and plan steps complete only after verification.
- [x] Run `npm test`, `npm run test:ui`, `npm run test:extension` and `git diff --check`. Review the final diff and record the verified local outcome without publishing.

Verification: five whole-tree/schema expectations failed before implementation; additional host and browser regressions reproduced the missing callee-definition selection marker before its correction. Final 772 unit tests, typecheck, both browser UI suites and isolated native macOS Extension Host passed. The final native run exited 0 at 2026-10-29T12:40:06Z and verified the full A tree, an unrelated expanded Side branch, B source/Context/selection, delayed editor events, follow/pin state and workspace-state reload. Legacy records and partial restore are covered by host tests. `git diff --check` passed. Old descendant-only records remain readable but cannot recover an original parent/sibling tree that was never stored; re-save those slots to capture the full view. All changes remain local; no release or installation.
