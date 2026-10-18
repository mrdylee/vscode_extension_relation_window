# Memory Diagnostics Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution.

**Goal:** A single photograph of Diagnostics explains where and against which
limit analysis stopped, without increasing graph/index memory materially.

**Architecture:** Add bounded typed Worker snapshots, analyzer phase callbacks,
a separate host diagnostics event, and a fixed Relation overlay. Keep analysis
behavior unchanged. Use existing Worker, native host and browser test harnesses.

**Tech Stack:** TypeScript, Node Worker/V8, VS Code webview, Playwright.

- [x] Add real Worker assertions in `test/analysis-worker.test.mjs`: snapshots
  must have positive measured heap/limit, phases in source/macro/callback/transfer
  order, <= four phase records, counts matching input, and preserved first budget
  hit after a subsequent diagnostic request. Run `npm run test:worker` for RED.
- [x] Implement `src/diagnostics.ts` types, phase callbacks in `src/analyzer.ts`,
  throttled snapshots in `src/analysis-worker.ts`. Run Worker tests for GREEN.
- [x] Pass snapshots and Worker failure through `src/workspace.ts`; use a separate
  event so `src/view.ts` publishes diagnostics without rebuilding graph/Context.
  Extend native tests to assert timestamp refresh and snapshot retention on fatal
  failure, plus graph identity preservation.
- [x] Add `webview/diagnostics.ts` overlay and styles. Extend `test/ui.mjs` for
  manual open, automatic incident open once, refresh, Escape/Close, worker-stopped
  labels and 900x500 screenshot fit. Run browser tests and inspect the screenshot.
- [x] Update README/USER_GUIDE/CHANGELOG, version/package path to 0.1.38. Run
  typecheck, unit, Worker, native host and UI checks; review diff for sampling
  overhead, stale metrics and unchanged analysis behavior. Package the VSIX.
