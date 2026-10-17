# Relation Interaction Implementation Plan

**Goal:** Keep menus usable during indexing and expand clicked nodes by selected depth.
**Architecture:** Persistent webview toolbar controls; one selectNode host message using current graph nodes and existing expansion overrides.
**Tech Stack:** TypeScript, VS Code Extension Host, Playwright.

- [x] Add a failing browser regression for an open Depth selector receiving repeated index messages. Confirm failure before changing rendering.
- [x] Keep toolbar controls mounted; preserve candidate options when unchanged. Browser regression passes.
- [x] Add host regression with control_task -> main -> launch chain. At depth 1 click control_task and expect main only; at depth 2 expect main -> launch. Preserve root/editor and preview control_task. Confirm failure before implementation.
- [x] Send selectNode with node key from webview. Validate key, derive preview ID, retain at least the selected depth and any existing expansion, then refresh once.
- [x] Extend browser regressions for mode/definition menus and node-click dispatch. Run npm run typecheck, npm test, npm run test:ui, npm run test:extension.
- [x] Update README, changelog and version; build installable VSIX. Review diff and record verification.
