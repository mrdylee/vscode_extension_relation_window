# Explicit callback candidates and Copilot progress

The reported Windows project reaches macro and static callback budgets. Disabling
those passes permits Index ready, but hides even the user's simple designated
callback registrations and does not show whether Copilot examined their calls.

## Behavior

- Preserve the user's `bbb = {.cb_preprocess = example_preprocess,
  .cb_process = example_process}` plus `ccc = &bbb; ccc->cb_process()` example.
- Independently examine raw initializer and straight-line alias facts for exact
  object/member registrations. Add a Registered candidate with evidence at the
  real call site. Keep it incomplete and keep the unresolved call; registration
  is evidence, not proof of runtime invocation. Never join merely by field name.
- Do not increase existing inference limits. Complex aliases, getter returns,
  branch-dependent receivers and unknown mutations remain unresolved.
- Copilot includes ordinary `cb()` when binding proves a function-pointer
  variable, including typedefs from later headers. Unknown names and direct
  functions are not added merely because they use call syntax.
- Show local indexing and Copilot progress independently. Each current snapshot
  has total detected sites, completed results, remaining sites (including failed
  sites), current failures, not-found and bounded-context counts. Zero remaining
  means all detected sites processed, not that every runtime target was proven.
- Keep the five-new-request limit and cache reuse. Expose a next-five button;
  never automatically spend requests to drain the entire project.
- Static analysis OFF still allows registered and Copilot candidates to be opened
  from the actual callback expression. Model/source changes invalidate progress.

## Verification

Regression tests use the recovered example and cover object collisions, alias
invalidation, unevaluated expressions, region-pressure isolation, plain pointer
binding and shadowing. Copilot tests cover seven-site batches, partial progress,
cache reuse, failure, no candidate, cancellation and model/source changes. UI
tests verify live diagnostic messages update the footer without replacing graph
controls. Build, type checking and existing relevant suites must pass. Actual
Windows and paid-model execution remain separate from local mocked checks.
