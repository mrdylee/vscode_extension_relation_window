# Bilingual in-extension user manual

The user requests separate Korean and English manuals that make settings easy to understand and help easy to notice. Reuse VS Code's offline Markdown preview and the existing Help message; avoid a separate renderer or onboarding notifications.

Keep `USER_GUIDE.md` as the English detailed reference, prepend an approachable quick start, settings recipes, and task navigation. Add `USER_GUIDE.ko.md` with equivalent everyday instructions, every visible setting, navigation/slots/undo, build context, diagnostics, and updates. Both begin with visible language links. Use actual English UI labels in Korean instructions. Explain that empty general Include means all indexed C/H candidates while empty Smart Analysis Include disables extra analysis, and that saved Exclude replaces defaults.

The toolbar displays `Help · 사용법` with a theme-aware accent border and bold text. Help chooses Korean for VS Code language `ko` or `ko-*`, otherwise English. Explicit commands `dynsight.helpKorean` and `dynsight.helpEnglish` always open the requested guide. The top Settings entry links to both commands. Switching language must preserve graph root, follow state, selection and expansion; no analysis settings change.

Package both guides and existing images. Keep package version unchanged and do not publish or install. Verify native preview entry points in both languages, toolbar dispatch including narrow views, Markdown links and settings examples, typecheck, existing tests, and extracted VSIX contents.
