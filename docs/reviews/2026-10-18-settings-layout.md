# review-work: Settings, dual direction and left alignment

Scope: Settings as the single preference entry point; configurable dual graph
sides; whole-graph left alignment, as clarified by the user. Defaults preserve
Callers left / Callees right. No analyzer/index changes and no review subagent.

## Checks and decisions

- The Settings command filters @ext:local-james-black.c-relation-explorer rather
  than only Include/Exclude IDs. Its existing command ID remains compatible.
- callGraphDirection is a window-scoped enum with explicit English option labels.
  Configuration changes publish the same graph and Context objects; they do not
  clear expansion keys or trigger analysis. Native Host assertions check identity.
- Branch mirroring follows physical placement (.left-branches), not whether a
  branch contains callers. Both roots and descendants therefore reverse correctly,
  while icons/text, logical direction keys and vertical sorting are unchanged.
- Rendering signatures include orientation only for both-direction graphs. This
  ensures a live swap re-renders even with unchanged graph data, while single-
  direction canvases retain their DOM and orientation. Browser regression included.
- Removed viewport-width padding, root centering and the previous root-position
  anchoring. Reset/new-root/swap returns the whole graph to the left edge. Expansion
  keeps the graph's left edge, allowing newly expanded left branches to be visible.
- Separate Context reveal moved from obsolete webview preference messages to the
  configuration listener, so changing the native setting opens the independent view.
  Direct preference menu actions, their handlers and unused radio/header styles were
  removed. Context menu retains Settings and Reset with keyboard support.

## Verification

Red tests first observed old preference menu entries and an undefined direction
state. Then browser tests passed both orientations, nested caller/callee geometry,
left alignment, persistent graph data, preview clicks, source sorting, pan/reset,
single-direction stability and Combined/Separate preview behavior.

The native Extension Host suite passed direction defaults/configuration persistence,
unchanged graph/preview identity, native Separate view registration and existing
navigation. The final 0.1.30 VSIX was extracted and the same native Host suite passed,
including opening the Settings command. The manifest exposes both direction choices
with callers-left as the default; the bundled extension filters the full extension's
settings and ships the updated offline Help. Its runtime payload matches the final
build byte-for-byte.

Fresh typecheck, all 138 unit tests and the final browser suite pass. There are no
remaining blocking findings from this local review. Analysis code is unchanged;
orientation-only configuration is covered by graph/preview identity assertions.
No new Windows/WSL end-to-end run or remote publication was performed in this step.

Local VSIX: artifacts/c-relation-explorer-0.1.30.vsix. SHA-256:
57ba2be23faf4100e0a32324f742e0e51cddfb793ccd72c7946a4dcf0567d31c.
