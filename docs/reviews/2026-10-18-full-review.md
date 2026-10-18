# Full review — C Relation Explorer 0.1.40

Reviewed HEAD `2a2bf7ef4b05e7b92f19de1d8e5ef7bc7b5809f9`, whose runtime matches
release tag `v0.1.40` (`67bdefdc447b3ea08f800ddce3705e6382cb65d1`). Scope includes
analysis, macro/callback propagation, index lifecycle, Relation/Context UI,
settings, diagnostics, report privacy/actions, updater and release workflow.
This is a review record; production code is unchanged.

## Findings

### P1 — A late old file read overwrites newer Worker input

Location: `src/workspace.ts:140–146` (dispatch at 144), with the stalled follow-up
at `src/workspace.ts:181`.

`analyze()` snapshots an epoch/version before awaiting disk IO but checks those
tokens only after sending the parse request. An older background disk read can
finish after a newer buffered edit was accepted. The late old request overwrites
the Worker's raw file. The host rejects that response but keeps the newer request
ID in `rawVersions`. Every subsequent derive is stale, and `derive()` breaks
without repairing the mismatch or reporting an error.

Controlled filesystem/VS Code adapters with the actual Worker reproduced:

- Ordered reads: latest source indexed; `revision === derivedRevision`; main's
  Callees includes `new_target` inferred from `CB cb=new_target; cb();`.
- Older read finishing last: host still contains latest source, but Worker returns
  stale derives; `revision !== derivedRevision`; main shows only unresolved `cb`.
  Status stays `Index ready`, with no analysis failures. `whenIdle()` repeatedly
  retries stale requests; that method is used by tests, not ordinary selection.

Check epoch/version again after IO and before dispatch; a stale result must not
replace active Worker input. Repair or explicitly fail a persistent stale derive.
This reproduces an ordering defect; it does not establish that the user's earlier
private WSL incident had the same cause.

### P2 — Watched file additions bypass the 10,000-file limit

Location: `src/workspace.ts:125–126`, reached from the watcher at 117–123.

The limit is enforced only by `reindex()`'s initial slice. A create/change event
for a previously unindexed eligible file enters `enqueue()`/`analyze()` with no
capacity check. Using 10,001 eligible header files, initial indexing stopped at
10,000, but one watcher create event raised the live index to 10,001. The status
still reported `Partial index: 10,000 file limit reached`.

Repeated generation/changes can grow the index beyond its advertised cap and add
memory/analysis work. Apply the capacity check to new live entries while still
allowing updates to already-indexed files and replacement after deletion.

### P2 — Callers includes unevaluated sizeof calls

Location: `src/relations.ts:251`.

```c
int target(void) { return 1; }
void task(void) { (void)sizeof((target())); }
```

This C11 source passed `clang -fsyntax-only`. The analyzed/derived graph lists
`task` under target's Callers, while task's Callees is empty. The analyzer already
marks unevaluated references with absent `access`, and outgoing calls filter that
field; the incoming-call filter checks only kind. References may retain the use,
but Callers/both should exclude unevaluated call records consistently.

## Verified checks

- TypeScript check, 196 unit tests and four GC/cache lifecycle regressions pass.
- Four real Worker regressions pass, including low-heap partial analysis,
  callback retention, header changes, reset and replay.
- Native VS Code integration and browser UI suite pass. They include Context,
  pin/navigation, settings, diagnostics and the new issue-report path.
- Additional controlled probes establish the three findings above. Probe adapters
  control disk/watcher timing; Worker analysis and index code are real.
- Native FreeRTOS verification passes: 655 files, 33,771 ms initial indexing,
  caller/callee, Context, variable/member and function-argument checks. Selected
  symbols updated in 105–133 ms. Existing loop/mutation/time budget notices remain;
  passing these checks does not mean every possible callback was inferred.
- Native large-workspace verification passes: 12,551 source candidates, 2,501
  included files, 50,000 calls; 4,327 ms indexing and 101 ms selection response.

## Observations not promoted to findings

- Deeply nested input can trigger recursion errors before explicit `tree.delete()`.
  The installed web-tree-sitter 0.27.1 has a Tree `FinalizationRegistry` that frees
  the native tree on GC, so skipped explicit deletion alone does not prove a
  permanent leak. No permanent-leak claim is made.
- Argument aliases are omitted when pointer analysis takes its lightweight path;
  the bundled guide explicitly documents this limit (lines 165–169).
- No additional report-data disclosure or automatic issue submission was found.
  Real WSL clipboard/update installation was not executed here.

Ignored reproduction/evidence files:
`output/review/{full-review-probes.ts,workspace-probes.mjs,workspace-ordered.mjs,workspace-limit.mjs}`
and `test-results/full-review-*`.
