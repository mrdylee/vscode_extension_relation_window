# Pinned Relation root marker

The user chose the existing Pin behavior: keep the Relation root fixed while
browsing callers, callees and source. Make that root identifiable with a small
pushpin on its existing one-line node. Unpin removes the marker immediately.

A toolbar-only indicator would not identify the node inside a large graph.
Adding a saved anchor or Return navigation would change the approved behavior.
Use the node marker with a tooltip naming the pinned symbol on the existing
toolbar button instead. Keep the original symbol icon and its meaning.

Update the root marker after rendering without adding lock state to the graph
render signature. Pin/unpin must preserve graph DOM, expanded branches, focus and
pan. Mark only the actual root, including in reversed bidirectional layouts;
recursive occurrences of the same symbol are ordinary branch nodes. Give the
marker an accessible description and use the existing theme accent color.

No analysis, tracking, workspace scope or layout settings change. Folder-selective
macro expansion remains a separate design. Full-width Combined is already
available through VS Code's Align Panel > Justify command and needs no new
extension layout behavior for this change.

Verify the existing browser suite and typecheck/build. Inspect pinned/unpinned
rendering, both graph orientations, theme visibility and unchanged graph state.
Update bundled Help and the patch version; prepare a local VSIX without publishing.
