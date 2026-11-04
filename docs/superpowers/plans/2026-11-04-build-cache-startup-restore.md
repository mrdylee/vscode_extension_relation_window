# Selected Build Cache Startup Restore Implementation Plan

> **For agentic workers:** REQUIRED EXECUTION SKILL: Use superpowers:executing-plans for continuous inline implementation. Use subagents only when explicitly requested. Steps use checkbox syntax for tracking.

**Goal:** Apply the startup, policy and concurrency requirements in `analysis.md` while retaining analysis cache version 19 and explicit rebuild protection.

**Architecture:** Defer WorkspaceIndex startup until synchronous service registration finishes. Let a selected build register a startup initializer that uses discovered source URIs before the first cache compatibility check. Keep those URIs available while restoration is blocked, restore inherited policy from the selected manifest, and serialize user requests behind workspace readiness. Reuse raw cache records while reconstructing the selected build view.

**Tech Stack:** TypeScript, esbuild, Node test runner, real analysis Worker and temporary on-disk caches.

## Files and interfaces

- `src/workspace.ts`: startup initializer, candidate URI retention, selected legacy policy restoration, startup barriers and contextual view restoration.
- `src/build-service.ts`: register selected-build initialization; use candidate URIs; suppress premature scheduled refreshes and await readiness for user refreshes.
- `test/build-startup-cache.test.mjs`: isolated VS Code adapter with real workspace/build services and Workers; persistent restart fixtures.
- `test/build-service.test.ts`: keep the existing service adapter consistent with the workspace interface.
- `package.json`: include the new integration tests in `test:worker`.
- `docs/reviews/2026-11-04-build-cache-startup-restore.md`: actual implementation, verification and remaining limits.

The workspace exposes `setBuildInitializer(initialize: () => Promise<void>): void`
and `buildSourceUris: string[]`. Constructor startup runs on a microtask after the
initializer can be registered. `setBuildProfile()` during that initialization sets
the profile without opening a cache or deriving empty facts. The existing reindex
body becomes private `rebuildIndex()` so startup can invoke it without awaiting
its own `ready` promise; public `reindex()` awaits readiness and checks disposal.

## Task 1: Reproduce startup failures with real caches

- [x] Seed caches through ordinary indexing and build selection, then close the Worker.
- [x] Restart with a selected build and default manifests that are version 14, missing or damaged. Require `cache.state === 'restored'`, zero `sourceParses`, unchanged source manifest generation and contextual references selecting the build's target.
- [x] Change only the selected manifest's version/key or damage its manifest/record. Require rebuild status and identical persisted bytes before explicit `reindex()`.
- [x] Remove the selected cache and require initial creation under `analysis-cache/profiles/<id>`.
- [x] Delay metadata/discovery to cover queued rebuild, scope/callback/folder changes and disposal. Check that no basic-cache work or post-disposal writes occur.
- [x] Cover retained source candidates after blocked restoration and legacy policy metadata, including explicit empty roots and real user-setting mismatches.
- [x] Run `npm run build` then `node --test test/build-startup-cache.test.mjs`; record failing cases before runtime edits.

## Task 2: Restore the selected cache before compatibility checks

- [x] Implement the initializer and URI retention in `WorkspaceIndex`; perform source discovery only when a selected build requests it.
- [x] Register the initializer only for a saved build in `registerBuildConfigurations()`. Initial refresh bypasses the readiness barrier; later refreshes await it.
- [x] Read selected-cache inherited policy before calculating `analysisKey`, clearing cached scopes when restored policy changes. Keep existing fallback policy on unavailable metadata; honor explicit empty roots.
- [x] Preserve inherited policy and version checks for unselected workspaces. Keep `ANALYSIS_CACHE_VERSION === 19`.
- [x] Run the selected-cache restart cases and existing workspace/cache tests.

## Task 3: Serialize startup work and reconstruct the build view

- [x] Make public rebuild, scope reconciliation and callback updates await startup; use private startup rebuild calls to avoid self-deadlock.
- [x] Defer source events and idle waits until startup completes; stop queued work after disposal.
- [x] Retain candidate URIs while the source index is empty and cache restoration is blocked. Release the fallback after usable source indexing.
- [x] Suppress automatic build refresh scheduling until initialization finishes.
- [x] Preserve rejection through scope/folder changes until explicit rebuild;
  verify the final fingerprint after a combined queued scope change and rebuild.
- [x] Reconstruct a selected build view after raw cache restore even when raw relationships validate. Preserve the valid source generation through `savedRevision`.
- [x] Run all new startup cases and the existing Worker/cache/workspace suite.

## Task 4: Verify the completed change

- [x] Run typecheck, the complete unit suite, `test:worker` and memory tests.
- [x] Run isolated native extension integration and validate unchanged cache compatibility.
- [x] Review the diff against every `analysis.md` requirement; record observed results rather than inheriting its reported test counts.
- [x] Keep source changes on the task branch; publication is outside this application request.
