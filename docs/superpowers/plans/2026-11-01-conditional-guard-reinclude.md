# Conditional Guard Re-entry Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for continuous inline implementation. Use subagents only when explicitly requested.

**Goal:** Preserve all callback candidates after conditional include-guard changes.

**Architecture:** Share the existing uncertain-guard handling between binding and expansion. Preserve known-guard optimization and advance cache compatibility.

**Tech Stack:** TypeScript, web-tree-sitter C parser, Node Worker, VS Code.

Apply the accepted review comment under the user's continuation authorization. Use `codex/conditional-guard-reinclude`; keep edits within guard-state propagation, cache compatibility, meaningful regressions and delivery documentation.

- [x] Promote the review reproduction to maintained macro tests with reset/retained-guard controls. Add conditional-definition and warm/edit coverage. Run before production edits and record the expected missing-target failure.
- [x] Share existing uncertain-guard handling with the full macro timeline. Bump analysis cache compatibility. Run focused tests and actual RBMS analysis immediately; preserve 147-file scope and existing bounds.
- [x] Add Worker/disk-cache coverage, inspect the diff locally, and run typecheck, unit/Worker/memory/performance/UI/native checks appropriate to the final change. Verify the extracted package against the actual RBMS BAT selection and rebuild, without AI.
- [ ] Publish a patch through the established three-platform pipeline and verify public assets/updater. Update the active installation, stop AI before rebuilding cache, and confirm the actual 147-file result. Record immutable release evidence separately.

Canonical progress and evidence are tracked in claude-mem work state. No completion claim before the target-loss regression and actual-project acceptance both pass.
