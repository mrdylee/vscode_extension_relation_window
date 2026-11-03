# RBMS Diab Build Context Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. Steps use checkbox syntax for tracking.

**Goal:** Extract correct RBMS source paths and preserve explicit preprocessing options for recognized Diab commands.

**Architecture:** Keep the existing bounded Make evaluator. Select matching pattern candidates using specificity and prerequisite evidence; recognize a finite set of observed Diab option forms. Preserve all existing generator and builtin uncertainty.

**Tech Stack:** TypeScript, node:test, Tree-sitter Make, existing BuildAnalysis and metadata cache.

---

### Task 1: Reproduce and repair overlapping patterns

**Files:** `src/build-options.ts`, `test/build-options.test.ts`, `test/build-context-cache.test.ts`.

- [x] Add a failing regression with `out/%.o out/share/%.o : %.c`,
  source `sdk/os/a.c` and target `out/share/sdk/os/a.o`. Assert:
  `assert.equal(profile.units[0].sourceUri, 'file:///p/sdk/os/a.c')`.
- [x] Cover competing rules, the most specific available source, and unresolved
  alternatives retaining `partial` and `unknown` membership.
- [x] Run `node --import tsx --test test/build-options.test.ts test/build-context-cache.test.ts`
  and confirm the new regressions fail on source selection.
- [x] Build one candidate per matching pattern, order by stem length and original
  order, and check prerequisites against indexed sources, directory entries and
  explicit rules. Cache directory observations and retain their fingerprints.
- [x] Check creation/deletion of a candidate source invalidates the cached profile.
- [x] Keep all 1,400 synthetic C units when shared C/assembly patterns overlap;
  preserve a limit diagnostic when artifact notices fill the 128-notice cap.
- [x] Re-run the two test files and require zero failures.

### Task 2: Preserve RBMS explicit compiler options

**Files:** `src/build-context.ts`, `test/build-context.test.ts`, `test/build-context-analysis.test.ts`.

- [x] Add failing normalization cases for general, MCAL, SafeRTOS and SOX options.
  Require `resolved`, ordered `-D/-U/-I`, unchanged argv and `builtins === 'unknown'`.
- [x] Add an end-to-end test using the overlapping pattern and RBMS target/options:
  release, warm release and debug edits must select the expected callback through an include path.
- [x] Run `node --import tsx --test test/build-context.test.ts test/build-context-analysis.test.ts`
  and confirm the recognized-option cases fail with `partial`.
- [x] Add a finite option set for the observed forms. Retain `partial` for unknown
  options, changed unsupported values, option files and unverified pre-build tools.
- [x] Re-run the normalization and analysis tests and require zero failures.

### Task 3: Validate the complete change

**Files:** `src/build-make-parser.ts`, implementation and regression files above.

- [x] Bump `MAKE_EXTRACTION_VERSION`; build fingerprints already invalidate derived contexts.
- [x] Run `npm run typecheck`, the full unit suite and the Worker suite.
- [x] Re-extract both actual root RBMS BAT entries and check source paths, general/debug
  macro differences, option diagnostics and retained generator uncertainty.
- [x] Hash all read inputs before/after the actual-project check. Require no changes.
- [x] Review the diff, update this checklist and report remaining runtime limitations.

No publication or integration is part of this request. Keep the verified changes
on the task branch for review.

### Task 4: Second review and follow-up corrections

**Files:** `src/build-options.ts`, `src/build-discovery.ts`, corresponding extraction/cache tests.

- [x] Reproduce directory-less patterns, parent-folder cache invalidation and
  source/option ambiguity in failing tests before changing runtime code.
- [x] Strip the target directory before matching a directory-less pattern. Restore
  it only to prerequisites containing `%`, and preserve the full `$*` value.
- [x] Invalidate observed directory descendants on parent creation/deletion events.
- [x] Clear positive and missing cached include reads under changed folders; canonicalize
  cache identities for Windows encoded-drive and path-case aliases.
- [x] Skip separate compiler-option values when collecting C inputs and retain one
  context per source for multi-input invocations.
- [x] Charge repeated multi-input normalization to the existing budget and keep
  unverified simple-variable target appends partial without poisoning sibling targets.
- [x] Compare small owned fixtures with GNU Make; rerun the full unit/Worker suites,
  typecheck and actual RBMS static extraction; update the validation record.

### Task 5: Correct the additional review findings

**Files:** `src/build-options.ts`, `src/build-make-parser.ts`, `test/build-options.test.ts`.

- [x] Add generated-source and empty-stem regressions; confirm all three cases fail
  before changing extraction. Cover unrelated target prerequisites and Make text functions.
- [x] Include the current target's explicit prerequisites in implicit candidate
  availability without making unrelated prerequisites count as existing.
- [x] Reject empty implicit rule stems without changing shared text-pattern matching;
  increment the extraction version to invalidate earlier contexts.
- [x] Recheck the original review reproductions, full unit/Worker suites, typecheck,
  performance and read-only RBMS extraction; record the remaining boundaries.
