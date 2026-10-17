# 0.1.8 verification — 2026-10-17

- Added three regression tests before implementation: block extern variable shadowing, block extern function shadowing, and conditional initializer ownership. Baseline: 22 passed, 3 failed.
- After fixes: all 25 core/syntax tests and TypeScript checking passed. The original two review reproduction probes also passed.
- Extern tests cover available and missing external definitions, selection on the declaration and use, and restoration of the outer parameter before/after the nested block.
- Conditional initialization tests cover static and global definitions. Each explicit initialization has only its own target candidate; ordinary uses under unknown build conditions retain both candidates.
- Actual VS Code Extension Host integration passed, including variable filters, Context use-site preview, upper caller trees, buffer/file updates and 93-file indexing without opening editor documents.
- FreeRTOS integration passed: 655 files in 10,974 ms, no indexing failures or editor documents opened during indexing. Existing queue function and variable R/W/RW/filter checks passed. Syntax-analysis notices remain possible for unsupported compiler syntax.
- Packaged and installed c-relation-explorer-0.1.8.vsix successfully.
- Reloaded the user's VS Code window and observed C Relations v0.1.8, CONTEXT V0.1.8, the xSchedulerRunning graph, and Index ready with 655 files.
