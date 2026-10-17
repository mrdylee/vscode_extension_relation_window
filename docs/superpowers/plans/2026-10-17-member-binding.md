# Typed Member Binding Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: superpowers:executing-plans, inline execution without subagents.

**Goal:** Distinguish same-named struct/union members through declared receiver types.

**Architecture:** Add optional type metadata and field-expression references to
Tree-sitter results. Resolve members via per-owner fields and visible type
records, reusing existing variable relations and UI navigation.

**Tech Stack:** TypeScript, Tree-sitter C WASM, node:test, VS Code, Playwright.

## Tasks

- [x] Add test/members.test.ts and include it in npm test. Start with
  `struct Motor { int state; }; struct Sensor { int state; }; int state;
  void run(struct Motor *m, struct Sensor *s){m->state=1;s->state++;state=3;}`.
  Assert 3 distinct definitions, one write for Motor, one RW for Sensor and only
  the unqualified write for global state. Run tests and confirm missing behavior.
- [x] Add CType (base/tag/id and ordered pointer/array/function layers) and a
  bounded typed-expression representation to src/model.ts. Add src/type-info.ts
  to extract type declarators and identifier/member/index/address/deref paths.
- [x] Extend src/analyzer.ts: capture named/anonymous aggregate owners, fields,
  aliases and variable types; collect field_identifier uses with field-expression
  access and original source positions. Retain indirect calls separately.
- [x] Add src/member-resolver.ts: resolve aliases in their declaration context,
  tags in visible lexical scope, and field chains via owner IDs. Reject unsupported
  expressions and mismatched pointer layers; bound recursion and candidate counts.
- [x] Wire incremental owner buckets and cached include reachability in
  src/relations.ts. Exclude fields/tags from ordinary identifier resolution.
  Resolve field uses first and preserve existing R/W filter and caller semantics.
- [x] Add fixtures for typedefs, anonymous typedefs, local aliases/tags, extern
  declarations, pointers/arrays/nesting, forward tags, conditional definitions,
  unsupported casts/macro receivers, sizeof, callback fields and edit invalidation.
- [x] Add qualified member names/labels to graph rendering and popup text without
  changing node size or glyphs. Add Extension Host and browser checks that selecting
  Motor.state shows only Motor uses and previews exact source locations.
- [x] Update Help, README, changelog, release notes and package version to 0.1.26.
  Run npm test, npm run typecheck, npm run test:ui, npm run test:extension,
  npm run test:freertos and npm run test:large. Review diff for scope and regressions.
- [x] Package VSIX, verify manifest/Help/bundled code and test packaged extension.
  Package checks passed; commit/publish tracked below.

## Verification record

- 66 unit tests pass, including 19 member-specific regressions; typecheck passes.
- Browser checks pass; inspected `output/playwright/member-binding.png` with v0.1.26, compact Motor.state node, existing variable icon and highlighted use.
- Extension Host integration passes against source and the extracted v0.1.26 VSIX, including member selection, type separation, write filtering and caller traversal.
- FreeRTOS: 655 files in 3,755 ms; QueueDefinition.uxMessagesWaiting writes grouped into 8 functions. Existing tracking samples 100–115 ms. Timings are local observations, not guarantees.
- Large workspace: 12,551 source files, 2,501 indexed after exclusions, 50,000 calls; initial scan 1,668 ms, selection during indexing 85 ms, incoming query 23 ms, outgoing query 1 ms.
- Incremental benchmark: 12,500 files / 125,010 references; total update 15.7 ms, single edit 0.024 ms in this local synthetic run.
- Package manifest, bundled Help, analysis and UI checked. `git diff --check` passes. Self-review covered lexical type scope, header ambiguity, edits/deletes and unsupported-expression fallback.

## Publication

- [ ] Commit changes on feature/c-analysis-navigation; preserve main and prior tags.
- [ ] Push v0.1.26 and verify Windows/macOS/Linux CI plus published assets/checksums.
