# Verification — 0.1.24

- Applied the approved original-style icon sheet: rounded ƒ, outlined declarations, filled definitions, existing v/T/#/? glyphs and separate dashed special states.
- Type checking and browser UI tests passed. Checks cover 16×16 dimensions, function glyph/fill distinction, visible dashed borders on filled functions, popup labels, light-theme colors and existing navigation/500 ms hover behavior.
- Inspected dark/light Relation screenshots and the complete English Help legend image.
- Real VS Code Extension Host checks passed with the development checkout and again with the packaged VSIX extracted to a temporary extension directory. Help opened, the guide referenced the icon image, and the packaged image had a valid PNG signature.
- The VSIX reported version 0.1.24 and contained USER_GUIDE.md and media/symbol-icons.png. `git diff --check` passed.

Local validation used macOS; platform release CI runs Windows, macOS and Linux. The user's WSL machine was not directly tested. Parser and relation-resolution behavior were not changed.
