# Verification — 0.1.21

Verified locally on macOS on 2026-10-17.

- Added a graph regression for function definitions, prototype references, a declaration root and an ownerless reference from incomplete analysis. It failed without the new graph metadata and passed after implementation.
- Type checking and all 37 unit tests passed.
- Browser UI tests passed, checking both SVG forms, 16×16 icon dimensions, accessible/popup labels and stronger light-theme colors alongside existing navigation.
- Inspected dark and light screenshots; graph cards retain their compact layout.
- The real VS Code Extension Host integration suite passed. Settings, offline Help and Relation navigation continue to work.
- Packaged v0.1.21 includes the updated offline guide and icon legend.

No parser or symbol-resolution behavior changed. Unknown function reference sites retain the generic function glyph. Windows and Linux validation runs in the tag-triggered release workflow; the user's WSL machine was not directly tested.
