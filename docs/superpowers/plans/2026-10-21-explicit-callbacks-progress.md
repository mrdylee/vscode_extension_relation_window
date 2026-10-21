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

- [ ] Add `test/explicit-callbacks.test.ts` first: the recovered bbb/ccc example
  must produce two registered candidates with inference evidence in static OFF
  mode. Reject foreign objects, reassigned/uncertain receivers and sizeof calls.
  Run `npx tsx --test test/explicit-callbacks.test.ts`; observe failure before
  implementing `src/explicit-callbacks.ts` and integrating analyzer/model/relations.
- [ ] Add failing pointer-site tests in `test/copilot-callbacks.test.ts`; use
  `RelationIndex.resolveReference` and `layout` in `src/copilot-context.ts` after
  all files are added. Check that direct and unknown names remain excluded.
- [ ] Add `test/copilot-progress.test.ts` for seven sites: first command completes
  five, leaves two, second uses five cached results and completes seven. Include
  failure and cancellation; then add total/completed/onProgress to the controller.
- [ ] Add service tests for progress before a held response, snapshot invalidation
  and a bounded Continue command. Reset current counts on changes while keeping
  session request totals explicit.
- [ ] Extend footer and Diagnostics with Copilot counts and the next-five action.
  Extend UI tests to dispatch diagnostics-only events and verify completion,
  remaining work, no-candidate outcomes and the command message. Add Registered
  candidate badges/evidence and static-OFF call-site navigation regression.
- [ ] Run typecheck, unit tests, Worker tests and UI tests once after integration;
  independently review modified code and fix demonstrated defects. Update guide
  with limits and the distinction between Index ready and AI completion.

No publishing, paid AI request, user source upload or Windows installation is
included in these local implementation steps.
