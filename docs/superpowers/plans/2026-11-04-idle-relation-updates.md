# Idle Relation Updates Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. Use subagents only when explicitly requested. Steps use checkbox syntax for tracking.

**Goal:** Batch automatic macro/callback updates until one hour after the last actual C/H change while preserving live basic navigation and restart-safe pending work.

**Architecture:** Keep the existing WorkspaceIndex parser and Worker incremental pipeline. Gate automatic derive with one persisted deadline and a distinct-URI set; explicit resume/configuration/rebuild can bypass the delay. Expose pending state through existing diagnostics and local progress controls.

**Tech Stack:** TypeScript, VS Code API, Node Worker/fs/timers, node:test, existing esbuild and native/UI harnesses.

---

### Task 1: Reproduce and define delayed scheduling

**Files:** `test/workspace.test.mjs`, `src/workspace.ts`.

- [x] Add a fixture-local clock that controls only long workspace timers and Date.now; keep source debounce and real Worker execution.
- [x] Assert `relationPasses` stays unchanged at 3,599,999 ms, becomes one higher at 3,600,000 ms, and direct navigation reflects changed source before then.
- [x] Assert a later edit resets the deadline, duplicate save/watch/close events do not, and distinct changed files coalesce.
- [x] Run `node --test --test-name-pattern='one-hour|idle update' test/workspace.test.mjs` and record failures before runtime edits.
- [x] Implement pending URI/deadline state, timer disposal/cancellation and idle-safe derive gates. Keep dirty-buffer and current-revision guards.

### Task 2: Restore pending work and expose manual update

**Files:** `src/workspace.ts`, `src/diagnostics.ts`, `webview/local-progress.ts`, `webview/diagnostics.ts`, `test/workspace.test.mjs`, `test/build-startup-cache.test.mjs`, `test/ui.mjs`.

- [x] Add real-Worker restart tests with temporary storage; reuse the same deadline across restart and run expired saved work once. Verify selected-build cache and rejected-cache boundaries.
- [x] Persist `{version:1, at, uris}` as `pending-analysis.json` in workspace storage with serialized writes and atomic replacement; clear only when current analysis or valid unchanged restoration makes it redundant.
- [x] Expose `deferredUpdate: {at, files, persistenceError?}` in index diagnostics and an explicit wait reason. Show the static pending state and use the existing `localResume` action for Update now.
- [x] Cover manual bypass, expiry while dirty, cancellation/re-edit and removal. Initial indexing, explicit rebuild and setting changes retain their established semantics.

### Task 3: Verify current behavior and document limits

**Files:** `test/workspace.test.mjs`, `test/build-startup-cache.test.mjs`, `test/extension.test.ts`, `USER_GUIDE.md`, `USER_GUIDE.ko.md`, `docs/reviews/2026-11-04-idle-relation-updates.md`.

- [x] Adjust existing saved-change tests to explicitly request analysis where they test callback results, and assert no automatic pass on save in native integration.
- [x] Run full unit and Worker suites, typecheck and build; inspect exit codes and failures.
- [x] Run the UI fixture and isolated native VS Code integration. Run memory/performance checks if new behavior exposes unresolved concerns.
- [x] Document timer semantics, pending/restart behavior, manual update and unchanged cache version; review the final diff and `git diff --check`.
- [x] Leave the verified work on the existing task branch without publishing or changing the installed extension.
