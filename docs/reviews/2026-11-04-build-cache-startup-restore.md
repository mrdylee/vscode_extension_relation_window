# Selected build cache startup restore validation

The `analysis.md` update at `ae94a11` contains the handoff, not the implementation.
The released source opened the basic cache in the WorkspaceIndex constructor and
restored the saved build only after `workspace.ready`. A rebuilt profile cache at
analysis version 19 could therefore be blocked by an unrelated basic cache at 14.

## Applied changes

- `src/workspace.ts`: defer startup to a microtask so build initialization can be
  registered first. Discover only candidate source URIs before restoring a saved
  build. Set the initial profile without deriving or persisting an empty index.
- `src/build-service.ts`: register the initializer for saved selections, use
  `buildSourceUris`, and suppress scheduled refreshes until workspace initialization
  finishes. User refreshes await readiness; the initial refresh avoids waiting on itself.
- `WorkspaceIndex.buildSourceUris`: retain the startup inventory when restoration
  is blocked, including forced build refreshes before explicit rebuild. Release the
  fallback after usable source analysis is established.
- `restoreLegacyPolicy()`: restore inherited roots from the selected profile before
  calculating its cache key, invalidate previously computed scopes and honor an
  explicitly empty root list. Unavailable policy metadata retains fallback behavior;
  explicit user-setting mismatches still block the selected cache.
- Public rebuild, reconciliation, source events and idle waits honor the startup
  barrier and disposal. Initial cache creation invokes private `rebuildIndex()` so
  it cannot await its own startup promise.
- Callback-only settings changes use the tracked reconciliation lifecycle while
  retaining the existing source inventory. A full filesystem rediscovery initially
  caused two existing callback regressions; retaining that inventory fixes both.
- Rejected caches remain blocked through queued scope or folder changes. Those
  changes cannot implicitly replace the rejected generation before explicit rebuild.
- A valid restored source snapshot no longer counts as a constructed build view.
  Derive the selected projection using existing build-fact caches, while retaining
  the source snapshot's saved revision and generation.

`ANALYSIS_CACHE_VERSION` remains **19**. Stored format, parsing and analysis
algorithms are unchanged. No user cache is deleted or manually rewritten.

## Regression evidence

The first 21 startup regressions produced 18 failures and three passing controls
before runtime changes. Two additional controls cover unavailable saved selections
and partial build metadata. Final review added three startup/configuration cases:
two reproduced implicit overwriting of rejected caches, and one checks a queued
rebuild followed by immediate restart with the final scope fingerprint. All 26
now pass and run through `test:worker`.

The cases cover stale/damaged/missing/current basic caches; incompatible settings,
versions, manifests and records in the selected cache; missing selected caches;
blocked refresh/rebuild/immediate restart; inherited policy and explicit empty
roots; real user-setting changes; slow rebuild/scope/callback/folder requests;
disposal during discovery or metadata reads; and unselected-cache protection.

Fresh final checks passed:

- 903 unit tests.
- 122 Worker/cache/workspace tests (the existing 96 plus 26 startup cases).
- Six memory tests, build and the full TypeScript check with zero errors.
- Existing native extension integration: 32 checks in an isolated VS Code profile.

The handoff's earlier counts and untracked TypeScript errors were not assumed to
describe this checkout. The full current typecheck passes without exclusions.

## Native startup reproduction

A separate isolated VS Code extension host used actual workspace file APIs,
`workspaceState`, the current WorkspaceIndex/build service and the real Worker.
Its source files, workspace settings and cache storage were temporary test data.

1. Create a selected build cache at version 19, then place a version-14 basic
   manifest beside it. Restart restores the selected cache with zero source parses.
2. The selected source manifest remains byte-identical and its build-specific call
   target remains `first`; the unrelated basic manifest is unchanged.
3. A version-14 selected cache still requires explicit rebuild. Rebuild followed
   immediately by closure and restart restores version 19 with zero source parses
   and the same contextual call target.
4. Changing the native workspace Include setting and refreshing build metadata
   while that selected cache is rejected leaves its bytes unchanged. Only explicit
   rebuild replaces it, and the following restart accepts the new configuration.

Evidence is local under `/private/tmp/dynsight-build-startup-20261104/`, including
`red.log`, `green.log`, `protection-red.log`, `protection-green.log`, `unit-final.log`, `worker-final.log`,
`memory-final.log`, `native-startup.json`, `native-startup.log` and
`native-extension.log`. Native execution was on macOS; this is not a Windows/WSL
live-user-cache or hardware validation claim.

Implementation was completed on `codex/build-cache-startup-restore` and prepared
for release 0.1.96 after the user's deployment request. Validation used temporary
cache files and isolated extension hosts; the user's original cache files and
installed extension were not changed.
