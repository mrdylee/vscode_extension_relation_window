# Folder-selective macro expansion

The user approved adding the previously discussed macro folder selection in the
same pending v0.1.36 release as Go to Pin. Include/Exclude still control basic C/H
indexing. A separate resource-scoped `cRelation.macroExpansionFolders` string array
restricts source bodies/initializers that receive token expansion. Default `["**"]`
preserves expansion for all included files; an explicit `[]` disables expansion.
Other patterns use the same workspace-relative glob rules as Include/Exclude.

Use one setting instead of separate enable/mode toggles. Its Settings description
links to **Select folders…**, a native checkbox QuickPick. Start from the current
resource's Include patterns; if Include is empty list workspace-root folders and
root C/H files. Retain custom saved patterns as choices. Check all for default/all,
uncheck all for off, cancel without changes. In multi-root workspaces pick the
workspace folder first and save at its resource scope. Native array editing remains
available for narrower paths/globs. Add a Command Palette entry for VSIX-only users.

Attach an optional `expandMacros` flag to each parsed FileAnalysis in the Worker;
requests without the flag preserve current behavior. Macro derivation bypasses
unselected source files and drops their old expanded cache entries, while keeping
the entire indexed file map available for selected files' include environments.
Unselected headers therefore still supply macro definitions to selected callers.
Basic symbols, source references/direct calls, function arguments and existing
pointer inference remain available; macro-dependent targets may be absent.

Do not reuse incomplete preprocessing flow as confirmed callback execution facts.
Selected sources retain existing conditional, dependency/cache invalidation,
repeated-include and memory-budget protections. Policy changes rebuild the index
through the existing recovery path; source creation/edits/deletion use the same
per-folder policy. Exclude continues to win. This limits macro expansion work; it
does not remove basic index or pointer-analysis memory costs or guarantee no OOM.

Verify failures before implementation: selected application expands from unchecked
SDK headers, unchecked SDK bodies stay unexpanded with direct/argument/pointer
relations retained, and policy toggles/header edits invalidate results. Check the
actual Worker protocol, native checkbox/settings flow and per-resource patterns,
including all/none, cancellation and multi-root behavior. Re-run existing tests,
benchmark representative selected/all expansion work, inspect native Help and final
VSIX, and perform review-work. Do not publish without a release request.
