# Pinned Relation Root Marker Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for inline implementation. Do not delegate. Steps use checkbox syntax for tracking.

**Goal:** Identify the existing pinned Relation root with a compact pushpin.

**Architecture:** Update a marker on the direct root title after graph rendering.
Reuse the existing lock state without rebuilding graph data or changing navigation.

**Tech Stack:** TypeScript webview, CSS, existing browser verification.

---

- [x] In `webview/main.ts`, find the direct root title after graph rendering;
  append one `.pin-marker` containing a 16-unit SVG pushpin while locked, and
  remove it when unlocked. Set/remove an accessible pinned-root description.
  Include the root name in the existing lock button's pinned tooltip.
- [x] In `webview/styles.css`, give the marker a 14-pixel fixed size and the theme
  accent color, preserving the 24-pixel title height and existing symbol icon.
- [x] Update `USER_GUIDE.md`, `CHANGELOG.md`, `package.json` and root version fields
  in `package-lock.json` to describe the marker and identify local v0.1.35.
- [x] Run `npm run typecheck` and `npm run test:ui`; expect exit 0. Inspect pinned
  dark/light and reversed-layout renders, pin removal and graph DOM preservation.
  This reversible presentation change reuses existing tests without new test files.
- [x] Review `git diff --check` and the complete diff. Build the local VSIX with
  `npm run package`, inspect its version and bundled marker, and record review
  results. Leave remote publication for a release request.
