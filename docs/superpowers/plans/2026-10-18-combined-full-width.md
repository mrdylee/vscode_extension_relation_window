# Combined Full Width Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for inline implementation. Do not delegate. Steps use checkbox syntax for tracking.

**Goal:** Let VSIX users select a clearly described full-width combined view in Settings.

**Architecture:** Reuse the combined webview and extend its layout preference.
Apply native VS Code layout commands on layout changes and main-view resolution.

**Tech Stack:** TypeScript, VS Code configuration and commands, existing UI/native checks.

---

- [x] Extend `package.json` Context Layout enum/labels/descriptions with
  `combined-full-width`. Add the value to `src/view-state.ts` and preserve it in
  `src/view.ts` preference loading. Keep default Combined and Separate visibility.
- [x] In `RelationView`, apply native Bottom then Justify commands when entering
  or resolving full width. After Bottom, recheck the active layout before Justify.
  On leaving full width apply Center. Catch command failures visibly. Do not
  reapply alignment for sorting/direction/argument-setting or index-only changes.
- [x] Update `README.md`, `USER_GUIDE.md` and the unpublished 0.1.35 changelog
  with the three choices and the shared Terminal/Panel effect.
- [x] Run typecheck/build, browser checks and native Extension Host checks.
  Inspect the full-width mode in native Settings and verify actual Panel placement
  and alignment with an isolated VS Code profile. Check pin and graph preservation.
- [x] Review the diff, regenerate and inspect the local v0.1.35 VSIX, update review
  evidence and leave remote publication untouched.
