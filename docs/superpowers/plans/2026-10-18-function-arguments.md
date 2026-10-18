# Function Arguments Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optional, precisely labelled function-argument links in existing graphs.

**Architecture:** Keep typed argument records separate from ordinary references.
A small collector reuses parsed expressions and existing pointer observations;
RelationIndex combines them only for enabled function-call graphs. Native
Settings changes projection; webviews retain compact existing icons.

**Tech Stack:** TypeScript, Tree-sitter C/WASM, VS Code API, existing Node and browser tests.

---

### Task 1: Contract and collector

Files: `test/function-arguments.test.ts`, `src/model.ts`,
`src/function-arguments.ts`, `src/pointer-targets.ts`, `package.json`.

- [ ] Add failing cases using the real analyzer. For
  `void target(void){} void svc(void(*cb)(void)); void origin(void){svc(target);}`
  assert a separate argument record with owner origin, target target, position 1,
  and the exact original argument offset. Assert ordinary references unchanged.
- [ ] Run `npx tsx --test test/function-arguments.test.ts`; verify missing records
  cause assertions to fail before implementation.
- [ ] Add `ReferenceRecord.argument` with receiver expression, argument index,
  call location and inferred flag; add `FileAnalysis.functionArguments`.
- [ ] Collect literal/address targets only for evaluated call references. Reuse
  per-round pointer argument observations and replay them with cached functions.
  Materialize their targets after propagation; include records in file caches.
- [ ] Verify opaque receiver, aliases, macros, inactive branches, return-value
  calls, unevaluated sizeof, shadows and dependency edits with the focused suite.

### Task 2: Optional graph projection

Files: `src/relations.ts`, `test/function-arguments.test.ts`.

- [ ] Add default-off graph/relations parameter `includeFunctionArguments`.
  Verify default Callers excludes origin and enabled Callers includes origin;
  enabled Callees includes both svc and target for the Task 1 fixture.
- [ ] Keep arguments in separate incoming/outgoing file buckets. Merge mixed
  call/argument sites per symbol, preserving actual call kind and source order.
- [ ] Verify References, resolveAt for aliases, variable filters, both graph
  orientations/depth and the 300-node budget retain their existing behavior.
- [ ] Verify replacing/removing target and source files removes stale links.

### Task 3: Settings and rendering

Files: `package.json`, `src/view-state.ts`, `src/view.ts`, `webview/main.ts`,
`webview/styles.css`, `test/extension.test.ts`, `test/create-ui-fixture.ts`,
`test/ui.mjs`.

- [ ] Add native boolean `cRelation.includeFunctionArguments`, default false,
  window scope. Read it in the controller and refresh projection on changes.
- [ ] Test that enabling it preserves indexed file identity and selected root.
  Clicking an incoming argument previews its source; Enter opens its source.
- [ ] Render dotted cyan argument-only connectors, solid mixed connectors,
  exact receiver/index labels and existing tinted expression/evidence details.
  Preserve existing icon and 500 ms hover behavior.
- [ ] Verify dark/light and reversed dual-direction connectors, popup labels,
  exact argument preview, keyboard open and one-line card height in browser tests.

### Task 4: Worker and real-workspace validation

Files: `test/analysis-worker.test.mjs`, `test/freertos.test.ts`.

- [ ] Test argument dependency edits, deletion, result acknowledgement and
  unchanged derive identity in the built Worker.
- [ ] Run typecheck, all unit tests, Worker, browser and native Extension Host
  tests. Verify full 655-file FreeRTOS index and bounded enabled graph queries.
- [ ] Measure final initial analysis and graph-query cost; distinguish existing
  time-budget warnings from complete callback inference. Do not claim WSL tests.

### Task 5: Documentation, review and local delivery

Files: `USER_GUIDE.md`, `README.md`, `package.json`, `package-lock.json`,
`docs/reviews/2026-10-18-function-arguments.md`.

- [ ] Document the option, dotted-connector legend, examples and accuracy limits
  in bundled Help and README. Advance the local package version to 0.1.31.
- [ ] Perform review-work against the approved spec and complete diff. Add
  reproducing tests for findings, fix them, and repeat relevant verification.
- [ ] Package the reviewed VSIX, record verification and remaining limitations,
  commit locally and create an annotated checkpoint tag. No publish/push requested.
