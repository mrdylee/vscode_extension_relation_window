# Issue reporting — review-work

Scope: user-reviewed reporting for VSIX users, prepared as v0.1.40. The public
repository has Issues enabled. No automatic collection/submission, analyzer
changes, index-cache changes, new server or GitHub credential storage.

## Review

- Report construction explicitly projects allowed fields. Source, graph nodes,
  paths, scope patterns, raw errors and unknown diagnostic strings are excluded.
  Unknown notices are counted in a fixed `other` bucket. Memory checkpoints,
  sample ages, version/environment and view/scope counts remain available.
- The command captures the latest host snapshot without waiting for the Worker.
  Opening the Markdown draft does not rebuild the index or change the graph.
- Clipboard/browser work occurs only after the user's notification action. The
  actual reviewed document is copied, not whichever editor happens to be active.
  Browser URLs carry generic instructions only. Users paste and submit on GitHub.
- Closed drafts, repeated clicks, clipboard failures and rejected browser opens
  were checked. Review found that closing a pending draft prevented re-entry;
  fixed with a regression. Old notification completion cannot clear a newer
  report session, including concurrent reopen clicks.
- Docs explain public issues, GitHub login, offline Save As/manual copy and
  confidential screenshots. The maintainer guide covers reproduction, failure
  categories, regression tests, review and release verification.
- The Issues flow does not rely on templates from this feature branch being
  installed on the repository's default `main` branch. The README triage-guide
  link targets the release tag rather than a nonexistent default-branch file.

No remaining blocking findings in this diff. GitHub issue submission itself was
not exercised: no test issue or external message was posted. Real user's WSL
clipboard/browser behavior remains environment-dependent; a local draft and
manual copy/link fallback are available.

## Verification

- Initial report test failed with the new module absent; native integration
  failed at the missing report command before registration.
- The closed-draft regression failed before the review fix, then passed.
- Typecheck and 196 unit tests pass, including nine report/boundary tests covering
  sensitive marker omission, 10,000 notices, missing Worker, action ordering,
  edited draft copying, dismissal/reopen and clipboard/browser failures.
- Native VS Code integration passes against source and extracted VSIX. The report
  opens with a simulated Worker failure while Worker requests are forbidden;
  graph identity and clipboard are preserved and source/path markers are omitted.
- Browser UI suite passes; Diagnostics sends only the `reportIssue` intent. The
  900x500 diagnostic screenshot was inspected and the new control fits without
  obscuring metrics or adding scroll. Existing graph/context/popup tests pass.
- VSIX manifest, bundled runtime, Help and changelog match the build. Final
  package changes after native verification only remove trailing spaces from
  numbered draft prompts; unit tests pass again. Release CI will verify the final
  source on all three OS platforms before publishing.

Ignored evidence: `test-results/issue-report-*` and
`output/playwright/memory-diagnostics.png`.

API references checked:
- https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue
- https://code.visualstudio.com/api/references/vscode-api
