# Relation Layout Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: superpowers:executing-plans, inline execution. No subagents requested.

**Goal:** Add optional Callees sorting, panning, dual-direction graphs and detachable Context.

**Architecture:** Extend the existing index graph projection and shared view controller.
Reuse one index and preview renderer across two registered webviews. Use workspace
configuration for layout/sort preferences and local browser state for panning.

**Tech Stack:** TypeScript, VS Code WebviewView API, Tree-sitter, node:test, Playwright.

- [x] Add failing graph tests in test/core.test.ts and test/macros.test.ts for source
  sorting, repeated sites, both-direction traversal, independent expansion keys and
  the 300-node shared budget. Run with tsx --test and confirm intended failures.
- [x] Extend src/model.ts and src/relations.ts: optional sort argument, source-sorted
  outgoing refs, and GraphData.callers with direction-specific keys in both mode.
  Preserve defaults and variable incoming relationships. Run npm test and typecheck.
- [x] Add cRelation.calleeSort and cRelation.contextLayout settings in package.json;
  register an Explorer Context view visible only in separate mode. Extend src/view.ts
  and src/extension.ts to share preview, validate configuration changes and handle
  both surfaces without duplicating index work. Review graph/controller changes.
- [x] Extend webview/main.ts and styles.css with the fourth relation mode, mirrored
  caller branches, accessible context-menu actions, thresholded background pan and
  split/combined rendering. Add browser tests in test/ui.mjs and Extension Host tests
  in test/extension.test.ts for persistence, navigation and unchanged selection.
- [x] Run npm test, npm run typecheck, npm run test:ui, npm run test:extension and
  performance comparisons of existing graph queries. Fix findings from local review.
- [x] Update USER_GUIDE.md, README.md and release notes; bump version to 0.1.29 and
  package a VSIX. Record review and verification, commit and add an annotated feature
  checkpoint tag. Keep remote publication separate from local implementation.
