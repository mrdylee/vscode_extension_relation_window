# Numeric Dependency and Readiness Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. No subagents are requested. Preserve the existing analysis.md edits.

**Goal:** Remove reproduced numeric dependency roots and accurately explain blocked/partial readiness without losing callback information.

**Architecture:** Change dependency collection in place, prove numeric array elements across possible layouts, and extend existing diagnostics with current source failures. Retain evaluation and all safety bounds.

**Tech Stack:** TypeScript, Tree-sitter C/WASM, Node test runner, existing Chromium UI harness.

### 1. Numeric roots

Files: `src/pointer-targets.ts`, `src/analysis-cache.ts`, `test/callback-effects.test.ts`.

- [x] Add regressions with 270 integer writes followed by empty numeric conditions
  and numeric-only array reads; require no mutation/region warning and retain the
  independent callback. Run `npx tsx --test test/callback-effects.test.ts`; the
  new over-tracking cases must fail on the current code.
- [x] Add preservation cases for nested callback selectors, address aliases,
  condition assignments/calls and numeric/non-numeric type alternatives. Actual
  callback consumers and unknown/ambiguous layouts must keep their dependencies.
- [x] In `collectBodyReads`, visit conditions without making their result required.
  In `collectReads`, suppress the intrinsic index root only when all possible
  element layouts are scalar data with no pointer/function/aggregate layer.
  Keep the returned dependency sets and recursive side-effect visits unchanged.
- [x] Run callback effects, safety, uncertainty and pointer-call tests. Increment
  `ANALYSIS_CACHE_VERSION` from 8 to 9; rerun cache invalidation coverage.

### 2. Readiness diagnostics

Files: `src/diagnostics.ts`, `src/workspace.ts`, `webview/diagnostics.ts`,
`test/workspace.test.mjs`, `test/ui.mjs`.

- [x] Add a Worker-backed source read/oversize failure case that requires the live
  failed-source count and a source-specific wait reason, then recovers both files.
  Run `npm run test:worker`; confirm the missing fields/reason fail first.
- [x] Extend the existing diagnostics data with current source failures, excluding
  the derived-analysis failure key. Add the corresponding English wait message.
- [x] Add browser assertions that source failures show `Basic navigation: blocked`
  and fresh limited results show `Detailed results: current (partial)`. Keep the
  old preparing/current labels for their normal cases. Run `npm run test:ui` and
  confirm these expectations fail before changing the renderer.
- [x] Render the live failure count and wait message without changing readiness
  eligibility or hiding existing notices. Rerun Worker and browser checks.

### 3. Verification and report

- [x] Run `npm run typecheck`, `npm test`, `npm run test:memory`, then Worker/UI
  and native Extension Host integration. Run the small cold/warm/disk/save fixture
  when available to compare actual candidate identities and completeness.
- [x] Review only this diff for lost numeric selectors, pointer alternatives,
  branch side effects, stale failure counts and accidental scope changes.
- [x] Update analysis.md with exact local evidence, cache 9 and remaining limits.
  The source report's private-target timings remain unverified. Keep extension
  version 0.1.75 and do not publish a new release during this repair.


## Verification

- Red: five numeric over-tracking regressions; two missing readiness fields/reason
  Worker cases; browser source-failure message and blocked/current-partial labels.
- Review found that a stopped Worker was counted as a failed source. A new
  assertion failed with 1 versus 0; excluding both worker and derived keys fixed it.
- Green: typecheck/build, 610 unit, 62 Worker/cache/workspace, 6 memory, both browser
  suites, native macOS Extension Host, and cold/warm/disk/save Worker fixtures.
- Before/after anonymous numeric input: old Worker stays Partial, new completes;
  candidate names, locations, conditions and incomplete flags match at all four
  stages. Separate six-candidate fixtures match across all four stages.
- Source changes preserve the old limits and namespace/scope behavior. Original
  target input is unavailable; no private-project completion or general speedup
  is claimed. The existing published 0.1.75 assets remain unchanged.
