# Bilingual manual verification

Scope: the user's request for separate Korean and English in-extension manuals, easy settings instructions and prominent access. Base `6410004`; local branch `codex/bilingual-user-manual`. No version bump, publication, push or user installation.

## Result

- Reused offline Markdown preview with `Help · 사용법`, a theme-aware accent border and explicit Korean/English commands. Default command selects the file from VS Code's display language.
- Added Korean instructions and an approachable English entry section with task navigation, quick start, folder selection recipes, all 13 visible settings/defaults, examples and troubleshooting. Existing English detailed reference remains intact.
- Added both language links to the first visible Settings description. Packaged Korean guide alongside English and the existing icon legend.
- Reviewed changes against the request and supplied simplicity/surgical-change instructions. No unrelated analysis or navigation behavior changes. Narrow settings tables and Korean bold rendering problems found during layout checks were corrected.

## Verification

- Before implementation, native integration failed on missing `dynsight.helpKorean`; browser integration failed on missing `Help · 사용법`.
- Typecheck and all **772 unit tests** passed.
- Both existing browser UI suites passed, including Help dispatch and its visibility at 520px toolbar width.
- Actual macOS Extension Host passed: both explicit language commands render their requested file; language selection preserves graph/root, follow state, Context and undo state. The default route opens the file matching the host's reported language.
- Validated **31 local document/image links**, **6 JSON examples**, and coverage of all **13 visible settings** in both guides against the manifest.
- Representative Markdown browser renders checked in light/dark themes at 1100px and 520px: no document overflow or unrendered bold markers. These are layout previews rather than native VS Code screenshots. Images: `output/manual-preview/`.
- Final local VSIX: **18 entries**, **750215 bytes**, SHA-256 `9d4ba73406c77a21b7a754e8661b445b32b6bb0ac270c63b9750bea92dea20ed`. Both guide files, icon image, manifest and changed built runtime entries match source/build. Final extracted package tested with actual macOS Extension Host.
- `git diff --check` passed.

The isolated host reports language `en` even when launched with `--locale=ko`, because it has no Korean language pack. Explicit Korean preview is verified; a real Korean display-language default is not exercised. Windows/Linux native hosts and clicking the new Settings Markdown links were not exercised locally; command registration and direct execution passed. No remote language resource is required for reading either bundled guide.

Logs: `/tmp/dynsight-manual-unit.log`, `/tmp/dynsight-manual-typecheck.log`, `/tmp/dynsight-manual-ui.log`, `/tmp/dynsight-manual-native.log`, `/tmp/dynsight-manual-native-ko-final.log`, `/tmp/dynsight-manual-doc-check.log`, `/tmp/dynsight-manual-package.log`.
