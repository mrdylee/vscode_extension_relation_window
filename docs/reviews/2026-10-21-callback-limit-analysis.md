# Analyze Callbacks ON: limit-scope investigation

2026-10-21. Checkout `011cf7f` (runtime is 0.1.58). Analyze Callbacks stayed ON
for every experiment. No analyzer code or limit was changed.

## Evidence and boundaries

The user screenshot shows 196 indexed files, Copilot off, and callback region
and mutation limits of 256. It does not establish an OOM or crash. The affected
WSL source corpus is not present here; the experiments below reproduce engine
behavior using generated C, not the exact user incident.

Run from the repository root:

```sh
npx tsx docs/reviews/2026-10-21-callback-limit-repro.ts
```

Every case uses the same callback chain: designated initializer -> getter
returning the table address -> init argument -> saved global pointer -> member
call. Additional code operates on a distinct global structure containing only
integer status fields. All eight inputs parse without syntax notices.

| Additional code | Warning | Original callback result |
| --- | --- | --- |
| None | None | target inferred, incomplete=false |
| Write 270 unread integer fields | None | target inferred, incomplete=false |
| Write the same fields and read them in a logger | mutation limit | target inferred, incomplete=false |
| Pass 255 separate integer-field addresses to an unknown function | None | target inferred, incomplete=false |
| Pass 256 field addresses | None | target inferred, incomplete=false |
| Pass 257 field addresses | region limit | target retained but incomplete=true; extra unresolved active->cb edge |
| Pass 270 field addresses | region limit | same unnecessary uncertainty on the independent callback |
| Pass the parent address first, then 270 field addresses | region limit | same uncertainty; overlapping regions still consume entries |

Individual local synthetic runs took approximately 1–49 ms; these are not
performance predictions for the user's 196-file project.

## Traced causes

1. `src/pointer-targets.ts`, `collectReads` / `summarize`: scalar exclusion only
   removes proven write-only declarations. A read for logging is sufficient to
   keep a field in the exported effect summary. Member names are also retained
   across the project for compatible declarations across files. These rules are
   conservative; they do not determine whether the scalar influences a callback
   receiver, function pointer, array selector or condition.
2. `markRegion` and `invalidate` count storage paths. A single structure's
   separately addressed scalar fields can consume 257 entries. This is not a
   count of 257 callback functions. Parent and child paths are retained separately;
   the tested parent-covered case still reaches the limit.
3. `notice` makes `projectIncomplete=true` for any notice except mutation limits.
   Region-limit diagnostics therefore affect every inferred call in this derive
   invocation. Result construction ORs that flag into each call's incomplete
   state and appends an unresolved edge even when its target was already found.
   This is a demonstrated precision problem, not proof that the target was lost.

## Repair constraints / order

- Keep full static inference enabled and retain the existing budgets.
- Track which objects/effects were omitted and propagate uncertainty to affected
  calls. Do not simply remove the global flag: a discarded write can change a
  global callback even through a no-argument helper.
- Reduce redundant parent/child regions only while preserving ordering,
  conditional writes, later exact overwrites and escaped pointers.
- Narrow scalar summaries using callback dependencies, retaining selectors,
  guards, pointer aliases and unresolved types. A cb_ name filter is insufficient.
- Regressions must retain valid getter/argument/global-pointer links and must keep
  genuinely affected calls uncertain. Existing callback-safety tests include an
  omitted global callback write in a no-argument helper.

The report establishes reproducible analysis overreach. It does not establish
which storage paths caused the user's first warning or that the user project is
fixed. No product change, package, installation or publication is part of this
investigation.
