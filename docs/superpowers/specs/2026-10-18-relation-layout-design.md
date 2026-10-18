# Relation layout and navigation

Approved scope: optional source/name sorting for Callees from the Relation context
menu; left-button background dragging; a fourth Callers & Callees relation mode;
and Combined/Separate Context layout selection. Existing name sorting and Combined
layout stay the defaults. Sorting and layout are workspace settings. No build is
required and no additional analysis index is created.

Callees source order means the earliest original lexical call location per target,
not runtime execution order. Repeated calls remain grouped. Sort popup locations
by source position too. Callers and References keep name ordering.

Both-direction graphs show one center function, callers branching left and callees
right. Branch expansion keys are direction-specific, recursion stays bounded, and
the combined graph has at most 300 visible nodes including its single root. Split
the budget approximately equally between sides. Variable R/W mode stays unchanged.
Keep the root stable while expanding branches; click previews the original call.

Background dragging pans the graph locally, without messages to the extension.
Start only on the background and use a movement threshold to avoid accidental
clicks. Hide hover details while dragging. Provide a Reset graph position action.
Node click/double-click, keyboard expansion and Context text selection remain usable.

Combined preserves the current two-pane view. Separate fills Relation's panel width
and exposes an independent Context webview in Explorer. Users can move its view
header with VS Code's native docking controls. Switching back hides the standalone
view. Both Context surfaces share selection, tinted code and validated navigation.
Do not move the user's other views or change global panel positions.

Validate real derived calls and depth/budget behavior, browser mouse/keyboard flows,
Extension Host configuration persistence and split navigation, and graph lookup
costs. Review each meaningful feature before packaging. Update the bundled guide.
