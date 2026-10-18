# Settings Layout Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. No subagents requested.

**Goal:** Centralize preferences in Settings and make dual graph sides configurable.
**Architecture:** One window-scoped direction setting travels through ViewState.
The renderer chooses branch placement/mirroring without changing index data.
**Tech Stack:** TypeScript, VS Code Settings, Webview, Playwright.

- [x] Add failing browser assertions for Settings-only menu choices and reversible
  root/child geometry, and native Host assertions for the default direction.
- [x] Add callGraphDirection schema/state/listener; open all extension settings.
  Move Separate-view reveal to the configuration listener. Remove obsolete direct
  menu-setting messages and expose Settings/Reset in the context menu.
- [x] Reorder/mirror branches from the preference and include it in the rendering
  signature; preserve graph identity/expansion and left-align the complete graph
  without root centering or viewport-width padding, including after side swaps.
- [x] Update native tests to change workspace settings, test no graph query on a
  direction change, and verify split Context still opens through Settings changes.
- [x] Run unit/type/UI/Host checks, review the diff and fixes, update Help/README,
  bump to 0.1.30 and package a locally validated VSIX. Commit and checkpoint locally.
