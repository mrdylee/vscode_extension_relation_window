# Smart Analysis AI Providers Implementation Plan

> **For agentic workers:** Execute inline with superpowers:executing-plans. No delegated work requested.

**Goal:** Support Copilot, Claude Code and Codex login accounts in Smart callback analysis.

**Architecture:** Keep the existing callback controller and add a bounded CLI provider adapter. Add provider settings and generic commands while preserving legacy Copilot settings and command IDs.

**Tech Stack:** TypeScript, Node child processes, VS Code configuration/LM API, node:test.

1. Add failing `test/cli-callback-provider.test.ts` process-fixture cases for Claude JSON and Codex JSONL, stdin/argument separation, cancellation, timeout, bounded output, missing executable and failure. Run `npx tsx --test test/cli-callback-provider.test.ts` before implementing `src/cli-callback-provider.ts`.
2. Extend `test/copilot-service.test.ts` with an external adapter seam to assert CLI routing without Copilot discovery, new enable-flag precedence, trust, provider cache separation and cancellation on provider/model changes. Run focused tests before editing `src/copilot-service.ts`.
3. Add machine executable paths and provider/model/enable settings to `package.json`; preserve legacy values and command aliases. Add the adapter, wire shared controller scheduling and errors, then rerun focused tests and typecheck.
4. Update `src/diagnostics.ts`, shared webview labels/progress and callback reasons to name the selected provider or use AI candidate. Extend browser assertions, and update README and both bundled user guides with CLI login, WSL host location, model selection and stop/resume instructions.
5. Run `npm test`, `npm run typecheck`, `npm run test:ui`, build and appropriate host checks. Inspect the final diff and preserve pre-existing WSL investigation files. Record verified results and live-account limitations; leave changes local.
