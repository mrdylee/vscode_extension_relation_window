# Actual RBMS partial-index completion

The user explicitly authorized fixing, verification and deployment, then clarified that the actual RBMS partial index must be resolved. The previous release is not acceptance evidence: native 0.1.91 still reports limits on 147 files, and selecting `Build_RBMS.bat` incorrectly presents an empty index as ready.

Acceptance: preserve the same 147 source files and settings; complete local analysis without limit notices, both without a build and with the actual RBMS BAT selected. Keep uncertainty from unavailable headers/compiler/generators visible. No firmware, generator or AI execution. Verify source and packaged extension in native VS Code before publication.

1. Reproduce partial header guards and incomplete-build coverage with failing maintained regressions. Fix header timeline handling without dropping unguarded postlude directives; retain detailed source fallback when there are no usable build contexts.
2. Replay all actual sources with fresh parsing. Profile remaining callback work/storage costs; add minimal reproductions before changing algorithms or measured resource bounds. Preserve cancellation, memory limits and conservative unknown effects.
3. Run unit, Worker, memory, performance and UI checks appropriate to the final changes. Review correctness and cache compatibility. Verify actual native workspace and extracted VSIX, including warm/rebuild behavior and zero AI requests.
4. Publish a new patch only after actual-project acceptance. Verify CI/public assets/updater; install the verified extension for the user's active environment and confirm its version and project result where supported.

Use the current isolated `codex/rbms-partial-index-completion` branch. Track progress/evidence in claude-mem work state. Do not mark this plan complete merely because the automated suite passes.
