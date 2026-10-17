# 0.1.18 verification — 2026-10-17

- Before implementation, Extension Host regression failed because an out-of-scope file remained indexed after setting Include.
- After implementation, typecheck and 36 unit tests pass. Actual VS Code Extension Host confirms Include/Exclude precedence, empty Include, no matches, automatic reindexing, watcher and unsaved-edit filtering, overlapping patterns and non-C filtering.
- Large-workspace test passes: 12,551 source files on disk, 2,501 indexed with Exclude; switching to Include alone still indexes exactly 2,501 files with no partial-index status. Includes overlapping patterns and 50,000 validated call sites in the original exclusion run.
- Browser regression reproduced wrong double-click target before the fix. Updated Chrome suite passes with 0/150/300 ms click delays and asserts the original symbol ID, plus existing menu, Context, keyboard and variable-access checks.
- README JSON examples parse and use registered settings. Universal v0.1.18 VSIX is built and its embedded settings/version inspected.
- Verification was local macOS with VS Code and Chrome. Windows and the user's WSL environment were not directly tested in this run. GitHub release publication is separate from committing these changes.
