# Typed Member Binding Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: superpowers:executing-plans, inline execution without subagents.

**Goal:** Distinguish same-named struct/union members through declared receiver types.

**Architecture:** Add optional type metadata and field-expression references to
Tree-sitter results. Resolve members via per-owner fields and visible type
records, reusing existing variable relations and UI navigation.

**Tech Stack:** TypeScript, Tree-sitter C WASM, node:test, VS Code, Playwright.

## Tasks

- [ ] Add test/members.test.ts and include it in npm test. Start with
  `struct Motor { int state; }; struct Sensor { int state; }; int state;
  void run(struct Motor *m, struct Sensor *s){m->state=1;s->state++;state=3;}`.
  Assert 3 distinct definitions, one write for Motor, one RW for Sensor and only
  the unqualified write for global state. Run tests and confirm missing behavior.
- [ ] Add CType (base/tag/id and ordered pointer/array/function layers) and a
  bounded typed-expression representation to src/model.ts. Add src/type-info.ts
  to extract type declarators and identifier/member/index/address/deref paths.
- [ ] Extend src/analyzer.ts: capture named/anonymous aggregate owners, fields,
  aliases and variable types; collect field_identifier uses with field-expression
  access and original source positions. Retain indirect calls separately.
- [ ] Add src/member-resolver.ts: resolve aliases in their declaration context,
  tags in visible lexical scope, and field chains via owner IDs. Reject unsupported
  expressions and mismatched pointer layers; bound recursion and candidate counts.
- [ ] Wire incremental owner buckets and cached include reachability in
  src/relations.ts. Exclude fields/tags from ordinary identifier resolution.
  Resolve field uses first and preserve existing R/W filter and caller semantics.
- [ ] Add fixtures for typedefs, anonymous typedefs, local aliases/tags, extern
  declarations, pointers/arrays/nesting, forward tags, conditional definitions,
  unsupported casts/macro receivers, sizeof, callback fields and edit invalidation.
- [ ] Add qualified member names/labels to graph rendering and popup text without
  changing node size or glyphs. Add Extension Host and browser checks that selecting
  Motor.state shows only Motor uses and previews exact source locations.
- [ ] Update Help, README, changelog, release notes and package version to 0.1.26.
  Run npm test, npm run typecheck, npm run test:ui, npm run test:extension,
  npm run test:freertos and npm run test:large. Review diff for scope and regressions.
- [ ] Package VSIX, verify manifest/Help/bundled code and test packaged extension.
  Commit on feature branch and report verification, known limits and release state.
