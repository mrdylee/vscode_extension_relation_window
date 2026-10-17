# GitHub Update Checker Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. No subagents requested.

**Goal:** Check published GitHub extension releases automatically, ask before installing, and push the initial repository commit.

**Architecture:** Pure release validation/version comparison and a bounded download module feed a small update controller; a VS Code adapter handles confirmation, storage and installation. Fixed public repository and stable numeric version tags.

**Tech Stack:** TypeScript, Node HTTPS/fetch, VS Code commands, node:test.

### 1. Update logic and tests
- [x] Create src/updates.ts with release validation, numeric version comparison, daily interval and confirmation/install controller. Use dependency injection only for storage/network/UI effects exercised by tests.
- [x] Create test/updates.test.ts covering newer/equal/older versions, drafts/prereleases, missing/wrong assets, missing release, daily throttling, manual override, declined consent, explicit acceptance, failure and overlapping checks.
- [x] Run failing tests before implementation, then run all unit tests and typecheck.

### 2. VS Code integration
- [x] Add src/update-service.ts adapter: GitHub API fetch, download to temporary storage, optional SHA-256 validation, VSIX install command, release notes/consent and optional reload.
- [x] Register cRelation.checkForUpdates and automaticUpdates setting in package.json; wire production startup/timer in src/extension.ts without blocking analysis. Keep manual checks functional.
- [x] Extend extension host checks for command registration and test-mode network suppression. Test controller consent paths with mocks; never replace the user extension with a simulated update.

### 3. Delivery
- [x] Version 0.1.9, README/CHANGELOG and publish instructions. Run core, UI and extension tests. Package and inspect VSIX contents, install and verify version in user window.
Git delivery: initialize main, configure the specified origin, inspect staged files, commit and push without force. Record the resulting local/remote HEAD and worktree status in the final task report after the initial commit.
