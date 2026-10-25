# Include/Exclude Folder Picker Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation.

**Goal:** Select general analysis folders without writing globs, preserving existing rules and saving only after Apply.

**Architecture:** A native folder dialog adds workspace-relative folder patterns to a staged list. A QuickPick review supports adding folders, removing individual rules, explicit Include modes, default Exclude restoration and Apply. Settings links and Explorer folder actions use the same review flow. General scope remains separate from Smart Analysis.

**Tech Stack:** TypeScript, VS Code extension API, minimatch, Node tests with esbuild and a VS Code adapter.

1. Add behavioral tests in `test/scope-folders.test.mjs`; verify they fail before implementation. Cover cancel without writes, staged multi-folder additions, Include narrowing, default exclusion reasons, removing rules, explicit empty Exclude, special path characters, workspace roots and folder-level save scope.
2. Implement `src/scope-folders.ts`; register commands in `src/extension.ts`; expose Settings links and Explorer submenu in `package.json`. Preserve custom glob rules and legacy effective values; use folder-scoped settings when needed. Reject selections outside the active workspace. Show exclusions as folder-rule matches without promising exact file counts.
3. Update README and user guide with entry points, Apply/cancel behavior and exclusion precedence. Run new tests, typecheck, build, migration tests and workspace tests; inspect diff for unrelated changes. No install, publication or push in this task.

Review corrections: offer settings editing per root and open folder settings for folder overrides; normalize root Include selection to `[]` so C/H-only bounded discovery remains active; describe fixed exclusions as immutable. Verify failing/passing adapter regressions, actual discovery arguments, single-root integration and a separate multi-root native host that opens each exact settings resource and preserves other roots on Apply.
