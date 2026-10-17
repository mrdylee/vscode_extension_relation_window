# Verification — 0.1.20

Verified locally on macOS on 2026-10-17.

- Before implementation, the UI test failed because the Settings toolbar button was missing.
- Type checking and all 36 unit tests passed after implementation.
- The browser UI suite passed, including Settings/Help message dispatch and existing relation navigation interactions.
- The VS Code Extension Development Host integration suite passed. Help opened the rendered bundled Markdown guide, Settings opened the native settings editor, and both retained the Relation root.
- The packaged VSIX contained `extension/USER_GUIDE.md` and reported version `0.1.20`. Both JSON examples in the guide parsed successfully.
- The VSIX was extracted into a temporary directory and used as the extension path for the same Extension Host suite; it passed, confirming the guide is accessible from the packaged extension.
- The toolbar layout was inspected in the browser screenshot. `git diff --check` passed.

The user's WSL machine was not directly tested. The tag-triggered release workflow runs the existing unit, performance, Extension Host and large-workspace checks on Windows, macOS and Linux before publishing downloads.
