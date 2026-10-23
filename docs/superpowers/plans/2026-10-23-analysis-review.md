# Analysis Report Corrections Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline; preserve existing files. No subagent delegation is requested.

**Goal:** Verify the updated report and fix demonstrated analysis inflation and parser defects.

**Architecture:** Preserve bounded local analysis and its existing flow representation. Add conditional branch identity to the preprocessor pipeline, improve existing budget/dependency diagnostics, and apply a narrow validated split-statement recovery.

**Tech Stack:** TypeScript, Tree-sitter C/WASM, Node test runner.

### Tasks

- [x] Fetch the main update and copy only its analysis.md into the current branch. Reproduce the 32/30 contradictory macro case and split-else warning using synthetic input.
- [x] Add failing macro regressions for repeated choices, correlated different macros, argument prescan, undef/redefinition, includes, independent conditions and genuine 32-alternative overflow. Run `npx tsx --test test/macros.test.ts`.
- [x] Preserve explicit branch identities and guarded definition alternatives through preprocessing and expansion; discard contradictions before consuming alternative slots, preserve undefined paths, and deduplicate equivalent states. Retain source provenance and existing bounds.
- [x] Add a callback-bearing low-budget reproduction. Verify phase-specific work accounting, invalidation diagnostics and no repeated exhausted bodies. Preserve partial observations and independent callbacks; run budget/safety/uncertainty regressions.
- [x] Test both split-statement patterns with known and unknown conditions and callback writes. Implement the smallest recovery that preserves both valid alternatives and locations; retain errors for malformed source.
- [x] Review overlapping-effect claims against the existing generic alias and dynamic-index tests. Implement only proven defects; record unverified compression/context-profile proposals as remaining work.
- [x] Update analysis.md with observed before/after results and limitations. Bump analysis cache compatibility if saved representation/semantics changes.
- [x] Run typecheck, all unit tests, Worker/cache/workspace tests and relevant memory/performance checks. Inspect the diff for scope and preserve unrelated October 21 review files. Publication is a separate requested action.

### SECOND Comment and final review

- [x] Fetch main `68caf23` and preserve its SECOND Comment alongside the local assessment.
- [x] Reproduce 43 uses of a conditional numeric constant including the undefined path. Seven synthetic units fall from 224 reparses/programs to 14; warm analysis adds zero reparses.
- [x] Retain correlated numeric callback indices; keep expression-level structural sharing as an explicit unimplemented proposal.
- [x] Correct unused-environment work, long header-choice paths, redundant condition identities, premature token serialization and duplicate macro-definition references found during review.
- [x] Record the broad FreeRTOS performance tradeoff: released full analysis 14.3s, current 22.7s, both Partial. This does not demonstrate a general speedup.

Final validation: typecheck; 569 unit tests; 60 Worker/cache/workspace tests; 5 memory tests; browser UI; native Extension Host; index performance; large workspace; basic and full FreeRTOS. Windows/WSL target and original firmware remain unverified. No publication or commit was performed.
