# Markdown Preview Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. No subagents requested.

**Goal:** Add one opt-in Markdown Preview Enhanced setting, safe default Help, and a native built-in Markdown disable guide.

**Architecture:** A small `src/markdown-preview.ts` adapter owns guide routing, a read-only plaintext content provider, and the two native extension-management links. `src/extension.ts` registers it and preserves existing localized Help commands. No automatic modification of other extensions, no built-in Markdown preview fallback, and no runtime dependency added.

**Tech Stack:** TypeScript, VS Code public API, esbuild, node:test, existing isolated Extension Host test runner.

## 1. Reproduce the unsafe default in a native regression

Files: `test/extension.test.ts`.

- Replace default Help webview expectation with an active `TabInputText` URI using scheme `dynsight-guide` and a `.txt` suffix.
- Assert `languageId === 'plaintext'`, no dirty document, guide text present, and built-in Markdown extension still inactive after default and Korean/English Help.
- Preserve existing Relation root/state checks.
- Run `npm run test:extension` against current implementation; expect failure because Help opens the built-in Markdown webview.

## 2. Implement routing and test failure/cancellation boundaries

Files: `src/markdown-preview.ts`, `src/extension.ts`, `test/markdown-preview.test.ts`, `package.json`.

- Add `dynsight.markdownPreview`: window-scoped enum `disabled` (default) / `enhanced`, order 80, native descriptions that explicitly distinguish Dynsight preview choice from extension enablement.
- Return `openGuide(language)` from `registerMarkdownPreview(context)` and replace the current `markdown.showPreview` closure in `extension.ts`.
- Register a `dynsight-guide` content provider whose `.txt` paths map only to the two bundled guides. Read packaged content through `workspace.fs` and display via `showTextDocument` with preview reuse.
- Enhanced routing activates `shd101wyy.markdown-preview-enhanced` only after selection, focuses the matching read-only text guide, then calls `markdown-preview-enhanced.openPreview` with the bundled guide URI. The installed Enhanced command also reads `activeTextEditor.document`, so the source editor must match the requested guide. Recheck the selected preference after asynchronous activation and document opening so switching back cannot open a late preview.
- Missing/disabled Enhanced: offer `Open Extension`; use documented `workbench.extensions.search` with its exact ID. Do not silently install or use another preview provider. Display the plain guide on cancellation/failure.
- Register `dynsight.manageBuiltinMarkdown` and `dynsight.manageMarkdownPreviewEnhanced`; open narrowly targeted native extension searches. The built-in guide explains Disable (Workspace), Restart Extensions when needed, and retaining Markdown Language Basics.
- Adapter tests substitute only VS Code APIs and exercise actual routing, two languages, no activation in default mode, URI-only provider access, Enhanced missing/failed/cancelled cases, and preference changes during activation. Include the test in `npm test`.

## 3. Document, validate and package

Files: `README.md`, `USER_GUIDE.md`, `USER_GUIDE.ko.md`, native smoke artifacts.

- Document the one dropdown and real one-time manual disable requirement, plus installation/enablement through the native page and unchanged Ctrl+T ownership.
- Run adapter tests, `npm run typecheck`, `npm test`, and `npm run test:extension`.
- Use an isolated profile with the installed MPE 0.8.40 linked only into the scratch extensions directory to verify its actual preview command accepts the guide URI with built-in Markdown disabled; no change to the user's profile.
- Build and package a clearly named local preview VSIX, inspect packaged settings/runtime/docs, and review diff for unrelated changes. Do not publish or install into the user's active VS Code as part of this request.
- Record validation and limits; current large-workspace MPE memory performance remains outside this feature's verification.
