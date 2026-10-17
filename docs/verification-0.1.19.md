# 0.1.19 verification — 2026-10-17

- Added the mixed brace/comma Include regression to the actual Extension Host suite and observed it fail before the fix.
- After independent pattern searches and URI deduplication, typecheck, 36 unit tests, Chrome UI checks and macOS Extension Host checks pass.
- Regression checks cover App/**/*.{c,h} combined with control.c and overlapping App/**, literal App,Main/**, and identical membership after a watcher update and full rebuild.
- Large-workspace suite passes with 12,551 source files and 2,501 indexed files, including overlapping Include-only patterns and the original Exclude case with 50,000 call sites.
- Local VSIX package version is inspected. Tagged release workflow additionally runs Windows/macOS/Ubuntu checks before publishing the platform-labelled universal packages.
- The user's WSL environment is not directly tested by these local checks.
