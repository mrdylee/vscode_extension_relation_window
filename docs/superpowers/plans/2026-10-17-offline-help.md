# Offline Help and Settings

Approved scope: toolbar Settings and Help plus bundled offline instructions. Use VS Code native workspace settings filtered to Include/Exclude (user settings when no folder is open), and Markdown preview for USER_GUIDE.md. Expose both through the Command Palette. Keep Relation state unchanged; no permanent extra pane or onboarding notifications.

- Add browser regression for Settings/Help dispatch; observed missing-button failure before implementation.
- Register commands in extension.ts, route fixed webview messages in view.ts and add persistent toolbar buttons in webview/main.ts.
- Add English USER_GUIDE.md and package it through .vscodeignore. Link it from README.
- Verify actual native settings and Markdown preview tabs through the Extension Host, root preservation, existing browser interactions, typecheck and unit tests.
- Inspect the packaged guide and version. Commit and publish v0.1.20 using the existing cross-platform release workflow.
