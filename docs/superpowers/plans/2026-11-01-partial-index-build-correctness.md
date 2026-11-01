# Partial analysis and Make context correctness Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. Steps use checkbox syntax; canonical changing state is tracked in claude-mem `partial-index-fix-release`.

**Goal:** Publish a verified fix for incomplete callback results, Make-context extraction and misleading retry status.

**Architecture:** Retain bounded analysis and propagate omitted information through existing unknown values and storage regions. Extend only the Make constructs demonstrated by the actual project, keeping extraction read-only. Preserve selected-provider AI and source scopes.

**Tech Stack:** TypeScript, tree-sitter C/Make WASM, VS Code API, node:test, existing VSIX and GitHub Actions release pipeline.

## Task1: Make input regressions and static extraction

Files: `test/build-discovery.test.ts`, `test/build-make-parser.test.ts`, `test/build-options.test.ts`, `src/build-discovery.ts`, `src/build-service.ts`, `src/build-make-parser.ts`, `src/build-make-expression.ts`, `src/build-options.ts`.

- [x] Add a nested `source/Makefile` plus sibling `make.cfg` fixture; assert the discovered entry cwd and resolved `-D` context.
- [x] Add computed `$(MODULE)SRCS` assignment, continued-comment, nested `eval(call ...)`, include restoration through `MAKEFILE_LIST`, recursion/operation-bound and no-shell-execution fixtures. Run `tsx --test test/build-{discovery,make-parser,options}.test.ts`, recording expected failures.
- [x] Set Makefile cwd to its directory, normalize only grammar-unsupported assignment-name spelling while preserving original offsets/text, and evaluate computed names before assignment.
- [x] Add bounded call argument scope and text-only eval callback; maintain Makefile list before each include. Keep unsupported effects explicit.
- [x] Re-run tests and `artifacts/partial-index-147/build-profile-probe.ts`; inspect actual command flags and unresolved inputs rather than treating discovery as application.

## Task2: Callback correctness regressions

Files: `test/macros.test.ts`, `test/analysis-budget.test.ts`, `src/model.ts`, `src/project-analysis.ts`, `src/pointer-targets.ts`, `src/analysis-cache.ts`.

- [x] Move the seven actual-engine review regressions from `artifacts/partial-index-147/review-regressions.test.ts` into maintained macro/work tests. Confirm four false-versus-true failures before changing production logic.
- [x] Add optional incomplete reasons to generated flow programs and unknown expressions. Incomplete global initializers join known values with an unknown alternative. Generated partial function programs retain candidates and unknown values for outputs/observations.
- [x] During existing scalar-dependency traversal collect bounded global write roots and direct callees; unresolved stores/calls conservatively include global/parameter roots. Propagate an exhausted function's omitted roots through existing summary invalidation; preserve known writes and independent local callbacks.
- [x] Set `ANALYSIS_CACHE_VERSION=17`; verify old cached results require rebuild and new incomplete facts survive warm/disk paths.
- [x] Run macro, budget, safety, uncertainty and effects tests; correct only demonstrated regressions.

## Task3: Honest local and build status

Files: `webview/local-progress.ts`, `src/build-service.ts`, `test/ui.mjs`, relevant build service tests and guides.

- [x] Add UI expectations for fixed-limit `Local analysis limited`/`Re-run local`, interrupted Retry, paused Resume, and discovery with no selected build. Observe old behavior fail.
- [x] Keep existing messages/actions and use existing outcome/limited state; explain identical bounds in re-run tooltip. Label no-selection discovery explicitly.
- [x] Verify UI and basic/detailed readiness without altering project Include or AI configuration.

## Task4: Review, integration and publication

Files: release version manifests, `CHANGELOG.md`, `docs/releases/<next>.md`, implementation/publication report.

- [x] Run typecheck, full unit/Worker/memory/performance/UI/native/large gates with logs under ignored artifacts. Validate actual147file baseline and Make projection separately, retaining source flags and partial reasons.
- [x] Review source diff against approved scope and failed regressions. Build/package the next available patch version and verify extracted VSIX in isolated VS Code.
- [x] Check current remote main/latest release, commit task files explicitly, integrate main without overwriting concurrent work and push the source/tag through existing release workflow.
- [x] Wait for Windows/macOS/Ubuntu/release success. Download all5publicVSIX and checksums, compare all archive-entry contents with the locally verified package, and run the real updater checks.
- [x] Commit the publication receipt separately, verify remote state and report delivered behavior plus remaining partial/build limits.
