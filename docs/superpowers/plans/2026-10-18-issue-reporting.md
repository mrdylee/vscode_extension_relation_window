# Issue Reporting Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. No subagents requested.

**Goal:** Ship a privacy-conscious, user-reviewed GitHub issue reporting flow.

**Architecture:** A pure report builder projects allowed fields into a bounded
Markdown snapshot. A VS Code adapter opens an editable draft and handles explicit
copy/open actions. Diagnostics dispatches the registered command. Existing index
and Worker behavior remain unchanged.

**Tech Stack:** TypeScript, VS Code API, existing webview, node:test, Playwright.

---

### 1. Report builder and regression tests

- [x] Create `test/issue-report.test.ts` first. Assert `createIssueReport` includes
  version, numeric memory and notice counts; rejects secret markers injected in
  raw status/errors/graphs/patterns; handles absent Worker; stays bounded with
  10,000 notices; returns a fixed GitHub URL with no diagnostic payload.
- [x] Observe failure, then implement `src/issue-report.ts`: `ReportInput` with
  runtime, current state, diagnostics and scope counts; fixed status/error buckets;
  explicit memory projection; Markdown symptom/steps/expected/actual placeholders.
- [x] Run `node_modules/.bin/tsx --test test/issue-report.test.ts` and add this file
  to the package test script. Verify unknown notices cannot echo their text.

### 2. VS Code integration and entry points

- [x] Add native assertions in `test/extension.test.ts` for the report command,
  opened Markdown draft, no Worker requests, preserved graph, and private source
  omission. Add browser assertion that Diagnostics dispatches `reportIssue` only.
- [x] Implement `src/issue-report-service.ts`, registering `cRelation.reportIssue`.
  Capture snapshot from host objects, create a Markdown text document and show
  it. Offer `Copy report` / `Copy & Open GitHub` via a non-modal notification.
  On selection use that document's current text, await clipboard then browser;
  catch failures and provide manual-copy guidance. Keep a single pending prompt
  so repeated clicks cannot accumulate report drafts.
- [x] Wire registration in `src/extension.ts`, command forwarding in `src/view.ts`,
  Diagnostics button in `webview/diagnostics.ts` and `webview/main.ts`, plus manifest.
- [x] Run native and browser tests; verify missing Worker snapshots don't wait.

### 3. Documentation, review and publication

- [x] Explain reporting and privacy in README and bundled USER_GUIDE, including
  GitHub account, review/paste/submit, screenshots and saved drafts when offline.
  Add `docs/ISSUE_TRIAGE.md` for diagnosis/regression/release workflow.
- [x] Bump package/lock/package output to 0.1.40. Add changelog and release notes.
- [x] Run typecheck, unit, native extension and UI checks; inspect full diff for
  raw-string leakage, stale capture, accidental sends and changes outside scope.
  Record review evidence and fix any findings before tagging.
- [x] Package VSIX, verify manifest and included report code/docs, commit/tag and
  push using the existing feature branch. Wait for three-OS release CI, verify
  downloads/checksums/updater, record publication evidence and report links.
