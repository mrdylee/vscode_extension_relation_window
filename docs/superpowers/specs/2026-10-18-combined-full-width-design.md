# Combined full-width layout

Add a third Context Layout choice, `combined-full-width`, labelled
**Combined · Full width**. Keep `combined` as the default and `separate` supported.
The new choice renders the existing combined Context/Relation webview and uses
VS Code's own bottom-panel position and Justify alignment. A webview-only width
change cannot extend beyond its parent Panel; a separate editor window would not
provide the requested layout beneath the sidebars.

Apply Bottom then Justify when entering full width and when the main Relation
webview resolves with that preference already saved. Returning to either other
layout from full width restores Center alignment. Ordinary Combined/Separate
startup and transitions keep existing behavior. Avoid resetting the entire VS Code
layout or changing source-analysis scope, pin state, expansions and sorting.

Use the built-in `workbench.action.positionPanelBottom`,
`workbench.action.alignPanelJustify` and `workbench.action.alignPanelCenter` commands
confirmed in the installed VS Code. Check the current preference after the awaited
position command so an obsolete full-width request cannot justify a newer mode.
Report a command failure through the existing extension error-message style.

Native Settings descriptions and bundled Help explain that all bottom Panel views,
including Terminal, share the alignment. The existing Separate Context view remains
visible only for `separate`. Preserve the previous uncommitted pin-marker work and
include both in the still-unpublished local v0.1.35 package.

Verify saved preference selection, combined rendering, original Combined/Separate
navigation, graph/index preservation and actual native panel alignment. Run the
existing UI and Extension Host checks, typecheck/build, inspect the final VSIX and
perform local review before reporting completion. No remote publication is requested.
