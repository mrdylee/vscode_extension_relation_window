# Bilingual User Manual Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. Use subagents only when explicitly requested. Track completion here and in work state.

**Goal:** Make Korean and English offline manuals easy to find and follow, especially Settings.

**Architecture:** Existing Markdown preview plus two bundled files. Three commands share a small locale-aware opener in activation; the existing Help message stays unchanged.

**Tech Stack:** TypeScript, VS Code Markdown preview, Markdown, existing native and browser tests.

### 1. Help entry points

- [x] Extend `test/extension.test.ts` to require both explicit help commands and open both preview files while preserving Relation state. Run `npm run test:extension` and observe the missing-command failure.
- [x] Update the browser Help locator to `Help · 사용법`; run `npm run test:ui` and observe the missing-button failure.
- [x] In `src/extension.ts`, choose `USER_GUIDE.ko.md` for `/^ko(?:-|$)/i` and `USER_GUIDE.md` otherwise. Register `dynsight.help`, `dynsight.helpKorean`, `dynsight.helpEnglish`; list explicit commands in `package.json`. Add both command links to the first visible Settings description.
- [x] Change toolbar label/title and add a scoped theme-aware `.user-guide` border/font rule in `webview/styles.css`.

### 2. Manuals

- [x] Prepend English task links, quick start and settings recipes to `USER_GUIDE.md`; retain detailed reference and icon image.
- [x] Add `USER_GUIDE.ko.md` with Korean steps, UI labels, settings table covering every visible setting, JSON examples, slots/undo, symbol image, build/diagnostic/update instructions. Include reciprocal language links.
- [x] Add `.vscodeignore` inclusion and update README help instructions.

### 3. Verification

- [x] Run typecheck, unit tests, both browser suites and native Extension Host tests. Check default locale and explicit language preview tabs and unchanged graph state.
- [x] Validate Markdown local files/anchors and JSON snippets against actual setting keys/types. Package to a separate local manual-preview VSIX and inspect/exercise the extracted guides.
- [x] Review the final diff; record actual results and limitations without claiming publication or user installation.

## Verification notes

Native commands and both guide previews passed in actual macOS VS Code; root/follow/graph/Context/undo remained unchanged. The isolated host reports `en` even with `--locale=ko` because no Korean language pack is installed, so the default English route and explicit Korean/English routes are exercised; a real Korean-display-language default remains unverified. Browser Markdown render checks are representative layout checks, not screenshots of VS Code native Markdown. Final results are recorded in `docs/reviews/2026-10-29-bilingual-user-manual.md`.
