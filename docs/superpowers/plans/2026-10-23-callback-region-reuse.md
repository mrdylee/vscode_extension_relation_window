# Callback Region Reuse Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for inline execution. Use no subagents. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Reduce repeated path/region work without changing callback candidates, uncertainty or protection limits.

**Architecture:** Reuse only immutable path decomposition within one inference run, bounded to 4096 entries. Avoid empty region queries, duplicate root insertion and symbolic resolution for concrete non-byte roots. Keep reads, effects, write stamps and dependencies current; retain containing-array resolution for byte writes.

**Tech Stack:** TypeScript, Node test runner, Tree-sitter C, existing Worker/cache/memory/UI harnesses.

---

### Task 1: Reproduce and protect the behavior

Files: `test/callback-effects.test.ts`, `test/callback-safety.test.ts`.

- [x] Add the nested-array opaque/assignment/call case with 8 and 80 repetitions. Count only the region path tokenizer's `String.matchAll` calls, restore the prototype in `finally`, and require less than 3x parsing growth while retaining all complete target sites and no warnings.
- [x] Run `npx tsx --test --test-name-pattern='repeated region paths' test/callback-effects.test.ts` before the fix; expect failure with counts 389→3845, not an import or syntax error.
- [x] Add an explicit baseline-preserving wildcard invalidation/precise overwrite/repeated invalidation case. Assert targets and uncertainty at individual source sites.

### Task 2: Implement bounded reuse

File: `src/pointer-targets.ts`.

- [x] Cache readonly parsed paths in the existing inference closure and clear at 4096 entries. Preserve `storageRoot` and path grammar; do not cache analysis results.
- [x] Return no matches for an empty region collection; register roots only when new. Keep trie keys current across map copies and insertion.
- [x] Avoid symbolic `objects` resolution for non-`$arg:` roots only when not processing a byte-range write; retain the original symbolic branch, dependency recording and byte destination widening.
- [x] Run the failing regression and callback effect/safety/uncertainty/index regressions. Inspect all set/map mutation paths for stale indices or ordering changes.

### Task 3: Compare outputs, resource use and performance

Files: existing test harnesses; temporary measurements in ignored `artifacts/callback-region-optimization/`.

- [x] Save the pre-change Worker bundle before editing. Compare old/new completed synthetic inputs through cold/warm/disk/save, using full candidate identity, original location, conditions, evidence, incomplete flags and warnings; normalize only non-semantic timing fields.
- [x] Confirm 32×9 shared callers avoid the false limit and 1×257 retains the real limit. Exercise more than 4096 distinct paths and repeated source revisions to cover eviction/lifetime.
- [x] Run `npm run typecheck`, `npm test`, `npm run test:worker`, `npm run test:memory` and `npm run test:ui`. Build once for direct Worker comparisons.
- [x] Measure the same completed synthetic workload old/new in isolated Workers, alternating runs; report medians and sampled heap. Optionally run the existing bounded 33-file public probe without treating cancellation as correctness equivalence.

### Task 4: Review and record

Files: `analysis.md`, `docs/reviews/2026-10-23-callback-region-reuse.md`.

- [x] Self-review against the design and test evidence, preserve pre-existing documentation edits, and record scope/limits and raw log locations.
- [x] Run `git diff --check`, inspect the final diff and make a local commit of the completed change after verification. Do not publish or deploy as part of this request.
