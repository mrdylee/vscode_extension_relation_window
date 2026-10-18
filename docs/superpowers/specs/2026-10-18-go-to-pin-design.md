# Go to the pinned symbol

The user wants a direct way back to the pinned position, either through the
context menu or beside Pinned Follow paused. Use a compact **↩ Pin** toolbar
button beside the existing pin toggle: it is immediately discoverable and takes
one click. A context-menu duplicate or saved-anchor/history feature is unnecessary.

Show the button only while pinned, with accessible name **Go to pinned symbol**
and a tooltip naming the root. Disable it if no root location is available.
The action reveals the actual pinned root in Relation after clearing canvas pan,
previews that symbol in the shared Context and opens its source in the main editor.
Expanded branches, depth, mode, orientation and the pin remain unchanged.

Reuse the webview's root symbol ID, existing preview/open messages and graph
position functions. The host already validates IDs and prevents automatic root
tracking while pinned. No new analyzer, Worker, settings or controller protocol is
needed. Scroll the direct root card into view in both caller/callee orientations;
returning to the graph's left edge alone may leave a deeply expanded root offscreen.

Verify existing browser/native navigation checks and a targeted browser smoke for
the button, message target/order, branch preservation, offscreen root reveal and
disabled/hidden states. Inspect a native click opening the pinned definition and
updating Context in combined/separate layouts. Update bundled Help and prepare a
local v0.1.36 VSIX after local review. Publication requires a release request.
