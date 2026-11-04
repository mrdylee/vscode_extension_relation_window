# Defer Relations While Typing Implementation Plan

The completed stage below now uses the follow-up
[one-hour idle update plan](2026-11-04-idle-relation-updates.md) for automatic timing.

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. Use subagents only when explicitly requested. Steps use checkbox syntax for tracking.

**Goal:** Update live per-file navigation without restarting project macro/callback analysis on each unsaved edit, then resume pending relations after save or discard.

**Architecture:** Use the existing dirty-document state as the barrier in WorkspaceIndex. Keep source parsing, debounce and RelationIndex updates. Stop project derivation while dirty, cancel an active pass, and let idle waits distinguish paused detail from active jobs. Saved sources continue through the existing pipeline and cache rules.

**Files:** `src/workspace.ts` for scheduling/derivation/status; `test/workspace.test.mjs` and selected-build integration tests for real Worker regressions; `USER_GUIDE.md` and `USER_GUIDE.ko.md` for the edit/save behavior; a review document for evidence and limitations.

- [x] Reproduce repeated dirty edits restarting relation passes, with source/relation/rebuild counters and Worker request tracing.
- [x] Cover save without another source parse, multiple dirty documents, discard and a dirty edit cancelling an in-flight pass.
- [x] Add the smallest dirty-document guard, cancellation and static pending status; make idle waits terminate while detail is deferred.
- [x] Keep unchanged save events able to finish pending relations, and preserve cache generations while unsaved.
- [x] Verify selected-build editing and startup restoration still work, with cache compatibility at 19.
- [x] Run focused regressions, complete unit and Worker suites, typecheck and appropriate native VS Code integration.
- [x] Document observed evidence and keep the fix on its task branch; this request does not publish a new release.

## Follow-up: update only affected files on save

- [x] Reproduce over-invalidation through common declarations, unused token pasting and private static names.
- [x] Separate reusable header context from coupled value-flow components; keep unrelated result objects.
- [x] Reuse cached macro expansion before deriving groups, including generated identifiers, and scope the basic pipeline as well as callbacks.
- [x] Preserve cross-file callbacks, header consumers, addition/removal invalidation and explicit retries of partial analysis.
- [x] Update contextual index entries by Worker version stamps and reuse unchanged build-cache records instead of serializing them again.
- [x] Verify affected batches against full analysis, real Worker save events and native VS Code; rerun full validation after runtime changes.
