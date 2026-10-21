# review-work — Copilot waiting for saved index

2026-10-21. Local review of the uncommitted Copilot wait-reason changes against
`docs/superpowers/plans/2026-10-21-copilot-wait-reasons.md` and the handoff.
Unrelated callback-registration and release changes are outside this review.

## Finding and resolution

**[P2] Waiting diagnostics retain an obsolete blocker after Worker failure — fixed.**
The service stores `waitReason` when it enters or revisits the waiting state.
An idle Worker can subsequently exit without a source or settled event to rerun
the service. Workspace diagnostics previously returned that stored object,
so the footer, Diagnostics and issue report could continue asking the user to
save C/H files when the actual action required was rebuilding the stopped Worker.

The regression in `test/workspace.test.mjs`, "Copilot waiting diagnostics reflect
a Worker failure after the wait began", starts a real Worker, establishes an
unsaved-source wait and terminates the Worker. Before the fix, the live getter
returned `worker-unavailable` while `workspace.diagnostics.copilot.waitReason`
still returned `unsaved-sources`; the test failed on that mismatch.

`WorkspaceIndex.diagnostics` now computes the current blocker whenever it exports
a waiting Copilot snapshot. Existing diagnostics/changed notifications carry the
updated value to the UI and issue report. This does not add retries or requests.
The same regression passes after the fix.

## Other checks

- Checked that ordinary Partial index limits do not introduce a Copilot blocker.
- Checked enabled/off state handling, dirty-source request prevention,
  save/settled resumption, stale-result rejection, wait-message rendering and
  issue-report reason allowlisting.
- Preserved additional same-worktree changes encountered during review:
  deferred explicit Analyze/Reanalyze intent and its unchanged-generation save
  regressions. These changes were included in the final test run; they were
  not authored as part of this review's snapshot fix.
- The deferred intent is consumed once; model reset or disabling Copilot clears
  it. Startup and model selection alone retain cache-only behavior.

## Fresh validation

- `npm test`: 365/365 passed.
- `npm run typecheck` and `npm run build`: exit 0.
- `node --test test/analysis-worker.test.mjs test/analysis-cache-worker.test.mjs test/workspace.test.mjs`:
  39/39 passed.
- `npx tsx test/create-ui-fixture.ts && node test/ui.mjs`: passed in Chrome headless,
  including the eight wait reasons, hidden waiting counts and ready-state recovery.
- `git diff --check`: exit 0.

No unresolved actionable finding remains in the reviewed scope. User WSL
reproduction, real Copilot provider behavior and the reported ten-minute delay
remain unverified. Existing uncommitted changes are preserved. No commit,
installation, packaging or publication was performed by this review.
