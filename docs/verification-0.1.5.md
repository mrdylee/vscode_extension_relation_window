# 0.1.5 verification — 2026-10-17

## Reproduced failures

- Full FreeRTOS indexing in an isolated VS Code host stalled at 90 files. After 60 seconds, the diagnostic recorded 24,681 submitted analyses and 13,783 pending requests. Opening each source as a VS Code document caused document-cache eviction; the document-close handler re-opened the evicted sources to analyze them, repeating indefinitely.
- The 93-file integration regression failed before the fix with an indexing timeout.
- Selecting `prvUnlockQueue` at its declaration in queue.c returned no symbol. Tree-sitter placed the prototype with trailing `PRIVILEGED_FUNCTION` inside an ERROR node, although the function declarator and parameters remained intact.

## Fix and validation

- Read closed source files through workspace.fs; preserve open document text for unsaved edits. Indexing no longer opens editor documents.
- Recover intact function prototypes followed by an annotation macro and a semicolon. Keep parser diagnostics for unsupported syntax.
- Type checking passed; all 18 core/syntax tests passed, including the new annotated-prototype regression.
- VS Code integration passed with 93 source files, zero document opens during reindex, unsaved edits, file changes, Context, expansion, locking and ambiguous candidates.
- Full FreeRTOS integration passed: 655 files, 13,742 ms, zero C editor documents opened during indexing, no file-analysis failures. Selecting queue.c's `prvUnlockQueue` prototype produced a graph with 6 reference groups and highlighted Context code.
- Packaged and installed 0.1.5. Detailed output: test-results/freertos.json and test-results/extension.json.
- Live user window reloaded through Developer: Reload Window. Verified `C Relations v0.1.5`, `Index ready · 655개 파일`, Relation root `prvUnlockQueue`, and Context `queue.c:2499` while the main editor remained at the declaration on line 183. Dismissed the unrelated CMake kit picker without choosing a compiler or building.
