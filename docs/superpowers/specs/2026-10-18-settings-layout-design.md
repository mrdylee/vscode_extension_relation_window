# Settings and call graph direction

Use the existing VS Code Settings editor as the single entry point for Callees
sorting, Combined/Separate Context layout, dual graph orientation and analysis scope.
The Settings button filters all settings of this extension. Remove direct sorting
and Context-layout choices from the graph context menu; retain Settings and Reset.

Add cRelation.callGraphDirection with callers-left (existing default) and callees-left.
Only Callers & Callees presentation changes. Keep graph relationships, direction
keys, expansion state, selection and Callees sorting semantics intact. Reflect
changes immediately without rebuilding the analysis index or graph projection.
Align the whole graph to the left after a new root or side swap. Remove automatic
root centering and viewport-width padding, including the old root-position anchoring
when callers expand. Keep left branches initially visible. Mirror whichever branches
are physically left, including descendants; leave symbol text/icons upright.

Persist choices using native workspace/user settings. Opening Separate through
Settings must reveal its native Context view while preserving editor focus. Update
bundled Help and verify both orientations and shared Context behavior.
