# review-work: Macro Expansion Folders, pending v0.1.36

The requested setting chooses which included source bodies/initializers receive
macro expansion. Unchecked files retain basic analysis and supply indexed header
definitions to checked sources. Include/Exclude is unchanged and Exclude wins.
Default `["**"]` preserves all expansion; explicit `[]` disables expansion.

Local diff review checked resource-scoped configuration, normalized glob matching,
Worker flag propagation/legacy defaults, bypass before include traversal, eviction
of unselected expanded cache entries, header dependency edits, and retained raw
pointer/function-argument analysis. Checked files retain all existing analysis
limits. The new setting uses the existing reindex/Worker recovery path.

The native picker uses Include patterns or root folders, retains saved custom
patterns, supports all/none/cancel, and saves to the selected multi-root folder.
Review found that generated folder patterns must escape glob metacharacters;
`minimatch.escape` now preserves literal names such as `App[board]`. The packaged
native test selects that folder and verifies expansion only there. Settings and
Command Palette entry points are available to VSIX-only users. No review subagent.

Verification:

- TDD: both new macro policy tests failed before the bypass was implemented;
  the complete macro suite then passed 28/28. Logs preserve the red/green result.
- Typecheck/build passed. Unit suite: 184/184. Real Worker suite: 4/4, including
  policy toggles, replay identity, edited unchecked headers, direct calls,
  literal function arguments and local pointer inference.
- Extension Host suite passed from source and the extracted final VSIX. Checks
  include automatic policy rebuilds, unchanged basic scope, excluded files staying
  excluded, new unchecked source creation, selected-source/unchecked-header
  expansion, off/all restoration, existing navigation and Worker recovery.
- Native macOS Settings command link and checkboxes passed selected/all/none,
  cancellation, retained custom globs, empty-Include fallback, root C/H and literal
  bracketed folder matching. A separate multi-root run verified only the chosen
  folder's `.vscode/settings.json` changed. UI screenshots were inspected.
- Existing browser navigation suite passed. The final extracted VSIX passed the
  native five-phase Go to Pin/layout smoke, retaining pinned source, Context,
  graph/index identity and combined/full-width/separate behavior.
- Actual FreeRTOS corpus: 655 files, index completed in 33,047 ms with no editor
  documents opened during indexing. Existing callback propagation/10-second budget
  notices remain; completion does not imply every callback was resolved.
- Controlled synthetic benchmark: 201 files / 8,000 macro invocations, 200 versus
  20 expanded source files. Four alternating-order runs: median derive time
  164.935 ms versus 33.52 ms. This measures postprocessing on this synthetic input,
  not source parsing, per-click latency, WSL throughput or a universal speedup.

Native harness adjustments filtered the virtualized Settings list to the setting
ID, reread configuration after saves instead of retaining a stale snapshot, and
waited for the workbench page. These were test harness failures, not fixes to the
product. Final native and packaged runs passed after those corrections.

No blocking finding remains in these verified paths. Unchecked bodies can lose
macro-dependent calls/callback targets by design. Basic indexing, header lookup
for selected sources and pointer analysis still cost memory. This does not promise
to eliminate memory-budget partial results or OOM in every workspace. New native
verification ran on macOS; no new Windows or WSL machine run was performed.

Implementation package before the final Settings text correction (superseded by
the package recorded in `2026-10-18-release-0.1.36.md`):
`artifacts/c-relation-explorer-0.1.36.vsix`, **516827 bytes**.
SHA-256: `92ae7a4b30247e88a3c5220426aa96fd046979bd2ea876b5cbd57d93c849fbe2`.
ZIP inspection verified manifest/default/command, both runtime bundles, Go to Pin,
offline Help and changelog. VSCE converts relative README links to GitHub links;
the bundled user guide remains identical to the workspace file.

Ignored evidence: `test-results/macro-folders-*`, `extension.json`, `freertos.json`,
`go-to-pin-native.json`, and `output/playwright/macro-folders-*`. The pre-feature
fallback is local tag `checkpoint/before-macro-folder-scope-20261018` at `c013374`.
No remote push, release or installed user extension change was performed.
