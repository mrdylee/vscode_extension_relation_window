# Compact Function Icons Implementation Plan

Goal: distinguish C function declarations and definitions without increasing node size.

Design: retain 16×16 icons. Use an outlined folded document for declarations and a filled faceted cube for definitions; shape distinguishes them without relying on color. Text suffixes were rejected because they consume space. Existing dashed borders still indicate conditional/candidate/recursive states. Unknown function reference sites retain the generic function glyph. Details and accessible labels name the form explicitly.

1. Carry the analyzer's existing definition flag into GraphNode. Ownerless declaration references must be declarations; other ownerless references must not be invented definitions. Verify a graph fixture covering definitions, prototypes, callers and unknown reference sites.
2. Render compact inline SVG icons in webview/main.ts and keep their 16×16 CSS footprint. Verify declaration/definition shapes, dimensions, popup labels and existing navigation in the browser suite; visually inspect the screenshot.
3. Document the legend in USER_GUIDE.md, README.md and release notes. Package as v0.1.21, check the bundled guide and run typecheck, unit, browser and Extension Host tests.
4. Commit, push and publish through the existing cross-platform release workflow, verifying downloadable assets after CI succeeds.

Scope: presentation metadata and icons only; no parser, resolution, root selection or index behavior changes.
