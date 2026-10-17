# 0.1.17 verification — 2026-10-17

- Reproduced the menu bug before fixing: opening Depth then dispatching five index-progress messages removed the select and lost focus; browser assertion failed.
- Confirmed click-expansion regression fails before adding selectNode handling in the actual VS Code Extension Host.
- After changes: TypeScript check, all 36 unit tests, Chrome browser UI suite, and macOS VS Code Extension Host integration suite pass.
- Browser coverage: Depth 2–5 after progress updates, relation-mode focus across graph update, definition chooser focus across unchanged candidate refresh, node click dispatch and double-click source opening, existing hover/context/access-filter/keyboard checks.
- Host coverage: clicking control_task at depth 1 reveals main; depth 2 reveals main -> launch. Root, main-editor position and Context target are correct. Repeated clicks retain the same graph.
- Built universal artifacts/c-relation-explorer-0.1.17.vsix; inspected embedded package version and webview message handler.
- This run used macOS and Chrome; the user's WSL session was not directly tested. No new GitHub release is published by these local checks.
