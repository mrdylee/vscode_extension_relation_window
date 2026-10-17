# 0.1.3 verification — 2026-10-17

- Reproduced both regressions before fixing: 80 candidates rendered as separate buttons; selecting an ambiguous macro left the previous graph and Context visible.
- `npm run typecheck`: passed.
- `npm test`: 17 tests passed.
- `npm run test:ui`: passed, including one-line nodes, hover/click Context, distinct syntax colors, keyboard controls, and 80 candidate definitions in a bounded selector with disambiguating paths.
- `npm run test:extension`: passed in isolated VS Code, including clearing stale graph/Context for ambiguous selections and choosing the new definition.
- Packaged and installed `local-james-black.c-relation-explorer@0.1.3`; version confirmed by VS Code CLI.
- Live user FreeRTOS window initially retained the old webview (old footer and extension restart indication). After the application reopened, the updated footer and compact toolbar were present.
- Live screenshot confirmed colored Context in `examples/cmake_example/main.c`: functions `main`, `printf`, `xTaskCreateStatic` yellow, types teal, `static` purple, variables blue, strings orange. Relation showed compact one-line `exampleTaskTCB` and `main` nodes with different variable/function icons.
- Live full-workspace indexing was still in progress; this check does not assert complete FreeRTOS indexing or completeness of all call graphs.
