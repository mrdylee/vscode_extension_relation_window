# Dynsight Panel Icon Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for inline execution. Steps use checkbox syntax.

**Goal:** Give the existing Dynsight panel tab a recognizable D and call-graph mark.

**Architecture:** Replace only `media/relation.svg`; reuse the existing panel-container manifest reference. Keep the SVG monochrome, transparent and 24×24.

**Tech Stack:** SVG, existing VS Code view contribution, existing build/typecheck and local browser rendering tools.

---

### Task 1: Replace and inspect the asset

- [ ] Save the current asset in ignored local artifacts for comparison.
- [ ] Replace the outlined boxes with a D path `M4.5 3.5H10a8.5 8.5 0 0 1 0 17H4.5Z`, stroke width 1.75 and rounded joins.
- [ ] Connect filled circles at (7.75,12), (13.75,8) and (13.75,16), radius 1.5; use the same stroke width and currentColor.
- [ ] Render before/after at 16px and 24px on light, dark and high-contrast backgrounds; inspect the screenshot and correct clipping or illegibility.

### Task 2: Verify and integrate

- [ ] Run `npm run build` and `npm run typecheck`; expect exit 0.
- [ ] Package to an ignored preview VSIX with an explicit output filename; verify that `extension/media/relation.svg` matches the source and the manifest still references it.
- [ ] Run `git diff --check` and review the asset-only product diff. Do not add automated tests that mirror SVG coordinates.
- [ ] Commit and push the completed change on main; confirm remote/local HEAD agreement and a clean tree. No new version, release tag or public release is part of this request.
