# Photo-pattern callback propagation fixes — 2026-10-23

The firmware sources and installed extension version from the two photos are unavailable. These are general C reproductions of the visible compensation/getter and nested diagnostic-table patterns, not a claim to have executed the private firmware.

## Confirmed roots and changes

1. **Numeric work before callback access.** Discarded numeric assignments were excluded from effect summaries but still evaluated their storage paths and values. A 26,000-assignment compensation fixture exhausted the unchanged default 100,000-unit function budget before `ops.cb()`. The evaluator now charges the statement, then skips its slot/value computation only when the result is discarded, the existing dependency analysis marks its scalar storage irrelevant, and both sides have no calls or nested assignments. Unknown types, callback selectors and effectful expressions retain ordinary evaluation.
2. **Container addresses consuming mutation slots.** Copying 96 callbacks under `diagnostic[].check[].check_func` exhausted the 256-slot summary limit because array/structure self-addresses were exported alongside the actual leaf writes. Container identities describe storage shape, not a value written into a pointer field. They remain in memory; copied leaf values are exported as effects. All 96 call sites now resolve completely. Actual 257-callback-field copies still report the limit.
3. **Compound RHS side effects lost.** `voltage += select()` did not evaluate `select()`, so a callback selector remained at its old value and the analyzer reported `first` instead of `second`. Compound assignments now execute the RHS while retaining an unknown arithmetic result. No new arithmetic inference is assumed.

Function/region/mutation/macro limits are unchanged. Callback analysis remains enabled. ELF, AI, configuration defaults and analysis scope were not changed. Analysis cache semantics advance to version 11 to reject stale derived results.

## Reproduction and regression coverage

- Before the fixes, the small compensation case and 96-callback copy both failed. A separate pre-change source snapshot also failed the default-budget compensation case. The compound-assignment test separately reproduced the wrong target before its fix.
- Compensation followed by a getter returning a callback-table pointer.
- Compensation macro expansion, nested loops and `memcpy` before the getter.
- Calls and assignments in numeric RHS expressions and destination indices remain effective.
- Nested table copies through parameters, returned structures and branches; later callback overwrites remain visible.
- All 96 table call sites retained through Worker cold analysis, warm reuse, disk restoration and a saved change from `first` to `second`.
- Existing genuine bounds and callback uncertainty regressions remain enabled.

Primary tests: `test/analysis-budget.test.ts`, `test/callback-effects.test.ts`, `test/analysis-cache-worker.test.mjs`.

## Validation

- `npm test`: 635 passed, 0 failed.
- `npm run test:worker`: 89 passed, 0 failed, including the build and the 96-site cache regression.
- `npm run test:memory`: 6 passed, 0 failed.
- `npm run typecheck` and `git diff --check`: passed.
- Public FreeRTOS single-port corpus (33 files): basic analysis 706 ms; detailed analysis cancelled at 60,157 ms. The previously observed broad propagation performance problem remains unresolved. Temporary evidence: `/tmp/dynsight-photo-freertos.json`.

No Windows/WSL or Diab firmware runtime validation is claimed. No commit, installation or release was performed.
