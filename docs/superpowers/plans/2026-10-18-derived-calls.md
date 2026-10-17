# Derived Calls Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution. Do not dispatch subagents. Review each feature before starting the next.

**Goal:** Implement macro-expanded calls and inferred function-pointer/callback targets, preserving original source navigation and build-free indexing.

**Architecture:** Serialize preprocessing and flow facts from Tree-sitter; run ordered token expansion and bounded project propagation in the existing Worker. Index derived call records with original provenance and refresh only current accepted source versions.

**Tech Stack:** TypeScript, existing Tree-sitter C WASM, node:test, VS Code tests, Playwright.

## Feature 1 — macro expansion

- [x] Add test/macros.test.ts to npm test. Start with `#define CALL(x) foo(x)` and assert foo is an expanded Callees target and incoming caller run at the CALL token. Verify failure.
- [x] Extend src/model.ts with preprocessing events, macro definitions, expansion provenance and effective-call metadata. Collect ordered define/include/undef events, function-body locations and full call extents in src/analyzer.ts.
- [x] Create src/c-tokens.ts for C preprocessing tokens with source origins, strings/comments and line-splice handling. Create src/macro-expansion.ts with ordered environment replay, includes, conditional candidates, argument substitution/prescan, #/##, variadics, hide sets and explicit limits.
- [x] Add analyzer project derivation: expand function bodies, reparse with Tree-sitter, map calls to original tokens, remove raw calls that expansion suppresses and deduplicate variants. No name-only call scanner.
- [x] Extend Worker protocol and WorkspaceIndex with raw-file version storage and serialized derived refresh. Clear/remove excluded files and discard stale results; whenIdle/reindex await completion. Add edit/header/delete/conditional regressions.
- [x] Render Macro-expanded call labels, expansion chain and text in existing popup; keep nodes compact and calls expandable. Test browser and VS Code actual-site navigation.
- [x] Run unit/typecheck, UI, Extension Host, FreeRTOS and large-workspace checks. Perform review-work against v0.1.27; record findings, fix/retest, then commit feature and review record before Feature 2.

## Feature 2 — function pointers and callbacks

- [x] Add test/pointer-calls.test.ts. Start with `void (*fp)(void)=foo; fp(); fp=bar; fp();` and assert per-site targets foo then bar, labelled inferred. Verify failure before implementation.
- [x] Add expression/control-flow facts to model and analyzer (including reparsed expanded bodies): initializers, assignments, branch/loop blocks, calls/arguments and returns. Encode designated and positional struct/array initializer entries.
- [x] Create src/pointer-targets.ts: object-slot identity, target/unknown sets and evidence; flow-sensitive locals; field/index lookup via declared types; bounded parameter/global/return fixed point. Retain unknown markers for opaque mutations and unsupported paths.
- [x] Integrate derived inferred calls into project analysis and incoming/outgoing relations, without losing ordinary variable reads or raw source selection. Include callback registration/forwarding, instance-separated tables, dynamic indices, null/unknown overwrites, conditional targets, cross-file symbols and edit/delete invalidation fixtures.
- [x] Render Inferred call and provenance/unknown details in existing popup with candidate styling. Add browser and Extension Host navigation tests for callback tables and candidates.
- [x] Run feature and full tests. Perform review-work for pointer analysis and interaction with macro expansion; record/fix/retest findings before final packaging.

## Final delivery

- [x] Update README, offline Help, CHANGELOG and release notes, bump package/lock/VSIX version together. Explain supported inference and uncertainty/limits with examples.
- [x] Verify typecheck, all unit tests, UI, Extension Host, performance, FreeRTOS, large workspace and extracted VSIX. Review final diff and docs; resolve every actionable finding.
- [x] Commit/push feature branch and release tag through the established reviewed release workflow. Verify all OS CI, public assets/checksums, remote SHA and clean tree; preserve main/prior versions. Mark goal complete only after both features and both review records are verified.
