# Relation interaction fixes

Keep toolbar selects mounted across index and preview updates; rebuild mode options only when switching function/variable mode. Preserve definition choices when candidates are unchanged.

Clicking a Relation symbol previews its existing target and reveals callers/references from that node using the toolbar depth (1–8). Keep the original root, other branches, main editor position, cycle protection and 300-node limit. Repeated clicks do not toggle/collapse the branch. Existing deeper expansion is retained. Double-click/Enter still opens source; popup call-site clicks only preview that site.

Use a dedicated selectNode message with a validated graph key, resolving the preview target on the host. Reuse existing per-node expansion state. This avoids two separate preview/expand updates. Do not reroot or make clicking repeatedly expand an unbounded number of levels.

Verify native menu focus during state updates, depth selection 2–5, function/variable mode changes, definition choices, and host node expansion at depths 1 and 2 with root/editor/Context preservation.
