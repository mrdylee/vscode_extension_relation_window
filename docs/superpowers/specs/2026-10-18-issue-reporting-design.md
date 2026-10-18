# User problem reports

Implement and publish a small reporting flow for VSIX users. The existing public
GitHub repository has Issues enabled. Use it as the support queue; no telemetry,
additional server, token or automatic issue submission is needed.

## Flow

- Diagnostics offers **Report issue**. The Command Palette also exposes
  **C Relations: Report Issue**, including when the Relation webview is unavailable.
- Capture the latest host-owned snapshot immediately, without waiting for the
  Worker or rebuilding the index. Open an editable, unsaved Markdown draft.
- The draft asks for the symptom, reproduction steps, expected/actual behavior
  and optional sanitized screenshot/reproducer. It includes a versioned diagnostic
  summary and explains that GitHub issues are public.
- A notification offers **Copy report** and **Copy & Open GitHub**. These read the
  reviewed document, not the active editor. Dismissal leaves the draft locally.
  The latter copies it and opens the repository's issue editor with short generic
  instructions; users paste, finish editing and explicitly submit there.
- Clipboard/browser failures leave the document available for manual copy. No
  report content is placed in the URL, avoiding URL-length limits and query leaks.
- GitHub login is needed to submit. Without an account or network, save/copy the
  draft using VS Code and share it through an agreed support channel.

## Report contents

Allowlist version, OS/architecture/remote kind, analysis status category, indexed
file count, view settings, Include/Exclude pattern counts, macro expansion mode
and counts, classified notice totals, and numeric memory checkpoints/sample age.
Do not serialize raw state, graphs, source, symbol names, paths, pattern strings,
raw errors or unknown diagnostic strings. Unknown notices become a counted bucket.
Worker-unavailable and partial-index reports remain usable. Distinguish JS heap,
external memory and the shared extension host; do not imply total process RAM.
No new background sampling or retained log history.

## Alternatives and boundaries

Photos alone are hard to search and omit details. An automatic crash service adds
credentials, infrastructure and unsolicited data transfer. GitHub with an editable
local draft fits the current distribution. Repository issue templates on main are
not required: this branch's packaged command creates its own draft.
Save-only indexing, persistent index caching and automatic issue analysis are out
of scope. Maintain a short triage guide for the owner: reproduce, add regression,
fix, review, release, then reference the fixing version in the issue.

## Success criteria

1. A ready, partial or failed index produces a bounded report without Worker work.
2. Secret marker strings in paths, symbols, settings or errors never enter the
   generated report; known failure categories and memory numbers remain useful.
3. Editing the draft does not change Relation selection or analysis state.
4. No browser/clipboard operation occurs before the corresponding user action.
5. Existing UI/native tests, new report tests and release CI pass. Verify all
   published assets and updater selection before calling publication complete.
