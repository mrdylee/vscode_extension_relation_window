# Include and Exclude implementation

Approved behavior: include is an allow-list of workspace-relative globs; [] means all C/H files. Exclude always wins. No include matches means zero files. Settings are folder-scoped and changes automatically rebuild the index. Apply the same rules to initial discovery, watchers and unsaved buffers. Apply the 10,000-file cap after scope filtering and deduplicate overlapping patterns.

- Add failing Extension Host checks for inclusion, precedence, empty/no matches, overlapping patterns and runtime events.
- Register cRelation.include and share folder-scoped matchers in workspace.ts. Query configured include patterns, filter C/H before applying the limit, retain existing bounded scan when Include is empty.
- Add large-workspace test using Include alone after excluding 10,050 tool files in the original scenario.
- Fix the reviewed double-click regression by retaining the first click target across graph replacement; verify exact target with delayed clicks.
- Update README settings examples, precedence, WSL paths and troubleshooting. Bump runtime version to 0.1.18.
- Run typecheck, unit, browser, Extension Host and large-workspace checks, build VSIX, inspect package, commit and update repository README.
