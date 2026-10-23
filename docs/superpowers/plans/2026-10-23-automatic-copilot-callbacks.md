# Automatic Copilot Callbacks Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation. Preserve existing changes; no subagents, release, or installation are required.

**Goal:** Automatically analyze unresolved callbacks when Copilot is enabled and remove the redundant footer chooser.

**Architecture:** Connect the existing automatic controller to the service lifecycle. Keep serial requests, cache validation, scope checks, cancellation, and per-call manual actions.

**Tech Stack:** TypeScript, VS Code language model API, Node test harness, Playwright Chromium.

### 1. Service regression and automatic lifecycle

Files: `src/copilot-service.ts`, `src/copilot-callbacks.ts`, `test/copilot-service.test.ts`.

- [x] Replace the manual-only lifecycle test with enabled startup/enable/source/rebuild cache tests. Add a test with eight sites asserting eight requests and no callback picker.
- [x] Add tests for explicit Stop persistence, failure persistence, waiting for saved sources, cancellation with a newer pending snapshot, model replacement, empty/excluded scope, and active manual target exclusion.
- [x] Keep existing per-call regressions by starting their service in the user-stopped state before explicit actions; this exercises the public Stop behavior without adding a test-only product setting.
- [x] Run `npx tsx --test test/copilot-service.test.ts` and observe the expected missing automatic requests before changing production code.
- [x] Replace cache-only lifecycle restoration with `analyzeUnresolved(snapshot, {reason:'enabled', automatic:true})`. Reserve the running task before model discovery, update cumulative diagnostics through controller callbacks, and use a session pause flag for Stop/failure.
- [x] Exclude active manual site keys in automatic snapshots only. Maintain path-exclusion counts separately. Queue the latest revision after cancellation, without overlapping requests.
- [x] Run service and controller tests, then typecheck.

### 2. Footer and current documentation

Files: `webview/main.ts`, `src/view.ts`, `test/ui.mjs`, `package.json`, `README.md`, `USER_GUIDE.md`, `docs/USER_GUIDE.en.md` if present.

- [x] Change browser assertions so pending/stopped states never show Choose callback. Run the browser test to observe the old button failure.
- [x] Remove the button, unused busy-state variable, and unused `copilotAnalyze` message handler. Preserve Stop and the single-row layout.
- [x] Update settings and current user guidance: enabling runs automatically within the configured scope, valid cache is reused, Stop pauses the session, model selection resumes only when enabled, and node rechecks remain per-call.
- [x] Run `npm run typecheck`, `npm test`, `npm run test:ui`, and `git diff --check`. Inspect the final diff to confirm existing layout work and unrelated files are preserved. Leave source changes for review without publishing.

## Verification

Typecheck, all 546 unit tests, both Chromium UI suites, and diff whitespace checks passed. Service regressions cover serial automatic requests beyond five calls, cache reuse, Stop persistence with completed candidates retained, source/model changes, failures, scope, manual target exclusion, and per-call recheck progress. The manual-only lifecycle and footer chooser tests failed before their corresponding fixes. Existing footer layout changes and unrelated untracked review files were preserved. No publication or installation was performed.
