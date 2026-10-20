# Persistent Diagnostic Reports Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation. No subagents.

**Goal:** Existing Report issue exports crash-surviving diagnostics and bounded host evidence.
**Architecture:** Separate bounded filesystem helpers from VS Code reporting adapter; record
only allowlisted metadata and keep original snapshot/report behavior intact.
**Tech Stack:** TypeScript, Node fs/promises, VS Code APIs, node:test, native VS Code integration.

### 1. Persistent journal and host collection
Files: src/diagnostic-history.ts, test/diagnostic-history.test.ts.
- [x] Tests first: create temp journal, append a record, flush, create second session,
  assert both records export. Append enough records to rotate and assert <=512 KiB
  per session; retain latest three sessions. Queue limit must not grow unbounded.
- [x] Fixtures for logs/DATE/exthost1/dylee.dynsight: exthost.log and remoteagent.log
  contain host-start/exit/OOM plus unrelated private text. Assert relevant text only,
  redacted roots, bounded tails and missing log statuses. Unknown layout must not scan.
- [x] Run `npx tsx --test test/diagnostic-history.test.ts` and observe missing-module failure.
- [x] Implement DiagnosticHistory.record/flush/read and collectHostLogs(logUriPath,
  redactions). Use unique names, private file permissions and fixed size/read limits.
- [x] Re-run tests until green.

### 2. Integrate existing Report issue
Files: src/issue-report-service.ts, src/view.ts, test/issue-report-service.test.ts,
test/extension.test.ts, package.json.
- [x] Add failing tests: adapter appends collection; Save report uses edited document;
  cancelled save does not write; unavailable collection still produces a report.
- [x] Recorder samples once on registration, every10s, and deduplicated index/Worker
  transitions. View emits allowlisted action type plus mode/depth, without identifiers.
- [x] Add bounded collection to the existing draft, escape Markdown fences, display
  missing sources. Save via showSaveDialog/workspace.fs.writeFile. No upload or rebuild.
- [x] Run typecheck, unit, Worker, browser and native checks. Check report creation while
  Worker request is disabled still works. Review diff, fix findings, rerun affected tests.

### 3. Deliver
Files: README.md, USER_GUIDE.md, CHANGELOG.md, docs/releases/0.1.46.md, review records.
- [x] Document history bounds, capture limits, sensitive host excerpts and Save report.
- [x] Bump0.1.46, build VSIX, run extracted-package native integration.
- [x] Commit/tag/push feature branch; all-platform CI; download checksums and package
  contents; verify updater recognition. Record publication evidence, no main merge.
