# Build-free Member Syntax Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans by default for continuous inline implementation. Use superpowers:subagent-driven-development only when the user explicitly requested subagents or parallel agent work. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Connect supported cast, returned, anonymous and initialized members without build configuration.

**Architecture:** Extend existing compact type facts and MemberResolver, preserving original reference locations and current index invalidation. Record unsupported syntactic forms in existing Analysis notices; keep runtime pointer inference unchanged.

**Tech Stack:** TypeScript, Tree-sitter C/WASM, node:test/tsx, VS Code Extension Host.

---

### Task 1: Capture the baseline and missing behavior

Files: `test/members.test.ts`, checkpoint tag, this plan and the matching spec.

- [x] Save the approved spec/plan and tag `cc582f2` as `checkpoint/before-member-syntax-20261018`.
- [x] Add real-parser regressions for these source forms:
  ```c
  struct Motor { int state; };
  struct Motor *get_motor(void);
  void task(void *p) {
      ((struct Motor *)p)->state = 1;
      get_motor()->state++;
  }
  ```
  Resolve each `state` token to Motor.state; assert write/readwrite access and
  exact token offsets. Keep unknown receivers and invalid `.`/`->` unresolved.
- [x] Add anonymous member and designated-initializer regressions:
  ```c
  struct Motor { union { int state; int mode; }; };
  struct Motor motor = { .state = 1 };
  void task(struct Motor *m) { m->state = 2; }
  ```
  Both uses resolve to the same field. Initializer belongs to motor, body write
  belongs to task. Named nested members must not be promoted.
- [x] Run `node_modules/.bin/tsx --test test/members.test.ts` and confirm failures
  are missing links, not parser/test setup errors. Save baseline timing for a
  fixed generated member workload before modifying production sources.

### Task 2: Cast and return types

Files: `src/model.ts`, `src/type-info.ts`, `src/member-resolver.ts`, member tests.

- [x] Add a typed-expression leaf carrying a written CType and lexical location,
  plus a call expression carrying its callee. Teach declaredType to retain
  abstract pointer/array/function declarator layers.
- [x] Parse cast type descriptors without requiring their operand to have a
  known type. Normalize their types at the cast's lexical scope.
- [x] Resolve a call's return type by removing a leading function layer or a
  pointer/function pair from the callee's declared type; do not infer arguments
  or runtime function targets for this operation.
- [x] Verify local typedef shadowing, return typedefs defined in headers,
  function-pointer returns, multiple conditional types and invalid operators.
  Run member, pointer and function-argument tests; fix regressions locally.

### Task 3: Anonymous members and designated initializers

Files: `src/model.ts`, `src/type-info.ts`, `src/analyzer.ts`,
`src/member-resolver.ts`, `src/relations.ts`, member tests.

- [x] Record anonymous ownership only for unnamed struct/union definitions that
  are actual anonymous fields. Add a separate index lookup, clearing/removing
  entries with their source file; ordinary callback field layouts stay intact.
- [x] Search promoted fields recursively within existing depth/candidate bounds,
  preserving conditions along anonymous paths and the original field identity.
- [x] Convert initializer designators to existing member/index expression paths
  rooted in the declared receiver or compound-literal type. Resolve outer
  designated initializer contexts before their nested lists. Support safe
  positional nesting where its receiving field is unambiguous.
- [x] Emit `reference`/`write` at each field designator. Preserve function owner,
  initialized-variable owner, active source conditions and sizeof exclusions.
- [x] Add English issues for unsupported field receiver/initializer expressions.
  Check empty results never connect to unrelated globals with the same name.
- [x] Verify nested field/array paths, anonymous conditions, header changes and
  deletion, and declaration-vs-use clicks. Run all unit tests and typecheck.

### Task 4: Native verification and performance

Files: `test/extension.test.ts`, existing Worker/FreeRTOS suites.

- [x] Extend native host tests with cast, returned and initializer selections.
  Assert Relation's qualified field name and exact Context/editor positions.
- [x] Build, run Worker and native host suites, then the 655-file FreeRTOS corpus.
  Compare the fixed member workload before/after and report indexing separately
  from relationship-query cost. Retain candidate/partial-analysis limitations.

### Task 5: Review and local delivery

Files: `README.md`, `USER_GUIDE.md`, `CHANGELOG.md`, `package.json`, lockfile,
`docs/reviews/2026-10-18-member-syntax.md`.

- [x] Bump development version/package output to 0.1.32 and document supported
  syntax, anonymous-field naming, original designator write locations and limits.
- [x] Perform local review-work against this spec, inspect the full diff, and
  reproduce/fix actionable findings with regression tests before completion.
- [x] Run final relevant tests/typecheck/build/whitespace checks. Package a VSIX,
  inspect its version/bundled guide and run native tests from extracted contents.
- [x] Commit verified changes and add a reviewed checkpoint tag. Report local
  package and validation; do not push or publish a release without a request.
