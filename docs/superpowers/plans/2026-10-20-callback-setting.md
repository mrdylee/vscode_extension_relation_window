# Callback setting implementation plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for inline implementation. No delegation.

**Goal:** Independently disable callback inference and callback selection while preserving ordinary navigation.

**Architecture:** Carry a window-scoped boolean from WorkspaceIndex through Worker derive to pointer-targets. Cache mode with the derived results. RelationView gates selection using the same preference. Recalculate on config revision without source parsing.

**Tech Stack:** TypeScript, VS Code API, Node Worker, Tree-sitter, node:test.

- [x] Add analyzer tests to test/pointer-calls.test.ts using `analyzer.derive(raw, undefined, undefined, false)`; assert no inferred edges, direct and literal argument edges present, then enabled restores targets. Run `npx tsx --test test/pointer-calls.test.ts` and observe failure.
- [x] Extend derive with optional `analyzeCallbacks = true`; forward to inferPointerCalls. Include mode in project cache and take existing direct-argument-only branch when disabled, before collecting project programs. Worker request and workspace getter forward the setting.
- [x] Add real Worker workspace tests toggling config, preserving sourceParses, rejecting an obsolete in-flight result. Configuration increments revision and calls derive; derive captures mode with its revision.
- [x] Add manifest checkbox; RelationView skips callbackAt when disabled, clears existing focus and retracks ordinary selection. Report `analyzeCallbacks` in the diagnostic snapshot. Native extension test verifies callback selection on/off/on and direct graph behavior.
- [x] Test typedef callback registration fixture against callbackAt. Keep any distinct unresolved WSL diagnosis separate from the setting change.
- [x] Document default, option independence, rebuild timing and inference limitations in README/USER_GUIDE/CHANGELOG. Run typecheck, unit, Worker, memory, browser and native suites.
- [ ] Review full diff for scope, stale inference and config races; fix findings. Package next patch VSIX, tag and publish through existing release workflow; verify assets and CI before claiming publication.
