# Tree-sitter Make Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace the Make statement parser, repair confirmed GCC/Diab extraction errors, verify and release.

**Architecture:** A typed Tree-sitter syntax adapter feeds the existing bounded evaluator. BAT/SH traversal and CompileUnitContext consumers retain their interfaces. Pure Make operations are reused with corrected variable precedence and scoped expansion.

**Tech Stack:** TypeScript, web-tree-sitter 0.27.1, tree-sitter-make 1.1.1 WASM, Node test runner, esbuild, VSIX and GitHub Actions.

## Task 1: Baseline and grammar compatibility

Files: `package.json`, `package-lock.json`, `scripts/build.mjs`, `THIRD_PARTY_NOTICES.txt`, `test/build-make-parser.test.ts`.

- [x] Run `npx tsx --test test/build-options.test.ts test/build-context.test.ts test/build-context-cache.test.ts` and record the baseline.
- [x] Add failing end-to-end regressions in `test/build-options.test.ts` using existing `buildFixture` and `makeEntry` for both `gcc` and `dcc`:

```make
CC=gcc
define FLAGS
-DNEW
endef
a.o: a.c
	$(CC) $(FLAGS) -c $<
```

Pass `args: ['FLAGS=-DCOMMAND']`; assert `macroActions` contains COMMAND and not NEW, status resolved. Add the quoted-condition/computed-name/foreach cases described in the spec. Run the file and observe the expected failures before implementation.
- [x] Install exact `tree-sitter-make@1.1.1` with `--ignore-scripts`; load its WASM with the installed runtime in a diagnostic probe. Inspect actual tree fields for all accepted statement types and raw recipe/define content.
- [x] Include the grammar in `scripts/build.mjs` and its license in notices. Keep unit tests independent from dist. If the published WASM cannot load, rebuild a pinned source artifact with the compatible Tree-sitter CLI and record its source/hash rather than swapping runtime blindly.

## Task 2: Syntax adapter

Files: create `src/build-make-parser.ts`, `test/build-make-parser.test.ts`; update the npm test list.

- [x] Define the minimal data contract with `BuildEvidence` on every statement and a discriminated union for assignment, definition, condition, include, rule, export and unsupported. Include raw target selectors, assignment operator, raw values, branch arrays, rule prerequisite text and recipe evidence.
- [x] Add tests for quoted/parenthesized conditions, else-if, nested branches, definition flavor, target assignments, optional include, inline recipe, CRLF, escaped comments, trailing newline normalization and malformed syntax.
- [x] Implement lazy runtime/language loading, one parser per extraction parse, raw source parsing, bounded traversal and explicit tree/parser deletion. Convert nodes to plain data; never expose live nodes beyond the parse call.
- [x] Preserve raw source evidence. Emit syntax issues for ERROR/missing nodes and unsupported nodes instead of interpreting them as ordinary rules. Do not treat recognized but unsupported rule operators as supported.
- [x] Run `npx tsx --test test/build-make-parser.test.ts` and `npm run typecheck`.

## Task 3: Replace Make statement evaluation

Files: `src/build-options.ts`, `test/build-options.test.ts`, `test/build-context-cache.test.ts`.

- [x] Replace only the Make parse loop with ordered evaluation of adapter statements. Delete Make regex recognizers, definition accumulator and parsing condition stack.
- [x] Retain BAT/SH `logicalLines`, metadata overlay, make arguments, dependency resolution, rule execution and per-target contexts. Includes execute at their statement position. Conditions select one branch and keep unknown results conservative.
- [x] Route define through the shared assignment routine so command-line origins win unless a supported explicit override applies. Preserve assignment flavor and +=/?= semantics.
- [x] Verify quoted conditions and define precedence for GCC and Diab, plus inactive unsupported branches, unknown common input and independent sibling targets.
- [x] Run `npx tsx --test test/build-make-parser.test.ts test/build-options.test.ts test/build-context.test.ts test/build-context-cache.test.ts`.

## Task 4: Computed variables and bounded foreach

Files: `src/build-make-expression.ts`, `test/build-options.test.ts`.

- [x] Add nested name and foreach scope regressions before changes. Examples: `FLAGS_A=-DACTIVE` consumed through `$(FLAGS_$(MODE))`; `FEATURES=A B` consumed through `$(foreach x,$(FEATURES),-D$(x))`.
- [x] Expand a computed reference name before lookup, preserving cycle detection and environment dependencies.
- [x] Evaluate foreach variable/list before the body, bind each loop variable as a local simple variable, evaluate the body once per word with operation/output bounds, then restore outer scope. Do not eagerly evaluate the body before binding.
- [x] Preserve existing pure functions and recipe/define expansion. Keep call/eval and effectful shell unsupported with explicit diagnostics.
- [x] Compare fixture commands with independent GNU Make dry-run output using only self-authored fixtures; pin expectations in cross-platform tests, avoiding a GNU Make dependency in unit tests.
- [x] Run focused tests and typecheck.

## Task 5: Integration, resource bounds and cache

Files: `src/build-make-parser.ts`, `src/build-options.ts`, `src/analysis-cache.ts`, `scripts/build.mjs`, related build/cache/host tests.

- [x] Add grammar/extraction revision to fingerprints and advance analysis cache compatibility for changed semantics. Update tests that intentionally pin the version.
- [x] Exercise missing/incompatible grammar handling, repeated parses and size/traversal/iteration bounds. Errors must leave basic analysis usable and must not report false resolved builds.
- [x] Verify clean dependency assets work before build and packaged assets load without node_modules. Extend the native Make build-context fixture to prove new syntax is active in the Extension Host.
- [x] Run `npm run typecheck`, `npm test`, `npm run test:worker`, `npm run test:memory`, `npm run test:performance`, `npm run test:build-context-performance`, `npm run test:ui`, `npm run test:extension`, and `npm run test:large`. Use completed outputs as evidence, not background process launch.
- [x] Review diff for legacy parser remnants, fabricated certainty, path quoting, resource release, and unrelated edits. Repair findings with regressions. Commit verified implementation.

## Task 6: Release and public verification

Files: `package.json`, `package-lock.json`, `CHANGELOG.md`, `docs/releases/<next-version>.md`, `docs/reviews/2026-10-26-tree-sitter-make-validation.md`.

- [x] Read latest tags/releases and choose the next unused patch version. Update manifest/lock/package script and explain new support plus remaining static-analysis limits in release notes.
- [x] Build and package; inspect VSIX entries, Make grammar, notices and exact bundled file equality. Run extracted-package Extension Host verification.
- [ ] Apply finishing-a-development-branch and verification-before-completion. Integrate the authorized release through repository conventions, push the branch/main and immutable tag, and watch the existing release workflow.
- [ ] If a tagged run fails because of source, keep the tag immutable and issue a new patch. Retry unchanged infrastructure flakes only with evidence.
- [ ] Verify all public VSIX aliases and SHA256SUMS, compare extracted public files to validated local files, and exercise update-service download/checksum behavior for the prior installed version.
- [ ] Record authoritative source/tag/CI/public asset evidence; push the validation record. Mark the goal complete only after all requirements are verified.

## Plan review

All four reproduced defects have failing-first tasks. The old statement parser is
removed, not retained as fallback. Evaluation scope remains bounded; packaging,
clean CI order, platform tests, cached contexts and public deployment are covered.
The private firmware and unknown Diab-specific compiler semantics remain unverified.
