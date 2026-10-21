# Explicit callback candidates and Copilot progress implementation plan

> Use superpowers:executing-plans for continuous execution. Parallel investigation
> and disjoint implementation are enabled by the current platform instructions.

**Goal:** retain inspectable simple callback registrations while making Copilot
completion and pending work visible.

**Architecture:** A pure raw-fact registration pass adds labelled candidates after
the existing bounded engine. Binding-aware Copilot collection uses all indexed
types. Controller progress flows through service diagnostics to a separate footer.

**Tech stack:** TypeScript, tree-sitter C, Node Worker, VS Code webview, tsx tests.

## Tasks

- [x] Add `test/explicit-callbacks.test.ts` first: the recovered bbb/ccc example
  must produce two registered candidates with inference evidence in static OFF
  mode. Reject foreign objects, reassigned/uncertain receivers and sizeof calls.
  Run `npx tsx --test test/explicit-callbacks.test.ts`; observe failure before
  implementing `src/explicit-callbacks.ts` and integrating analyzer/model/relations.
- [x] Add failing pointer-site tests in `test/copilot-callbacks.test.ts`; use
  `RelationIndex.resolveReference` and `layout` in `src/copilot-context.ts` after
  all files are added. Check that direct and unknown names remain excluded.
- [x] Add `test/copilot-progress.test.ts` for seven sites: first command completes
  five, leaves two, second uses five cached results and completes seven. Include
  failure and cancellation; then add total/completed/onProgress to the controller.
- [x] Add service tests for progress before a held response, snapshot invalidation
  and a bounded Continue command. Reset current counts on changes while keeping
  session request totals explicit.
- [x] Extend footer and Diagnostics with Copilot counts and the next-five action.
  Extend UI tests to dispatch diagnostics-only events and verify completion,
  remaining work, no-candidate outcomes and the command message. Add Registered
  candidate badges/evidence and static-OFF call-site navigation regression.
- [x] Run typecheck, unit tests, Worker tests and UI tests once after integration;
  independently review modified code and fix demonstrated defects. Update guide
  with limits and the distinction between Index ready and AI completion.

No publishing, paid AI request, user source upload or Windows installation is
included in these local implementation steps.


## Verification outcome (2026-10-21)

- `npm run typecheck`: passed.
- `npm test`: 338 passed, including the original bbb/ccc registration pattern,
  typed plain function-pointer calls, seven-site batching, failed/stale responses.
- Worker/cache/workspace suites with Node 22 (CI runtime): 36 passed.
- `npm run test:ui`: passed; diagnostics-only events preserve the graph, progress
  and next-five dispatch work, registered candidates show evidence and warning.
- `npm run test:extension`: passed in the installed macOS VS Code test host,
  including static-OFF registered candidate selection and target navigation.
- Independent review found pointer-storage address confusion and quadratic alias
  evidence retention. Regressions now pass; addresses retain their level and alias
  evidence is bounded to 16 steps. Actual Worker memory pressure skips this pass.
- The Node 25.9.0 small-heap Worker stress test failed on both pure HEAD and current
  bundles before the callback phase. Node 25 reported a 320 MiB heap limit for a
  128 MiB old-generation cap, placing the existing 60% guard above the OOM point.
  The corresponding Node 22 test passed on both versions. This pre-existing
  runtime-specific memory guard issue was not changed in this callback fix.
- When static analysis is OFF and the cursor already rests on an unresolved
  callback before AI results arrive, click the call again to open new candidates.
- Actual Windows corpus and live Copilot model calls were not exercised. No new
  VSIX was installed, and no commit or release was pushed.

## Follow-up: model-selection freeze (2026-10-21)

The user reports the whole VS Code window becoming unresponsive on Windows when
selecting a Copilot model. The exact remote Windows symptom was not reproduced;
local investigation isolated and corrected two concrete problems on this path:

- Selecting B while provider A ignores cancellation left `await running` pending
  indefinitely. Provider discovery, token counting, request creation and streaming
  now race a rejecting abort/60-second deadline. Checks after each await prevent
  late work from sending source or changing the new model's state. Seven new
  regressions cover ignored cancellation, late rejection and timeout responses.
- Applying cached candidates repeatedly scanned all references for every hint.
  Per-file lookups now scan references once, retain only requested locations, and
  avoid filtered-array allocation when there are no AI refs or candidate hints.
  On the same local synthetic fixture (80,000 references / 1,000 cached hints),
  synchronous application decreased from 1,019ms to 37ms with the same 1,000 results.
  A deterministic operation-count regression checks the linear scan behavior.

Validation: TypeScript passed; full unit suite 348/348 on Node 22.22.2; browser UI
suite passed; independent review found no remaining actionable issue in the two
fixes. Differential comparison of 200 mixed candidate fixtures matched the prior
result semantics. No live Copilot account request or Windows runtime validation;
no release publication or installation. These changes remain in the local branch.

## Release preparation: 0.1.55 (2026-10-21)

The user subsequently requested publication of the accumulated fixes. A fresh
independent review found two pointer-storage escape cases in the registration
fallback. Address escapes through casts and nested expressions now invalidate
the local alias; an explicit reassignment can restore tracking. Regression tests
cover the escapes without expanding the fallback to pointer-to-pointer inference.

- Final Node 22 validation: typecheck, all 350 unit tests, all 36 Worker/cache/
  workspace tests, and the browser UI suite passed.
- The four memory checks and the 12,500-file index performance check passed.
- A second reviewer found no remaining blocker in Copilot discovery, progress,
  model cancellation or cached-candidate application.
- The packaged VSIX contains 16 files and the runtime assets match the tested
  build. It passed native macOS VS Code integration in an isolated workspace,
  including static-OFF registered-candidate selection and target navigation.
  Publication follows the existing tag-triggered workflow, which requires
  Windows, macOS and Linux native VS Code and large-workspace tests to pass.

Actual user Windows source and live Copilot responses remain unverified. The
existing macro and full callback propagation limits were not raised or removed.
