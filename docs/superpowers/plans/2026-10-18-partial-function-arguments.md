# Partial Function Arguments Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans. No subagents requested.

**Goal:** Restore literal argument candidates in partial analyses and handle the subsequently confirmed Worker memory failure without false completion or permanent loss of analysis.

**Architecture:** Keep original flow solely for the existing direct argument collector. Propagate incomplete source-call markers, while pointer inference continues to receive no incomplete programs or initializers. Strip the retained flow at the Worker boundary. Apply a Worker heap-pressure predicate to optional derivation, expose partial/fatal status, and recreate failed or memory-limited Workers on explicit rebuild.

**Tech Stack:** TypeScript, Tree-sitter C/WASM, Node Worker, VS Code Extension Host.

## Implementation and verification

- [x] Add a failing function-argument regression using `svc_send_event(ctx,
  (svc_param_t)rack, (svc_param_t)state, 0, 0, priv_mode_change)` after repeated
  includes. Assert Callees and Callers, argument #6, exact source position,
  incomplete markers, default-off absence and no alias/executor inference.
- [x] Add dependency repair and target deletion assertions so partial data never
  becomes stale or remains marked incomplete after header repair.
- [x] In `src/model.ts`, add optional `argumentPrograms?: FlowProgram[]`.
  In `src/project-analysis.ts`, retain `file.programs` in that field only in the
  existing visit-limit fallback; keep `programs` and `initializers` empty.
- [x] In `src/function-arguments.ts`, visit both argument-only and normal flow
  for direct collection. In `add`, inherit incomplete source-call state/reasons.
  In `src/analysis-worker.ts`, strip `argumentPrograms` with other flow facts.
- [x] Extend the repeated-include Worker regression to assert a partial literal
  argument survives serialization without flow facts, with unchanged replay.
- [x] Extend the existing native include regression to select the origin and
  target with Settings enabled, preview the original argument and verify repair.
- [x] Run targeted red/green, typecheck, all unit tests, Worker and native tests.
  Review the diff and protect existing macro/alias behavior. Run FreeRTOS if
  profiling or changed full-project behavior identifies a new concern.
- [x] Document the partial source-argument behavior in bundled Help and record
  verification in `docs/reviews/2026-10-18-partial-function-arguments.md`.

The private WSL project is unavailable locally. Do not claim its exact cause is
confirmed. This local correction is reviewable separately from release/push.

## Confirmed Worker out-of-memory follow-up

- [x] Capture the user's fatal error and false Index ready status. Instrument
  FreeRTOS by phase: roughly 181 MB after parsing, 1,413 MB after macro work,
  639 MB after pointer analysis (point-in-time samples, not retained-size proof).
- [x] Reproduce real ERR_WORKER_OUT_OF_MEMORY in a 128-MB Worker on 21 files;
  record the failing regression in `/tmp/c-rel-worker-memory-red.log`.
- [x] Add a native failure-injection regression proving failed derive is
  overwritten by Index ready before the fix, plus Rebuild recovery assertions.
- [x] Add a Worker-supplied heap-pressure predicate to analyzer derive, macro
  expansion/timelines and pointer analysis. Preserve partial literal arguments;
  retry memory-limited caches when pressure clears. Reject source parses already
  under pressure instead of indefinitely accumulating raw facts.
- [x] Preserve fatal/partial statuses and recreate the Worker on explicit rebuild
  after a fatal or memory-budget stop. Suppress stale Worker events.
- [x] Verify actual small-heap liveness, callback/cache tests, full native suite
  and FreeRTOS with the production pressure predicate. Review concurrency around
  rebuild, later source updates and cache recovery before packaging.
- [x] Document memory pressure, partial results and reload/scope/rebuild recovery
  in bundled Help, plus final local review and remaining private-WSL uncertainty.
