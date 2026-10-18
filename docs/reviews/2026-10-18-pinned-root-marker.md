# review-work: Pinned root marker

The approved scope preserves the current Pin behavior and identifies its actual
Relation root. Only webview presentation changes; no analyzer, graph data,
tracking, include/exclude or navigation controller changes. No review subagent.

Local diff review found no blocking issues. The direct-child selector marks only
the root card, independent of which side contains callers. Repeated state messages
reuse one marker. Unpin removes it without changing the graph render signature.
The SVG is a static constant with no interpolated source content. The root's
accessible description names its state; the toolbar tooltip names its symbol.

Fresh verification: typecheck/build and the existing browser UI suite passed.
An ignored local browser smoke check covered References, Callees, both graph
directions and variables in dark/light themes. Each pinned view had exactly one
14x14 marker on its root; title height remained 24 pixels. Graph DOM identity and
pan survived pin/unpin, and empty graphs showed no marker. Screenshots inspected
for both dual orientations. This is not a new Windows/WSL runtime verification.

VS Code's official Custom Layout documentation confirms Align Panel > Justify
extends the bottom Panel below both sidebars. Bundled Help documents its use with
Combined and explains that other bottom-panel views share that setting. No VS Code
layout or extension preferences were changed automatically.

Intermediate pin-only package: `artifacts/c-relation-explorer-0.1.35.vsix`, 513739 bytes.
SHA-256: `88c0e3b9c1116b80fa65aa4e1c888d36c2c0f6e4f89245b8d2e02f9cf5f82a00`.
Manifest version, bundled UI equality to the verified build and offline Help were
checked from the ZIP. No remote push, release or installed-extension change.
The subsequent Combined Full width change replaces this unpublished package;
see `2026-10-18-combined-full-width.md` for final v0.1.35 package verification.
