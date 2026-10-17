# 0.1.7 verification — 2026-10-17

- Four new analyzer/index regression cases failed before implementation; all 22 core/syntax tests passed afterward.
- Variable coverage: explicit initialization, reads, direct and compound assignments, increments/decrements, parenthesized identifiers, address-taking, scope/shadowing, extern definition lookup, inactive branches, pointer reads and unevaluated sizeof operands.
- Read and write filters include RW; RW and address filters select only their own kinds. Variable use functions continue into their caller tree.
- TypeScript checking passed.
- Browser checks passed with compact variable badges, distinct R/W/RW/address colors in dark/light themes, filter changes, exact first-site click preview, second-site popup preview and preserved function mode. Existing one-second stationary hover and function/Context interactions passed.
- Actual isolated VS Code Extension Host checks passed: variable selection, filters, upper caller tree, use-site Context preview without moving the editor, invalid filter rejection and reset after filtering away the selected site. Existing 93-file indexing, buffer and file-change checks passed.
- Full FreeRTOS: 655 C/header files indexed in 11,942 ms; zero file-analysis failures and zero editor documents opened during indexing. Parser syntax notices remain visible for unsupported/compiler-specific syntax.
- FreeRTOS `prvUnlockQueue` retained six reference groups. `uxCurrentNumberOfTasks` produced read/write/readwrite sites; its read filter included `uxTaskGetNumberOfTasks`, while its write filter excluded that function.
- Packaged and installed 0.1.7 VSIX successfully. Reloaded the user's VS Code window and observed `C Relations v0.1.7`, `CONTEXT V0.1.7`, and `Index ready · 655개 파일`.
- In the installed extension, selecting tasks.c:505:45 showed variable `uxCurrentNumberOfTasks`, the variable-access selector and R/W/RW badges on its using functions.
- Browser preview: `output/playwright/variable-access.png`.

Limitations: syntactic access classification only; no pointer alias propagation, structure-member or array-element write tracking, macro expansion, or runtime branch selection. sizeof operands are excluded, including VLA evaluation exceptions.
