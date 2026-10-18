# Macro Expansion Folders Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans inline. Do not delegate. Steps use checkbox syntax for tracking.

**Goal:** Let users choose macro-expansion folders while retaining basic indexing.

**Architecture:** Add one resource glob setting and checkbox command. Pass each
file's expansion policy to the Worker; skip unselected macro bodies while keeping
their headers and raw source facts available.

**Tech Stack:** TypeScript, VS Code QuickPick/settings, Minimatch, Tree-sitter Worker.

---

- [x] Add failing semantic tests in `test/macros.test.ts`: checked app/unchecked
  SDK header/body, preserved direct calls/literal arguments/pointer inference,
  empty/all policy, header changes and toggles. Run the macro tests and observe
  failure because unchecked bodies currently expand.
- [x] Add `expandMacros?: boolean` to `FileAnalysis` and Worker requests. Set it
  from a resource-scoped `macroExpansionFolders` matcher in `src/workspace.ts`.
  Rebuild on configuration changes. In `src/project-analysis.ts`, bypass and
  evict unselected-file cache entries before timeline/expansion work. Preserve
  raw files in the full include dictionary and existing pointer/argument analysis.
- [x] Register the array setting, default `["**"]`, explicit empty/off description
  and **C Relations: Select Macro Expansion Folders** command in `package.json`.
  Implement `src/macro-folders.ts` QuickPick and register it in `src/extension.ts`.
  Use Include choices/fallback root directories, retain saved custom patterns,
  save at the selected workspace resource scope, and leave Cancel untouched.
- [x] Add a real Worker regression for the policy flag and toggling/replay.
  Verify unit/typecheck/Worker tests, native Settings link/checkbox save and
  reindex semantics, no base scope loss, cancellation/empty/all and multi-root.
  Run existing navigation UI/native checks and a controlled all/selected benchmark.
- [x] Update README, bundled Help and the pending v0.1.36 changelog. Review the diff
  and verification, package the cumulative Go to Pin + macro-folder VSIX, inspect
  its settings/runtime/Help and record evidence without remote publication.
