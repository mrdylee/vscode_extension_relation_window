# Optional Markdown preview for Dynsight Help

Implemented the approved single setting: `dynsight.markdownPreview` defaults to `disabled` (read-only text), with `enhanced` as the optional Markdown Preview Enhanced renderer. The setting links to the exact native extension pages for disabling built-in Markdown Language Features in the workspace and installing/enabling Enhanced. Actual extension enablement remains a manual VS Code action, as agreed.

Help now reads only the two bundled guides through a read-only `dynsight-guide:/*.txt` content provider. This avoids `onLanguage:markdown` activation even when preview is off. Existing localized commands and Relation state are preserved. Missing or failed Enhanced previews retain a readable text guide; no automatic installation or built-in preview fallback was added.

The real Enhanced 0.8.40 command uses `activeTextEditor.document` even when passed a source URI. Initial integration testing reproduced a missing Korean preview after opening English. The adapter now focuses the matching text guide before invoking the preview command, with a regression assertion for that order. Enhanced independently activates on `onStartupFinished`; its own startup activation is not controlled by Dynsight's preference.

## Verification

- Before implementation, the native Help regression failed because the original command opened a Markdown webview instead of the required text document. The active-editor regression also failed before its correction.
- Final adapter tests: **10/10 passed**. Full unit suite: **832/832 passed**. Typecheck and `git diff --check` passed.
- Actual isolated macOS VS Code integration passed from source and again from the extracted final VSIX. Default and Korean/English Help opened plaintext, kept documents clean, preserved Relation state, and left the enabled built-in Markdown extension inactive.
- Actual installed Markdown Preview Enhanced **0.8.40**, linked into an isolated test profile, passed from source and extracted final VSIX: default text, English preview, Korean preview, return to text, and both native extension-management commands. Built-in Markdown was disabled for these Enhanced-specific tests.
- Final local VSIX: `artifacts/markdown-preview-setting/dynsight-markdown-preview.vsix`, **760396 bytes**, **18 archive entries** (16 extension files), SHA-256 `8b95718f19b00d3cf1b0f8757757405ec9a5602c139b4c864a7198430dfceb65`.
- Packaged runtime, manifest and offline guides match source/build bytes. VSCE's expected LICENSE rename and README link rewriting were accounted for; the new README instructions are present.

Evidence is retained under `artifacts/markdown-preview-setting/`: `native-red.log`, `unit-active-editor-red.log`, `unit-final.log`, `native-green.log`, `enhanced-smoke-final.log`, `packaged-native.log`, `packaged-enhanced.log`, `packaged-enhanced-result.json`, and `package-result.json`.

## Delivery boundary

This is a local implementation and preview package, retaining the current 0.1.89 manifest version. No public release, push, or installation into the user's active VS Code profile was performed. The user's workspace and other extensions' enablement were not changed by these tests. Large-workspace Enhanced memory performance and Windows/WSL runtime behavior were not tested; this feature does not establish that every Ctrl+T or memory problem is resolved.
